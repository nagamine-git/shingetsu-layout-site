import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { counterReply, getCounterDb, readCount, recordHit, type CounterDb } from "../visitorCounter";

/** D1 の prepare / bind / first / run だけを、実際の SQLite（node:sqlite）に載せた偽物。SQL の文法ミスも拾える */
function fakeD1(options: { failOn?: RegExp } = {}) {
  const raw = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const db: CounterDb = {
    prepare(query) {
      queries.push(query);
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async first<T>() {
          if (options.failOn?.test(query)) throw new Error("D1_ERROR: boom");
          return ((raw.prepare(query).get(...(values as never[])) as T | undefined) ?? null) as T | null;
        },
        async run() {
          if (options.failOn?.test(query)) throw new Error("D1_ERROR: boom");
          raw.prepare(query).run(...(values as never[]));
          return {};
        },
      };
      return statement;
    },
  };
  return { db, queries, writes: () => queries.filter((q) => /^\s*(INSERT|UPDATE)/i.test(q)).length };
}

describe("recordHit", () => {
  it("adds one per hit and returns the new total", async () => {
    const { db } = fakeD1();
    expect(await recordHit(db)).toBe(1);
    expect(await recordHit(db)).toBe(2);
    expect(await recordHit(db)).toBe(3);
  });

  it("never hands the same total to two concurrent hits", async () => {
    const { db } = fakeD1();
    const totals = await Promise.all(Array.from({ length: 50 }, () => recordHit(db)));
    expect(new Set(totals).size).toBe(50);
    expect(Math.max(...totals)).toBe(50);
  });

  it("increments with a single atomic upsert, not a read-then-write", async () => {
    const { db, queries } = fakeD1();
    await recordHit(db);
    const upserts = queries.filter((q) => /ON CONFLICT/i.test(q));
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatch(/RETURNING\s+n/i);
    expect(queries.some((q) => /^\s*SELECT/i.test(q))).toBe(false);
  });

  it("creates the table once per database, however many hits follow", async () => {
    const { db, queries } = fakeD1();
    await Promise.all([recordHit(db), recordHit(db)]);
    await recordHit(db);
    await readCount(db);
    expect(queries.filter((q) => /CREATE TABLE IF NOT EXISTS/i.test(q))).toHaveLength(1);
  });

  it("retries the table creation after it failed, instead of caching the failure", async () => {
    let broken = true;
    const inner = fakeD1();
    const db: CounterDb = {
      prepare(query) {
        if (broken && /CREATE TABLE/i.test(query)) {
          return { bind: () => db.prepare(query), first: async () => null, run: async () => Promise.reject(new Error("D1_ERROR: down")) };
        }
        return inner.db.prepare(query);
      },
    };
    await expect(recordHit(db)).rejects.toThrow("down");
    broken = false;
    expect(await recordHit(db)).toBe(1);
  });

  it("throws when the database does not return a number", async () => {
    const db: CounterDb = {
      prepare: () => {
        const statement = { bind: () => statement, first: async () => ({ n: "x" }), run: async () => ({}) };
        return statement as never;
      },
    };
    await expect(recordHit(db)).rejects.toThrow();
  });
});

describe("readCount", () => {
  it("is 0 before anything was counted, and reading never counts", async () => {
    const { db, writes } = fakeD1();
    expect(await readCount(db)).toBe(0);
    expect(await readCount(db)).toBe(0);
    expect(writes()).toBe(0);
  });

  it("returns the total after hits", async () => {
    const { db } = fakeD1();
    await recordHit(db);
    await recordHit(db);
    expect(await readCount(db)).toBe(2);
  });
});

describe("getCounterDb", () => {
  it("is undefined when the binding is missing or not a database", () => {
    expect(getCounterDb(undefined)).toBeUndefined();
    expect(getCounterDb({})).toBeUndefined();
    expect(getCounterDb({ COUNTER_DB: "oops" })).toBeUndefined();
    expect(getCounterDb({ COUNTER_DB: {} })).toBeUndefined();
  });

  it("returns the binding when it looks like a database", () => {
    const { db } = fakeD1();
    expect(getCounterDb({ COUNTER_DB: db })).toBe(db);
  });
});

describe("counterReply", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hit: counts and returns the total, uncached", async () => {
    const { db } = fakeD1();
    await counterReply("hit", db);
    const reply = await counterReply("hit", db);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ count: 2 });
    expect(reply.cacheControl).toBe("no-store");
  });

  it("count: returns the total without adding, with a short shared cache", async () => {
    const { db, writes } = fakeD1();
    await counterReply("hit", db);
    const before = writes();
    const reply = await counterReply("count", db);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ count: 1 });
    expect(reply.cacheControl).toMatch(/s-maxage=30/);
    expect(writes()).toBe(before);
  });

  it.each(["hit", "count"] as const)("%s: answers {count:null} when the binding is not set up", async (action) => {
    const reply = await counterReply(action, undefined);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ count: null });
  });

  it.each(["hit", "count"] as const)("%s: answers {count:null} with an error status, uncached, when D1 fails", async (action) => {
    const { db } = fakeD1({ failOn: /./ });
    const reply = await counterReply(action, db);
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({ count: null, error: "server_error" });
    expect(reply.cacheControl).toBe("no-store");
  });
});
