// Types mirroring the Luka - Chess Engine backend API payloads.

export interface EngineScore {
  type: "cp" | "mate" | null;
  cp: number | null;
  mate: number | null;
  pov_cp: number | null;
}

export interface EvalLine {
  multipv: number;
  depth: number | null;
  seldepth: number | null;
  nodes: number | null;
  nps: number | null;
  time: number | null;
  hashfull: number | null;
  score: EngineScore;
  pv_uci: string[];
  pv_san: string[];
  currmove: string | null;
  currmovenumber: number | null;
  wdl: [number, number, number] | null;
  turn: "white" | "black";
}

export interface AnalysisResult {
  fen: string;
  turn: "white" | "black";
  legal_moves: number;
  is_game_over: boolean;
  is_checkmate: boolean;
  is_stalemate: boolean;
  is_check: boolean;
  lines: EvalLine[];
  depth: number;
  multipv: number;
  cancelled: boolean;
  engine: string;
}

export interface PgnMove {
  ply: number;
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  comment?: string;
  clock?: number | null;
  nags?: number[];
  variations?: Array<{ moves: PgnMove[] }>;
}

export interface ParsedGame {
  index: number;
  headers: Record<string, string>;
  result: string;
  start_fen: string;
  moves: PgnMove[];
  content_hash: string;
  ply_count: number;
  has_variations: boolean;
}

export interface ParsePgnResponse {
  games: ParsedGame[];
  errors: { index: number; error: string }[];
  count: number;
}

export interface LibraryEntry {
  id: string;
  content_hash: string;
  headers: Record<string, string>;
  white: string;
  black: string;
  event: string;
  site: string;
  date: string;
  result: string;
  eco: string;
  opening: string;
  ply_count: number;
  source_name: string;
  added_at: number;
  tags: string[];
  collections: string[];
  analysis: {
    status: "none" | "running" | "complete";
    depth?: number;
    multipv?: number;
    engine?: string;
    accuracy?: { white?: number; black?: number };
    reviewed_at?: number;
  };
  files: Record<string, string>;
  start_fen: string;
  moves: PgnMove[];
}

export interface JobSnapshot {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  has_result: boolean;
  data?: Record<string, unknown>;
}

export interface ReviewMove {
  ply: number;
  move_number: number;
  mover: "white" | "black";
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  category: string;
  category_label: string;
  reason: Record<string, unknown> & { rule?: string };
  nag: number | null;
  metrics: {
    cp_loss: number;
    delta_wp: number;
    accuracy: number;
    best_wp: number | null;
    played_wp: number | null;
    forced: boolean;
    applicable: boolean;
  };
  best_move_uci: string | null;
  best_move_san: string | null;
  best_pv_san: string[];
  eval_before: EngineScore | null;
  eval_after: EngineScore | null;
  material_given: number;
}

export interface ReviewPosition {
  ply: number;
  fen: string;
  eval: EngineScore | null;
  units: number | null;
  best_move_uci: string | null;
  best_pv_san: string[];
  wdl: [number, number, number] | null;
}

export interface ReviewSummary {
  white: SummaryPlayer;
  black: SummaryPlayer;
  critical_moments: CriticalMoment[];
  opening: { eco: string; name: string; matched_moves: number } | null;
  result: string;
  accuracy_method: Record<string, string>;
  depth: number;
  engine: string;
}

export interface SummaryPlayer {
  moves_analyzed: number;
  moves_scored: number;
  average_cp_loss: number | null;
  accuracy: number | null;
  median_cp_loss: number | null;
  classifications: Record<string, number>;
}

export interface CriticalMoment {
  ply: number;
  move_number: number;
  mover: "white" | "black";
  san: string;
  category: string;
  delta_wp: number | null;
  cp_loss: number | null;
  eval_before: EngineScore | null;
  eval_after: EngineScore | null;
}

export interface ReviewResult {
  ok: boolean;
  complete: boolean;
  cancelled: boolean;
  game: {
    headers: Record<string, string>;
    result: string;
    start_fen: string;
    moves: { ply: number; san: string; uci: string }[];
    content_hash: string | null;
  };
  analysis: {
    engine: string;
    depth: number;
    multipv: number;
    positions_analyzed: number;
  };
  positions: ReviewPosition[];
  moves: ReviewMove[];
  summary: ReviewSummary;
  annotations: { comment: string; nag: number | null }[];
}

export interface EngineStatus {
  available: boolean;
  name: string | null;
  author: string | null;
  path: string;
  error: string | null;
  supported_options?: Record<string, EngineOption>;
  defaults?: Record<string, unknown>;
}

export interface EngineOption {
  name: string;
  type: string;
  default: unknown;
  min?: number | null;
  max?: number | null;
  var?: unknown[] | null;
}

export interface Settings {
  data_dir: string;
  engine: {
    path: string;
    threads: number;
    hash_mb: number;
    multipv: number;
    depth: number;
    movetime_ms: number;
    nodes: number;
    show_wdl: boolean;
    syzygy_path: string;
    extra_options: Record<string, unknown>;
  };
  review: { depth: number; max_positions: number; resume: boolean };
  classification: {
    excellent_loss: number;
    good_loss: number;
    inaccuracy_loss: number;
    mistake_loss: number;
    blunder_loss: number;
  };
  accuracy: { model: string; cp_scale: number; full_accuracy_bonus: number };
  board: {
    flip: boolean;
    theme: string;
    show_coordinates: boolean;
    show_legal_moves: boolean;
    sound: boolean;
    arrow_best_move: boolean;
  };
  online_import: { enabled: boolean; timeout_s: number };
}

export interface FenValidation {
  valid: boolean;
  error: string | null;
  fen: string | null;
  turn: "white" | "black";
  is_check: boolean;
  is_checkmate: boolean;
  is_stalemate: boolean;
  is_game_over: boolean;
  legal_move_count: number;
}

export interface LegalMove {
  uci: string;
  san: string;
  from: string;
  to: string;
  promotion: string | null;
}

export interface ApiError {
  code: string;
  message: string;
}