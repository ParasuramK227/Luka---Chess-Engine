import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadReport } from "../api/client";
import { useApp } from "../state/AppContext";
import { useJob } from "../hooks/useJob";
import type { EngineScore, ParsedGame, ReviewResult } from "../api/types";
import { BoardView } from "./BoardView";
import { EvalGraph, EvalMark, pointsFromReview } from "./EvalGraph";
import { MovesTable, type MoveCell } from "./MovesTable";
import { Badge, Button, Card, EmptyState, Field, Input, ProgressBar, Select, Spinner, clsx } from "./ui";
import { catMeta, formatCp, formatPct } from "../lib/format";
import { scoreToUnits } from "../lib/format";

const WORTHY: Record<string, boolean> = {
  inaccuracy: true,
  mistake: true,
  blunder: true,
  missed_win: true,
  great: true,
  brilliant: true,
};

export function ReviewView() {
  const { board, library, refreshLibrary, settings, toast, setTab, pendingReviewId, clearPendingReview } = useApp();

  const [srcMode, setSrcMode] = useState<"library" | "pgn">("library");
  const [gameId, setGameId] = useState<string>("");
  const [pgnText, setPgnText] = useState("");
  const [parsedGames, setParsedGames] = useState<ParsedGame[]>([]);
  const [pickIdx, setPickIdx] = useState(0);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [depth, setDepth] = useState(10);

  const { jobId, snapshot, result, running, start, cancel } = useJob();
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPly, setSelectedPly] = useState(-1);
  const [resolvedId, setResolvedId] = useState<string | null>(null);

  const defaultDepth = settings?.review?.depth ?? 10;
  useEffect(() => setDepth(defaultDepth), [defaultDepth]);

  const reviewedGames = useMemo(
    () =>
      library
        .filter((g) => g.ply_count > 0)
        .sort((a, b) => b.added_at - a.added_at),
    [library],
  );

  useEffect(() => {
    if (!gameId && reviewedGames.length > 0) {
      const g = reviewedGames[0];
      setGameId(g.id);
      if (g.analysis?.status === "complete") void loadLibraryReview(g.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewedGames]);

  const jumpTo = useCallback(
    (ply: number) => {
      setSelectedPly(ply);
      board.navigateToPly(ply);
    },
    [board],
  );

  const adoptReview = useCallback(
    (r: ReviewResult) => {
      setReview(r);
      const end = r?.positions ? r.positions.length - 1 : -1;
      jumpTo(end);
    },
    [jumpTo],
  );

  function loadLibraryReview(id: string) {
    api
      .libraryReview(id)
      .then((r) => {
        setError(null);
        setReview(r);
        setResolvedId(id);
        jumpTo(r.positions ? r.positions.length - 1 : -1);
        if (r.complete) toast("Loaded saved review", "success");
      })
      .catch((e) => {
        setError((e as Error).message);
        setReview(null);
      });
  }

  const chooseGame = useCallback(
    (id: string) => {
      setGameId(id);
      const entry = library.find((g) => g.id === id);
      if (entry?.analysis?.status === "complete") {
        void loadLibraryReview(id);
      } else {
        setReview(null);
        setResolvedId(null);
        if (entry) board.loadParsedGame(entry);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, board],
  );

  // Handle "Review" button pressed from the Library tab.
  useEffect(() => {
    if (!pendingReviewId) return;
    const id = pendingReviewId;
    clearPendingReview();
    setSrcMode("library");
    setReview(null);
    setResolvedId(null);
    const entry = library.find((g) => g.id === id);
    if (entry) {
      setGameId(id);
      if (entry.analysis?.status === "complete") loadLibraryReview(id);
      else board.loadParsedGame(entry);
    }
  }, [pendingReviewId, clearPendingReview, library, board, loadLibraryReview]);

  const parsePgn = useCallback(async () => {
    setError(null);
    try {
      const res = await api.parsePgn(pgnText);
      setParsedGames(res.games);
      if (res.games.length === 0) {
        setError(res.errors.map((e) => e.error).join("; ") || "No games parsed");
        toast("No games parsed", "error");
        return;
      }
      toast(`Parsed ${res.games.length} game${res.games.length === 1 ? "" : "s"}`, "success");
      if (res.errors.length) toast(`Skipped ${res.errors.length} invalid game(s)`, "error");
      board.loadParsedGame(res.games[0]);
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, "error");
    }
  }, [pgnText, board, toast]);

  const startReview = useCallback(async () => {
    setError(null);
    setReview(null);
    setResolvedId(null);
    try {
      let id = srcMode === "library" ? gameId : "";
      let body: Parameters<typeof api.review>[0];
      if (srcMode === "pgn") {
        if (parsedGames.length === 0) {
          toast("Parse the PGN first", "error");
          return;
        }
        if (saveToLibrary) {
          const res = await api.libraryImport(pgnText, "pasted.pgn");
          const pick = parsedGames[pickIdx];
          // pick the imported entry that matches the chosen game by index as much as possible
          const imported = res.games.find((x) => !x.duplicate) ?? res.games[pickIdx];
          id = imported?.id ?? "";
          if (id) {
            await refreshLibrary();
            await new Promise((r) => setTimeout(r, 50));
            const entry = (await api.libraryGet(id).catch(() => null)) ?? library.find((g) => g.id === id);
            if (entry) { board.loadParsedGame(entry); }
            void pick; // pick used above
          }
        }
        body = id ? { game_id: id, depth } : { pgn: pgnText, game_index: pickIdx, depth };
      } else {
        body = { game_id: id, depth };
        const entry = library.find((g) => g.id === id);
        if (entry) board.loadParsedGame(entry);
      }
      setResolvedId(id || null);
      const { job_id } = await api.review(body);
      start(job_id);
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, "error");
    }
  }, [srcMode, gameId, parsedGames, saveToLibrary, pgnText, pickIdx, depth, library, board, start, refreshLibrary, toast]);

  useEffect(() => {
    if (snapshot?.status === "error") setError(snapshot.error ?? "Review failed");
    if (snapshot?.status === "cancelled") setError("Review cancelled");
  }, [snapshot]);

  useEffect(() => {
    if (result) {
      adoptReview(result as ReviewResult);
      void refreshLibrary();
    }
  }, [result, adoptReview, refreshLibrary]);

  // ---- derived ----
  const evalAtPly = useMemo<EngineScore | null>(() => {
    if (!review) return null;
    const idx =
      selectedPly === -1
        ? review.positions.length - 1
        : Math.min(Math.max(selectedPly, 0), review.positions.length - 1);
    return review.positions[idx]?.eval ?? null;
  }, [review, selectedPly]);

  const marks = useMemo<EvalMark[]>(() => {
    if (!review) return [];
    const out: EvalMark[] = [];
    for (const m of review.moves) {
      if (WORTHY[m.category]) {
        const after = review.positions[m.ply];
        const units = after ? scoreToUnits(after.eval) : null;
        if (units !== null) out.push({ ply: m.ply, units, category: m.category });
      }
    }
    return out;
  }, [review]);

  const moveCells = useMemo<MoveCell[]>(() => {
    if (!review) return [];
    return review.moves.map((m) => ({
      san: m.san,
      ply: m.ply,
      badge: { label: catMeta(m.category).label, cls: catMeta(m.category).cls },
      title: `${catMeta(m.category).label} · loss ${formatCp(m.metrics?.cp_loss)} cp · ${m.best_move_san ? `Best: ${m.best_move_san}` : ""}`,
    }));
  }, [review]);

  const summary = review?.summary;
  const white = summary?.white;
  const black = summary?.black;

  const download = (id: string, fmt: "html" | "pgn" | "csv" | "json", label: string) => async () => {
    try {
      const { content, filename } = await downloadReport(id, fmt);
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`${label} downloaded`, "success");
    } catch (e) {
      toast(`Download failed: ${(e as Error).message}`, "error");
    }
  };

  const exportId = resolvedId;
  const canExport = Boolean(exportId && review?.complete);

  if (srcMode === "library" && reviewedGames.length === 0) {
    return (
      <div className="space-y-4">
        <Card title="Choose a game">
          <EmptyState
            title="No games in the library yet"
            body={<>Import a PGN from the Library tab, or switch to <button className="underline text-emerald-400" onClick={() => setSrcMode("pgn")}>Paste PGN</button> to review without saving.</>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="1 · Choose a game">
        <div className="mb-2 flex gap-1">
          <Button small variant={srcMode === "library" ? "primary" : "ghost"} onClick={() => setSrcMode("library")}>Library</Button>
          <Button small variant={srcMode === "pgn" ? "primary" : "ghost"} onClick={() => setSrcMode("pgn")}>Paste PGN</Button>
        </div>

        {srcMode === "library" ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Game">
              <Select value={gameId} onChange={(e) => chooseGame(e.target.value)} className="w-96">
                {reviewedGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {`${[g.white || "?", g.black || "?"].filter(Boolean).join(" – ")} (${g.date || "?"}) · ${g.ply_count} plies`}
                    {g.analysis?.status === "complete"
                      ? ` · W ${formatPct(g.analysis.accuracy?.white)} B ${formatPct(g.analysis.accuracy?.black)}`
                      : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Depth">
              <Input type="number" min={4} max={28} className="w-24" value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
            </Field>
            <Button onClick={() => void startReview()} disabled={running || !gameId}>
              {running ? <Spinner className="h-3.5 w-3.5" /> : "Review game"}
            </Button>
            {running ? <Button small variant="danger" onClick={() => void cancel()}>Stop</Button> : null}
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="PGN" hint="Paste one or more games, then Parse to preview on the board.">
              <textarea
                className="h-32 w-full rounded border border-stone-700 bg-stone-900 px-2.5 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-emerald-500"
                value={pgnText}
                onChange={(e) => setPgnText(e.target.value)}
                placeholder={'[Event "Example"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 Nc6 *'}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button small variant="subtle" onClick={() => void parsePgn()}>Parse preview</Button>
              {parsedGames.length > 1 ? (
                <label className="flex items-center gap-1 text-xs text-stone-400">
                  game
                  <Select className="w-20 py-1" value={pickIdx} onChange={(e) => { const i = Number(e.target.value); setPickIdx(i); board.loadParsedGame(parsedGames[i]); }}>
                    {parsedGames.map((_, i) => (
                      <option key={i} value={i}>{i + 1}</option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <label className="flex items-center gap-1.5 text-xs text-stone-400">
                <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
                Save to library
              </label>
              <Field label="Depth">
                <Input type="number" min={4} max={28} className="w-24" value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
              </Field>
              <Button onClick={() => void startReview()} disabled={running || parsedGames.length === 0}>
                {running ? <Spinner className="h-3.5 w-3.5" /> : "Review"}
              </Button>
              {running ? <Button small variant="danger" onClick={() => void cancel()}>Stop</Button> : null}
            </div>
          </div>
        )}

        {running ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-stone-400">
            <ProgressBar className="w-40" value={snapshot?.progress ?? 0} />
            <span className="truncate">{snapshot?.message}</span>
            {snapshot?.progress !== undefined ? <span className="tabular-nums">{snapshot.progress.toFixed(0)}%</span> : null}
          </div>
        ) : null}
        {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
        {jobId && !running && !review ? <p className="mt-1 text-xs text-stone-500">Job finished — fetching result…</p> : null}
      </Card>

      {review ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <Card
                title="2 · Board"
                right={
                  <div className="flex gap-1">
                    <Button small variant="ghost" onClick={() => jumpTo(0)}>|◀</Button>
                    <Button small variant="ghost" onClick={() => jumpTo(Math.max(0, selectedPly - 1))}>◀</Button>
                    <Button small variant="ghost" onClick={() => jumpTo(Math.min(review.positions.length - 1, selectedPly + 1))}>▶</Button>
                    <Button small variant="ghost" onClick={() => jumpTo(review.positions.length - 1)}>▶|</Button>
                    <Button small variant="subtle" onClick={() => setTab("board")}>Open in Board</Button>
                  </div>
                }
              >
                <BoardView readOnly evalScore={evalAtPly} />
              </Card>
              <Card title="3 · Eval graph" right={<span className="text-[10px] text-stone-500">click a point to jump</span>}>
                <EvalGraph points={pointsFromReview(review.positions)} marks={marks} onClick={(ply) => jumpTo(ply)} />
              </Card>
            </div>
            <div className="space-y-4">
              <Card title="Accuracy">
                {white && black ? (
                  <div className="space-y-3">
                    <PlayerScore name={review.game?.headers?.["White"] || "White"} side="w" s={white} />
                    <PlayerScore name={review.game?.headers?.["Black"] || "Black"} side="b" s={black} />
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded bg-stone-800/70 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wide text-stone-500">Engine depth</div>
                        <div className="text-sm font-semibold text-stone-200">{review?.analysis?.depth}</div>
                      </div>
                      <div className="rounded bg-stone-800/70 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wide text-stone-500">Positions</div>
                        <div className="text-sm font-semibold text-stone-200">{review?.positions.length}</div>
                      </div>
                    </div>
                    {summary?.opening ? (
                      <div className="rounded bg-stone-800/70 px-2 py-1.5 text-xs text-stone-300">
                        <span className="font-semibold text-emerald-400">{summary.opening.name}</span>
                        <span className="text-stone-500"> · {summary.opening.eco}</span>
                      </div>
                    ) : null}
                    <p className="text-[10px] leading-relaxed text-stone-600">
                      Accuracy from win-probability loss (documented model — see Settings).
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-stone-500">No accuracy summary.</p>
                )}
              </Card>
              <Card title="Classified moves">
                <ClassBars white={white} black={black} />
              </Card>
              <Card title="Critical moments" right={<span className="text-[10px] text-stone-500">{marks.length}</span>}>
                {marks.length ? (
                  <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                    {review.moves
                      .filter((m) => WORTHY[m.category])
                      .map((m) => (
                        <li key={m.ply}>
                          <button
                            className={clsx(
                              "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-stone-800",
                              selectedPly === m.ply && "bg-stone-800",
                            )}
                            onClick={() => jumpTo(m.ply)}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="font-semibold text-stone-300">{`${m.move_number}${m.mover === "white" ? "." : "…"} ${m.san}`}</span>
                              <Badge className={catMeta(m.category).cls}>{catMeta(m.category).label}</Badge>
                            </span>
                            <span className="tabular-nums text-stone-500">−{formatCp(m.metrics?.cp_loss)} cp</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-xs text-stone-500">No critical moments — solid game!</p>
                )}
              </Card>
              <Card title="Report & exports">
                <div className="flex flex-wrap gap-1.5">
                  {(["pgn", "html", "csv", "json"] as const).map((fmt) => (
                    <Button key={fmt} small variant="subtle" disabled={!canExport} onClick={canExport ? download(exportId as string, fmt, fmt.toUpperCase()) : undefined}>
                      {fmt === "pgn" ? "Annotated PGN" : fmt === "html" ? "HTML report" : fmt.toUpperCase()}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-stone-600">
                  {canExport ? "Generated locally and saved under data/reports/." : "Export requires a saved (library) game with a completed review."}
                </p>
              </Card>
            </div>
          </div>
          <Card title="4 · Move list">
            <MovesTable cells={moveCells} selectedPly={selectedPly} onSelect={jumpTo} maxHeight="26rem" />
          </Card>
        </>
      ) : (
        <Card title="Review">
          <EmptyState
            title="No review yet"
            body={
              running
                ? "The engine is analysing every position in the game — this can take a minute at depth 10 on this machine."
                : "Pick a game above and click Review to compute accuracy, move classifications, and the eval graph."
            }
          />
        </Card>
      )}
    </div>
  );
}

function PlayerScore({ name, side, s }: { name: string; side: "w" | "b"; s: { accuracy?: number | null; moves_scored?: number; average_cp_loss?: number | null } }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className={clsx("h-8 w-2 rounded", side === "w" ? "bg-stone-100" : "bg-stone-800 ring-1 ring-stone-700")} />
        <div>
          <div className="text-sm font-semibold text-stone-200">{name}</div>
          <div className="text-[10px] text-stone-500">
            {s.moves_scored ?? 0} scored · avg loss {formatCp(s.average_cp_loss)} cp
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={clsx("text-2xl font-bold tabular-nums", side === "w" ? "text-stone-100" : "text-stone-400")}>
          {formatPct(s.accuracy)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-stone-500">accuracy</div>
      </div>
    </div>
  );
}

function ClassBars({ white, black }: { white?: ReviewResult["summary"]["white"]; black?: ReviewResult["summary"]["black"] }) {
  const order = ["best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder", "missed_win", "great", "brilliant"];
  const totals: Record<string, number> = {};
  for (const s of [white, black]) {
    if (!s?.classifications) continue;
    for (const [k, v] of Object.entries(s.classifications)) totals[k] = (totals[k] ?? 0) + v;
  }
  const max = Math.max(1, ...Object.values(totals));
  if (Object.keys(totals).length === 0) return <p className="text-xs text-stone-500">No classified moves.</p>;
  return (
    <div className="space-y-1.5">
      {order.map((cat) => {
        const n = totals[cat] ?? 0;
        if (!n) return null;
        const meta = catMeta(cat);
        return (
          <div key={cat} className="flex items-center gap-2 text-xs">
            <span className="w-20 truncate text-stone-400">{meta.label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded bg-stone-800">
              <div className={clsx("h-full rounded", meta.cls)} style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className="w-6 text-right tabular-nums text-stone-300">{n}</span>
          </div>
        );
      })}
    </div>
  );
}