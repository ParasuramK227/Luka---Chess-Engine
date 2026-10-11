import { useEffect } from "react";
import { AppProvider, useApp, type TabId } from "./state/AppContext";
import { BoardPanel } from "./components/BoardPanel";
import { ReviewView } from "./components/ReviewView";
import { LibraryView } from "./components/LibraryView";
import { OpeningsView } from "./components/OpeningsView";
import { SettingsView } from "./components/SettingsView";
import { EngineBadge } from "./components/EngineBadge";
import { Toasts } from "./components/Toasts";
import { clsx } from "./components/ui";

const TABS: { id: TabId; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "review", label: "Review" },
  { id: "library", label: "Library" },
  { id: "openings", label: "Openings" },
  { id: "settings", label: "Settings" },
];

function Shell() {
  const { tab, setTab, board, settings } = useApp();

  useEffect(() => {
    if (settings?.board?.flip) {
      board.setOrientation("black");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.board?.flip]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-stone-800 bg-stone-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded bg-emerald-700 text-sm font-black text-white">♞</span>
            <div>
              <h1 className="text-base font-bold leading-none text-stone-100">ChessLab</h1>
              <p className="mt-0.5 text-[10px] leading-none text-stone-500">offline chess analysis · local stockfish</p>
            </div>
          </div>
          <nav className="ml-2 flex flex-1 items-center gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  "whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === t.id ? "bg-stone-800 text-emerald-300" : "text-stone-400 hover:text-stone-200",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <EngineBadge />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        {tab === "board" ? <BoardPanel /> : null}
        {tab === "review" ? <ReviewView /> : null}
        {tab === "library" ? <LibraryView /> : null}
        {tab === "openings" ? <OpeningsView /> : null}
        {tab === "settings" ? <SettingsView /> : null}
      </main>

      <footer className="border-t border-stone-800 py-3 text-center text-[11px] text-stone-600">
        ChessLab · 100% local · no accounts · no telemetry · engine: Stockfish via UCI on 127.0.0.1:5001
      </footer>
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}