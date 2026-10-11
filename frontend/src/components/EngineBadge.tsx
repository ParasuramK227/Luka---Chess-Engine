import { useApp } from "../state/AppContext";
import { clsx, Spinner } from "./ui";

export function EngineBadge() {
  const { engine, engineLoading, restartEngine } = useApp();
  const ok = engine?.available;
  return (
    <button
      onClick={() => void restartEngine()}
      title={
        ok
          ? `${engine.name ?? "Stockfish"} — click to restart`
          : `Engine unavailable: ${engine?.error ?? "unknown"} — click to retry`
      }
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        engineLoading
          ? "border-stone-700 text-stone-400"
          : ok
            ? "border-emerald-700 bg-emerald-950/60 text-emerald-300"
            : "border-red-700 bg-red-950/60 text-red-300",
      )}
    >
      {engineLoading ? (
        <Spinner className="h-3 w-3" />
      ) : (
        <span className={clsx("h-2 w-2 rounded-full", ok ? "bg-emerald-400" : "bg-red-400")} />
      )}
      {engineLoading ? "Engine…" : ok ? `Stockfish ${engine?.name?.replace(/^Stockfish\s*/, "") || ""}`.trim() || "Stockfish" : "Engine offline"}
    </button>
  );
}