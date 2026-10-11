import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useApp } from "../state/AppContext";
import type { Settings } from "../api/types";
import { Button, Card, Field, Input, NumberInput, Select, Spinner, Toggle, clsx } from "./ui";

export function SettingsView() {
  const { settings, updateSettings, engine, engineLoading, refreshEngine, restartEngine, toast } = useApp();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{ entries: number; data_dir: string } | null>(null);

  useEffect(() => {
    if (settings && !draft) {
      setDraft(JSON.parse(JSON.stringify(settings)) as Settings);
    }
    void api
      .health()
      .then((h) => setCacheInfo({ entries: h.cache_entries, data_dir: h.data_dir }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // All hooks must run before the conditional return.
  const save = useCallback(
    async (applyEngine: boolean) => {
      const d = draft;
      if (!d) return;
      setSaving(true);
      try {
        await updateSettings({ ...d });
        if (applyEngine) {
          await api.engineConfigure({
            threads: d.engine.threads,
            hash_mb: d.engine.hash_mb,
            show_wdl: d.engine.show_wdl,
            multipv: d.engine.multipv,
            depth: d.engine.depth,
            movetime_ms: d.engine.movetime_ms,
            nodes: d.engine.nodes,
          } as never);
          await restartEngine();
          toast("Settings saved and engine restarted", "success");
        } else {
          toast("Settings saved", "success");
        }
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setSaving(false);
      }
    },
    [draft, updateSettings, restartEngine, toast],
  );

  if (!draft || !settings) {
    return (
      <Card title="Settings">
        <div className="flex items-center gap-2 text-sm text-stone-400">
          <Spinner /> Loading settings…
        </div>
      </Card>
    );
  }

  const setEng = (patch: Partial<Settings["engine"]>) => setDraft({ ...draft, engine: { ...draft.engine, ...patch } });
  const setRev = (patch: Partial<Settings["review"]>) => setDraft({ ...draft, review: { ...draft.review, ...patch } });
  const setCls = (patch: Partial<Settings["classification"]>) =>
    setDraft({ ...draft, classification: { ...draft.classification, ...patch } });
  const setBrd = (patch: Partial<Settings["board"]>) => setDraft({ ...draft, board: { ...draft.board, ...patch } });

  const clearCache = async () => {
    try {
      const r = await api.cacheClear();
      toast(`Cache cleared (${r.cleared} entries)`, "success");
      setCacheInfo((c) => (c ? { ...c, entries: 0 } : c));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const changeEnginePath = async () => {
    try {
      await api.engineConfigure({ path: draft.engine.path });
      await updateSettings({ engine: { ...draft.engine } });
      await restartEngine();
      toast("Engine path updated and restarted", "success");
      await refreshEngine();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Engine" right={engineLoading ? <Spinner className="h-3 w-3" /> : undefined}>
          <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/50 px-3 py-2 text-xs">
            <div className={clsx("font-semibold", engine?.available ? "text-emerald-400" : "text-red-400")}>
              {engine?.available ? `● ${engine.name} (${engine.author ?? "author unknown"})` : "● Unavailable"}
            </div>
            {engine?.error ? <div className="mt-1 text-red-400">{engine.error}</div> : null}
            <div className="mt-1 truncate text-stone-500">path: {engine?.path ?? draft.engine.path}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Threads" hint="More threads = faster searches">
              <NumberInput min={1} max={64} value={draft.engine.threads} onChange={(e) => setEng({ threads: Number(e.target.value) })} />
            </Field>
            <Field label="Hash (MB)" hint="Engine hash memory">
              <NumberInput min={8} max={4096} step={8} value={draft.engine.hash_mb} onChange={(e) => setEng({ hash_mb: Number(e.target.value) })} />
            </Field>
            <Field label="Default multipv lines">
              <NumberInput min={1} max={6} value={draft.engine.multipv} onChange={(e) => setEng({ multipv: Number(e.target.value) })} />
            </Field>
            <Field label="Default depth">
              <NumberInput min={4} max={28} value={draft.engine.depth} onChange={(e) => setEng({ depth: Number(e.target.value) })} />
            </Field>
            <Field label="Move time (ms, 0 = depth-based)">
              <NumberInput min={0} max={600000} step={100} value={draft.engine.movetime_ms} onChange={(e) => setEng({ movetime_ms: Number(e.target.value) })} />
            </Field>
            <Field label="Nodes limit (0 = none)">
              <NumberInput min={0} value={draft.engine.nodes} onChange={(e) => setEng({ nodes: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="mt-3 space-y-2">
            <Toggle
              checked={Boolean(draft.engine.show_wdl)}
              onChange={(v) => setEng({ show_wdl: v })}
              label="Show WDL win/draw/loss percentages (UCI_ShowWDL)"
            />
            <Field label="Syzygy tablebase path (optional, local)" hint="Directory containing .rtbw/.rtbz files, e.g. /home/me/syzygy">
              <Input value={draft.engine.syzygy_path ?? ""} onChange={(e) => setEng({ syzygy_path: e.target.value })} placeholder="/path/to/syzygy" />
            </Field>
            <Field label="Engine binary path">
              <div className="flex gap-2">
                <Input className="flex-1 font-mono text-xs" value={draft.engine.path} onChange={(e) => setEng({ path: e.target.value })} />
                <Button small variant="outline" onClick={() => void changeEnginePath()}>Apply</Button>
              </div>
            </Field>
          </div>
        </Card>

        <Card title="Review">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Analysis depth" hint="Higher = slower but more accurate (this machine likes 10)">
              <NumberInput min={4} max={28} value={draft.review.depth} onChange={(e) => setRev({ depth: Number(e.target.value) })} />
            </Field>
            <Field label="Max positions" hint="Cap for very long games">
              <NumberInput min={10} max={2000} step={10} value={draft.review.max_positions} onChange={(e) => setRev({ max_positions: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="mt-2">
            <Toggle checked={Boolean(draft.review.resume)} onChange={(v) => setRev({ resume: v })} label="Resume cached reviews when re-reviewing" />
          </div>
        </Card>

        <Card title="Accuracy model">
          <p className="text-xs leading-relaxed text-stone-400">
            Accuracy is computed from win-probability loss on each move, using the documented logistic model{" "}
            <code className="text-stone-300">wp = 1 / (1 + exp(−{draft.accuracy.cp_scale}·cp))</code> and{" "}
            <code className="text-stone-300">accuracy = 100·(1 − Δwp)^1.5</code>. This is an approximation — it is not
            an exact match for Chess.com or Lichess accuracy numbers.
          </p>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Classification thresholds (cp loss)">
          <p className="mb-2 text-[11px] text-stone-500">A move is classified by how much centipawn advantage it loses (keep values ascending).</p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["excellent_loss", "Excellent ≤", 30],
                ["good_loss", "Good ≤", 60],
                ["inaccuracy_loss", "Inaccuracy ≤", 90],
                ["mistake_loss", "Mistake ≤", 150],
              ] as const
            ).map(([key, label, max]) => (
              <Field key={key} label={label}>
                <NumberInput min={0} max={max} value={draft.classification[key]} onChange={(e) => setCls({ [key]: Number(e.target.value) } as never)} />
              </Field>
            ))}
            <Field label="Blunder >">
              <NumberInput min={1} max={500} value={draft.classification.blunder_loss} onChange={(e) => setCls({ blunder_loss: Number(e.target.value) } as never)} />
            </Field>
          </div>
          <div className="mt-3 space-y-2">
            <Toggle checked={Boolean(draft.board.arrow_best_move)} onChange={(v) => setBrd({ arrow_best_move: v })} label="Show engine best-move arrow during analysis" />
            <Toggle checked={Boolean(draft.board.show_legal_moves)} onChange={(v) => setBrd({ show_legal_moves: v })} label="Show legal-move dots on click" />
            <Toggle checked={Boolean(draft.board.sound)} onChange={(v) => setBrd({ sound: v })} label="Move sounds (firefox only)" />
          </div>
        </Card>

        <Card title="Board">
          <div className="space-y-2">
            <Toggle checked={Boolean(draft.board.show_coordinates)} onChange={(v) => setBrd({ show_coordinates: v })} label="Show coordinates (a–h / 1–8)" />
            <div className="flex items-center justify-between text-sm text-stone-300">
              <span>Default orientation</span>
              <Select
                className="w-32"
                value={draft.board.flip ? "black" : "white"}
                onChange={(e) => setBrd({ flip: e.target.value === "black" })}
              >
                <option value="white">White bottom</option>
                <option value="black">Black bottom</option>
              </Select>
            </div>
          </div>
          {draft.board.theme ? (
            <div className="mt-2 flex items-center justify-between text-sm text-stone-300">
              <span>Theme</span>
              <Select className="w-32" value={draft.board.theme} onChange={(e) => setBrd({ theme: e.target.value })}>
                <option value="classic">Classic (brown)</option>
              </Select>
            </div>
          ) : null}
        </Card>

        <Card title="Storage & cache">
          <div className="space-y-2 text-xs text-stone-400">
            <div>
              Data directory: <code className="text-stone-300">{cacheInfo?.data_dir ?? settings.data_dir}</code>
            </div>
            <div>
              Eval cache entries: <code className="text-stone-300">{cacheInfo?.entries ?? "…"}</code>
            </div>
            <div className="flex gap-2">
              <Button small variant="danger" onClick={() => void clearCache()}>Clear eval cache</Button>
              <Button small variant="ghost" onClick={() => void refreshEngine()}>Refresh engine status</Button>
            </div>
            <p className="text-stone-600">
              Everything (settings.json, library, games, reports, cache) lives in the data directory and is never sent
              anywhere — this app makes no network calls.
            </p>
          </div>
        </Card>

        <div className="flex items-center gap-2">
          <Button onClick={() => void save(false)} disabled={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" /> : "Save settings"}
          </Button>
          <Button variant="outline" onClick={() => void save(true)} disabled={saving}>
            Save & restart engine
          </Button>
          <Button variant="ghost" onClick={() => { void restartEngine(); }}>Restart engine</Button>
        </div>
      </div>
    </div>
  );
}