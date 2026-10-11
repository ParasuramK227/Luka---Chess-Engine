import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJob } from "../hooks/useJob";

const SNAPSHOT = (id: string, status = "done") => ({
  id,
  kind: "analyze_move",
  status,
  progress: 100,
  message: status === "done" ? "ok" : "running",
  error: null,
  created_at: 0,
  updated_at: 0,
  has_result: status === "done",
});

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (method === "GET" && url.endsWith("/result")) {
      const id = url.split("/").slice(-2)[0];
      return json({ ...SNAPSHOT(id), result: { marker: id } });
    }
    if (method === "GET") {
      const id = url.split("/").pop() as string;
      return json(SNAPSHOT(id));
    }
    return json({ cancelled: true });
  });
});

describe("useJob", () => {
  it("never carries a previous job's result into a new job", async () => {
    const { result } = renderHook(() => useJob());

    act(() => {
      result.current.start("job-a");
    });
    await waitFor(() => expect(result.current.result).toEqual({ marker: "job-a" }));

    // Starting a second job must drop the stale result immediately — treating
    // a previous job's output as the new job's output caused a black screen.
    act(() => {
      result.current.start("job-b");
    });
    expect(result.current.result).toBeNull();
    expect(result.current.jobId).toBe("job-b");
    expect(result.current.running).toBe(true);

    await waitFor(() => expect(result.current.result).toEqual({ marker: "job-b" }));
  });

  it("reports running while a job executes", async () => {
    const { result } = renderHook(() => useJob());
    act(() => {
      result.current.start("job-a");
    });
    expect(result.current.running).toBe(true);
    await waitFor(() => expect(result.current.result).toEqual({ marker: "job-a" }));
    await waitFor(() => expect(result.current.running).toBe(false));
  });
});