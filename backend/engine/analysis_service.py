"""High-level analysis helpers built on the Stockfish manager."""

from __future__ import annotations

from typing import Callable

import chess
import chess.engine

from .stockfish_manager import EngineUnavailable, StockfishManager


def build_limit(
    *,
    depth: int | None = None,
    movetime_ms: int | None = None,
    nodes: int | None = None,
) -> chess.engine.Limit:
    kwargs: dict = {}
    if depth:
        kwargs["depth"] = int(depth)
    if movetime_ms:
        kwargs["time"] = float(movetime_ms) / 1000.0
    if nodes:
        kwargs["nodes"] = int(nodes)
    if not kwargs:
        kwargs["depth"] = 18
    return chess.engine.Limit(**kwargs)


def analyse_fen(
    manager: StockfishManager,
    fen: str,
    *,
    depth: int | None = None,
    movetime_ms: int | None = None,
    nodes: int | None = None,
    multipv: int = 1,
    on_info: Callable | None = None,
) -> dict:
    """Analyse a FEN and return the normalized MultiPV payload."""
    try:
        board = chess.Board(fen) if fen else chess.Board()
    except ValueError as exc:
        raise ValueError(f"Invalid FEN: {exc}") from exc

    limit = build_limit(depth=depth, movetime_ms=movetime_ms, nodes=nodes)
    result = manager.analyse_multi(board, limit, multipv=multipv, on_info=on_info)
    result["fen"] = board.fen()
    result["turn"] = "white" if board.turn else "black"
    result["legal_moves"] = board.legal_moves.count()
    result["is_game_over"] = board.is_game_over()
    result["is_checkmate"] = board.is_checkmate()
    result["is_stalemate"] = board.is_stalemate()
    result["is_check"] = board.is_check()
    return result


def legal_moves(fen: str) -> list[dict]:
    board = chess.Board(fen) if fen else chess.Board()
    out = []
    for move in board.legal_moves:
        out.append(
            {
                "uci": move.uci(),
                "san": board.san(move),
                "from": chess.square_name(move.from_square),
                "to": chess.square_name(move.to_square),
                "promotion": chess.piece_symbol(move.promotion).upper() if move.promotion else None,
            }
        )
    return out


__all__ = ["build_limit", "analyse_fen", "legal_moves", "StockfishManager", "EngineUnavailable"]
