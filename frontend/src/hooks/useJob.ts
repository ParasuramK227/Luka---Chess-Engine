import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { JobSnapshot } from "../api/types";

export interface JobHookState {
  jobId: string | null;
  snapshot: JobSnapshot | null;
  result: unknown | null;
  running: boolean;
  start: (jobId: string) => void;
  cancel: () => Promise<void>;
  clear: () => void;
}

/**
 * Track a backend job to completion using SSE when available, with a
 * polling fallback. Fetches the full result payload once the job finishes.
 */
export function useJob(onComplete?: (result: unknown) => void): JobHookState {
  const [jobId, setJobId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [result, setResult] = useState<unknown | null>(null);
  const [running, setRunning] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finishedRef = useRef(false);

  useEffect(() => {
    finishedRef.current = false;
  }, [jobId]);

  const fetchResult = useCallback(async (id: string) => {
    try {
      const res = await api.jobResult(id);
      setResult(res.result);
      setRunning(false);
      onCompleteRef.current?.(res.result);
    } catch (err) {
      // keep snapshot; the caller can retry
      console.warn("fetch result failed", err);
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!jobId) {
      setSnapshot(null);
      setResult(null);
      setRunning(false);
      return;
    }
    setRunning(true);
    let cancelled = false;
    let pollTimer: number | undefined;
    let es: EventSource | null = null;

    const apply = (s: JobSnapshot) => {
      if (cancelled) return;
      setSnapshot(s);
      if ((s.status === "done" || s.status === "error" || s.status === "cancelled") && !finishedRef.current) {
        finishedRef.current = true;
        setRunning(false);
        if (s.status === "done") void fetchResult(jobId);
        if (pollTimer) window.clearInterval(pollTimer);
        es?.close();
      }
    };

    const pollOnce = async () => {
      try {
        const s = await api.job(jobId);
        apply(s);
      } catch {
        /* transient; keep polling */
      }
    };

    try {
      es = new EventSource(api.jobEventsUrl(jobId));
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { job?: JobSnapshot } | JobSnapshot;
          const snap = "job" in data ? data.job : (data as JobSnapshot);
          if (snap?.id) apply(snap);
        } catch {
          /* ignore malformed event */
        }
      };
      es.onerror = () => {
        // SSE dropped — fall back to polling
        if (!pollTimer) {
          pollTimer = window.setInterval(() => void pollOnce(), 1000);
        }
      };
    } catch {
      pollTimer = window.setInterval(() => void pollOnce(), 1000);
    }

    // safety net: always poll periodically in case SSE misses the final state
    const safety = window.setInterval(() => {
      if (pollTimer) return; // already in fallback mode
      void pollOnce();
    }, 2000);

    void pollOnce();

    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer) window.clearInterval(pollTimer);
      window.clearInterval(safety);
    };
  }, [jobId, fetchResult]);

  const start = useCallback((id: string) => {
    setJobId(id);
  }, []);

  const cancel = useCallback(async () => {
    if (jobId) {
      try {
        await api.cancelJob(jobId);
        setRunning(false);
      } catch {
        /* already gone */
      }
    }
  }, [jobId]);

  const clear = useCallback(() => {
    setJobId(null);
    setSnapshot(null);
    setResult(null);
    setRunning(false);
  }, []);

  return { jobId, snapshot, result, running, start, cancel, clear };
}