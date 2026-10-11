"""File-backed game library.

Games are stored as PGN files under ``data/games`` with an index in
``data/library.json``. Review reports are written alongside under
``data/reports``. Original imported files are never modified.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from .file_manager import FileManager, content_hash
from .pgn_service import games_to_pgn


class Library:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.games_dir = self.data_dir / "games"
        self.reports_dir = self.data_dir / "reports"
        self.index_path = self.data_dir / "library.json"
        self.fm = FileManager(self.data_dir)
        self.games_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._index: list[dict] = self._load()

    # -- persistence -------------------------------------------------------

    def _load(self) -> list[dict]:
        try:
            if self.index_path.is_file():
                with self.index_path.open("r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, list):
                    return data
        except (json.JSONDecodeError, OSError):
            pass
        return []

    def _save(self) -> None:
        tmp = self.index_path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(self._index, fh, indent=2)
        tmp.replace(self.index_path)

    # -- queries -----------------------------------------------------------

    def list(self, *, query: str | None = None, collection: str | None = None,
             tag: str | None = None, status: str | None = None) -> list[dict]:
        with self._lock:
            entries = list(self._index)
        q = (query or "").lower().strip()
        out = []
        for e in entries:
            if collection and collection not in (e.get("collections") or []):
                continue
            if tag and tag not in (e.get("tags") or []):
                continue
            if status and (e.get("analysis") or {}).get("status") != status:
                continue
            if q:
                haystack = " ".join(
                    str(e.get(k, "")) for k in
                    ("white", "black", "event", "site", "date", "result", "eco", "opening", "source_name")
                ).lower()
                if q not in haystack:
                    continue
            out.append(e)
        return sorted(out, key=lambda e: e.get("added_at", 0), reverse=True)

    def get(self, game_id: str) -> dict | None:
        with self._lock:
            for e in self._index:
                if e["id"] == game_id:
                    return dict(e)
        return None

    def find_by_hash(self, digest: str) -> dict | None:
        with self._lock:
            for e in self._index:
                if e.get("content_hash") == digest:
                    return dict(e)
        return None

    # -- mutations ---------------------------------------------------------

    def _entry_id(self, digest: str) -> str:
        return digest[:16]

    def add(self, game: dict, *, source_name: str = "import") -> dict:
        """Add a parsed game, de-duplicating by content hash."""
        digest = game.get("content_hash") or content_hash(
            json.dumps(game.get("moves", []), sort_keys=True)
        )
        with self._lock:
            existing = self.find_by_hash(digest)
            if existing is not None:
                existing["duplicate"] = True
                return existing

            game_id = self._entry_id(digest)
            headers = game.get("headers") or {}
            pgn_path = self.games_dir / f"{game_id}.pgn"
            pgn_text = games_to_pgn(
                [
                    {
                        "headers": headers,
                        "result": game.get("result", "*"),
                        "start_fen": game.get("start_fen"),
                        "moves": game.get("moves", []),
                    }
                ]
            )
            self.fm.write_text(pgn_path, pgn_text, overwrite=True)

            entry = {
                "id": game_id,
                "content_hash": digest,
                "headers": headers,
                "white": headers.get("White", ""),
                "black": headers.get("Black", ""),
                "event": headers.get("Event", ""),
                "site": headers.get("Site", ""),
                "date": headers.get("Date", ""),
                "result": game.get("result", headers.get("Result", "*")),
                "eco": headers.get("ECO", ""),
                "opening": headers.get("Opening", ""),
                "ply_count": game.get("ply_count", len(game.get("moves", []))),
                "source_name": source_name,
                "added_at": time.time(),
                "tags": [],
                "collections": [],
                "analysis": {"status": "none"},
                "files": {"pgn": str(pgn_path.relative_to(self.data_dir))},
                "start_fen": game.get("start_fen"),
                "moves": game.get("moves", []),
            }
            self._index.append(entry)
            self._save()
            return dict(entry)

    def update(self, game_id: str, patch: dict) -> dict | None:
        with self._lock:
            for e in self._index:
                if e["id"] == game_id:
                    e.update(patch)
                    self._save()
                    return dict(e)
        return None

    def set_analysis(self, game_id: str, **kwargs) -> dict | None:
        with self._lock:
            for e in self._index:
                if e["id"] == game_id:
                    analysis = dict(e.get("analysis") or {})
                    analysis.update(kwargs)
                    e["analysis"] = analysis
                    self._save()
                    return dict(e)
        return None

    def delete(self, game_id: str) -> bool:
        with self._lock:
            remaining = []
            found = False
            for e in self._index:
                if e["id"] == game_id:
                    found = True
                    for rel in (e.get("files") or {}).values():
                        try:
                            self.fm.delete(self.data_dir / rel)
                        except Exception:
                            pass
                else:
                    remaining.append(e)
            if found:
                self._index = remaining
                self._save()
            return found

    def add_tag(self, game_id: str, tag: str) -> dict | None:
        entry = self.get(game_id)
        if entry is None:
            return None
        tags = sorted(set((entry.get("tags") or []) + [tag]))
        return self.update(game_id, {"tags": tags})

    def add_to_collection(self, game_id: str, collection: str) -> dict | None:
        entry = self.get(game_id)
        if entry is None:
            return None
        collections = sorted(set((entry.get("collections") or []) + [collection]))
        return self.update(game_id, {"collections": collections})

    def remove_tag(self, game_id: str, tag: str) -> dict | None:
        entry = self.get(game_id)
        if entry is None:
            return None
        tags = sorted(t for t in (entry.get("tags") or []) if t != tag)
        return self.update(game_id, {"tags": tags})

    def remove_from_collection(self, game_id: str, collection: str) -> dict | None:
        entry = self.get(game_id)
        if entry is None:
            return None
        collections = sorted(c for c in (entry.get("collections") or []) if c != collection)
        return self.update(game_id, {"collections": collections})

    def get_moves(self, game_id: str) -> list[dict] | None:
        entry = self.get(game_id)
        if entry is None:
            return None
        return entry.get("moves") or []

    def collections(self) -> list[str]:
        with self._lock:
            names = set()
            for e in self._index:
                names.update(e.get("collections") or [])
        return sorted(names)

    def save_report_files(self, game_id: str, contents: dict[str, str]) -> dict:
        """Write report artifacts and record their relative paths on the entry."""
        files = {}
        for key, text in contents.items():
            filename = f"{game_id}.{key}"
            path = self.reports_dir / filename
            self.fm.write_text(path, text, overwrite=True)
            files[key] = str(path.relative_to(self.data_dir))
        entry = self.get(game_id)
        if entry is not None:
            merged = {**(entry.get("files") or {}), **files}
            self.update(game_id, {"files": merged})
        return files
