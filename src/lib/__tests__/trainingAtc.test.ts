import { describe, expect, it } from "vitest";
import type { Passage } from "../../data/trainingCorpus";
import { freshProfile, type TrainingResult } from "../training";
import { atcEstimate, atcKanaPodium, bestKeystrokeRate, conversionRatio, keystrokeRate, podiumGap } from "../trainingAtc";

const passage = (text: string, reading: string): Passage => ({ id: text, text, reading, topic: "", stage: 5, benchmark: false });

function result(overrides: Partial<TrainingResult>): TrainingResult {
  return { date: new Date(0).toISOString(), mode: "speed", method: "keyboard", material: "short", duration: 60, stage: 5, cpm: 160, accuracy: 97, kana: 160, attempts: 224, errors: 6, interrupted: false, assisted: false, signature: "speed:keyboard:60:5:v1:longmark-v1", ...overrides };
}

describe("ATC gauge", () => {
  it("counts every key press per second, errors included", () => {
    expect(keystrokeRate({ attempts: 224, duration: 60 })).toBeCloseTo(3.73, 2);
    expect(keystrokeRate({ attempts: 10, duration: 0 })).toBe(0);
  });

  it("converts kana/min with the typed passages' text-to-reading ratio", () => {
    const ratio = conversionRatio([passage("温かいお茶を飲む", "あたたかいおちゃをのむ"), passage("これ", "これ")]);
    expect(ratio).toBeCloseTo(10 / 13, 5);
    expect(atcEstimate(160, ratio)).toBe(123);
    expect(conversionRatio([])).toBe(1);
  });

  it("takes the best rate only from timed, unassisted, accurate PC runs", () => {
    const profile = freshProfile();
    profile.results.push(result({ attempts: 240 }));
    profile.results.push(result({ attempts: 600, accuracy: 80 }));
    profile.results.push(result({ attempts: 600, interrupted: true }));
    profile.results.push(result({ attempts: 600, mode: "learn" }));
    profile.results.push(result({ attempts: 600, method: "touch" }));
    expect(bestKeystrokeRate(profile, "keyboard")).toBe(4);
    expect(bestKeystrokeRate(freshProfile(), "keyboard")).toBe(0);
  });

  it("states the gap to the reference podium line", () => {
    expect(podiumGap(107)).toContain(`あと${atcKanaPodium.score - 107}`);
    expect(podiumGap(atcKanaPodium.score)).toContain("届いています");
  });
});
