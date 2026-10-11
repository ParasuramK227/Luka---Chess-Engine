import { useMemo, useState } from "react";
import type { Arrow, Square } from "../lib/boardTypes";
import { useApp } from "../state/AppContext";
import { BoardView } from "./BoardView";
import { LiveAnalysis, type LiveAnalysisState } from "./LiveAnalysis";
import { MovesTable } from "./MovesTable";
import { Card } from "./ui";

export function BoardPanel() {
  const { board, library, engine, settings } = useApp();
  const [analysis, setAnalysis] = useState<LiveAnalysisState | null>(null);
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

  const moveCells = useMemo(
    () => board.moves.map((m, i) => ({ san: m.san, ply: i + 1, title: m.uci })),
    [board.moves],
  );

  const reviewedCount = library.filter((g) => g.analysis?.status === "complete").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <BoardView evalScore={analysis?.evalForFen ?? null} arrows={arrows} />
      </div>
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