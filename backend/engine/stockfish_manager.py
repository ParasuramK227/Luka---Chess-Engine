"""Stockfish lifecycle and UCI communication.

A single managed engine process is reused across requests (no process-per-move).
All UCI traffic is serialized with a lock; only ``cancel`` is lock-free so an
in-flight search can be interrupted from another thread.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Callable

import chess
import chess.engine

logger = logging.getLogger("luka.engine")


class EngineUnavailable(RuntimeError):
    """Stockfish is missing, not executable, or failed to start."""


class EngineBusy(RuntimeError):
    """Another analysis is already running on the shared engine."""


def _option_descriptor(option: "chess.engine.Option") -> dict:
    return {
        "name": option.name,
        "type": option.type,
        "default": option.default,
        "min": option.min,
        "max": option.max,
        "var": list(option.var) if option.var else None,
    }


def _score_to_dict(score: "chess.engine.PovScore", turn: chess.Color) -> dict:
    """Normalize a PovScore into White-perspective cp/mate plus turn POV."""
    if score is None:
        return {"type": None, "cp": None, "mate": None, "pov_cp": None}

    white = score.white()
    if white.is_mate():
        mate = white.mate()  # positive => White delivers mate
        cp = None
        pov_cp = score.pov(turn).score(mate_score=100000)
        return {"type": "mate", "cp": None, "mate": mate, "pov_cp": pov_cp}

    cp = white.score()
    return {"type": "cp", "cp": cp, "mate": None, "pov_cp": score.pov(turn).score()}


def _wdl_to_list(wdl: Any, turn: chess.Color) -> list[int] | None:
    if wdl is None:
        return None
    try:
        white = wdl.white()
        return [int(white.wins), int(white.draws), int(white.losses)]
    except Exception:  # pragma: no cover - defensive
        return None


def _pv_to_san(board: chess.Board, pv: list[chess.Move]) -> list[str]:
    b = board.copy()
    out: list[str] = []
    for move in pv:
        try:
            out.append(b.san(move))
            b.push(move)
        except (ValueError, AssertionError):
            break
    return out


class StockfishManager:
    def __init__(self, engine_path: str, options: dict | None = None):
        self._path = engine_path
        self._options = dict(options or {})
        self._engine: chess.engine.SimpleEngine | None = None
        self._lock = threading.RLock()
        self._cancel = threading.Event()
        self._active: chess.engine.AnalysisResult | None = None
        self._meta: dict[str, Any] = {
            "available": False,
            "path": engine_path,
            "name": None,
            "author": None,
            "options": {},
            "error": None,
        }

    # -- introspection -----------------------------------------------------

    def status(self) -> dict:
        return dict(self._meta)

    def is_started(self) -> bool:
        return self._engine is not None

    def engine_name(self) -> str | None:
        return self._meta.get("name")

    # -- lifecycle ---------------------------------------------------------

    def _close_locked(self) -> None:
        if self._engine is not None:
            try:
                self._engine.quit()
            except Exception:  # pragma: no cover - best effort
                pass
            self._engine = None
        self._active = None

    def start(self, force: bool = False) -> dict:
        """Launch Stockfish and complete the UCI handshake if not already running."""
        with self._lock:
            if self._engine is not None and not force:
                return self.status()

            self._close_locked()
            path = self._path
            if not path:
                raise EngineUnavailable("No engine path configured")
            if not os.path.exists(path):
                raise EngineUnavailable(f"Stockfish not found at {path}")
            if not os.access(path, os.X_OK):
                raise EngineUnavailable(f"Stockfish is not executable: {path}")

            try:
                engine = chess.engine.SimpleEngine.popen_uci(path)
            except Exception as exc:
                self._meta = {
                    "available": False,
                    "path": path,
                    "name": None,
                    "author": None,
                    "options": {},
                    "error": f"Engine failed to start: {exc}",
                }
                raise EngineUnavailable(f"Engine failed to start: {exc}") from exc

            self._engine = engine
            self._meta = {
                "available": True,
                "path": path,
                "name": engine.id.get("name"),
                "author": engine.id.get("author"),
                "options": {name: _option_descriptor(opt) for name, opt in engine.options.items()},
                "error": None,
            }
            try:
                self._apply_options_locked()
            except Exception as exc:  # configuration is best-effort
                logger.warning("Failed to apply engine options: %s", exc)
            return self.status()

    def restart(self) -> dict:
        return self.start(force=True)

    def quit(self) -> None:
        with self._lock:
            self._close_locked()

    def configure(self, options: dict) -> dict:
        """Merge and apply options. Unknown/unsupported options are ignored."""
        with self._lock:
            self._options.update(options or {})
            if self._engine is not None:
                self._apply_options_locked()
            return self.status()

    def _apply_options_locked(self) -> None:
        if self._engine is None:
            return
        supported = self._engine.options
        wanted: dict[str, Any] = {}

        def put(setting_key: str, uci_name: str, value: Any) -> None:
            if uci_name in supported:
                wanted[uci_name] = value

        eng = self._options
        if "threads" in eng:
            put("threads", "Threads", int(eng["threads"]))
        if "hash_mb" in eng:
            put("hash_mb", "Hash", int(eng["hash_mb"]))
        # MultiPV is managed per-search by python-chess (engine.configure rejects it).
        if "show_wdl" in eng:
            put("show_wdl", "UCI_ShowWDL", bool(eng["show_wdl"]))
        if eng.get("syzygy_path"):
            put("syzygy_path", "SyzygyPath", str(eng["syzygy_path"]))
        for key, value in (eng.get("extra_options") or {}).items():
            if key in supported:
                wanted[key] = value

        if wanted:
            self._engine.configure(wanted)

    # -- cancellation ------------------------------------------------------

    def cancel(self) -> bool:
        """Request cancellation of the active search (lock-free)."""
        self._cancel.set()
        active = self._active
        if active is not None:
            try:
                active.stop()
                return True
            except Exception:  # pragma: no cover - engine may have died
                logger.warning("Failed to stop active analysis", exc_info=True)
        return False

    def clear_cancel(self) -> None:
        self._cancel.clear()

    # -- analysis ----------------------------------------------------------

    def analyse(
        self,
        board: chess.Board,
        limit: chess.engine.Limit,
        multipv: int = 1,
        on_info: Callable[[dict, chess.Board], None] | None = None,
    ) -> dict:
        """Run an analysis and return the final normalized result.

        ``on_info`` is invoked with ``(normalized_info, board)`` for each engine
        info line, enabling streaming progress. Cancellation via ``cancel()``
        ends the search and returns the last info seen (if any).
        """
        self.start()
        with self._lock:
            assert self._engine is not None
            self._cancel.clear()
            last: dict | None = None
            try:
                with self._engine.analysis(
                    board, limit, multipv=max(1, multipv), info=chess.engine.INFO_ALL
                ) as analysis:
                    self._active = analysis
                    for info in analysis:
                        normalized = self._normalize(info, board)
                        last = normalized
                        if on_info is not None:
                            on_info(normalized, board)
                        if self._cancel.is_set():
                            analysis.stop()
            except chess.engine.EngineTerminatedError as exc:
                self._meta["available"] = False
                self._meta["error"] = "Engine process terminated unexpectedly"
                self._engine = None
                raise EngineUnavailable("Engine process terminated unexpectedly") from exc
            except chess.engine.EngineError as exc:
                raise EngineUnavailable(f"Engine error: {exc}") from exc
            finally:
                self._active = None

            cancelled = self._cancel.is_set()
            if last is None:
                last = self._normalize(None, board)
            last["cancelled"] = cancelled
            last["engine"] = self._meta.get("name")
            return last

    def analyse_multi(
        self,
        board: chess.Board,
        limit: chess.engine.Limit,
        multipv: int = 1,
        on_info: Callable[[dict, chess.Board], None] | None = None,
    ) -> dict:
        """Like ``analyse`` but returns all MultiPV lines from the final info."""
        self.start()
        with self._lock:
            assert self._engine is not None
            self._cancel.clear()
            lines: dict[int, dict] = {}
            last_depth = 0
            try:
                with self._engine.analysis(
                    board, limit, multipv=max(1, multipv), info=chess.engine.INFO_ALL
                ) as analysis:
                    self._active = analysis
                    for info in analysis:
                        normalized = self._normalize(info, board)
                        rank = normalized.get("multipv") or 1
                        lines[rank] = normalized
                        last_depth = normalized.get("depth") or last_depth
                        if on_info is not None:
                            on_info(normalized, board)
                        if self._cancel.is_set():
                            analysis.stop()
            except chess.engine.EngineTerminatedError as exc:
                self._meta["available"] = False
                self._meta["error"] = "Engine process terminated unexpectedly"
                self._engine = None
                raise EngineUnavailable("Engine process terminated unexpectedly") from exc
            except chess.engine.EngineError as exc:
                raise EngineUnavailable(f"Engine error: {exc}") from exc
            finally:
                self._active = None

            ordered = [lines[k] for k in sorted(lines.keys())]
            return {
                "lines": ordered,
                "depth": last_depth,
                "multipv": multipv,
                "cancelled": self._cancel.is_set(),
                "engine": self._meta.get("name"),
            }

    # -- normalization -----------------------------------------------------

    def _normalize(self, info: dict | None, board: chess.Board) -> dict:
        if not info:
            return {
                "depth": None,
                "seldepth": None,
                "nodes": None,
                "nps": None,
                "time": None,
                "hashfull": None,
                "multipv": 1,
                "score": {"type": None, "cp": None, "mate": None, "pov_cp": None},
                "pv_uci": [],
                "pv_san": [],
                "currmove": None,
                "currmovenumber": None,
                "wdl": None,
                "turn": "white" if board.turn else "black",
            }

        score = info.get("score")
        pv = list(info.get("pv") or [])
        currmove = info.get("currmove")
        return {
            "depth": info.get("depth"),
            "seldepth": info.get("seldepth"),
            "nodes": info.get("nodes"),
            "nps": info.get("nps"),
            "time": info.get("time"),
            "hashfull": info.get("hashfull"),
            "multipv": info.get("multipv", 1),
            "score": _score_to_dict(score, board.turn),
            "pv_uci": [m.uci() for m in pv],
            "pv_san": _pv_to_san(board, pv),
            "currmove": currmove.uci() if currmove else None,
            "currmovenumber": info.get("currmovenumber"),
            "wdl": _wdl_to_list(info.get("wdl"), board.turn),
            "turn": "white" if board.turn else "black",
        }
