import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import type { ReviewResult } from "../api/types";

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

const EVAL = (cp: number) => ({ type: "cp" as const, cp, pov_cp: cp, mate: null });

function buildReview(): ReviewResult {
  const sans = ["e4", "e5", "Nf3", "Nc6"];
  const ucis = ["e2e4", "e7e5", "g1f3", "b8c6"];
  const evals = [EVAL(20), EVAL(30), EVAL(0), EVAL(25), EVAL(0)];
  const moves = sans.map((san, i) => {
    const ply = i + 1;
    const mover: "white" | "black" = ply % 2 === 1 ? "white" : "black";
    return {
      ply,
      move_number: Math.ceil(ply / 2),
      mover,
      san,
      uci: ucis[i],
      fen_before: "",
      fen_after: "",
      category: "book",
      category_label: "Book",
      nag: null,
      reason: { rule: "Move is part of the bundled opening dataset." },
      metrics: { cp_loss: 0, delta_wp: 0, accuracy: 100, best_wp: 0.5, played_wp: 0.5, forced: false, applicable: true },
      best_move_uci: ucis[i],
      best_move_san: san,
      best_pv_san: [san],
      eval_before: evals[i],
      eval_after: evals[i + 1],
      material_given: 0,
    };
  });
  const player = (movesScored: number, average_cp_loss: number) => ({
    moves_analyzed: movesScored,
    moves_scored: movesScored,
    average_cp_loss,
    accuracy: average_cp_loss === 0 ? 100 : 98 - average_cp_loss,
    median_cp_loss: average_cp_loss,
    classifications: { book: movesScored },
  });
  return {
    ok: true,
    complete: true,
    cancelled: false,
    game: {
      headers: { White: "A", Black: "B", Result: "1-0" },
      result: "1-0",
      start_fen: "",
      moves: sans.map((san, i) => ({ ply: i + 1, san, uci: ucis[i] })),
      content_hash: null,
    },
    analysis: { engine: "Stockfish 19", depth: 10, multipv: 1, positions_analyzed: 5 },
    positions: evals.map((evalScore, ply) => ({
      ply,
      fen: "",
      eval: evalScore,
      units: evalScore.cp,
      best_move_uci: ply < 4 ? ucis[ply] : null,
      best_pv_san: ply < sans.length ? [sans[ply]] : [],
      wdl: null,
    })),
    moves,
    summary: {
      white: player(2, 5),
      black: player(2, 8),
      critical_moments: [],
      opening: { eco: "C40", name: "King's Pawn Game", matched_moves: 1 },
      result: "1-0",
      accuracy_method: { model: "winprob", note: "documented approximation" },
      depth: 10,
      engine: "Stockfish 19",
    },
    annotations: [],
  } as ReviewResult;
}

describe("import -> auto-review -> completed review renders", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the review UI (board, stats column, badges) after the job finishes", async () => {
    const calls: string[] = [];
    let reviewDelivered = false;

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

      if (method === "GET" && url.includes("/api/v1/jobs/job-1") && url.endsWith("/result")) {
        reviewDelivered = true;
        return json({ status: "done", progress: 100, message: "ok", error: null, has_result: true, id: "job-1", result: buildReview() });
      }
      if (method === "GET" && url.includes("/api/v1/jobs/job-1")) return json({ status: "done", progress: 100, message: "ok", error: null, has_result: true, id: "job-1" });
      return json({});
    });

    render(<App />);

    // Import a game (much like an online import), which lands on Review and
    // auto-starts a review job.
    fireEvent.click(await screen.findByText("Library"));
    fireEvent.change(await screen.findByPlaceholderText(/DrNykterstein/i), { target: { value: "foo" } });
    fireEvent.click(screen.getByRole("button", { name: /Import & analyze/i }));

    await waitFor(() => expect(calls.some((c) => c === "POST /api/v1/jobs/review")).toBe(true));

    // The job completes: the review must render (not a black screen) including
    // the new middle stats column and the move badges on the board.
    await waitFor(() => expect(reviewDelivered).toBe(true), { timeout: 5000 });
    expect(await screen.findByText("Game stats")).toBeInTheDocument();
    expect(screen.getByText(/from saved review/i)).toBeInTheDocument();
    expect(screen.getByText(/Classifications/i)).toBeInTheDocument();
    expect(screen.getAllByText("Book").length).toBeGreaterThan(0);
    // Badge chip(s) on the board + tally chips carry the category as a title.
    expect(screen.getAllByTitle("Book").length).toBeGreaterThan(0);
    // Accuracies per side shown in the stats column (and accuracies card).
    expect(screen.getAllByText("93.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("90.0%").length).toBeGreaterThan(0);
  });
});