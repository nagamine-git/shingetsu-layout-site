import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { readUsageCount, recordUsage, usageReply, usageScope } from "../usageCounter";
import type { CounterDb } from "../visitorCounter";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const raw of databases.splice(0)) raw.close(); });
function database(): { db: CounterDb; raw: DatabaseSync; queries: string[] } {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const queries: string[] = [];
  const db: CounterDb = {
    prepare(query) {
      queries.push(query);
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first<T>() { return (raw.prepare(query).get(...values as never[]) ?? null) as T | null; },
        async run() { return raw.prepare(query).run(...values as never[]); },
      };
      return statement;
    },
  };
  return { db, raw, queries };
}
const token = "12345678-1234-4123-8123-123456789abc";
function post(body: unknown = { token }, origin = "https://shingetsu-layout.com", url = "https://shingetsu-layout.com/api/usage"): Request {
  return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("anonymous usage declarations", () => {
  it("starts empty and visits do not add declarations or tokens", async () => {
    const { db, queries } = database();
    for (let index = 0; index < 3; index++) {
      const reply = await usageReply(new Request("https://shingetsu-layout.com/api/usage"), db);
      expect(await reply.json()).toEqual({ count: 0, scope: "production" });
      expect(reply.headers.get("cache-control")).toBe("no-store");
    }
    expect(queries.filter((query) => /^INSERT/i.test(query))).toHaveLength(0);
  });
  it("deduplicates concurrent requests and retries, and only stores a hash", async () => {
    const { db, raw } = database();
    await Promise.all(Array.from({ length: 30 }, () => recordUsage(db, "production", token)));
    expect(await readUsageCount(db, "production")).toBe(1);
    expect(await recordUsage(db, "production", token)).toBe(1);
    const rows = raw.prepare("SELECT * FROM usage_declarations").all();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(["scope", "token_hash"]);
    expect(rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].token_hash).not.toContain(token);
  });
  it("counts distinct declarations without using the visitor counter or test rows", async () => {
    const { db, raw } = database();
    raw.exec("CREATE TABLE visitor_counters (key TEXT PRIMARY KEY, n INTEGER); INSERT INTO visitor_counters VALUES ('total', 999)");
    expect(await recordUsage(db, "test", token)).toBe(1);
    expect(await readUsageCount(db, "production")).toBe(0);
    expect(await recordUsage(db, "production", token)).toBe(1);
    expect(await recordUsage(db, "production", crypto.randomUUID())).toBe(2);
    expect(await readUsageCount(db, "test")).toBe(1);
    expect(raw.prepare("SELECT n FROM visitor_counters").get()?.n).toBe(999);
  });
  it("derives scope from the server request host", () => {
    expect(usageScope(new URL("https://shingetsu-layout.com"))).toBe("production");
    expect(usageScope(new URL("https://www.shingetsu-layout.com"))).toBe("production");
    for (const host of ["localhost", "preview.shingetsu-layout-site.pages.dev", "shingetsu-layout-site.pages.dev", "shingetsu-layout.com.example.com"]) expect(usageScope(new URL(`https://${host}`))).toBe("test");
  });
  it("acknowledges duplicate POSTs with the same authoritative total", async () => {
    const { db } = database();
    for (let index = 0; index < 2; index++) {
      const response = await usageReply(post(), db);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ count: 1, scope: "production", recorded: true });
    }
  });
  it("rejects other origins and invalid or extra fields before writing", async () => {
    const { db, queries } = database();
    expect((await usageReply(post({ token }, "https://example.com"), db)).status).toBe(403);
    expect((await usageReply(post({ token }, ""), db)).status).toBe(403);
    for (const body of [{}, { token: "invalid" }, { token, scope: "production" }, { token, email: "a@example.com" }, [], { token: "x".repeat(300) }]) expect((await usageReply(post(body), db)).status).toBe(400);
    expect((await usageReply(new Request("https://shingetsu-layout.com/api/usage", { method: "POST", headers: { origin: "https://shingetsu-layout.com", "content-type": "application/json" }, body: "{" }), db)).status).toBe(400);
    expect(queries).toHaveLength(0);
  });
  it("reports unavailable storage and failures as null, never zero", async () => {
    for (const db of [undefined, { prepare() { throw new Error("unavailable"); } }]) {
      const response = await usageReply(new Request("https://shingetsu-layout.com/api/usage"), db);
      expect(response.status).toBe(503);
      expect((await response.json()).count).toBeNull();
    }
  });
  it("retries schema initialization after a failure", async () => {
    const inner = database();
    let failed = true;
    const db: CounterDb = { prepare(query) {
      if (failed) return { bind() { return this; }, first: async () => null, run: async () => { throw new Error("unavailable"); } };
      return inner.db.prepare(query);
    } };
    await expect(readUsageCount(db, "production")).rejects.toThrow();
    failed = false;
    expect(await readUsageCount(db, "production")).toBe(0);
  });
});
