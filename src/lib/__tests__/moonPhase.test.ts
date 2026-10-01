import { describe, expect, it } from "vitest";
import { moonPhase, moonPhaseName, moonPhasePath } from "../moonPhase";

/** 周期の端（0 付近と 1 付近）は同じ新月なので、距離は円周上で測る */
const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

describe("moonPhase", () => {
  it("is near 0 at known new moons", () => {
    expect(distance(moonPhase(new Date("2024-01-11T11:57:00Z")), 0)).toBeLessThan(0.03);
    expect(distance(moonPhase(new Date("2025-09-21T19:54:00Z")), 0)).toBeLessThan(0.03);
  });

  it("is near 0.5 at known full moons", () => {
    expect(distance(moonPhase(new Date("2024-01-25T17:54:00Z")), 0.5)).toBeLessThan(0.03);
    expect(distance(moonPhase(new Date("2025-10-07T03:47:00Z")), 0.5)).toBeLessThan(0.03);
  });

  it("is near 0.25 at a first quarter and 0.75 at a last quarter", () => {
    expect(distance(moonPhase(new Date("2024-01-18T03:53:00Z")), 0.25)).toBeLessThan(0.03);
    expect(distance(moonPhase(new Date("2024-01-04T03:30:00Z")), 0.75)).toBeLessThan(0.03);
  });

  it("stays within [0, 1) even before the reference date", () => {
    for (const iso of ["1970-01-01T00:00:00Z", "1999-12-31T23:59:59Z", "2026-10-01T00:00:00Z"]) {
      const phase = moonPhase(new Date(iso));
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });
});

describe("moonPhaseName", () => {
  it("names the main phases", () => {
    expect(moonPhaseName(0)).toBe("新月");
    expect(moonPhaseName(0.995)).toBe("新月");
    expect(moonPhaseName(0.25)).toBe("上弦");
    expect(moonPhaseName(0.5)).toBe("満月");
    expect(moonPhaseName(0.75)).toBe("下弦");
  });
});

describe("moonPhasePath", () => {
  const r = 10;
  it("draws nothing lit at the new moon and the whole disc at the full moon", () => {
    expect(moonPhasePath(0, r)).toBe("");
    expect(moonPhasePath(0.5, r)).toMatch(/^M10 0A10 10 0 0 1 10 20A10 10 0 0 1 10 0Z$/);
  });

  it("lights the right side while waxing and the left side while waning", () => {
    const waxing = moonPhasePath(0.25, r);
    const waning = moonPhasePath(0.75, r);
    // 上弦・下弦は端から端までの半円 + 直線（楕円の幅 0）
    expect(waxing).toBe("M10 0A10 10 0 0 1 10 20A0 10 0 0 0 10 0Z");
    expect(waning).toBe("M10 0A10 10 0 0 0 10 20A0 10 0 0 1 10 0Z");
  });

  it("makes a thin crescent narrower than the half, and a gibbous wider", () => {
    const rx = (d: string) => Number(d.split("A")[2]!.split(" ")[0]);
    expect(rx(moonPhasePath(0.1, r))).toBeGreaterThan(0);
    expect(rx(moonPhasePath(0.1, r))).toBeLessThan(r);
    expect(rx(moonPhasePath(0.4, r))).toBeGreaterThan(0);
    expect(rx(moonPhasePath(0.4, r))).toBeLessThan(r);
    // 三日月は凸方向（sweep 0）、凸月は反対側（sweep 1）にふくらむ
    expect(moonPhasePath(0.1, r)).toMatch(/A[\d.]+ 10 0 0 0 10 0Z$/);
    expect(moonPhasePath(0.4, r)).toMatch(/A[\d.]+ 10 0 0 1 10 0Z$/);
  });

  it("accepts a phase outside [0, 1) by wrapping it", () => {
    expect(moonPhasePath(1.25, r)).toBe(moonPhasePath(0.25, r));
    expect(moonPhasePath(-0.25, r)).toBe(moonPhasePath(0.75, r));
  });
});
