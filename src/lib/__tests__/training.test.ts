import { describe, expect, it } from "vitest";
import { benchmarkCorpus } from "../../data/trainingCorpus";
import { freshProfile, readProfile, saveSession, tokenize, TrainingRun, updateSkills } from "../training";

describe("tokenize", () => {
  it("splits readings into layout tokens with key paths", () => {
    const tokens = tokenize("きゃ、");
    expect(tokens.map((token): string => token.text)).toEqual(["きゃ", "、"]);
    expect(tokens[0].paths.length).toBeGreaterThan(0);
  });

  it("accepts a hyphen for the long mark", () => {
    expect(tokenize("ー")[0].paths).toContain("-");
  });
});

describe("TrainingRun", () => {
  it("counts errors without advancing and records inter-key pairs", () => {
    const run = new TrainingRun([benchmarkCorpus[0]]);
    const first = run.token!;
    const path = first.paths[0];
    expect(run.press("zzz", 0)).toBe(false);
    expect(run.errors).toBe(1);
    let time = 0;
    for (const key of path) { time += 100; expect(run.press(key, time)).toBe(true); }
    expect(run.completed).toBe(Array.from(first.text).length);
    expect(run.samples[0]).toMatchObject({ text: first.text, errors: 1 });
    expect(run.pairs.length).toBe(Math.max(0, path.length - 1));
    expect(run.cpm(60_000)).toBeGreaterThan(0);
  });

  it("accepts the ☆゛ shortcut and the long way for 濁拗音, hinting the shortcut first", () => {
    const passage = { id: "t", text: "邪魔", reading: "じゃま", topic: "", stage: 4, benchmark: false };
    expect(tokenize("じゃ")[0].paths[0]).toBe("klc");
    expect(tokenize("みゃ")[0].paths[0]).toBe("kl,");
    expect(tokenize("ちゃ")[0].paths[0]).toBe("kl/");
    const short = new TrainingRun([passage]);
    for (const [index, key] of ["k", "l", "c"].entries()) expect(short.press(key, index * 100)).toBe(true);
    expect(short.completed).toBe(2);
    expect(short.errors).toBe(0);
    const long = new TrainingRun([passage]);
    for (const [index, key] of ["e", "l", "k", "b"].entries()) expect(long.press(key, index * 100)).toBe(true);
    expect(long.completed).toBe(2);
    expect(long.errors).toBe(0);
  });
});

describe("tokenize with the v9.0 ☆゛ columns", () => {
  it("lists the ち-column and み-column shortcuts as one-unit paths", () => {
    for (const [kana, shortcut] of [["ちょ", "klp"], ["ちゅ", "kl;"], ["ちゃ", "kl/"], ["みょ", "kli"], ["みゅ", "klk"], ["みゃ", "kl,"]]) {
      expect(tokenize(kana).map((token): string => token.text), kana).toEqual([kana]);
      expect(tokenize(kana)[0].paths, kana).toContain(shortcut);
    }
  });

  it("hints ち＋ょ and み＋ょ before the equally short shortcut, because ょ is a single key", () => {
    expect(tokenize("ちょ")[0].paths.slice(0, 2)).toEqual(["d;t", "klp"]);
    expect(tokenize("みょ")[0].paths.slice(0, 2)).toEqual(["dit", "kli"]);
  });

  it("no longer has a ☆゛ shortcut for でぃ・でゅ・ぢゃ: they are で＋ぃ・で＋ゅ・ぢ＋ゃ", () => {
    expect(tokenize("でぃ").map((token): string => token.text)).toEqual(["でぃ"]);
    expect(tokenize("でぃ")[0].paths).toEqual(["rlil"]);
    expect(tokenize("でゅ")[0].paths[0]).toBe("rlkv");
    expect(tokenize("ぢゃ")[0].paths[0]).toBe("d;lkb");
    for (const path of ["klt", "klg", "klb"]) expect(tokenize("でぃでゅぢゃ").flatMap((token): string[] => token.paths)).not.toContain(path);
  });
});

describe("profile persistence", () => {
  it("round-trips drill and sprint results and skills through readProfile", () => {
    const profile = freshProfile();
    saveSession(profile, { date: new Date(0).toISOString(), mode: "drill", method: "keyboard", material: "short", duration: 45, stage: 5, cpm: 180, accuracy: 96, kana: 135, attempts: 140, errors: 5, interrupted: false, assisted: false, signature: "drill:keyboard:45:5:v1:longmark-v1" },
      [{ text: "か", milliseconds: 300, strokes: 1, errors: 0, hinted: false }], [{ pair: "dk", milliseconds: 300 }], []);
    const restored = readProfile(JSON.stringify(profile));
    expect(restored.results).toHaveLength(1);
    expect(restored.results[0].mode).toBe("drill");
    expect(restored.keyboard["か"]?.samples).toBe(1);
    expect(restored.pairs.keyboard.dk?.milliseconds).toBe(300);
  });

  it("drops unknown modes and malformed entries", () => {
    const raw = JSON.stringify({ version: 1, keyboard: {}, touch: {}, pairs: { keyboard: {}, touch: {} }, results: [{ date: "x" }, { date: new Date(0).toISOString(), mode: "bogus" }], recent: [] });
    expect(readProfile(raw).results).toEqual([]);
  });

  it("schedules spaced review only for hint-free, error-free retrievals", () => {
    const stats = {};
    updateSkills(stats, [{ text: "か", milliseconds: 300, strokes: 1, errors: 1, hinted: false }], 0);
    expect(stats["か" as keyof typeof stats]).toMatchObject({ streak: 0, due: 600_000 });
    updateSkills(stats, [{ text: "か", milliseconds: 300, strokes: 1, errors: 0, hinted: false }], 600_000);
    expect(stats["か" as keyof typeof stats]).toMatchObject({ streak: 1, due: 600_000 + 86_400_000 });
  });
});
