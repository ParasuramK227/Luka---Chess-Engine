"""Single-move live analysis.

Runs the same documented evaluation + classification pipeline as the full game
review (``game_review.run_review``) but for a single just-played move: evaluate
the position before the move and the position after it, classify the played
move with the identical thresholds, and return the usual MultiPV analysis of
the current position so the UI can render eval, engine lines, and a move-quality
badge without waiting for a full game review.
"""

from __future__ import annotations

from typing import Any

import chess

from ..engine.analysis_service import analyse_fen
from . import accuracy, move_classifier
from .game_review import _category_label, _one_ply_see


def analyse_move(
    manager,
    *,
    fen: str,
    prev_fen: str | None = None,
    sans: list[str] | None = None,
    depth: int = 18,
    multipv: int = 2,
    thresholds: dict | None = None,
    book=None,
    job=None,
) -> dict[str, Any]:
    """Analyse ``fen`` and, when ``prev_fen`` is given, classify the last move.

    Returns the standard analysis payload (``lines``, eval, game-over flags)
    plus a ``move`` entry carrying the classification of the move that led to
    the position, mirroring a single ``review.moves[]`` element.
    """
    _progress(job, 5, "Starting per-move analysis")
    cur = analyse_fen(manager, fen, depth=depth, multipv=multipv)
    cur_lines = cur.get("lines") or []
    best_cur = cur_lines[0] if cur_lines else None
    after_units = accuracy.eval_to_white_units(best_cur["score"]) if best_cur else None

    move_info: dict[str, Any] | None = None
    if prev_fen:
        move_info = _classify_last_move(
            manager,
            fen=fen,
            prev_fen=prev_fen,
            sans=sans or [],
            depth=depth,
            multipv=multipv,
            thresholds=thresholds,
            book=book,
            after_units=after_units,
            best_uci_after=(
                best_cur["pv_uci"][0] if best_cur and best_cur.get("pv_uci") else None
            ),
            eval_after=(best_cur["score"] if best_cur else None),
            job=job,
        )

    _progress(job, 100, "Per-move analysis complete")
    return {
        "fen": cur["fen"],
        "turn": cur["turn"],
        "legal_moves": cur["legal_moves"],
        "is_game_over": cur["is_game_over"],
        "is_checkmate": cur["is_checkmate"],
        "is_stalemate": cur["is_stalemate"],
        "is_check": cur["is_check"],
        "lines": cur_lines,
        "depth": cur.get("depth"),
        "multipv": multipv,
        "engine": cur.get("engine"),
        "move": move_info,
    }


def _classify_last_move(
    manager,
    *,
    fen: str,
    prev_fen: str,
    sans: list[str],
    depth: int,
    multipv: int,
    thresholds: dict | None,
    book,
    after_units: int | None,
    best_uci_after: str | None,
    eval_after: dict | None,
    job=None,
) -> dict[str, Any] | None:
    before = chess.Board(prev_fen)
    after = chess.Board(fen)
    played_uci = _find_played_move(before, after)
    san = before.san(chess.Move.from_uci(played_uci))

    _progress(job, 50, f"Evaluating position before {san}")
    prev = analyse_fen(manager, prev_fen, depth=depth, multipv=multipv)
    prev_lines = prev.get("lines") or []
    best = prev_lines[0] if prev_lines else None
    if best is None:
        return None
    second = prev_lines[1] if len(prev_lines) > 1 else None

    before_units = accuracy.eval_to_white_units(best["score"])
    second_best_units = accuracy.eval_to_white_units(second["score"]) if second else None
    white_to_move = before.turn
    mover = "white" if white_to_move else "black"
    legal_count = before.legal_moves.count()

    san_prefix = list(sans) if sans else [san]
    is_book = False
    if book is not None:
        try:
            is_book = bool(book.is_book_move(san_prefix))
        except (TypeError, ValueError):
            is_book = False

    metrics = accuracy.evaluate_move(
        before_units, after_units, white_to_move, forced=(legal_count <= 1)
    )

    # Sacrifice detection mirrors the review pipeline (best reply of the side to
    # move in the after position captures material that is not fully recaptured).
    material_given = 0
    if best_uci_after:
        try:
            capture = chess.Move.from_uci(best_uci_after)
            if after.is_capture(capture):
                material_given = _one_ply_see(after, capture, white_to_move)
        except ValueError:
            pass

    classification = move_classifier.classify_move(
        played_uci=played_uci,
        best_uci=(best.get("pv_uci") or [None])[0],
        before_units=before_units,
        after_units=after_units,
        white_to_move=white_to_move,
        metrics=metrics,
        legal_moves=legal_count,
        is_book=is_book,
        second_best_units=second_best_units,
        opponent_best_is_capture=bool(best_uci_after and material_given > 0),
        material_given=material_given,
        thresholds=thresholds,
    )

    _progress(job, 90, "Classification ready")
    return {
        "uci": played_uci,
        "san": san,
        "mover": mover,
        "category": classification["category"],
        "category_label": _category_label(classification["category"]),
        "reason": classification["reason"],
        "nag": classification["nag"],
        "metrics": metrics,
        "best_move_uci": (best.get("pv_uci") or [None])[0],
        "best_move_san": (best.get("pv_san") or [None])[0],
        "best_pv_san": best.get("pv_san") or [],
        "eval_before": best["score"],
        "eval_after": eval_after,
        "material_given": material_given,
    }


def _find_played_move(before: chess.Board, after: chess.Board) -> str:
    """Return the UCI of the single legal move connecting ``before`` to ``after``.

    Raises ``ValueError`` when the two FENs are not consecutive plies.
    """
    after_fen = after.fen()
    for uci in before.legal_moves:
        probe = before.copy()
        probe.push(uci)
        if probe.fen() == after_fen:
            return uci.uci()
    raise ValueError("FENs must be consecutive plies of the same game")


def _progress(job, value: float, message: str) -> None:
    if job is not None:
        job.set_progress(value, message)