import { describe, expect, it } from "vitest";
import { curriculum } from "../../data/trainingCorpus";
import { freshProfile, type TrainingProfile, type TrainingResult } from "../training";
import { planSession } from "../trainingPlan";

const now = 1_000_000_000_000;
const allKana = curriculum.map((stage): string => stage.kana).join("");

function skill(latency = 300, due = now + 1e9): TrainingProfile["keyboard"][string] {
  return { samples: 10, recent: Array(10).fill(1), latencies: Array(5).fill(latency), last: 0, due, streak: 2 };
}

function mastered(): TrainingProfile {
  const profile = freshProfile();
  for (const kana of allKana) profile.keyboard[kana] = skill();
  return profile;
}

function result(overrides: Partial<TrainingResult>): TrainingResult {
  return { date: new Date(now - 60_000).toISOString(), mode: "speed", method: "keyboard", material: "short", duration: 60, stage: 5, cpm: 200, accuracy: 97, kana: 200, attempts: 210, errors: 6, interrupted: false, assisted: false, signature: "speed:keyboard:60:5:v1:longmark-v1", ...overrides };
}

describe("planSession", () => {
  it("starts beginners at the suggested learning stage with hints", () => {
    const plan = planSession(freshProfile(), "keyboard", now);
    expect(plan).toMatchObject({ mode: "learn", stage: 0, hints: "auto", duration: 0 });
    expect(plan.title).toContain(curriculum[0].name);
  });

  it("inserts a hint-free review block for beginners once three kana are due, but not twice in a row", () => {
    const profile = freshProfile();
    for (const kana of "はかと") profile.keyboard[kana] = skill(300, now - 1);
    expect(planSession(profile, "keyboard", now).mode).toBe("review");
    profile.results.push(result({ mode: "review", duration: 40, signature: "review:keyboard:0:0:v1:longmark-v1" }));
    expect(planSession(profile, "keyboard", now).mode).toBe("learn");
  });

  it("reviews due kana before anything else once all stages are introduced", () => {
    const profile = mastered();
    profile.keyboard["こ"] = skill(300, now - 1);
    expect(planSession(profile, "keyboard", now)).toMatchObject({ mode: "review", hints: "off" });
  });

  it("drills weaknesses when nothing is due, then alternates away from drill", () => {
    const profile = mastered();
    profile.keyboard["ぬ"] = skill(900);
    const plan = planSession(profile, "keyboard", now);
    expect(plan.mode).toBe("drill");
    expect(plan.targets.map((target): string => target.id)).toEqual(["ぬ"]);
    profile.results.push(result({ mode: "drill", duration: 45, signature: "drill:keyboard:45:5:v1:longmark-v1" }));
    expect(planSession(profile, "keyboard", now)).toMatchObject({ mode: "speed", duration: 60 });
  });

  it("offers a sprint only right after an accurate, comparable 60-second run", () => {
    const profile = mastered();
    profile.results.push(result({ accuracy: 97 }));
    expect(planSession(profile, "keyboard", now)).toMatchObject({ mode: "speed", duration: 15 });
    profile.results.push(result({ accuracy: 94, date: new Date(now - 30_000).toISOString() }));
    expect(planSession(profile, "keyboard", now)).toMatchObject({ mode: "speed", duration: 60 });
  });

  it("always consolidates after a sprint and explains a poor sprint", () => {
    const profile = mastered();
    profile.results.push(result({ accuracy: 97 }), result({ accuracy: 88, duration: 15, signature: "speed:keyboard:15:5:v1:longmark-v1", date: new Date(now - 10_000).toISOString() }));
    const plan = planSession(profile, "keyboard", now);
    expect(plan).toMatchObject({ mode: "speed", duration: 60 });
    expect(plan.reason).toContain("正確さ");
  });

  it("ignores benchmark runs when deciding the last block and keeps touch separate", () => {
    const profile = mastered();
    profile.results.push(result({ accuracy: 97 }), result({ mode: "benchmark", signature: "benchmark:keyboard:60:5:v1:longmark-v1", date: new Date(now - 5_000).toISOString() }));
    expect(planSession(profile, "keyboard", now).duration).toBe(15);
    expect(planSession(profile, "touch", now).mode).toBe("learn");
  });
});
