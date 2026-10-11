"""ChessLab configuration: validated, file-backed settings.

Settings live in ``<project>/data/settings.json`` by default. The data directory
itself is configurable through the ``CHESSLAB_DATA_DIR`` environment variable or
by editing the settings file. Nothing here performs network access.
"""

from __future__ import annotations

import copy
import json
import os
import threading
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _default_data_dir() -> Path:
    env = os.environ.get("CHESSLAB_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (PROJECT_ROOT / "data").resolve()


DEFAULT_ENGINE_PATH = os.environ.get("CHESSLAB_ENGINE_PATH", "/usr/bin/stockfish")

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS: dict[str, Any] = {
    "data_dir": str(_default_data_dir()),
    "engine": {
        "path": DEFAULT_ENGINE_PATH,
        # Conservative defaults for the host (see README). All adjustable.
        "threads": 2,
        "hash_mb": 64,
        "multipv": 1,
        "depth": 18,
        "movetime_ms": 0,
        "nodes": 0,
        "show_wdl": True,
        "syzygy_path": "",
        "extra_options": {},
    },
    "review": {
        "depth": 14,
        "max_positions": 600,
        "resume": True,
    },
    "classification": {
        "excellent_loss": 20,
        "good_loss": 50,
        "inaccuracy_loss": 100,
        "mistake_loss": 250,
        "blunder_loss": 500,
    },
    "accuracy": {
        # "winprob" (win-probability based) is the default documented model.
        "model": "winprob",
        # Centipawn values mapped to win probability via a logistic curve.
        "cp_scale": 0.00368208,
        "full_accuracy_bonus": 1.0,
    },
    "board": {
        "flip": False,
        "theme": "green",
        "show_coordinates": True,
        "show_legal_moves": True,
        "sound": False,
        "arrow_best_move": True,
    },
}

# Bounds used when validating user-supplied engine options.
ENGINE_BOUNDS = {
    "threads": (1, 1024),
    "hash_mb": (1, 33554432),
    "multipv": (1, 256),
    "depth": (1, 60),
    "movetime_ms": (0, 3_600_000),
    "nodes": (0, 1_000_000_000_000),
}

MAX_SETTINGS_BYTES = 1_000_000


class ConfigError(ValueError):
    """Raised when settings are invalid."""


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _clamp_int(name: str, value: Any, default: int) -> int:
    lo, hi = ENGINE_BOUNDS[name]
    try:
        ivalue = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, ivalue))


def validate_settings(raw: dict) -> dict:
    """Return a fully-populated, validated settings dict."""
    if not isinstance(raw, dict):
        raise ConfigError("Settings must be a JSON object")

    settings = _deep_merge(DEFAULT_SETTINGS, raw)

    data_dir = settings.get("data_dir")
    if not data_dir or not isinstance(data_dir, str):
        raise ConfigError("data_dir must be a non-empty string")
    settings["data_dir"] = str(Path(data_dir).expanduser())

    engine = settings["engine"]
    if not isinstance(engine.get("path"), str) or not engine["path"].strip():
        raise ConfigError("engine.path must be a non-empty string")
    engine["threads"] = _clamp_int("threads", engine.get("threads"), 2)
    engine["hash_mb"] = _clamp_int("hash_mb", engine.get("hash_mb"), 64)
    engine["multipv"] = _clamp_int("multipv", engine.get("multipv"), 1)
    engine["depth"] = _clamp_int("depth", engine.get("depth"), 18)
    engine["movetime_ms"] = _clamp_int("movetime_ms", engine.get("movetime_ms"), 0)
    engine["nodes"] = _clamp_int("nodes", engine.get("nodes"), 0)
    engine["show_wdl"] = bool(engine.get("show_wdl", True))
    if not isinstance(engine.get("extra_options"), dict):
        engine["extra_options"] = {}

    review = settings["review"]
    review["depth"] = _clamp_int("depth", review.get("depth"), 14)
    review["max_positions"] = max(2, int(review.get("max_positions", 600)))
    review["resume"] = bool(review.get("resume", True))

    cls = settings["classification"]
    for key in ("excellent_loss", "good_loss", "inaccuracy_loss", "mistake_loss", "blunder_loss"):
        try:
            cls[key] = max(0, int(cls.get(key, DEFAULT_SETTINGS["classification"][key])))
        except (TypeError, ValueError):
            cls[key] = DEFAULT_SETTINGS["classification"][key]

    return settings


class Settings:
    """Thread-safe, file-backed settings store."""

    def __init__(self, data_dir: Path | None = None):
        self._lock = threading.RLock()
        self._data_dir = Path(data_dir) if data_dir else _default_data_dir()
        self._path = self._data_dir / "settings.json"
        self._settings: dict[str, Any] = copy.deepcopy(DEFAULT_SETTINGS)
        self._load()

    # -- lifecycle ---------------------------------------------------------

    def _load(self) -> None:
        try:
            if self._path.exists():
                if self._path.stat().st_size > MAX_SETTINGS_BYTES:
                    raise ConfigError("settings.json is unexpectedly large")
                with self._path.open("r", encoding="utf-8") as fh:
                    raw = json.load(fh)
                self._settings = validate_settings(raw)
        except (json.JSONDecodeError, OSError, ConfigError):
            # Corrupt settings fall back to defaults rather than crashing.
            self._settings = copy.deepcopy(DEFAULT_SETTINGS)

    def save(self) -> None:
        with self._lock:
            self._data_dir.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".json.tmp")
            with tmp.open("w", encoding="utf-8") as fh:
                json.dump(self._settings, fh, indent=2, sort_keys=True)
            os.replace(tmp, self._path)

    # -- access ------------------------------------------------------------

    @property
    def data_dir(self) -> Path:
        with self._lock:
            return Path(self._settings["data_dir"])

    def as_dict(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._settings)

    def get(self, *keys: str, default: Any = None) -> Any:
        with self._lock:
            node: Any = self._settings
            for key in keys:
                if not isinstance(node, dict) or key not in node:
                    return default
                node = node[key]
            return node

    def update(self, patch: dict) -> dict:
        """Merge a validated patch and persist it."""
        with self._lock:
            merged = _deep_merge(self._settings, patch or {})
            self._settings = validate_settings(merged)
            self.save()
            return copy.deepcopy(self._settings)


# Module-level default store (created lazily so importing is side-effect free).
_default: Settings | None = None


def get_settings() -> Settings:
    global _default
    if _default is None:
        _default = Settings()
    return _default
