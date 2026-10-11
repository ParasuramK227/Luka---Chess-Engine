import { BookOpen, Diamond, Gem, Square, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EngineScore, ReviewMove } from "../api/types";

/** Convert a score to a signed white-POV centipawn value (mate → very large). */
export function scoreToUnits(score: EngineScore | null | undefined): number | null {
  if (!score) return null;
  const pov = score.pov_cp ?? score.cp;
  if (score.type === "mate" && score.mate !== null) {
    const dir = score.mate > 0 ? 1 : -1;
    return dir * (100000 - Math.abs(score.mate));
  }
  if (pov === null || pov === undefined) return null;
  return pov;
}

/** White win probability from a white-POV unit score (documented logistic model). */
export function wpFromUnits(units: number | null | undefined): number {
  if (units === null || units === undefined) return 0.5;
  const cp = (units > 100000) ? 100000 : (units < -100000 ? -100000 : units);
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/** Human-readable eval string, white-POV. */
export function formatEval(score: EngineScore | null | undefined): string {
  const units = scoreToUnits(score);
  if (units === null || units === undefined) return "–";
  if (units >= 100000 - 1000) return `M${100000 - units}`;
  if (units <= -100000 + 1000) return `-M${100000 + units}`;
  if (Math.abs(units) < 5) return "0.00";
  const str = (units / 100).toFixed(2);
  return units > 0 ? `+${str}` : str;
}

/** White advantage in human-friendly terms for the eval bar. */
export function wpFraction(score: EngineScore | null | undefined): number {
  const units = scoreToUnits(score);
  if (units === null) return 0.5;
  const clamp = Math.max(-900, Math.min(900, units));
  return (1 + clamp / 900) / 2;
}

export interface CatMeta {
  label: string;
  cls: string;
  nag: number | null;
}

const CATS: Record<string, CatMeta> = {
  best: { label: "Best", cls: "cat-best", nag: 1 },
  excellent: { label: "Excellent", cls: "cat-excellent", nag: 1 },
  good: { label: "Good", cls: "cat-good", nag: null },
  book: { label: "Book", cls: "cat-book", nag: null },
  forced: { label: "Forced", cls: "cat-forced", nag: null },
  inaccuracy: { label: "Inaccuracy", cls: "cat-inaccuracy", nag: 2 },
  mistake: { label: "Mistake", cls: "cat-mistake", nag: 4 },
  blunder: { label: "Blunder", cls: "cat-blunder", nag: 4 },
  missed_win: { label: "Missed win", cls: "cat-missed_win", nag: 3 },
  great: { label: "Great", cls: "cat-great", nag: 1 },
  brilliant: { label: "Brilliant", cls: "cat-brilliant", nag: 3 },
};

export function catMeta(category: string): CatMeta {
  return CATS[category] ?? { label: category, cls: "", nag: null };
}

/* ---------------------------------------------------------------------------
 * Move-quality badges & merged buckets
 *
 * Badge appearance follows the design picked for the app:
 *   book=brown book · good=green star · brilliant=cyan diamond · best=green
 *   diamond · inaccuracy=orange "?!" · mistake=yellow "?!" · blunder=red "??"
 *   · forced=black rectangle
 * The backend still emits the full category set; ``excellent`` and ``great``
 * display as Best (green diamond) and ``missed_win`` as Mistake (yellow "?!"),
 * and the merged tally uses those aliases so counts stay coherent.
 * ------------------------------------------------------------------------- */

export interface BadgeMeta {
  icon: LucideIcon | null;
  glyph: string | null;
  color: string;
  label: string;
}

export const BADGE_ALIAS: Record<string, string> = {
  excellent: "best",
  great: "best",
  missed_win: "mistake",
};

const BADGES: Record<string, BadgeMeta> = {
  book: { icon: BookOpen, glyph: null, color: "#92400e", label: "Book" },
  forced: { icon: Square, glyph: null, color: "#44403c", label: "Forced" },
  brilliant: { icon: Gem, glyph: null, color: "#0e7490", label: "Brilliant" },
  best: { icon: Diamond, glyph: null, color: "#15803d", label: "Best" },
  good: { icon: Star, glyph: null, color: "#16a34a", label: "Good" },
  inaccuracy: { icon: null, glyph: "?!", color: "#ea580c", label: "Inaccuracy" },
  mistake: { icon: null, glyph: "?!", color: "#ca8a04", label: "Mistake" },
  blunder: { icon: null, glyph: "??", color: "#dc2626", label: "Blunder" },
};

/** Resolve a backend category (with aliases applied) into badge display meta. */
export function badgeMeta(category: string): BadgeMeta {
  const key = BADGE_ALIAS[category] ?? category;
  return BADGES[key] ?? { icon: null, glyph: null, color: "#57534e", label: key };
}

/** Order used for merged classification tallies and review ClassBars. */
export const BUCKET_ORDER = ["best", "book", "good", "forced", "brilliant", "inaccuracy", "mistake", "blunder"];

/** Collapse a backend category into its display bucket (aliases applied). */
export function bucketOf(category: string): string {
  return BADGE_ALIAS[category] ?? category;
}

/** Sum per-move counts into merged display buckets. */
export function talliesFor(moves: Array<{ category: string }>): Record<string, number> {
  const t: Record<string, number> = {};
  for (const m of moves) {
    const b = bucketOf(m.category);
    t[b] = (t[b] ?? 0) + 1;
  }
  return t;
}

/** One scored move shape used by the live stats panel. */
export interface ScoredMove {
  mover: "white" | "black";
  category: string;
  cpLoss: number | null;
  accuracy: number | null;
  applicable: boolean;
}

export interface ScoredSummary {
  accuracy: number | null;
  avgCpLoss: number | null;
  rating: number | null;
  movesScored: number;
}

/**
 * Aggregate eligible per-move stats exactly like the review summary: forced and
 * un-scorable moves are excluded from the means (but still counted in tallies).
 */
export function summarizeEligible(moves: ScoredMove[]): ScoredSummary {
  const scored = moves.filter((m) => m.applicable && m.accuracy !== null && m.cpLoss !== null);
  const accuracy = scored.length ? scored.reduce((a, m) => a + (m.accuracy ?? 0), 0) / scored.length : null;
  const avgCpLoss = scored.length ? scored.reduce((a, m) => a + (m.cpLoss ?? 0), 0) / scored.length : null;
  return {
    accuracy: accuracy === null ? null : Math.round(accuracy * 100) / 100,
    avgCpLoss: avgCpLoss === null ? null : Math.round(avgCpLoss * 100) / 100,
    rating: estimateRating(avgCpLoss),
    movesScored: scored.length,
  };
}

/* ---------------------------------------------------------------------------
 * Rating estimate (Luka - Chess Engine's own documented model)
 *
 * Maps average centipawn loss to an approximate rating with piecewise-linear
 * knots. Estimate only — not an official rating, no Chess.com/Lichess parity.
 * ------------------------------------------------------------------------- */

const RATING_KNOTS: Array<[number, number]> = [
  [240, 600],
  [140, 800],
  [100, 950],
  [70, 1150],
  [50, 1350],
  [35, 1500],
  [25, 1650],
  [18, 1800],
  [12, 1950],
  [8, 2050],
  [0, 2200],
];
const RATING_FLOOR = 400;
const RATING_CEIL = 2800;

export function estimateRating(avgCpLoss: number | null | undefined): number | null {
  if (avgCpLoss === null || avgCpLoss === undefined || Number.isNaN(avgCpLoss)) return null;
  const loss = Math.max(0, avgCpLoss);
  let rating: number | null = null;
  for (let i = 0; i < RATING_KNOTS.length; i++) {
    const [x, y] = RATING_KNOTS[i];
    if (loss >= x) {
      if (i === 0) {
        rating = y;
      } else {
        const [xPrev, yPrev] = RATING_KNOTS[i - 1];
        const t = xPrev > x ? (loss - x) / (xPrev - x) : 0;
        rating = y + (yPrev - y) * t;
      }
      break;
    }
  }
  if (rating === null) rating = RATING_KNOTS[RATING_KNOTS.length - 1][1];
  return Math.round(Math.min(RATING_CEIL, Math.max(RATING_FLOOR, rating)));
}

export function moveLabel(m: ReviewMove): string {
  return `${m.move_number}${m.mover === "white" ? "." : "…"} ${m.san}`;
}

export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${v.toFixed(1)}%`;
}

export function formatCp(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${Math.round(v)}`;
}

export function formatClock(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || Number.isNaN(secs)) return "";
  if (secs >= 3600) {
    return `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
  }
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
}

export function elapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export function friendlyResult(result: string | undefined): string {
  switch (result) {
    case "1-0": return "1–0";
    case "0-1": return "0–1";
    case "1/2-1/2": return "½–½";
    default: return "*";
  }
}