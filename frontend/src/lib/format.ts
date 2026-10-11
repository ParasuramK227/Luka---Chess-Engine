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