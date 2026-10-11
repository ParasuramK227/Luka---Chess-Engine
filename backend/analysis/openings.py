"""Opening *name* recognition from a bundled dataset.

This resolves human-readable opening names and ECO codes from move sequences.
It provides **no** win rates, popularity, or game counts — those require a
statistical game database, which is an optional user-supplied dataset (see the
opening explorer). We never fabricate statistics.

Users may override/extend the dataset by placing ``openings.json`` in the data
directory with the same schema: a list of ``{"eco", "name", "moves"}`` objects,
where ``moves`` is a list of SAN strings.
"""

from __future__ import annotations

import json
from pathlib import Path

# A modest, curated set of common openings (names + ECO only).
BUILTIN_OPENINGS: list[dict] = [
    {"eco": "C50", "name": "Italian Game", "moves": ["e4", "e5", "Nf3", "Nc6", "Bc4"]},
    {"eco": "C50", "name": "Italian Game: Giuoco Piano", "moves": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]},
    {"eco": "C55", "name": "Italian Game: Two Knights Defense", "moves": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]},
    {"eco": "C60", "name": "Ruy Lopez", "moves": ["e4", "e5", "Nf3", "Nc6", "Bb5"]},
    {"eco": "C65", "name": "Ruy Lopez: Berlin Defense", "moves": ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"]},
    {"eco": "C68", "name": "Ruy Lopez: Exchange Variation", "moves": ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6"]},
    {"eco": "C45", "name": "Scotch Game", "moves": ["e4", "e5", "Nf3", "Nc6", "d4"]},
    {"eco": "C42", "name": "Petrov Defense", "moves": ["e4", "e5", "Nf3", "Nf6"]},
    {"eco": "C41", "name": "Philidor Defense", "moves": ["e4", "e5", "Nf3", "d6"]},
    {"eco": "C41", "name": "Philidor Defense: Exchange Variation", "moves": ["e4", "e5", "Nf3", "d6", "d4", "exd4", "Nxd4"]},
    {"eco": "C30", "name": "King's Gambit", "moves": ["e4", "e5", "f4"]},
    {"eco": "B20", "name": "Sicilian Defense", "moves": ["e4", "c5"]},
    {"eco": "B50", "name": "Sicilian Defense: Classical", "moves": ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "Nc6"]},
    {"eco": "B70", "name": "Sicilian Defense: Dragon", "moves": ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"]},
    {"eco": "B90", "name": "Sicilian Defense: Najdorf", "moves": ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]},
    {"eco": "B33", "name": "Sicilian Defense: Sveshnikov", "moves": ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5"]},
    {"eco": "C00", "name": "French Defense", "moves": ["e4", "e6"]},
    {"eco": "C02", "name": "French Defense: Advance Variation", "moves": ["e4", "e6", "d4", "d5", "e5"]},
    {"eco": "B10", "name": "Caro-Kann Defense", "moves": ["e4", "c6"]},
    {"eco": "B12", "name": "Caro-Kann Defense: Advance", "moves": ["e4", "c6", "d4", "d5", "e5"]},
    {"eco": "B01", "name": "Scandinavian Defense", "moves": ["e4", "d5"]},
    {"eco": "B07", "name": "Pirc Defense", "moves": ["e4", "d6", "d4", "Nf6", "Nc3"]},
    {"eco": "A00", "name": "English Opening", "moves": ["c4"]},
    {"eco": "A20", "name": "English Opening: Reversed Sicilian", "moves": ["c4", "e5"]},
    {"eco": "A30", "name": "English Opening: Symmetrical", "moves": ["c4", "c5"]},
    {"eco": "D06", "name": "Queen's Gambit", "moves": ["d4", "d5", "c4"]},
    {"eco": "D30", "name": "Queen's Gambit Declined", "moves": ["d4", "d5", "c4", "e6"]},
    {"eco": "D20", "name": "Queen's Gambit Accepted", "moves": ["d4", "d5", "c4", "dxc4"]},
    {"eco": "D10", "name": "Slav Defense", "moves": ["d4", "d5", "c4", "c6"]},
    {"eco": "E60", "name": "King's Indian Defense", "moves": ["d4", "Nf6", "c4", "g6"]},
    {"eco": "E20", "name": "Nimzo-Indian Defense", "moves": ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"]},
    {"eco": "D70", "name": "Grunfeld Defense", "moves": ["d4", "Nf6", "c4", "g6", "Nc3", "d5"]},
    {"eco": "A45", "name": "Trompowsky Attack", "moves": ["d4", "Nf6", "Bg5"]},
    {"eco": "A80", "name": "Dutch Defense", "moves": ["d4", "f5"]},
    {"eco": "D02", "name": "London System", "moves": ["d4", "d5", "Nf3", "Nf6", "Bf4"]},
    {"eco": "D00", "name": "Queen's Pawn Game", "moves": ["d4", "d5"]},
    {"eco": "A40", "name": "Modern Defense", "moves": ["e4", "g6"]},
    {"eco": "B00", "name": "Nimzowitsch Defense", "moves": ["e4", "Nc6"]},
]


class OpeningBook:
    """Resolve opening names from move sequences (longest-prefix match)."""

    def __init__(self, extra_path: Path | None = None):
        self._entries = list(BUILTIN_OPENINGS)
        if extra_path is not None and Path(extra_path).is_file():
            try:
                raw = json.loads(Path(extra_path).read_text(encoding="utf-8"))
                if isinstance(raw, list):
                    valid = [
                        e for e in raw
                        if isinstance(e, dict) and isinstance(e.get("moves"), list) and e.get("name")
                    ]
                    self._entries.extend(valid)
            except (json.JSONDecodeError, OSError):
                pass
        self._source = "bundled" if extra_path is None else "bundled+custom"

    @property
    def source(self) -> str:
        return self._source

    def lookup(self, san_moves: list[str]) -> dict | None:
        """Return the best matching opening for a full move list (SAN), if any."""
        best: dict | None = None
        best_len = -1
        for entry in self._entries:
            seq = entry["moves"]
            n = len(seq)
            if n > len(san_moves):
                continue
            if n > best_len and san_moves[:n] == seq:
                best = entry
                best_len = n
        if best is None:
            return None
        return {"eco": best.get("eco"), "name": best["name"], "matched_moves": best_len}

    def entries(self, query: str | None = None) -> list[dict]:
        """All book entries, optionally filtered by a case-insensitive query."""
        q = (query or "").strip().lower()
        items = self._entries
        if q:
            items = [e for e in items if q in e["name"].lower() or q in str(e.get("eco", "")).lower()]
        return [
            {"eco": e.get("eco"), "name": e["name"], "moves": e["moves"]}
            for e in items
        ]

    def is_book_move(self, san_moves_including_move: list[str]) -> bool:
        """True if the moves-so-far still lie on a known opening line."""
        moves = san_moves_including_move
        for entry in self._entries:
            seq = entry["moves"]
            n = len(seq)
            if len(moves) <= n and moves == seq[: len(moves)]:
                return True
        return False
