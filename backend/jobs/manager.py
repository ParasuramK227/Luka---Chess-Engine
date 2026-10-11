"""A small in-process job system for long-running analysis.

Jobs run on a bounded thread pool. Progress is exposed both through polling
(``GET /jobs/<id>``) and Server-Sent Events, and every job can be cancelled.
Nothing here blocks the request thread.
"""

from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

TERMINAL = {"done", "error", "cancelled"}
MAX_HISTORY = 50


class Job:
    def __init__(self, job_id: str, kind: str):
        self.id = job_id
        self.kind = kind
        self.status = "queued"
        self.progress = 0.0
        self.message = "Queued"
        self.result: Any = None
        self.error: str | None = None
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.cancel_event = threading.Event()
        self.data: dict[str, Any] = {}
        self._lock = threading.Lock()

    # -- updates -----------------------------------------------------------

    def set_progress(self, progress: float, message: str | None = None) -> None:
        with self._lock:
            self.progress = max(0.0, min(100.0, float(progress)))
            if message is not None:
                self.message = message
            self.updated_at = time.time()
            if self.status == "queued":
                self.status = "running"

    def is_cancelled(self) -> bool:
        return self.cancel_event.is_set()

    def set_data(self, data: dict) -> None:
        with self._lock:
            self.data = data
            self.updated_at = time.time()

    def _snapshot_locked(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 2),
            "message": self.message,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "has_result": self.result is not None,
            "data": self.data,
        }

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot_locked()

    def result_payload(self) -> dict:
        with self._lock:
            return {
                **self._snapshot_locked(),
                "result": self.result,
            }


class JobManager:
    def __init__(self, max_workers: int = 2):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="chesslab-job")
        self._jobs: dict[str, Job] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()

    def submit(self, kind: str, fn: Callable[[Job], Any]) -> str:
        job = Job(uuid.uuid4().hex, kind)
        with self._lock:
            self._jobs[job.id] = job
            self._order.append(job.id)
            while len(self._order) > MAX_HISTORY:
                oldest = self._order.pop(0)
                self._jobs.pop(oldest, None)

        def runner() -> None:
            if job.is_cancelled():
                job.status = "cancelled"
                job.message = "Cancelled before start"
                return
            job.status = "running"
            try:
                result = fn(job)
            except Exception as exc:  # noqa: BLE001 - surface to client
                job.status = "cancelled" if job.is_cancelled() else "error"
                job.error = str(exc)
                job.message = f"Failed: {exc}"
                job.updated_at = time.time()
                return
            if job.is_cancelled():
                job.status = "cancelled"
                job.message = "Cancelled"
                job.result = result
            else:
                job.status = "done"
                job.progress = 100.0
                job.message = "Complete"
                job.result = result
            job.updated_at = time.time()

        self._executor.submit(runner)
        return job.id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None:
            return False
        job.cancel_event.set()
        if job.status in TERMINAL:
            return True
        job.message = "Cancelling..."
        job.updated_at = time.time()
        return True

    def list_jobs(self) -> list[dict]:
        with self._lock:
            jobs = [self._jobs[j].snapshot() for j in self._order if j in self._jobs]
        return list(reversed(jobs))

    def events(self, job_id: str, poll_interval: float = 0.4):
        """Yield SSE-style progress snapshots until the job reaches a terminal state."""
        last = None
        while True:
            job = self.get(job_id)
            if job is None:
                yield {"id": job_id, "status": "error", "error": "Unknown job"}
                return
            snap = job.snapshot()
            if snap != last:
                yield snap
                last = snap
            if snap["status"] in TERMINAL:
                return
            time.sleep(poll_interval)

    def shutdown(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            if job.status not in TERMINAL:
                job.cancel_event.set()
        self._executor.shutdown(wait=False, cancel_futures=True)
