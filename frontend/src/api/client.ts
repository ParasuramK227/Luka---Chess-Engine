import type {
  AnalysisResult,
  EngineStatus,
  FenValidation,
  JobSnapshot,
  LegalMove,
  LibraryEntry,
  ParsePgnResponse,
  ParsedGame,
  ReviewResult,
  Settings,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "http_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Cannot reach the local ChessLab backend. Is it running?", 0, "network");
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code = "http_error";
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
    } catch {
      /* keep defaults */
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
}

// ---- engine ---------------------------------------------------------------

export const api = {
  health(): Promise<{ status: string; engine: boolean; data_dir: string; cache_entries: number }> {
    return request("/health");
  },

  engineStatus(): Promise<EngineStatus> {
    return request("/engine/status");
  },

  engineRestart(): Promise<EngineStatus> {
    return post("/engine/restart");
  },

  engineConfigure(cfg: Partial<Settings["engine"]>): Promise<EngineStatus> {
    return post("/engine/configure", cfg);
  },

  validateFen(fen: string): Promise<FenValidation> {
    return post("/fen/validate", { fen });
  },

  legalMoves(fen: string): Promise<{ fen: string; moves: LegalMove[]; legal_move_count: number; is_game_over: boolean; is_check: boolean }> {
    return post("/legal-moves", { fen });
  },

  // ---- jobs ----

  analyze(body: { fen: string; depth?: number; multipv?: number; movetime_ms?: number; nodes?: number }): Promise<{ job_id: string }> {
    return post("/jobs/analyze", body);
  },

  review(body: { game_id?: string; pgn?: string; game_index?: number; depth?: number; max_positions?: number }): Promise<{ job_id: string }> {
    return post("/jobs/review", body);
  },

  job(id: string): Promise<JobSnapshot> {
    return request(`/jobs/${id}`);
  },

  jobResult(id: string): Promise<JobSnapshot & { result: AnalysisResult | ReviewResult }> {
    return request(`/jobs/${id}/result`);
  },

  cancelJob(id: string): Promise<{ cancelled: boolean; job_id: string }> {
    return post(`/jobs/${id}/cancel`);
  },

  jobs(): Promise<JobSnapshot[]> {
    return request("/jobs");
  },

  jobEventsUrl(id: string): string {
    return `${BASE}/jobs/${id}/events`;
  },

  // ---- pgn / library ----

  parsePgn(pgn: string, sourceName?: string): Promise<ParsePgnResponse> {
    return post("/pgn/parse", { pgn, source_name: sourceName });
  },

  libraryList(q?: string, collection?: string): Promise<{ games: LibraryEntry[]; collections: string[] }> {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (collection) params.set("collection", collection);
    const qs = params.toString();
    return request(`/library${qs ? `?${qs}` : ""}`);
  },

  libraryGet(id: string): Promise<LibraryEntry> {
    return request(`/library/${id}`);
  },

  libraryDelete(id: string): Promise<{ deleted: boolean; id: string }> {
    return request(`/library/${id}`, { method: "DELETE" });
  },

  libraryImport(pgn: string, sourceName?: string): Promise<{ imported: number; games: { id: string; duplicate?: boolean }[]; errors: { index: number; error: string }[] }> {
    return post("/library/import", { pgn, source_name: sourceName ?? "pasted.pgn" });
  },

  libraryTag(id: string, tag: string): Promise<LibraryEntry> {
    return post(`/library/${id}/tags`, { tag });
  },

  libraryUntag(id: string, tag: string): Promise<LibraryEntry> {
    return request(`/library/${id}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
  },

  libraryCollection(id: string, collection: string): Promise<LibraryEntry> {
    return post(`/library/${id}/collections`, { collection });
  },

  libraryUncollection(id: string, collection: string): Promise<LibraryEntry> {
    return request(`/library/${id}/collections/${encodeURIComponent(collection)}`, { method: "DELETE" });
  },

  reportDownloadUrl(id: string, fmt: "html" | "pgn" | "json" | "csv"): string {
    return `${BASE}/library/${id}/report/${fmt}`;
  },

  libraryReview(id: string, depth?: number): Promise<ReviewResult> {
    const qs = depth ? `?depth=${depth}` : "";
    return request(`/library/${id}/review${qs}`);
  },

  // ---- settings / openings ----

  settingsGet(): Promise<Settings> {
    return request<{ settings: Settings }>("/settings").then((d) => d.settings);
  },

  settingsPut(patch: Record<string, unknown>): Promise<Settings> {
    return put<{ settings: Settings }>("/settings", { settings: patch }).then((d) => d.settings);
  },

  openings(moves: string[]): Promise<{ eco: string; name: string; matched_moves: number; total_moves: number } | null> {
    return post<{ opening: { eco: string; name: string; matched_moves: number; total_moves: number } | null }>("/openings/lookup", { moves }).then((d) => d.opening);
  },

  openingsList(q?: string): Promise<{ openings: { eco: string; name: string; moves: string[] }[]; count: number; source: string }> {
    return post("/openings/list", { q });
  },

  cacheClear(): Promise<{ cleared: number }> {
    return post("/cache/clear");
  },

  filesList(path: string): Promise<{ path: string; entries: { name: string; is_dir: boolean; size: number }[] }> {
    return request(`/files/list?path=${encodeURIComponent(path)}`);
  },
};

/** Fetch raw text for report downloads that returns text/plain or file payloads. */
export async function downloadReport(id: string, fmt: "html" | "pgn" | "json" | "csv"): Promise<{ content: string; filename: string }> {
  const url = api.reportDownloadUrl(id, fmt);
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError("Cannot reach the local ChessLab backend.", 0, "network");
  }
  if (!res.ok) throw new ApiError(`Download failed: HTTP ${res.status}`, res.status);
  const content = await res.text();
  const name = fmt === "html" ? "report.html" : fmt === "json" ? "review.json" : fmt === "csv" ? "review.csv" : "annotated.pgn";
  return { content, filename: `${id}.${name}` };
}

export interface ImportConfirm {
  games: ParsedGame[];
  showConfirm: boolean;
}

/** Download text as a file via a temporary anchor. */
export function saveTextFile(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}