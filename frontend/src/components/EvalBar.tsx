import type { EngineScore } from "../api/types";
import { formatEval, scoreToUnits } from "../lib/format";

/**
 * Vertical white/black eval bar. The white share fills bottom-up; both
 * colors are drawn so that either orientation stays readable.
 */
export function EvalBar({
  evalScore,
  note,
  height = "100%",
}: {
  evalScore: EngineScore | null | undefined;
  note?: string;
  height?: string;
}) {
  const units = scoreToUnits(evalScore);
  let frac = 0.5;
  if (units !== null) {
    const capped = Math.max(-900, Math.min(900, units));
    frac = 0.5 + capped / 1800; // -900 → 0, +900 → 1
  }
  const whitePct = Math.round(frac * 1000) / 10;

  return (
    <div className="flex flex-col items-center gap-1" style={{ height }}>
      <div className="relative w-3.5 overflow-hidden rounded border border-stone-700 bg-stone-950" style={{ flex: 1, minHeight: 0 }}>
        <div className="absolute inset-x-0 top-0 bg-stone-900" style={{ height: `${100 - whitePct}%` }} />
        <div className="absolute inset-x-0 bottom-0 bg-stone-100" style={{ height: `${whitePct}%` }} />
        <div className="absolute inset-x-0 top-1/2 h-px bg-red-500/70" />
      </div>
      <div className="w-14 text-center text-[11px] font-semibold tabular-nums text-stone-300" title={note}>
        {formatEval(evalScore)}
      </div>
    </div>
  );
}