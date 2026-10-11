import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useApp } from "../state/AppContext";
import { useJob } from "../hooks/useJob";
import type { AnalysisResult, EvalLine, EngineScore } from "../api/types";
import { formatEval } from "../lib/format";
import { Button, ProgressBar, Select, Spinner, clsx } from "./ui";

export interface LiveAnalysisState {
  /** Best line of the last finished analysis for the *current* fen, if any. */
  evalForFen: EngineScore | null;
  firstLine?: EvalLine | null;
  pvUci: string[];
  analyzing: boolean;
}

export function LiveAnalysis({
  onAnalysisChange,
}: {
  onAnalysisChange?: (state: LiveAnalysisState) => void;
}) {
  const { board, analyzeDepth, setAnalyzeDepth, analyzeMultipv, setAnalyzeMultipv, engine, toast } = useApp();
  const { jobId, snapshot, result, running, start, cancel, clear } = useJob();

  const [lines, setLines] = useState<EvalLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Position marker of the analysis that produced `result`/`lines`.
  const [analyzedFen, setAnalyzedFen] = useState<string | null>(null);

  const handleResult = useCallback((r: unknown) => {
    const res = r as AnalysisResult;
    if (res?.lines) setLines(res.lines);
  }, []);

  const startAnalysis = useCallback(async () => {
    if (!board.fen) return;
    setError(null);
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

  // Expose first line + eval to the parent (for the eval bar / arrows).
  useEffect(() => {
    const first = liveLines[0] ?? null;
    onAnalysisChange?.({
      evalForFen: first?.score ?? null,
      firstLine: first,
      pvUci: first?.pv_uci ?? [],
      analyzing: running,
    });
  }, [liveLines, running, onAnalysisChange]);

  const restart = useCallback(() => {
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
    <div className={clsx("rounded border px-2 py-1.5 text-xs", rank === 1 ? "border-emerald-800/70 bg-emerald-950/30" : "border-stone-800 bg-stone-900/50")}>
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