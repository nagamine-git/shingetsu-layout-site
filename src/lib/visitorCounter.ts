// 訪問者カウンターの集計ロジック。D1（binding: COUNTER_DB）に累計を 1 行だけ持つ。
// binding が未設定でもビルド・実行は壊さず、API は { count: null } を返す（UI はそれを見て非表示にする）。

/** D1 のうち、ここで使う分だけの最小インターフェース（テストで差し替えやすくするため） */
export interface CounterStatement {
  bind(...values: unknown[]): CounterStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface CounterDb {
  prepare(query: string): CounterStatement;
}

const TOTAL_KEY = "total";

const CREATE_TABLE = "CREATE TABLE IF NOT EXISTS visitor_counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)";
// 読んでから書くと同時アクセスで取りこぼすので、加算と取得を 1 文で行う
const INCREMENT = "INSERT INTO visitor_counters (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n";
const SELECT = "SELECT n FROM visitor_counters WHERE key = ?";

// isolate ごとに 1 回だけ CREATE TABLE する。失敗したら覚えず、次のリクエストでやり直す
const schemaReady = new WeakMap<object, Promise<void>>();

function ensureTable(db: CounterDb): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db
      .prepare(CREATE_TABLE)
      .run()
      .then(() => undefined);
    schemaReady.set(db, ready);
    ready.catch(() => schemaReady.delete(db));
  }
  return ready;
}

function toCount(row: { n?: unknown } | null): number {
  const n = row?.n;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("COUNTER_DB returned a non-numeric count");
  return n;
}

/** 1 回数えて、数えたあとの累計を返す */
export async function recordHit(db: CounterDb): Promise<number> {
  await ensureTable(db);
  return toCount(await db.prepare(INCREMENT).bind(TOTAL_KEY).first<{ n: unknown }>());
}

/** 加算せずに累計だけ返す（まだ 1 回も数えていなければ 0） */
export async function readCount(db: CounterDb): Promise<number> {
  await ensureTable(db);
  const row = await db.prepare(SELECT).bind(TOTAL_KEY).first<{ n: unknown }>();
  return row ? toCount(row) : 0;
}

/** Cloudflare の env から COUNTER_DB を取り出す。未設定・別物なら undefined */
export function getCounterDb(env: unknown): CounterDb | undefined {
  const db = (env as { COUNTER_DB?: unknown } | null | undefined)?.COUNTER_DB;
  return db && typeof (db as CounterDb).prepare === "function" ? (db as CounterDb) : undefined;
}

export interface CounterReply {
  status: number;
  body: { count: number | null; error?: string };
  cacheControl: string;
}

/** GET の累計は短く共有キャッシュさせる。加算（POST）とエラーは必ず素通し */
const COUNT_CACHE_CONTROL = "public, max-age=0, s-maxage=30";
const NO_STORE = "no-store";

export async function counterReply(action: "hit" | "count", db: CounterDb | undefined): Promise<CounterReply> {
  if (!db) return { status: 200, body: { count: null }, cacheControl: action === "count" ? COUNT_CACHE_CONTROL : NO_STORE };
  try {
    if (action === "hit") return { status: 200, body: { count: await recordHit(db) }, cacheControl: NO_STORE };
    return { status: 200, body: { count: await readCount(db) }, cacheControl: COUNT_CACHE_CONTROL };
  } catch (err) {
    console.error("Visitor counter error:", err);
    return { status: 500, body: { count: null, error: "server_error" }, cacheControl: NO_STORE };
  }
}
