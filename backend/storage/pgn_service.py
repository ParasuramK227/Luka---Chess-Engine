"""PGN and FEN handling built on ``python-chess``.

Parsing is defensive: malformed games are reported, not fatal. Nothing here
mutates source files.
"""

from __future__ import annotations

import io
from typing import Any

import chess
import chess.pgn

from .file_manager import content_hash

MAX_VARIATION_DEPTH = 6
MAX_VARIATIONS_PER_NODE = 6


class PgnError(ValueError):
    pass


# ---------------------------------------------------------------------------
# FEN
# ---------------------------------------------------------------------------

def validate_fen(fen: str) -> dict:
    """Validate a FEN string and return a normalized representation."""
    if not isinstance(fen, str) or not fen.strip():
        return {"valid": False, "error": "FEN is empty", "fen": None}
    fen = fen.strip()
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        return {"valid": False, "error": f"Invalid FEN: {exc}", "fen": None}

    status = board.status()
    _status_checks = [
        ("STATUS_NO_WHITE_KING", "no white king"),
        ("STATUS_NO_BLACK_KING", "no black king"),
        ("STATUS_TOO_MANY_KINGS", "too many kings"),
        ("STATUS_OPPOSITE_CHECK", "opponent is in check"),
        ("STATUS_TOO_MANY_CHECKERS", "too many checkers"),
        ("STATUS_IMPOSSIBLE_CHECK", "impossible check"),
        ("STATUS_PAWNS_ON_BACKRANK", "pawns on back rank"),
        ("STATUS_TOO_MANY_PAWNS", "too many pawns"),
    ]
    errors = [
        message
        for attr, message in _status_checks
        if hasattr(chess, attr) and status & getattr(chess, attr)
    ]

    return {
        "valid": not errors,
        "error": "; ".join(errors) if errors else None,
        "fen": board.fen(),
        "turn": "white" if board.turn else "black",
        "is_check": board.is_check(),
        "is_checkmate": board.is_checkmate(),
        "is_stalemate": board.is_stalemate(),
        "is_game_over": board.is_game_over(),
        "legal_move_count": board.legal_moves.count(),
    }


# ---------------------------------------------------------------------------
# PGN parsing
# ---------------------------------------------------------------------------

def _move_entry(board: chess.Board, node: chess.pgn.GameNode) -> dict:
    move = node.move
    san = board.san(move)
    fen_before = board.fen()
    board.push(move)
    clock = None
    if node.clock() is not None:
        clock = node.clock()
    return {
        "san": san,
        "uci": move.uci(),
        "fen_before": fen_before,
        "fen_after": board.fen(),
        "comment": node.comment or "",
        "clock": clock,
        "nags": sorted(node.nags),
        "variations": [],
    }


def _serialize_line(node: chess.pgn.GameNode, board: chess.Board, depth: int) -> list[dict]:
    """Serialize the principal line from ``node`` onward, recursing into variations."""
    out: list[dict] = []
    current = node
    while current.variations:
        nxt = current.variations[0]
        entry = _move_entry(board, nxt)  # pushes move onto `board`
        if depth < MAX_VARIATION_DEPTH:
            for alt in current.variations[1 : MAX_VARIATIONS_PER_NODE + 1]:
                alt_board = board.copy()
                alt_board.pop()  # position before the main move
                entry["variations"].append({"moves": _serialize_line(alt, alt_board, depth + 1)})
        out.append(entry)
        current = nxt
    return out


def serialize_game(game: chess.pgn.Game, index: int = 0) -> dict:
    headers = {str(k): str(v) for k, v in game.headers.items()}
    start_fen = game.headers.get("FEN") or chess.STARTING_FEN
    try:
        board = game.board()
    except ValueError:
        board = chess.Board()

    moves = _serialize_line(game, board, 0)
    uci_seq = " ".join(m["uci"] for m in moves)
    digest = content_hash(f"{start_fen}|{uci_seq}")

    return {
        "index": index,
        "headers": headers,
        "result": headers.get("Result", "*"),
        "start_fen": start_fen,
        "moves": moves,
        "content_hash": digest,
        "ply_count": len(moves),
        "has_variations": any(m["variations"] for m in moves),
    }


def parse_pgn(text: str, max_games: int = 2000) -> dict:
    """Parse PGN text into a list of serialized games plus any parse errors."""
    if text is None:
        raise PgnError("No PGN content supplied")
    if len(text.encode("utf-8", errors="ignore")) > 25 * 1024 * 1024:
        raise PgnError("PGN exceeds the 25 MiB import limit")

    games: list[dict] = []
    errors: list[dict] = []
    stream = io.StringIO(text)

    while len(games) < max_games:
        try:
            game = chess.pgn.read_game(stream)
        except (ValueError, UnicodeDecodeError) as exc:
            errors.append({"index": len(games), "error": f"Malformed PGN: {exc}"})
            break
        if game is None:
            break
        try:
            games.append(serialize_game(game, index=len(games)))
        except Exception as exc:  # pragma: no cover - defensive
            errors.append({"index": len(games), "error": f"Failed to read game: {exc}"})

    if not games and not errors:
        errors.append({"index": 0, "error": "No games found in the PGN"})

    return {"games": games, "errors": errors, "count": len(games)}


# ---------------------------------------------------------------------------
# PGN export
# ---------------------------------------------------------------------------

def _escape_header(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def games_to_pgn(games: list[dict]) -> str:
    """Export serialized games back to standard PGN (headers + mainline)."""
    chunks: list[str] = []
    for game in games:
        lines = []
        headers = game.get("headers") or {}
        for key, value in headers.items():
            lines.append(f'[{key} "{_escape_header(value)}"]')
        if not headers:
            lines.append('[Result "*"]')
        body = _moves_to_text(game)
        lines.append("")
        lines.append(body)
        chunks.append("\n".join(lines))
    return "\n\n".join(chunks).rstrip() + "\n"


def _moves_to_text(game: dict) -> str:
    moves = game.get("moves") or []
    start_fen = game.get("start_fen")
    board = chess.Board(start_fen) if start_fen else chess.Board()
    parts: list[str] = []
    for i, move in enumerate(moves):
        if board.turn:
            parts.append(f"{board.fullmove_number}.")
        san = move.get("san")
        if not san:
            break
        parts.append(san)
        if move.get("comment"):
            parts.append("{" + str(move["comment"]).replace("}", "]") + "}")
        try:
            board.push_uci(move["uci"])
        except (ValueError, AssertionError, KeyError):
            break
    result = game.get("result", "*")
    parts.append(result)
    return " ".join(parts)


def game_to_annotated_pgn(game: dict, annotations: list[dict] | None = None) -> str:
    """Export a game with per-move comments and NAGs.

    ``annotations`` is a list aligned with plies, each optionally containing
    ``comment`` and ``nag`` keys.
    """
    annotations = annotations or []
    headers = dict(game.get("headers") or {})
    headers.setdefault("Annotator", "ChessLab")
    headers.setdefault("Result", game.get("result", "*"))

    lines = [f'[{key} "{_escape_header(value)}"]' for key, value in headers.items()]
    lines.append("")

    moves = game.get("moves") or []
    start_fen = game.get("start_fen")
    board = chess.Board(start_fen) if start_fen else chess.Board()
    parts: list[str] = []
    for i, move in enumerate(moves):
        ann = annotations[i] if i < len(annotations) else {}
        if board.turn:
            parts.append(f"{board.fullmove_number}.")
        san = move.get("san")
        if not san:
            break
        parts.append(san)
        nag = ann.get("nag")
        if nag:
            parts.append(f"${nag}")
        comment = ann.get("comment") or move.get("comment")
        if comment:
            parts.append("{" + str(comment).replace("}", "]") + "}")
        try:
            board.push_uci(move["uci"])
        except (ValueError, AssertionError, KeyError):
            break
    parts.append(game.get("result", "*"))
    lines.append(" ".join(parts))
    return "\n".join(lines).rstrip() + "\n"
