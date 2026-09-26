import { describe, expect, it } from "vitest";
import { trainingCorpus } from "../../data/trainingCorpus";
import { freshProfile, tokenize, type TrainingProfile, type TrainingResult } from "../training";
import { drillChanges, keyHeat, selectDrillPassages, sprintAdvice, sprintTarget, weakTargets } from "../trainingDrill";

function skill(latency: number, accuracy = 1): TrainingProfile["keyboard"][string] {
  const recent = Array.from({ length: 10 }, (_, index): number => (index / 10 < accuracy ? 1 : 0));
  return { samples: 10, recent, latencies: Array(5).fill(latency), last: 0, due: Number.MAX_SAFE_INTEGER, streak: 0 };
}

function result(overrides: Partial<TrainingResult>): TrainingResult {
  return { date: "2026-09-01T00:00:00.000Z", mode: "speed", method: "keyboard", material: "short", duration: 60, stage: 5, cpm: 200, accuracy: 97, kana: 200, attempts: 210, errors: 6, interrupted: false, assisted: false, signature: "speed:keyboard:60:5:v1:longmark-v1", ...overrides };
}

describe("weakTargets", () => {
  it("returns nothing without data", () => {
    expect(weakTargets(freshProfile(), "keyboard", 0)).toEqual([]);
  });

  it("picks kana that are slow relative to the personal median, not by absolute value", () => {
    const profile = freshProfile();
    for (const kana of "はかとたくうき") profile.keyboard[kana] = skill(300);
    profile.keyboard["こ"] = skill(600); // 2 倍遅い
    const targets = weakTargets(profile, "keyboard", 0);
    expect(targets.map((target): string => target.id)).toEqual(["こ"]);
    expect(targets[0]).toMatchObject({ kind: "kana", baseline: 600 });
    expect(targets[0].reason).toContain("倍遅い");
  });

  it("treats a ☆゛ shortcut such as じゃ as one target and finds passages that contain it", () => {
    const profile = freshProfile();
    for (const kana of "はかとたくうき") profile.keyboard[kana] = skill(300);
    profile.keyboard["じゃ"] = skill(700);
    const targets = weakTargets(profile, "keyboard", 0);
    expect(targets.map((target): string => target.id)).toEqual(["じゃ"]);
    // 得意な文を混ぜない設定（interleave 0）で、じゃ を含む文が尽きるまでは、それだけが選ばれる
    const picked = selectDrillPassages(profile, targets, () => .5, 0, 10);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((passage): boolean => passage.reading.includes("じゃ"))).toBe(true);
  });

  it("covers every ☆゛ shortcut in the corpus except the practically unused ぢゃ", () => {
    const tokens = new Set(trainingCorpus.flatMap((passage): string[] => tokenize(passage.reading).map((token): string => token.text)));
    for (const kana of ["ぴょ", "びょ", "じょ", "ぎょ", "でぃ", "ぴゅ", "びゅ", "じゅ", "ぎゅ", "でゅ", "ぴゃ", "びゃ", "じゃ", "ぎゃ", "みゃ", "みゅ", "みょ"]) expect(tokens, kana).toContain(kana);
  });

  it("picks kana with low hint-free accuracy", () => {
    const profile = freshProfile();
    for (const kana of "はかとたくうき") profile.keyboard[kana] = skill(300);
    profile.keyboard["こ"] = skill(300, .6);
    expect(weakTargets(profile, "keyboard", 0)[0]).toMatchObject({ id: "こ", reason: "正答率 60%" });
  });

  it("picks pairs at least 1.5x slower than the personal pair median and labels them", () => {
    const profile = freshProfile();
    for (const pair of ["as", "sd", "df", "jk", "kl", "l;"]) profile.pairs.keyboard[pair] = { samples: 6, milliseconds: 200 };
    profile.pairs.keyboard["dk"] = { samples: 6, milliseconds: 320 }; // 1.6 倍
    profile.pairs.keyboard["kd"] = { samples: 6, milliseconds: 260 }; // 1.3 倍 → 対象外
    profile.pairs.keyboard["qz"] = { samples: 2, milliseconds: 900 }; // 標本不足
    const targets = weakTargets(profile, "keyboard", 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: "pair", id: "dk", label: "D → K", baseline: 320 });
  });

  it("caps the list and orders by severity", () => {
    const profile = freshProfile();
    for (const kana of "はかとたくうきこしいんの") profile.keyboard[kana] = skill(300);
    profile.keyboard["あ"] = skill(450);
    profile.keyboard["お"] = skill(900);
    profile.keyboard["え"] = skill(300, .5);
    const targets = weakTargets(profile, "keyboard", 0, 2);
    expect(targets).toHaveLength(2);
    expect(targets.map((target): string => target.id)).toContain("お");
  });
});

describe("selectDrillPassages", () => {
  it("prefers passages containing the targets while interleaving general passages", () => {
    const profile = freshProfile();
    const targets = weakTargets({ ...profile, keyboard: { ...Object.fromEntries(Array.from("はかとたくうき").map((kana): [string, ReturnType<typeof skill>] => [kana, skill(300)])), "し": skill(900) } }, "keyboard", 0);
    expect(targets[0].id).toBe("し");
    let seed = 17;
    const random = (): number => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const passages = selectDrillPassages(profile, targets, random, .3);
    expect(passages.length).toBeGreaterThan(3);
    const hits = passages.filter((passage): boolean => passage.reading.includes("し")).length;
    expect(hits / passages.length).toBeGreaterThan(.55);
    expect(hits).toBeLessThan(passages.length); // 得意な文も混ざる
    expect(new Set(passages.map((passage): string => passage.id)).size).toBe(passages.length);
  });

  it("falls back to general passages when there are no targets", () => {
    const passages = selectDrillPassages(freshProfile(), [], (): number => .5);
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every((passage): boolean => trainingCorpus.includes(passage))).toBe(true);
  });

  it("matches pair targets against the primary key path", () => {
    const passage = trainingCorpus.find((item): boolean => tokenize(item.reading).map((token): string => token.paths[0]).join("").includes("dk"));
    expect(passage).toBeDefined();
    const passages = selectDrillPassages(freshProfile(), [{ kind: "pair", id: "dk", label: "D → K", reason: "", baseline: 300 }], (): number => .99, 0);
    expect(passages.some((item): boolean => tokenize(item.reading).map((token): string => token.paths[0]).join("").includes("dk"))).toBe(true);
  });
});

describe("drillChanges", () => {
  it("compares the session median against the baseline for kana and pairs", () => {
    const targets = [
      { kind: "kana" as const, id: "こ", label: "こ", reason: "", baseline: 600 },
      { kind: "pair" as const, id: "dk", label: "D → K", reason: "", baseline: 320 },
    ];
    const changes = drillChanges(targets, [
      { text: "こ", milliseconds: 400, strokes: 1, errors: 0, hinted: false },
      { text: "こ", milliseconds: 500, strokes: 1, errors: 0, hinted: false },
      { text: "こ", milliseconds: 100, strokes: 1, errors: 1, hinted: false }, // ミスは除外
      { text: "こ", milliseconds: 100, strokes: 1, errors: 0, hinted: true }, // ヒントは除外
    ], [{ pair: "dk", milliseconds: 250 }, { pair: "kd", milliseconds: 900 }]);
    expect(changes[0]).toMatchObject({ before: 600, after: 450, samples: 2 });
    expect(changes[1]).toMatchObject({ before: 320, after: 250, samples: 1 });
  });
});

describe("sprintTarget", () => {
  it("uses the comparable speed best across normal durations, times the boost", () => {
    const profile = freshProfile();
    profile.results.push(result({ cpm: 200 }), result({ cpm: 240, duration: 30, signature: "speed:keyboard:30:5:v1:longmark-v1" }));
    profile.results.push(result({ cpm: 400, accuracy: 90 })); // 正確率不足
    profile.results.push(result({ cpm: 500, signature: "speed:keyboard:15:5:v1:longmark-v1", duration: 15 })); // 疾走自身は除外
    profile.results.push(result({ cpm: 600, material: "paragraph" }));
    profile.results.push(result({ cpm: 900, signature: "speed:keyboard:60:5:v1" })); // 旧入力規則は除外
    expect(sprintTarget(profile, "keyboard", "short")).toBe(Math.round(240 * 1.08));
    expect(sprintTarget(profile, "keyboard", "paragraph")).toBe(Math.round(600 * 1.08));
    expect(sprintTarget(profile, "touch", "short")).toBe(0);
  });
});

describe("sprintAdvice", () => {
  it("guides toward consolidation after exceeding the target", () => {
    expect(sprintAdvice(260, 96, 250).title).toContain("定着");
    expect(sprintAdvice(260, 85, 250).title).toContain("速すぎた");
    expect(sprintAdvice(200, 96, 250).title).toContain("もう一本");
    expect(sprintAdvice(200, 96, 0).title).toContain("基準");
  });
});

describe("keyHeat", () => {
  it("aggregates incoming pairs per key and normalises within the person", () => {
    const heats = keyHeat({ ad: { samples: 4, milliseconds: 200 }, sd: { samples: 4, milliseconds: 400 }, ak: { samples: 5, milliseconds: 600 }, qz: { samples: 1, milliseconds: 5000 } });
    const d = heats.find((heat): boolean => heat.key === "d");
    const k = heats.find((heat): boolean => heat.key === "k");
    const z = heats.find((heat): boolean => heat.key === "z");
    expect(d).toMatchObject({ milliseconds: 300, samples: 8, level: 0 });
    expect(k).toMatchObject({ milliseconds: 600, level: 1 });
    expect(z?.level).toBe(-1);
  });

  it("handles a single key without dividing by zero", () => {
    expect(keyHeat({ ad: { samples: 4, milliseconds: 200 } })[0].level).toBe(0);
  });
});
