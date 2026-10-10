import type { CounterDb } from "./visitorCounter";

export type UsageScope = "production" | "test";
export const USAGE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const schemaReady = new WeakMap<object, Promise<void>>();

export function usageScope(url: URL): UsageScope {
  return ["shingetsu-layout.com", "www.shingetsu-layout.com"].includes(url.hostname) ? "production" : "test";
}

async function ensureTable(db: CounterDb): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.prepare("CREATE TABLE IF NOT EXISTS usage_declarations (scope TEXT NOT NULL, token_hash TEXT NOT NULL, PRIMARY KEY (scope, token_hash))").run().then(() => undefined);
    schemaReady.set(db, ready);
    ready.catch(() => schemaReady.delete(db));
  }
  return ready;
}

export async function readUsageCount(db: CounterDb, scope: UsageScope): Promise<number> {
  await ensureTable(db);
  const row = await db.prepare("SELECT COUNT(*) AS n FROM usage_declarations WHERE scope = ?").bind(scope).first<{ n: unknown }>();
  if (typeof row?.n !== "number" || !Number.isSafeInteger(row.n) || row.n < 0) throw new Error("Invalid usage count");
  return row.n;
}

export async function recordUsage(db: CounterDb, scope: UsageScope, token: string): Promise<number> {
  if (!USAGE_TOKEN_RE.test(token)) throw new Error("Invalid declaration token");
  await ensureTable(db);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  // UNIQUE 制約で同時送信・応答消失後の再送も同じ 1 件にする。
  await db.prepare("INSERT INTO usage_declarations (scope, token_hash) VALUES (?, ?) ON CONFLICT (scope, token_hash) DO NOTHING").bind(scope, tokenHash).run();
  return readUsageCount(db, scope);
}

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readToken(request: Request): Promise<string | undefined> {
  // 個人情報を受け取る入力欄はなく、本文も小さい JSON だけに限定する。
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256) { await reader.cancel(); return undefined; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
    const fields = Object.keys(body);
    const token = (body as { token?: unknown }).token;
    return fields.length === 1 && typeof token === "string" && USAGE_TOKEN_RE.test(token) ? token : undefined;
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export async function usageReply(request: Request, db: CounterDb | undefined): Promise<Response> {
  const url = new URL(request.url);
  const scope = usageScope(url);
  if (request.method !== "GET" && request.method !== "POST") return reply({ count: null, error: "method_not_allowed" }, 405);
  let token: string | undefined;
  if (request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return reply({ count: null, error: "invalid_origin" }, 403);
    token = await readToken(request);
    if (!token) return reply({ count: null, error: "invalid_request" }, 400);
  }
  if (!db) return reply({ count: null, error: "unavailable", scope }, 503);
  try {
    const count = token ? await recordUsage(db, scope, token) : await readUsageCount(db, scope);
    return reply({ count, scope, ...(token ? { recorded: true } : {}) });
  } catch {
    // 申告キー・リクエスト本文をログへ残さない。
    return reply({ count: null, error: "unavailable", scope }, 503);
  }
}
