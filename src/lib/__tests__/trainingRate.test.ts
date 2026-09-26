import { describe, expect, it } from "vitest";
import { freshProfile, type TrainingResult } from "../training";
import { bestKeystrokeRate, keystrokeRate } from "../trainingRate";

function result(overrides: Partial<TrainingResult>): TrainingResult {
  return { date: new Date(0).toISOString(), mode: "speed", method: "keyboard", material: "short", duration: 60, stage: 5, cpm: 160, accuracy: 97, kana: 160, attempts: 224, errors: 6, interrupted: false, assisted: false, signature: "speed:keyboard:60:5:v1:longmark-v1", ...overrides };
}

describe("keystroke rate", () => {
  it("counts every key press per second, errors included", () => {
    expect(keystrokeRate({ attempts: 224, duration: 60 })).toBeCloseTo(3.73, 2);
    expect(keystrokeRate({ attempts: 10, duration: 0 })).toBe(0);
  });

  it("takes the best rate only from timed, unassisted, accurate runs of the same method", () => {
    const profile = freshProfile();
    profile.results.push(result({ attempts: 240 }));
    profile.results.push(result({ attempts: 600, accuracy: 80 }));
    profile.results.push(result({ attempts: 600, interrupted: true }));
    profile.results.push(result({ attempts: 600, mode: "learn" }));
    profile.results.push(result({ attempts: 600, method: "touch" }));
    expect(bestKeystrokeRate(profile, "keyboard")).toBe(4);
    expect(bestKeystrokeRate(freshProfile(), "keyboard")).toBe(0);
  });
});
