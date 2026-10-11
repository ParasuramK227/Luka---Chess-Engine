"""Position evaluation cache.

Cache keys include the position, depth, MultiPV, engine name, and the relevant
engine option values, so results are invalidated when any of those change.
Stored as a single JSON file in the data directory and written atomically.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

MAX_ENTRIES = 100_000


def make_key(fen: str, depth: int, multipv: int, engine: str | None, options: dict | None = None) -> str:
    opts = options or {}
    opt_sig = ",".join(f"{k}={opts[k]}" for k in sorted(opts))
    return f"{fen}|d={depth}|mp={multipv}|e={engine or '?'}|o={opt_sig}"


class EvalCache:
    def __init__(self, path: Path):
        self._path = Path(path)
        self._lock = threading.RLock()
        self._data: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        try:
            if self._path.is_file():
                with self._path.open("r", encoding="utf-8") as fh:
                    raw = json.load(fh)
                if isinstance(raw, dict):
                    self._data = raw
        except (json.JSONDecodeError, OSError):
            self._data = {}

    def get(self, key: str) -> dict | None:
        with self._lock:
            return self._data.get(key)

    def put(self, key: str, value: dict) -> None:
        with self._lock:
            if len(self._data) >= MAX_ENTRIES:
                # Drop ~10% oldest-inserted entries as a simple bound.
                for k in list(self._data.keys())[: MAX_ENTRIES // 10]:
                    self._data.pop(k, None)
            self._data[key] = value

    def flush(self) -> None:
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".json.tmp")
            with tmp.open("w", encoding="utf-8") as fh:
                json.dump(self._data, fh)
            tmp.replace(self._path)

    def clear(self) -> None:
        with self._lock:
            self._data = {}
            if self._path.is_file():
                self._path.unlink()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)
