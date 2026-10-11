import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/client";
import { useBoard } from "./useBoard";
import type { BoardModel } from "./useBoard";
import type { EngineStatus, LibraryEntry, Settings } from "../api/types";

export type TabId = "board" | "review" | "library" | "openings" | "settings";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface AppContextValue {
  tab: TabId;
  setTab: (t: TabId) => void;

  board: BoardModel;

  engine: EngineStatus | null;
  engineLoading: boolean;
  refreshEngine: (silent?: boolean) => Promise<void>;
  restartEngine: () => Promise<void>;

  settings: Settings | null;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;

  library: LibraryEntry[];
  libraryLoading: boolean;
  refreshLibrary: () => Promise<void>;

  /** Open a specific library game in the Review tab. */
  openGameInReview: (id: string) => void;
  pendingReviewId: string | null;
  clearPendingReview: () => void;

  analyzeDepth: number;
  setAnalyzeDepth: (d: number) => void;
  analyzeMultipv: number;
  setAnalyzeMultipv: (m: number) => void;

  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const board = useBoard();

  const [tab, setTab] = useState<TabId>("board");
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [pendingReviewId, setPendingReviewId] = useState<string | null>(null);
  const [analyzeDepth, setAnalyzeDepth] = useState(18);
  const [analyzeMultipv, setAnalyzeMultipv] = useState(1);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = toastId.current++;
    setToasts((ts) => [...ts.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 6000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const refreshEngine = useCallback(async (silent = false) => {
    if (!silent) setEngineLoading(true);
    try {
      const st = await api.engineStatus();
      setEngine(st);
    } catch {
      setEngine(null);
    } finally {
      if (!silent) setEngineLoading(false);
    }
  }, []);

  const restartEngine = useCallback(async () => {
    setEngineLoading(true);
    try {
      const st = await api.engineRestart();
      setEngine(st);
      toast(st.available ? `Engine restarted: ${st.name}` : `Engine unavailable: ${st.error}`, st.available ? "success" : "error");
    } catch (e) {
      toast(`Engine restart failed: ${(e as Error).message}`, "error");
    } finally {
      setEngineLoading(false);
    }
  }, [toast]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.settingsGet();
      setSettings(s);
      setAnalyzeDepth(s.review?.depth ?? s.engine?.depth ?? 18);
      setAnalyzeMultipv(s.engine?.multipv ?? 1);
    } catch {
      setSettings(null);
    }
  }, []);

  const updateSettings = useCallback(async (patch: Record<string, unknown>) => {
    try {
      const s = await api.settingsPut(patch);
      setSettings(s);
      setAnalyzeDepth(s.review?.depth ?? analyzeDepth);
      setAnalyzeMultipv(s.engine?.multipv ?? analyzeMultipv);
    } catch (e) {
      toast(`Failed to save settings: ${(e as Error).message}`, "error");
      throw e;
    }
  }, [analyzeDepth, analyzeMultipv, toast]);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await api.libraryList();
      setLibrary(res.games);
    } catch {
      /* leave existing list */
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const openGameInReview = useCallback((id: string) => {
    setPendingReviewId(id);
    setTab("review");
  }, []);

  const clearPendingReview = useCallback(() => setPendingReviewId(null), []);

  useEffect(() => {
    void refreshEngine();
    void loadSettings();
    void refreshLibrary();
    const iv = window.setInterval(() => void refreshEngine(true).catch(() => undefined), 15000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      tab,
      setTab,
      board,
      engine,
      engineLoading,
      refreshEngine,
      restartEngine,
      settings,
      updateSettings,
      library,
      libraryLoading,
      refreshLibrary,
      openGameInReview,
      pendingReviewId,
      clearPendingReview,
      analyzeDepth,
      setAnalyzeDepth,
      analyzeMultipv,
      setAnalyzeMultipv,
      toasts,
      toast,
      dismissToast,
    }),
    [
      tab, board, engine, engineLoading, refreshEngine, restartEngine, settings, updateSettings,
      library, libraryLoading, refreshLibrary, openGameInReview, pendingReviewId, clearPendingReview,
      analyzeDepth, setAnalyzeDepth, analyzeMultipv, setAnalyzeMultipv, toasts, toast, dismissToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}