import { describe, expect, it } from "vitest";
import {
  badgeMeta,
  bucketOf,
  catMeta,
  estimateRating,
  formatEval,
  scoreToUnits,
  summarizeEligible,
  talliesFor,
  wpFromUnits,
} from "../lib/format";

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

describe("badgeMeta", () => {
  it("follows the icon/color spec per category", () => {
    expect(badgeMeta("book").icon).toBeTruthy();
    expect(badgeMeta("book").color).toBe("#92400e"); // brown book
    expect(badgeMeta("good").icon).toBeTruthy();
    expect(badgeMeta("good").color).toBe("#16a34a"); // green star
    expect(badgeMeta("brilliant").color).toBe("#0e7490"); // cyan diamond
    expect(badgeMeta("best").color).toBe("#15803d"); // green diamond
    expect(badgeMeta("inaccuracy").glyph).toBe("?!");
    expect(badgeMeta("inaccuracy").color).toBe("#ea580c"); // orange
    expect(badgeMeta("mistake").glyph).toBe("?!");
    expect(badgeMeta("mistake").color).toBe("#ca8a04"); // yellow
    expect(badgeMeta("blunder").glyph).toBe("??");
    expect(badgeMeta("blunder").color).toBe("#dc2626"); // red
    expect(badgeMeta("forced").color).toBe("#44403c"); // black rectangle
  });

  it("aliases excellent/great to best and missed_win to mistake", () => {
    expect(badgeMeta("excellent").color).toBe("#15803d");
    expect(badgeMeta("great").color).toBe("#15803d");
    expect(badgeMeta("missed_win").glyph).toBe("?!");
    expect(badgeMeta("missed_win").color).toBe("#ca8a04");
    expect(bucketOf("excellent")).toBe("best");
    expect(bucketOf("great")).toBe("best");
    expect(bucketOf("missed_win")).toBe("mistake");
    expect(bucketOf("best")).toBe("best");
  });

  it("falls back gracefully for unknown categories", () => {
    const meta = badgeMeta("alien");
    expect(meta.icon).toBeNull();
    expect(meta.glyph).toBeNull();
    expect(meta.color).toBeTruthy();
  });
});

describe("talliesFor", () => {
  it("merges aliased categories into display buckets", () => {
    const t = talliesFor([
      { category: "best" },
      { category: "excellent" },
      { category: "great" },
      { category: "mistake" },
      { category: "missed_win" },
      { category: "book" },
    ]);
    expect(t).toEqual({ best: 3, mistake: 2, book: 1 });
  });
});

describe("summarizeEligible", () => {
  it("averages only applicable scored moves", () => {
    const s = summarizeEligible([
      { mover: "white", category: "best", cpLoss: 0, accuracy: 100, applicable: true },
      { mover: "white", category: "inaccuracy", cpLoss: 100, accuracy: 60, applicable: true },
      { mover: "white", category: "forced", cpLoss: 0, accuracy: 100, applicable: false },
    ]);
    expect(s.movesScored).toBe(2);
    expect(s.accuracy).toBe(80);
    expect(s.avgCpLoss).toBe(50);
    expect(s.rating).not.toBeNull();
  });

  it("is empty for no eligible moves", () => {
    const s = summarizeEligible([{ mover: "black", category: "forced", cpLoss: 0, accuracy: 100, applicable: false }]);
    expect(s.movesScored).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(s.avgCpLoss).toBeNull();
    expect(s.rating).toBeNull();
  });
});

describe("estimateRating", () => {
  it("is null without data", () => {
    expect(estimateRating(null)).toBeNull();
    expect(estimateRating(undefined)).toBeNull();
    expect(estimateRating(Number.NaN)).toBeNull();
  });

  it("maps knots and clamps", () => {
    expect(estimateRating(240)).toBe(600);
    expect(estimateRating(400)).toBe(600); // clamps at floor
    expect(estimateRating(100)).toBe(950);
    expect(estimateRating(50)).toBe(1350);
    expect(estimateRating(0)).toBe(2200);
    const mid = estimateRating(120) as number;
    expect(mid).toBeGreaterThan(800);
    expect(mid).toBeLessThan(950);
  });
});