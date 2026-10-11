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
  board: { flip: false, theme: "classic", show_coordinates: true, show_legal_moves: true, sound: false, arrow_best_move: true },
  online_import: { enabled: true, timeout_s: 15 },
};

const ENTRY = {
  id: "game-abc",
  content_hash: "hash",
  headers: { White: "A", Black: "B", Result: "1-0" },
  white: "A",
  black: "B",
  event: "Import test",
  site: "lichess",
  date: "2026.10.01",
  result: "1-0",
  eco: "",
  opening: "",
  ply_count: 4,
  source_name: "lichess:foo",
  added_at: 1,
  tags: [],
  collections: [],
  analysis: { status: "none" },
  files: {},
  start_fen: "",
  moves: [
    { ply: 1, san: "e4", uci: "e2e4", fen_before: "", fen_after: "" },
    { ply: 2, san: "e5", uci: "e7e5", fen_before: "", fen_after: "" },
    { ply: 3, san: "Nf3", uci: "g1f3", fen_before: "", fen_after: "" },
    { ply: 4, san: "Nc6", uci: "b8c6", fen_before: "", fen_after: "" },
  ],
};

describe("online import", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("imports the last games by username and auto-starts a review", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      calls.push(`${method} ${url}`);

      if (url.endsWith("/api/v1/health")) return json({ status: "ok", engine: true, data_dir: "./data", cache_entries: 0 });
      if (url.endsWith("/api/v1/engine/status")) {
        return json({ available: true, name: "Stockfish 19", author: "The Stockfish developers", path: "/usr/bin/stockfish", error: null });
      }
      if (url.endsWith("/api/v1/settings") && method === "GET") return json({ settings: SETTINGS, engine: {} });
      if (url.endsWith("/api/v1/library") && method === "GET") return json({ games: [], collections: [] });
      if (method === "POST" && url.endsWith("/api/v1/library/import/online")) {
        return json({
          imported: 1,
          games: [{ id: ENTRY.id, duplicate: false, white: ENTRY.white, black: ENTRY.black, date: ENTRY.date, result: ENTRY.result }],
          source: "lichess",
          username: "foo",
          skipped_variants: 0,
          errors: [],
        });
      }
      if (url.endsWith(`/api/v1/library/${ENTRY.id}`)) return json(ENTRY);
      if (method === "POST" && url.endsWith("/api/v1/jobs/review")) return json({ job_id: "job-1" });
      if (url.includes(`/api/v1/jobs/job-1`)) return json({ status: "queued", progress: 0, message: "", error: null });
      return json({});
    });

    render(<App />);
    fireEvent.click(await screen.findByText("Library"));

    const usernameInput = await screen.findByPlaceholderText(/DrNykterstein/i);
    fireEvent.change(usernameInput, { target: { value: "foo" } });
    fireEvent.click(screen.getByRole("button", { name: /Import & analyze/i }));

    // The import endpoint was called and the newest game opened for review.
    await waitFor(() => {
      expect(calls.some((c) => c === "POST /api/v1/library/import/online")).toBe(true);
      expect(calls.some((c) => c === "POST /api/v1/jobs/review")).toBe(true);
    });
    expect(await screen.findByText(/Imported 1 game from lichess/i)).toBeInTheDocument();
  });
});