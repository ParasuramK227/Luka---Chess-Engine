import { describe, expect, it } from "vitest";
import { catMeta, formatEval, scoreToUnits, wpFromUnits } from "../lib/format";

describe("scoreToUnits", () => {
  it("is null without a score", () => {
    expect(scoreToUnits(null)).toBeNull();
    expect(scoreToUnits(undefined)).toBeNull();
  });

  it("prefers pov_cp when present", () => {
    expect(scoreToUnits({ type: "cp", cp: -120, pov_cp: 200, mate: null })).toBe(200);
  });

  it("falls back to cp", () => {
    expect(scoreToUnits({ type: "cp", cp: -120, pov_cp: null, mate: null })).toBe(-120);
  });

  it("maps mates to large offsets", () => {
    expect(scoreToUnits({ type: "mate", cp: null, pov_cp: null, mate: 3 })).toBe(100000 - 3);
    expect(scoreToUnits({ type: "mate", cp: null, pov_cp: null, mate: -2 })).toBe(-(100000 - 2));
  });
});

describe("wpFromUnits", () => {
  it("is 0.5 for equal positions", () => {
    expect(wpFromUnits(0)).toBeCloseTo(0.5, 6);
  });

  it("is monotone increasing", () => {
    expect(wpFromUnits(-200)).toBeLessThan(wpFromUnits(0));
    expect(wpFromUnits(0)).toBeLessThan(wpFromUnits(200));
  });

  it("saturates for huge mates", () => {
    expect(wpFromUnits(100000)).toBeGreaterThan(0.999);
    expect(wpFromUnits(-100000)).toBeLessThan(0.001);
  });
});

describe("formatEval", () => {
  it("formats centipawns in pawns", () => {
    expect(formatEval({ type: "cp", cp: 120, pov_cp: 120, mate: null })).toBe("+1.20");
    expect(formatEval({ type: "cp", cp: -34, pov_cp: -34, mate: null })).toBe("-0.34");
    expect(formatEval({ type: "cp", cp: 0, pov_cp: 0, mate: null })).toBe("0.00");
  });

  it("formats mate scores", () => {
    expect(formatEval({ type: "mate", cp: null, pov_cp: null, mate: 5 })).toBe("M5");
    expect(formatEval({ type: "mate", cp: null, pov_cp: null, mate: -3 })).toBe("-M3");
  });
});

describe("catMeta", () => {
  it("maps known categories", () => {
    expect(catMeta("blunder").label).toBe("Blunder");
    expect(catMeta("blunder").cls).toBe("cat-blunder");
  });

  it("falls back gracefully", () => {
    const meta = catMeta("alien");
    expect(meta.label).toBe("alien");
    expect(meta.cls).toBe("");
  });
});