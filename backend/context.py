"""Application context: wires settings, engine, library, cache, and jobs."""

from __future__ import annotations

from pathlib import Path

from .analysis.openings import OpeningBook
from .cache.eval_cache import EvalCache
from .config import Settings, get_settings
from .engine.stockfish_manager import EngineUnavailable, StockfishManager
from .jobs.manager import JobManager
from .storage.library import Library


class AppContext:
    def __init__(self):
        self.settings: Settings = get_settings()
        self.jobs = JobManager(max_workers=2)
        self._build()

    def _build(self) -> None:
        s = self.settings.as_dict()
        self.data_dir = Path(s["data_dir"])
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.library = Library(self.data_dir)
        self.book = OpeningBook(self.data_dir / "openings.json")
        self.cache = EvalCache(self.data_dir / "eval_cache.json")

        eng = s["engine"]
        self.engine = StockfishManager(
            eng["path"],
            {
                "threads": eng["threads"],
                "hash_mb": eng["hash_mb"],
                "show_wdl": eng["show_wdl"],
                "syzygy_path": eng["syzygy_path"],
                "extra_options": eng["extra_options"],
            },
        )

    # -- engine ------------------------------------------------------------

    def ensure_engine(self) -> dict:
        """Return engine status, starting the engine on first use."""
        try:
            return self.engine.start()
        except EngineUnavailable as exc:
            status = self.engine.status()
            status["error"] = str(exc)
            return status

    def engine_health(self) -> dict:
        status = self.ensure_engine()
        return {
            "available": status.get("available", False),
            "name": status.get("name"),
            "author": status.get("author"),
            "path": status.get("path"),
            "error": status.get("error"),
        }

    # -- settings ----------------------------------------------------------

    def apply_settings(self, patch: dict) -> dict:
        new = self.settings.update(patch)
        # Reload dependent resources against the new data dir if it changed.
        if Path(new["data_dir"]) != self.data_dir:
            self._build()
        eng = new["engine"]
        self.engine._path = eng["path"]
        self.engine.configure(
            {
                "threads": eng["threads"],
                "hash_mb": eng["hash_mb"],
                "show_wdl": eng["show_wdl"],
                "syzygy_path": eng["syzygy_path"],
                "extra_options": eng["extra_options"],
            }
        )
        return new

    def shutdown(self) -> None:
        self.jobs.shutdown()
        self.engine.quit()
        try:
            self.cache.flush()
        except Exception:  # pragma: no cover
            pass
