import { useEffect, useMemo, useState } from "react";
import type { Arrow, Square } from "../lib/boardTypes";
import { useApp } from "../state/AppContext";
import { summarizeEligible, talliesFor } from "../lib/format";
import { BoardView } from "./BoardView";
import { LiveAnalysis, type LiveAnalysisState } from "./LiveAnalysis";
import { LiveGameStats, type GameStatsPlayer } from "./LiveGameStats";
import { MovesTable } from "./MovesTable";
import { Card } from "./ui";

interface MoveStat {
  /** FEN after the move (= board.fens[ply]) so stale stats self-expire. */
  fen: string;
  ply: number;
  uci: string;
  san: string;
  mover: "white" | "black";
  category: string;
  cpLoss: number | null;
  accuracy: number | null;
  applicable: boolean;
}

export function BoardPanel() {
  const { board, library, engine, settings } = useApp();
  const [analysis, setAnalysis] = useState<LiveAnalysisState | null>(null);
  const [moveStats, setMoveStats] = useState<Record<number, MoveStat>>({});
  const showArrow = settings?.board?.arrow_best_move ?? true;

  const arrows = useMemo<Arrow[]>(() => {
    if (!showArrow || !analysis?.pvUci?.length || !analysis.analyzing) return [];
    const [first, second] = analysis.pvUci;
    if (!first) return [];
    const toSquare = (uci: string): Square => `${uci[2]}${uci[3]}` as Square;
    const fromSquare = (uci: string): Square => `${uci[0]}${uci[1]}` as Square;
    const result: Arrow[] = [];
    result.push([fromSquare(first), toSquare(first), "#34d399"]);
    if (second) result.push([fromSquare(second), toSquare(second), "#fbbf24"]);
    return result;
  }, [analysis, showArrow]);

  // Record auto-analysis results per ply as they finish. Stats are keyed by
  // ply and validated against the current fens, so replaying a line reuses the
  // stored numbers and a changed line naturally drops them.
  const liveMove = analysis?.move;
  useEffect(() => {
    if (!liveMove) return;
    setMoveStats((prev) => ({
      ...prev,
      [liveMove.ply]: {
        fen: liveMove.fen,
        ply: liveMove.ply,
        uci: liveMove.uci,
        san: liveMove.san,
        mover: liveMove.mover,
        category: liveMove.category,
        cpLoss: liveMove.cpLoss,
        accuracy: liveMove.accuracy,
        applicable: Boolean(liveMove.metrics?.applicable),
      },
    }));
  }, [liveMove]);

  const validStats = useMemo<MoveStat[]>(() => {
    const out: MoveStat[] = [];
    for (const s of Object.values(moveStats)) {
      if (s.ply <= 0 || s.ply > board.cursor) continue;
      if (board.fens[s.ply] === s.fen) out.push(s);
    }
    return out.sort((a, b) => a.ply - b.ply);
  }, [moveStats, board.cursor, board.fens]);

  const summarize = useMemo(() => {
    const whiteMoves = validStats.filter((m) => m.mover === "white");
    const blackMoves = validStats.filter((m) => m.mover === "black");
    return {
      white: summarizeEligible(whiteMoves),
      black: summarizeEligible(blackMoves),
    };
  }, [validStats]);

  const mergedTallies = useMemo(() => talliesFor(validStats), [validStats]);

  const lastMoveData = useMemo(() => {
    const stat = validStats.length ? validStats[validStats.length - 1] : null;
    if (!stat) return null;
    const number = Math.ceil(stat.ply / 2);
    return { label: `${number}${stat.mover === "white" ? "." : "…"} ${stat.san}`, category: stat.category };
  }, [validStats]);

  const moveBadges = useMemo(() => {
    if (board.cursor <= 0) return [];
    const stat = moveStats[board.cursor];
    if (!stat || stat.fen !== board.fens[board.cursor]) return [];
    return [{ square: `${stat.uci[2]}${stat.uci[3]}`, category: stat.category }];
  }, [moveStats, board.cursor, board.fens]);

  const players: Record<"white" | "black", GameStatsPlayer> = {
    white: {
      name: "White",
      accuracy: summarize.white.accuracy,
      avgCpLoss: summarize.white.avgCpLoss,
      rating: summarize.white.rating,
      movesScored: summarize.white.movesScored,
    },
    black: {
      name: "Black",
      accuracy: summarize.black.accuracy,
      avgCpLoss: summarize.black.avgCpLoss,
      rating: summarize.black.rating,
      movesScored: summarize.black.movesScored,
    },
  };

  const moveCells = useMemo(
    () => board.moves.map((m, i) => ({ san: m.san, ply: i + 1, title: m.uci })),
    [board.moves],
  );

  const reviewedCount = library.filter((g) => g.analysis?.status === "complete").length;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,auto)_320px_340px]">
      <div>
        <BoardView evalScore={analysis?.evalForFen ?? null} arrows={arrows} moveBadges={moveBadges} />
      </div>
      <LiveGameStats
        white={players.white}
        black={players.black}
        tallies={mergedTallies}
        moveCount={validStats.length}
        totalPlies={board.cursor}
        lastMove={lastMoveData}
        note="live · after each move"
        emptyHint={
          engine?.available
            ? "Make a move — the engine analyses it automatically."
            : "Engine unavailable — no live statistics."
        }
      />
      <div className="flex flex-col gap-4">
        <Card title="Engine analysis" right={engine?.available ? <span className="text-[10px] text-emerald-400">local · {engine.name ?? "stockfish"}</span> : <span className="text-[10px] text-red-400">offline</span>}>
          <LiveAnalysis onAnalysisChange={setAnalysis} />
        </Card>
        <Card title="Moves">
          <MovesTable cells={moveCells} selectedPly={board.cursor} onSelect={(ply) => board.navigateToPly(ply)} maxHeight="16rem" />
        </Card>
        {reviewedCount > 0 ? (
          <p className="text-center text-[11px] text-stone-600">
            {reviewedCount} reviewed game{reviewedCount === 1 ? "" : "s"} in library — see the Review tab.
          </p>
        ) : null}
      </div>
    </div>
  );
}