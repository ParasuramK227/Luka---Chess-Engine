import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useApp } from "../state/AppContext";
import type { ParsedGame } from "../api/types";
import { BoardView } from "./BoardView";
import { Button, Card, EmptyState, Input, Spinner } from "./ui";

interface BookEntry {
  eco: string;
  name: string;
  moves: string[];
}

export function OpeningsView() {
  const { board, toast } = useApp();
  const [detected, setDetected] = useState<{ eco: string; name: string; matched_moves: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<BookEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState("bundled");
  const [loading, setLoading] = useState(false);

  const currentSans = useMemo(() => board.sans.slice(0, board.cursor), [board.sans, board.cursor]);

  const checkCurrent = useCallback(async () => {
    if (currentSans.length === 0) {
      setDetected(null);
      return;
    }
    setChecking(true);
    try {
      const op = await api.openings(currentSans);
      setDetected(op);
    } catch {
      setDetected(null);
    } finally {
      setChecking(false);
    }
  }, [currentSans]);

  useEffect(() => {
    const t = window.setTimeout(() => void checkCurrent(), 200);
    return () => window.clearTimeout(t);
  }, [checkCurrent]);

  const loadList = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const res = await api.openingsList(query || undefined);
      setEntries(res.openings);
      setTotal(res.count);
      setSource(res.source);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList("");
  }, [loadList]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadList(q), 250);
    return () => window.clearTimeout(t);
  }, [q, loadList]);

  const playEntry = useCallback(
    (e: BookEntry) => {
      const fake: ParsedGame = {
        index: 0,
        headers: { Event: "Opening explorer", White: "?", Black: "?" },
        result: "*",
        start_fen: "",
        moves: e.moves.map((san, i) => ({ ply: i + 1, san, uci: "", fen_before: "", fen_after: "" })),
        content_hash: "",
        ply_count: e.moves.length,
        has_variations: false,
      };
      board.loadParsedGame(fake);
      toast(`Loaded ${e.name} onto the board`, "success");
    },
    [board, toast],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Current position" right={checking ? <Spinner className="h-3 w-3" /> : undefined}>
          <BoardView readOnly showControls={false} statusLine={undefined} />
          <div className="mt-3">
            {detected ? (
              <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2">
                <div className="text-sm font-semibold text-emerald-300">{detected.name}</div>
                <div className="text-xs text-stone-500">ECO {detected.eco} · matches first {detected.matched_moves} move{detected.matched_moves === 1 ? "" : "s"} of the book line</div>
              </div>
            ) : (
              <p className="text-xs text-stone-500">
                {currentSans.length === 0 ? "Make moves on the board (Board tab) to detect an opening name." : "No known opening matched this move sequence."}
              </p>
            )}
          </div>
        </Card>
        <Card title="How it works">
          <p className="text-xs leading-relaxed text-stone-400">
            ChessLab bundles a curated dataset of common opening names and ECO codes (plus any{" "}
            <code className="text-stone-300">openings.json</code> you drop into the data directory). Detection is a
            longest-prefix match of the move list. Win rates and popularity are <em>never</em> fabricated — they are
            not included because no statistical database ships with the app.
          </p>
        </Card>
      </div>
      <Card
        title="Opening explorer"
        right={
          <span className="text-[10px] text-stone-500">
            {total} lines · {source}
          </span>
        }
      >
        <div className="mb-2">
          <Input placeholder="Search names or ECO codes…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading ? <Spinner /> : null}
        {entries.length === 0 && !loading ? (
          <EmptyState title="Nothing found" body="Try a different name, or add entries via data/openings.json." />
        ) : null}
        <ul className="max-h-[36rem] divide-y divide-stone-800/70 overflow-y-auto">
          {entries.map((e, i) => (
            <li key={`${e.eco}-${e.name}-${i}`} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">{e.eco}</span>
                  <span className="truncate text-sm font-medium text-stone-200">{e.name}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{e.moves.join(" ")}</div>
              </div>
              <Button small variant="outline" onClick={() => playEntry(e)}>Load</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}