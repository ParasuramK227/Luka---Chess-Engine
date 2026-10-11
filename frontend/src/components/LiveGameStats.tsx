import { useMemo } from "react";
import { badgeMeta, BUCKET_ORDER } from "../lib/format";
import { Card, clsx } from "./ui";

export interface GameStatsPlayer {
  name: string;
  accuracy: number | null;
  avgCpLoss: number | null;
  rating: number | null;
  movesScored: number;
}

export interface GameStatsProps {
  white: GameStatsPlayer;
  black: GameStatsPlayer;
  /** Merged classification tallies keyed by display bucket. */
  tallies: Record<string, number>;
  /** Total plies currently included in the statistics. */
  moveCount: number;
  /** Total plies in the current game (for context). */
  totalPlies: number;
  lastMove?: { label: string; category: string } | null;
  note?: string;
  emptyHint?: string;
}

/** A small colored chip that represents one move category. */
export function CategoryChip({ category, small = false }: { category: string; small?: boolean }) {
  const meta = badgeMeta(category);
  const Icon = meta.icon;
  const size = small ? 12 : 14;
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-sm"
      style={{ width: size, height: size, backgroundColor: meta.color }}
      title={meta.label}
    >
      {Icon ? (
        <Icon size={Math.round(size * 0.62)} className="text-white" strokeWidth={3} />
      ) : meta.glyph ? (
        <span className="font-bold leading-none text-white" style={{ fontSize: Math.round(size * 0.5) }}>
          {meta.glyph}
        </span>
      ) : null}
    </span>
  );
}

function StatRow({ side, player }: { side: "w" | "b"; player: GameStatsPlayer }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={clsx("h-8 w-2 shrink-0 rounded", side === "w" ? "bg-stone-100" : "bg-stone-800 ring-1 ring-stone-700")} />
        <div className="min-w-0">
          <div className="max-w-32 truncate text-sm font-semibold text-stone-200" title={player.name}>
            {player.name}
          </div>
          <div className="text-[10px] text-stone-500">
            {player.rating !== null ? (
              <span title="Luka's own estimate from average centipawn loss — not an official rating">
                ≈{player.rating} est.
              </span>
            ) : (
              <span>no rating yet</span>
            )}
            {player.avgCpLoss !== null ? ` · ${player.avgCpLoss.toFixed(0)} cp avg` : ""}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={clsx("text-xl font-bold tabular-nums", side === "w" ? "text-stone-100" : "text-stone-400")}>
          {player.accuracy !== null && !Number.isNaN(player.accuracy) ? `${player.accuracy.toFixed(1)}%` : "–"}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-stone-500">accuracy</div>
      </div>
    </div>
  );
}

export function LiveGameStats({ white, black, tallies, moveCount, totalPlies, lastMove, note, emptyHint }: GameStatsProps) {
  const tallyKeys = useMemo(() => BUCKET_ORDER.filter((b) => (tallies[b] ?? 0) > 0), [tallies]);
  const empty = moveCount === 0;
  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Game stats"
        right={note ? <span className="text-[10px] text-stone-500">{note}</span> : undefined}
      >
        <div className="space-y-3">
          <StatRow side="w" player={white} />
          <StatRow side="b" player={black} />
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded bg-stone-800/70 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-stone-500">Moves scored</div>
              <div className="text-sm font-semibold tabular-nums text-stone-200">
                {moveCount}
                {totalPlies > 0 ? <span className="text-stone-500">/{totalPlies}</span> : null}
              </div>
            </div>
            <div className="rounded bg-stone-800/70 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-stone-500">Last move</div>
              <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-stone-200">
                {lastMove ? (
                  <>
                    <CategoryChip category={lastMove.category} small />
                    <span className="truncate">{lastMove.label}</span>
                  </>
                ) : (
                  <span className="text-stone-500">–</span>
                )}
              </div>
            </div>
          </div>
          {empty && emptyHint ? <p className="text-[11px] text-stone-600">{emptyHint}</p> : null}
        </div>
      </Card>

      <Card title="Classifications" right={<span className="text-[10px] text-stone-500">merged</span>}>
        {tallyKeys.length ? (
          <div className="flex flex-wrap gap-1.5">
            {tallyKeys.map((bucket) => (
              <span
                key={bucket}
                className="flex items-center gap-1.5 rounded border border-stone-800 bg-stone-900 px-1.5 py-0.5 text-[11px] text-stone-300"
              >
                <CategoryChip category={bucket} small />
                {badgeMeta(bucket).label}
                <span className="font-semibold tabular-nums text-stone-500">{tallies[bucket]}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-stone-600">No classified moves yet.</p>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-stone-600">
          Excellent/Great count as Best, missed wins as Mistake. Rating ≈ Luka's own estimate
          from average centipawn loss — not an official or Chess.com/Lichess figure.
        </p>
      </Card>
    </div>
  );
}