import { useCallback, useEffect, useRef, useState } from "react";
import { api, downloadReport } from "../api/client";
import { useApp } from "../state/AppContext";
import type { LibraryEntry } from "../api/types";
import { Badge, Button, Card, EmptyState, Field, Input, NumberInput, Select, Spinner } from "./ui";
import { formatPct, friendlyResult } from "../lib/format";

export function LibraryView() {
  const { board, refreshLibrary, toast, setTab, libraryLoading, openGameInReview, settings } = useApp();
  const [games, setGames] = useState<LibraryEntry[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [pasted, setPasted] = useState("");
  const [importing, setImporting] = useState(false);
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [colInput, setColInput] = useState<Record<string, string>>({});
  const [onlineSite, setOnlineSite] = useState<"lichess" | "chess.com">("lichess");
  const [onlineUser, setOnlineUser] = useState("");
  const [onlineCount, setOnlineCount] = useState(5);
  const [onlineImporting, setOnlineImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (q?: string, col?: string) => {
    setLoading(true);
    try {
      const res = await api.libraryList(q || undefined, col || undefined);
      setGames(res.games);
      setCollections(res.collections ?? []);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(query || undefined, collection || undefined), 250);
    return () => window.clearTimeout(t);
  }, [query, collection, load]);

  const importText = useCallback(
    async (text: string, sourceName: string) => {
      setImporting(true);
      try {
        const res = await api.libraryImport(text, sourceName);
        const dup = res.games.filter((g) => g.duplicate).length;
        toast(`Imported ${res.imported} game${res.imported === 1 ? "" : "s"}${dup ? ` (${dup} duplicate${dup === 1 ? "" : "s"} skipped)` : ""}`, "success");
        if (res.errors.length) toast(`${res.errors.length} game(s) skipped: ${res.errors[0].error}`, "error");
        setPasted("");
        await load();
        await refreshLibrary();
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setImporting(false);
      }
    },
    [load, refreshLibrary, toast],
  );

  const onFile = useCallback(
    async (file: File) => {
      const raw = await file.text();
      await importText(raw, file.name);
    },
    [importText],
  );

  const importOnline = useCallback(async () => {
    const username = onlineUser.trim();
    if (!username) return;
    setOnlineImporting(true);
    try {
      const res = await api.importOnline(onlineSite, username, onlineCount);
      const dup = res.games.filter((g) => g.duplicate).length;
      const variantNote = res.skipped_variants ? `, skipped ${res.skipped_variants} variant game(s)` : "";
      toast(
        `Imported ${res.imported} game${res.imported === 1 ? "" : "s"} from ${res.source}` +
          `${dup ? ` (${dup} duplicate${dup === 1 ? "" : "s"})` : ""}${variantNote}`,
        "success",
      );
      if (res.errors.length) toast(`${res.errors.length} game(s) skipped`, "error");
      await load(query || undefined, collection || undefined);
      await refreshLibrary();
      const newest = res.games.find((g) => !g.duplicate) ?? res.games[0];
      if (newest) openGameInReview(newest.id, { autoStart: true });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setOnlineImporting(false);
    }
  }, [onlineUser, onlineSite, onlineCount, load, query, collection, refreshLibrary, openGameInReview, toast]);

  const del = useCallback(
    async (g: LibraryEntry) => {
      if (!window.confirm(`Delete “${g.white || "?"} – ${g.black || "?"}” from the library?`)) return;
      try {
        await api.libraryDelete(g.id);
        toast("Game deleted", "success");
        await load();
        await refreshLibrary();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [load, refreshLibrary, toast],
  );

  const addTag = useCallback(
    async (g: LibraryEntry) => {
      const tag = (tagInput[g.id] ?? "").trim();
      if (!tag) return;
      try {
        await api.libraryTag(g.id, tag);
        toast(`Tagged “${tag}”`, "success");
        setTagInput((s) => ({ ...s, [g.id]: "" }));
        await load(query || undefined, collection || undefined);
        await refreshLibrary();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [tagInput, query, collection, load, refreshLibrary, toast],
  );

  const addCollection = useCallback(
    async (g: LibraryEntry) => {
      const name = (colInput[g.id] ?? "").trim();
      if (!name) return;
      try {
        await api.libraryCollection(g.id, name);
        toast(`Added to “${name}”`, "success");
        setColInput((s) => ({ ...s, [g.id]: "" }));
        await load(query || undefined, collection || undefined);
        await refreshLibrary();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [colInput, query, collection, load, refreshLibrary, toast],
  );

  const removeTag = useCallback(
    async (g: LibraryEntry, tag: string) => {
      try {
        await api.libraryUntag(g.id, tag);
        toast(`Removed tag “${tag}”`, "success");
        await load(query || undefined, collection || undefined);
        await refreshLibrary();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [query, collection, load, refreshLibrary, toast],
  );

  const removeCollection = useCallback(
    async (g: LibraryEntry, name: string) => {
      try {
        await api.libraryUncollection(g.id, name);
        toast(`Removed from “${name}”`, "success");
        await load(query || undefined, collection || undefined);
        await refreshLibrary();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [query, collection, load, refreshLibrary, toast],
  );

  const save = (g: LibraryEntry, fmt: "pgn" | "html" | "csv" | "json") => {
    const download = async () => {
      try {
        const { content, filename } = await downloadReport(g.id, fmt);
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Downloaded", "success");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    };
    void download();
  };

  return (
    <div className="space-y-4">
      <Card title="Import games">
        <div className="flex flex-wrap items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pgn,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <Button small variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? <Spinner className="h-3 w-3" /> : "Choose .pgn file"}
          </Button>
          <Input
            className="min-w-64 flex-1 py-1.5 font-mono text-xs"
            placeholder="…or paste PGN text and press Import"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <Button small onClick={() => void importText(pasted, "pasted.pgn")} disabled={!pasted.trim() || importing}>
            Import
          </Button>
        </div>
      </Card>

      <Card title="Import recent games by username">
        {settings?.online_import?.enabled ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Site">
              <Select
                className="w-36"
                value={onlineSite}
                onChange={(e) => setOnlineSite(e.target.value as "lichess" | "chess.com")}
              >
                <option value="lichess">Lichess</option>
                <option value="chess.com">Chess.com</option>
              </Select>
            </Field>
            <Field label="Username">
              <Input
                className="min-w-48"
                value={onlineUser}
                onChange={(e) => setOnlineUser(e.target.value)}
                placeholder="e.g. DrNykterstein"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void importOnline();
                }}
              />
            </Field>
            <Field label="Games">
              <NumberInput
                className="w-20"
                min={1}
                max={20}
                value={onlineCount}
                onChange={(e) => setOnlineCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
            </Field>
            <Button small onClick={() => void importOnline()} disabled={!onlineUser.trim() || onlineImporting}>
              {onlineImporting ? <Spinner className="h-3 w-3" /> : "Import & analyze"}
            </Button>
            <p className="w-full text-[11px] text-stone-500">
              Fetches the most recent public games from {onlineSite} and opens the newest one to review. This is the
              only Luka - Chess Engine feature that uses the internet, and it only runs when you click the button.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-stone-400">
            <span>
              Import your last games from chess.com or lichess by username, then jump straight into analysis. This is
              off by default because it uses the internet.
            </span>
            <Button small variant="outline" onClick={() => setTab("settings")}>
              Enable in Settings
            </Button>
          </div>
        )}
      </Card>

      <Card
        title="Library"
        right={
          <div className="flex items-center gap-2">
            <Input className="w-48 py-1 text-xs" placeholder="Search names / event…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select
              className="rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-100 outline-none focus:border-violet-500"
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
            >
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        }
      >
        {loading || libraryLoading ? <Spinner /> : null}
        {games.length === 0 && !loading ? (
          <EmptyState title="No games match" body="Import a PGN above, or clear the search." />
        ) : null}
        <ul className="divide-y divide-stone-800/70">
          {games.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-stone-200">
                    {g.white || "?"} – {g.black || "?"}
                  </span>
                  <span className="text-sm text-stone-400">{friendlyResult(g.result)}</span>
                  {g.opening ? (
                    <span className="hidden text-[11px] text-stone-500 sm:inline" title={g.opening}>
                      {g.opening.length > 32 ? `${g.opening.slice(0, 32)}…` : g.opening}
                    </span>
                  ) : null}
                  {g.analysis?.status === "complete" ? (
                    <Badge className="bg-violet-800">
                      W {formatPct(g.analysis.accuracy?.white)} · B {formatPct(g.analysis.accuracy?.black)}
                    </Badge>
                  ) : (
                    <Badge className="bg-stone-700">not reviewed</Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-stone-500">
                  {[g.event, g.site, g.date].filter(Boolean).join(" · ") || "—"} · {g.ply_count} plies{g.eco ? ` · ${g.eco}` : ""}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {g.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-400">
                      #{t}
                      <button
                        type="button"
                        title={`Remove tag ${t}`}
                        aria-label={`Remove tag ${t}`}
                        className="text-stone-500 hover:text-red-400"
                        onClick={() => void removeTag(g, t)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {g.collections.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 rounded bg-sky-950 px-1.5 py-0.5 text-[10px] text-sky-400">
                      📁 {c}
                      <button
                        type="button"
                        title={`Remove from collection ${c}`}
                        aria-label={`Remove from collection ${c}`}
                        className="text-sky-700 hover:text-red-400"
                        onClick={() => void removeCollection(g, c)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <span className="flex items-center gap-1">
                    <input
                      className="w-20 rounded border border-stone-800 bg-stone-900 px-1 py-0.5 text-[10px] text-stone-300 outline-none"
                      placeholder="+tag"
                      value={tagInput[g.id] ?? ""}
                      onChange={(e) => setTagInput((s) => ({ ...s, [g.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") void addTag(g); }}
                    />
                    <input
                      className="w-20 rounded border border-stone-800 bg-stone-900 px-1 py-0.5 text-[10px] text-stone-300 outline-none"
                      placeholder="+collection"
                      value={colInput[g.id] ?? ""}
                      onChange={(e) => setColInput((s) => ({ ...s, [g.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") void addCollection(g); }}
                    />
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  small
                  variant="outline"
                  onClick={() => {
                    board.loadParsedGame(g);
                    setTab("board");
                  }}
                >
                  Board
                </Button>
                <Button small variant="outline" onClick={() => openGameInReview(g.id)}>
                  Review
                </Button>
                <select
                  className="rounded border border-stone-800 bg-stone-900 px-1.5 py-1 text-[10px] text-stone-300 outline-none"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) { save(g, e.target.value as "pgn" | "html" | "csv" | "json"); e.target.value = ""; }
                  }}
                >
                  <option value="" disabled>Export…</option>
                  <option value="pgn">Annotated PGN</option>
                  <option value="html">HTML report</option>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
                <Button small variant="danger" onClick={() => void del(g)}>✕</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}