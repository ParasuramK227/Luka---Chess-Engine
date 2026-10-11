import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../App";

const SETTINGS = {
  data_dir: "./data",
  engine: {
    path: "/usr/bin/stockfish",
    threads: 2,
    hash_mb: 64,
    multipv: 1,
    depth: 18,
    movetime_ms: 0,
    nodes: 0,
    show_wdl: true,
    syzygy_path: "",
    extra_options: {},
  },
  review: { depth: 10, max_positions: 600, resume: true },
  classification: { excellent_loss: 20, good_loss: 50, inaccuracy_loss: 90, mistake_loss: 150, blunder_loss: 250 },
  accuracy: { model: "winprob-loss", cp_scale: 0.00368208, full_accuracy_bonus: 0 },
  board: { flip: false, theme: "classic", show_coordinates: true, show_legal_moves: true, sound: false, arrow_best_move: true, auto_analyze: true, live_depth: 18 },
  online_import: { enabled: false, timeout_s: 15 },
};

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.endsWith("/api/v1/health")) return json({ status: "ok", engine: true, data_dir: "./data", cache_entries: 0 });
    if (url.endsWith("/api/v1/engine/status")) {
      return json({ available: true, name: "Stockfish 19", author: "The Stockfish developers", path: "/usr/bin/stockfish", error: null, supported_options: {}, defaults: SETTINGS.engine });
    }
    if (url.endsWith("/api/v1/settings")) return json({ settings: SETTINGS, engine: {} });
    if (url.endsWith("/api/v1/library")) return json({ games: [], collections: [] });
    if (url.endsWith("/api/v1/openings/list")) return json({ openings: [], count: 0, source: "bundled" });
    if (url.endsWith("/api/v1/openings/lookup")) return json({ opening: null, source: "bundled" });
    if (url.endsWith("/api/v1/legal-moves")) return json({ fen: "", moves: [] });
    if (url.endsWith("/api/v1/fen/validate")) {
      return json({ valid: true, error: null, fen: "start", turn: "white", is_check: false, is_checkmate: false, is_stalemate: false, is_game_over: false, legal_move_count: 20 });
    }
    if (url.includes("/api/v1/library/") && method === "DELETE") return json({ deleted: true });
    if (method === "POST" && url.endsWith("/api/v1/library/import")) return json({ imported: 0, games: [], errors: [] });
    if (method === "POST" && url.endsWith("/api/v1/pgn/parse")) return json({ games: [], errors: [], count: 0 });
    if (url.endsWith("/api/v1/cache/clear")) return json({ cleared: 0 });
    return json({});
  });
});

describe("App smoke", () => {
  it("renders header, engine badge and tabs", async () => {
    render(<App />);
    expect(screen.getByText("Luka - Chess Engine")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Board")).toBeInTheDocument());
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByText("Openings")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows the board tab with engine analysis panel", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Engine analysis/i)).toBeInTheDocument());
    expect(await screen.findByRole("button", { name: /analyze/i })).toBeInTheDocument();
  });

  it("navigates to the Library tab", async () => {
    render(<App />);
    const libTab = await screen.findByText("Library");
    fireEvent.click(libTab);
    await waitFor(() => expect(screen.getByText(/Import games/i)).toBeInTheDocument());
  });

  it("navigates to Settings and shows engine name", async () => {
    render(<App />);
    const settingsTab = await screen.findByText("Settings");
    fireEvent.click(settingsTab);
    await waitFor(() => expect(screen.getByText(/The Stockfish developers/i)).toBeInTheDocument());
  });
});