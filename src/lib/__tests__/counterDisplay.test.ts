import { describe, expect, it } from "vitest";
import { countUpProgress, countUpValue, formatCount } from "../counterDisplay";

describe("formatCount", () => {
  it("groups digits with commas", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("countUpProgress", () => {
  it("runs from 0 to 1 and clamps outside the duration", () => {
    expect(countUpProgress(0, 1200)).toBe(0);
    expect(countUpProgress(1200, 1200)).toBe(1);
    expect(countUpProgress(5000, 1200)).toBe(1);
    expect(countUpProgress(-10, 1200)).toBe(0);
  });

  it("eases out: more than half way at half the time, and never goes backwards", () => {
    expect(countUpProgress(600, 1200)).toBeGreaterThan(0.5);
    let last = 0;
    for (let t = 0; t <= 1200; t += 40) {
      const p = countUpProgress(t, 1200);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it("is already done for a zero or negative duration", () => {
    expect(countUpProgress(0, 0)).toBe(1);
  });
});

describe("countUpValue", () => {
  it("is a whole number between 0 and the target, ending exactly on the target", () => {
    expect(countUpValue(0, 4321)).toBe(0);
    expect(countUpValue(1, 4321)).toBe(4321);
    const mid = countUpValue(0.4, 4321);
    expect(Number.isInteger(mid)).toBe(true);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(4321);
  });
});
