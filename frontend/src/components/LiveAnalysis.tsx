import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useApp } from "../state/AppContext";
import { useJob } from "../hooks/useJob";
import type { AnalysisResult, AnalyzeMoveResult, EvalLine, EngineScore, ReviewMove } from "../api/types";
import { formatEval } from "../lib/format";
import { Button, ProgressBar, Select, Spinner, clsx } from "./ui";

export interface LiveMoveInfo {
  /** FEN (after the move) this classification applies to. */
  fen: string;
  ply: number;
  category: string;
  categoryLabel: string;
  cpLoss: number | null;
  accuracy: number | null;
  san: string;
  uci: string;
  mover: "white" | "black";
  metrics: ReviewMove["metrics"];
}

export interface LiveAnalysisState {
  /** Best line of the last finished analysis for the *current* fen, if any. */
  evalForFen: EngineScore | null;
  firstLine?: EvalLine | null;
  pvUci: string[];
  analyzing: boolean;
  /** Classification of the last played move (auto-analysis), if known. */
  move?: LiveMoveInfo | null;
}

const AUTO_DEBOUNCE_MS = 400;

export function LiveAnalysis({
  onAnalysisChange,
}: {
  onAnalysisChange?: (state: LiveAnalysisState) => void;
}) {
  const { board, analyzeDepth, setAnalyzeDepth, analyzeMultipv, setAnalyzeMultipv, engine, settings, toast } = useApp();
  const { jobId, snapshot, result, running, start, cancel, clear } = useJob();

  const autoAnalyze = settings?.board?.auto_analyze ?? true;
  const liveDepth = settings?.board?.live_depth ?? 18;

  const [lines, setLines] = useState<EvalLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [moveInfo, setMoveInfo] = useState<LiveMoveInfo | null>(null);
  const [autoMode, setAutoMode] = useState(false);

  // Position marker of the analysis that produced `result`/`lines`.
  const [analyzedFen, setAnalyzedFen] = useState<string | null>(null);

  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId;

  // What the *next* (auto) analysis corresponds to, including the ply that made
  // the move, so classification can be attributed to the right ply later.
  const pendingRef = useRef<{ fen: string; prevFen: string | null; ply: number } | null>(null);

  const handleResult = useCallback((r: unknown) => {
    const res = r as AnalysisResult;
    if (res?.lines) setLines(res.lines);
    const moveResult = (r as AnalyzeMoveResult).move;
    const pending = pendingRef.current;
    if (moveResult && pending && moveResult.uci) {
      setMoveInfo({
        fen: pending.fen,
        ply: pending.ply,
        category: moveResult.category,
        categoryLabel: moveResult.category_label,
        cpLoss: moveResult.metrics?.cp_loss ?? null,
        accuracy: moveResult.metrics?.accuracy ?? null,
        san: moveResult.san,
        uci: moveResult.uci,
        mover: moveResult.mover,
        metrics: moveResult.metrics,
      });
    }
  }, []);

  const startAnalysis = useCallback(async () => {
    if (!board.fen) return;
    pendingRef.current = null;
    setError(null);
    setAutoMode(false);
    try {
      const { job_id } = await api.analyze({
        fen: board.fen,
        depth: analyzeDepth || undefined,
        multipv: analyzeMultipv,
      });
      setAnalyzedFen(board.fen);
      start(job_id);
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, "error");
    }
  }, [board.fen, analyzeDepth, analyzeMultipv, start, toast]);

  /** Automatic per-move analysis: classify the move just played at depth 18. */
  const runAuto = useCallback(async () => {
    if (!board.fen || board.cursor <= 0) return;
    const prevFen = board.fens[board.cursor - 1] ?? null;
    pendingRef.current = { fen: board.fen, prevFen, ply: board.cursor };
    // Drop whatever is in flight so analyses never pile up on the server.
    if (jobIdRef.current) {
      try {
        await api.cancelJob(jobIdRef.current);
      } catch {
        /* job already finished */
      }
    }
    try {
      const { job_id } = await api.analyzeMove({
        fen: board.fen,
        prev_fen: prevFen ?? undefined,
        sans: board.sans.slice(0, board.cursor),
        depth: liveDepth,
        multipv: analyzeMultipv,
      });
      setError(null);
      setAutoMode(true);
      start(job_id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [board.fen, board.cursor, board.fens, board.sans, liveDepth, analyzeMultipv, start]);

  // Auto-analysis after every move (debounced, cancelling the previous job);
  // also fires on cursor navigation (undo/redo/load) so any replayed position
  // gets fresh lines and a badge for the move that reached it.
  useEffect(() => {
    if (!autoAnalyze || !engine?.available || board.cursor <= 0) return;
    const timer = window.setTimeout(() => {
      void runAuto();
    }, AUTO_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [board.fen, board.cursor, autoAnalyze, engine?.available, runAuto]);

  // Live info during search comes through snapshot.data.lines
  const liveLines = useMemo<EvalLine[]>(() => {
    const data = snapshot?.data as { lines?: EvalLine[] } | undefined;
    if (snapshot?.status === "running" && data?.lines?.length) return data.lines;
    return lines;
  }, [snapshot, lines]);

  useEffect(() => {
    if (snapshot?.status === "error") {
      setError(snapshot.error ?? "Analysis failed");
    } else if (snapshot?.status === "cancelled") {
      setError("Analysis cancelled");
    }
  }, [snapshot]);

  useEffect(() => {
    if (result) handleResult(result);
  }, [result, handleResult]);

  // Expose first line + eval + last-move classification to the parent.
  useEffect(() => {
    const first = liveLines[0] ?? null;
    onAnalysisChange?.({
      evalForFen: first?.score ?? null,
      firstLine: first,
      pvUci: first?.pv_uci ?? [],
      analyzing: running,
      move: moveInfo,
    });
  }, [liveLines, running, moveInfo, onAnalysisChange]);

  const restart = useCallback(() => {
    pendingRef.current = null;
    clear();
    void startAnalysis();
  }, [clear, startAnalysis]);

  const stale = analyzedFen !== null && analyzedFen !== board.fen && jobId !== null;

  const best = liveLines[0];
  const evalsForDisplay = liveLines;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button small onClick={running ? () => void cancel() : startAnalysis} variant={running ? "danger" : "primary"}>
          {running ? "Stop" : "Analyze"}
        </Button>
        <Button small variant="subtle" onClick={restart} disabled={!jobId}>
          Re-run
        </Button>
        <label className="flex items-center gap-1 text-xs text-stone-400">
          depth
          <Select
            className="w-20 py-1"
            value={String(analyzeDepth)}
            onChange={(e) => setAnalyzeDepth(Number(e.target.value))}
          >
            {[8, 10, 12, 14, 16, 18, 20, 22, 24].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1 text-xs text-stone-400">
          lines
          <Select
            className="w-16 py-1"
            value={String(analyzeMultipv)}
            onChange={(e) => setAnalyzeMultipv(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 6].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>
        {autoMode && autoAnalyze ? (
          <span className="rounded bg-violet-950/60 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
            auto · depth {liveDepth}
          </span>
        ) : null}
        {!autoAnalyze ? (
          <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-500" title="Auto-analysis is off — see Settings">
            auto off
          </span>
        ) : null}
      </div>

      {running ? (
        <div className="flex items-center gap-2 text-xs text-stone-400">
          <Spinner className="h-3 w-3" />
          <span className="truncate">{snapshot?.message ?? "Searching…"}</span>
          <ProgressBar className="w-24" value={snapshot?.progress ?? 0} />
        </div>
      ) : null}
      {stale ? <p className="text-[11px] text-amber-500">Position changed - press Analyze for the current position.</p> : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {!engine?.available ? <p className="text-[11px] text-red-400">Engine unavailable — analysis disabled.</p> : null}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {evalsForDisplay.map((line, i) => (
          <AnalysisLineView key={i} line={line} rank={i + 1} />
        ))}
        {evalsForDisplay.length === 0 && !running ? (
          <p className="py-8 text-center text-xs text-stone-600">Press Analyze to get engine lines.</p>
        ) : null}
      </div>
      {best ? (
        <p className="text-[11px] text-stone-500">
          {best.depth ? `depth ${best.depth}` : ""}
          {best.nodes ? ` · ${(best.nodes / 1000).toFixed(0)}k nodes` : ""}
          {best.time ? ` · ${((best.time) / 1000).toFixed(1)}s` : ""}
          {best.wdl ? ` · WDL ${best.wdl[0]}/${best.wdl[1]}/${best.wdl[2]}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function AnalysisLineView({ line, rank }: { line: EvalLine; rank: number }) {
  const pv = line.pv_san?.slice(0, 8) ?? [];
  return (
    <div className={clsx("rounded border px-2 py-1.5 text-xs", rank === 1 ? "border-violet-800/70 bg-violet-950/30" : "border-stone-800 bg-stone-900/50")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-stone-200">{formatEval(line.score)}</span>
        <span className="text-stone-500">
          {line.depth ? `d${line.depth}` : ""} {line.seldepth ? `/s${line.seldepth}` : ""}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-1 text-stone-300">
        {rank === 1 ? null : <span className="font-bold text-stone-500">{rank}.</span>}
        {pv.map((san, i) => (
          <span key={i} className={clsx(i % 2 === 1 && "font-semibold text-stone-400")}>
            {san}
          </span>
        ))}
      </div>
      {line.wdl ? (
        <div className="mt-1 flex gap-2 text-[10px] tabular-nums">
          <span className="font-semibold text-stone-300">WDL</span>
          <span className="text-emerald-400">{line.wdl[0]}%</span>
          <span className="text-stone-500">{line.wdl[1]}%</span>
          <span className="text-red-400">{line.wdl[2]}%</span>
        </div>
      ) : null}
    </div>
  );
}