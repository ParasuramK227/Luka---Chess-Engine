"""Full-game review pipeline.

Reconstructs every position once, evaluates each with Stockfish (reusing the
consecutive-position evaluations so a move's "after" evaluation *is* the next
position's "before" evaluation), classifies each played move, and produces
accuracy metrics, a summary, and an annotated game.

Evaluation of position *i* is the engine's best score assuming best play. For a
move played in position *i* by the side to move S, the centipawn loss is
``best_pov(i) - played_pov(i)`` where ``played_pov(i)`` is derived from the
evaluation of position *i+1* (negated, since the opponent is then to move).
"""

from __future__ import annotations

from typing import Any

import chess

from ..engine.analysis_service import build_limit
from ..engine.stockfish_manager import EngineUnavailable, StockfishManager
from . import accuracy, move_classifier

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 300,
    chess.BISHOP: 320,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}


def _terminal_units(board: chess.Board) -> int | None:
    """White-perspective units for a finished position, or None if ongoing."""
    if board.is_checkmate():
        # Side to move is checkmated.
        return -accuracy.MATE_UNIT if board.turn else accuracy.MATE_UNIT
    if board.is_game_over(claim_draw=True) or board.is_stalemate() or board.is_insufficient_material():
        return 0
    return None


def _one_ply_see(board_after: chess.Board, capture: chess.Move, mover_color: chess.Color) -> int:
    """Rough material gain for the opponent's capture, accounting for one recapture."""
    victim = board_after.piece_at(capture.to_square)
    if victim is None:
        return 0
    gain = PIECE_VALUES.get(victim.piece_type, 0)
    recapturers = board_after.attackers(mover_color, capture.to_square)
    if recapturers:
        min_value = min(
            PIECE_VALUES.get(board_after.piece_at(sq).piece_type, 0)
            for sq in recapturers
            if board_after.piece_at(sq) is not None
        )
        gain -= min_value
    return max(0, gain)


def _category_label(category: str) -> str:
    return {
        "missed_win": "Missed win",
        "inaccuracy": "Inaccuracy",
        "mistake": "Mistake",
        "blunder": "Blunder",
        "best": "Best move",
        "excellent": "Excellent",
        "good": "Good",
        "book": "Book",
        "brilliant": "Brilliant",
        "great": "Great move",
        "forced": "Forced move",
    }.get(category, category.title())


def run_review(
    manager: StockfishManager,
    game: dict,
    *,
    depth: int,
    multipv: int = 2,
    thresholds: dict | None = None,
    book=None,
    cache=None,
    job=None,
) -> dict:
    start_fen = game.get("start_fen") or chess.STARTING_FEN
    moves = game.get("moves") or []

    # Reconstruct positions.
    positions: list[chess.Board] = [chess.Board(start_fen)]
    for move in moves:
        nxt = positions[-1].copy()
        try:
            nxt.push_uci(move["uci"])
        except (ValueError, AssertionError) as exc:
            raise ValueError(f"Illegal move at ply {len(positions)}: {move.get('san')} ({exc})") from exc
        positions.append(nxt)

    total = len(positions)
    engine_name = manager.engine_name()
    options_signature = {"depth": depth, "multipv": multipv}

    # --- 1. Evaluate every position once ---------------------------------
    evals: list[dict[str, Any]] = []
    for index, board in enumerate(positions):
        if job is not None and job.is_cancelled():
            return _cancelled_payload(game, evals, index)

        terminal = _terminal_units(board)
        if terminal is not None:
            evals.append(
                {
                    "units": terminal,
                    "second_units": None,
                    "score": _units_to_score(terminal),
                    "best_uci": None,
                    "best_pv_san": [],
                    "best_pv_uci": [],
                    "depth": 0,
                }
            )
            _progress(job, index + 1, total, "Evaluating positions")
            continue

        key = None
        cached = None
        if cache is not None:
            from ..cache.eval_cache import make_key

            key = make_key(board.fen(), depth, multipv, engine_name, options_signature)
            cached = cache.get(key)

        if cached is not None:
            evals.append(cached)
            _progress(job, index + 1, total, "Evaluating positions (cached)")
            continue

        result = manager.analyse_multi(
            board, build_limit(depth=depth), multipv=multipv
        )
        lines = result.get("lines") or []
        best = lines[0] if lines else None
        second = lines[1] if len(lines) > 1 else None
        entry = {
            "units": accuracy.eval_to_white_units(best["score"]) if best else None,
            "second_units": accuracy.eval_to_white_units(second["score"]) if second else None,
            "score": best["score"] if best else None,
            "best_uci": (best["pv_uci"][0] if best and best.get("pv_uci") else None),
            "best_pv_san": (best["pv_san"][:8] if best else []),
            "best_pv_uci": (best["pv_uci"][:8] if best else []),
            "depth": result.get("depth"),
        }
        evals.append(entry)
        if cache is not None and key is not None:
            cache.put(key, entry)
        _progress(job, index + 1, total, "Evaluating positions")

    # --- 2. Classify each played move ------------------------------------
    move_reports: list[dict[str, Any]] = []
    san_prefix: list[str] = []
    for i, move in enumerate(moves):
        board = positions[i]
        white_to_move = board.turn
        mover = "white" if white_to_move else "black"
        legal_count = board.legal_moves.count()
        before_units = evals[i]["units"]
        after_units = evals[i + 1]["units"]

        san_prefix.append(move["san"])
        is_book = bool(book is not None and book.is_book_move(san_prefix))

        metrics = accuracy.evaluate_move(
            before_units, after_units, white_to_move, forced=(legal_count <= 1)
        )

        # Sacrifice detection for the "brilliant" heuristic.
        material_given = 0
        opp_best = evals[i + 1].get("best_uci")
        if opp_best:
            try:
                capture = chess.Move.from_uci(opp_best)
                if positions[i + 1].is_capture(capture):
                    material_given = _one_ply_see(positions[i + 1], capture, board.turn)
            except ValueError:
                pass

        classification = move_classifier.classify_move(
            played_uci=move["uci"],
            best_uci=evals[i].get("best_uci"),
            before_units=before_units,
            after_units=after_units,
            white_to_move=white_to_move,
            metrics=metrics,
            legal_moves=legal_count,
            is_book=is_book,
            second_best_units=evals[i].get("second_units"),
            opponent_best_is_capture=bool(opp_best and material_given > 0),
            material_given=material_given,
            thresholds=thresholds,
        )

        best_san = (evals[i].get("best_pv_san") or [None])[0]
        move_reports.append(
            {
                "ply": i + 1,
                "move_number": board.fullmove_number,
                "mover": mover,
                "san": move["san"],
                "uci": move["uci"],
                "fen_before": move["fen_before"],
                "fen_after": move["fen_after"],
                "category": classification["category"],
                "category_label": _category_label(classification["category"]),
                "reason": classification["reason"],
                "nag": classification["nag"],
                "metrics": metrics,
                "best_move_uci": evals[i].get("best_uci"),
                "best_move_san": best_san,
                "best_pv_san": evals[i].get("best_pv_san") or [],
                "eval_before": evals[i].get("score"),
                "eval_after": evals[i + 1].get("score"),
                "material_given": material_given,
            }
        )

    # --- 3. Accuracy summaries -------------------------------------------
    white_metrics = [m["metrics"] for m in move_reports if m["mover"] == "white"]
    black_metrics = [m["metrics"] for m in move_reports if m["mover"] == "black"]
    white_summary = accuracy.summarize(white_metrics)
    black_summary = accuracy.summarize(black_metrics)

    white_counts = _category_counts(move_reports, "white")
    black_counts = _category_counts(move_reports, "black")

    # --- 4. Critical moments (largest win-probability swings) ------------
    critical = sorted(
        move_reports,
        key=lambda m: (m["metrics"].get("delta_wp") or 0.0),
        reverse=True,
    )[:6]
    critical_moments = [
        {
            "ply": m["ply"],
            "move_number": m["move_number"],
            "mover": m["mover"],
            "san": m["san"],
            "category": m["category"],
            "delta_wp": m["metrics"].get("delta_wp"),
            "cp_loss": m["metrics"].get("cp_loss"),
            "eval_before": m["eval_before"],
            "eval_after": m["eval_after"],
        }
        for m in critical
    ]

    # --- 5. Opening identification ---------------------------------------
    opening = None
    if book is not None:
        opening = book.lookup([m["san"] for m in moves])

    annotations = _build_annotations(move_reports)

    return {
        "ok": True,
        "complete": True,
        "cancelled": False,
        "game": {
            "headers": game.get("headers", {}),
            "result": game.get("result", "*"),
            "start_fen": start_fen,
            "moves": [
                {"ply": m["ply"], "san": m["san"], "uci": m["uci"]} for m in move_reports
            ],
            "content_hash": game.get("content_hash"),
        },
        "analysis": {
            "engine": engine_name,
            "depth": depth,
            "multipv": multipv,
            "positions_analyzed": len(positions),
        },
        "positions": [
            {
                "ply": idx,
                "fen": positions[idx].fen(),
                "eval": evals[idx].get("score"),
                "units": evals[idx].get("units"),
                "best_move_uci": evals[idx].get("best_uci"),
                "best_pv_san": evals[idx].get("best_pv_san") or [],
                "wdl": None,
            }
            for idx in range(len(positions))
        ],
        "moves": move_reports,
        "summary": {
            "white": {**white_summary, "classifications": white_counts},
            "black": {**black_summary, "classifications": black_counts},
            "critical_moments": critical_moments,
            "opening": opening,
            "result": game.get("result", "*"),
            "accuracy_method": {
                "model": "winprob",
                "formula": "accuracy = 100 * (1 - delta_winprob) ** 1.5; game accuracy = mean of per-move accuracy",
                "note": "Luka - Chess Engine estimate, not an official Chess.com or Lichess score.",
                "cp_to_wp": "wp = 1 / (1 + exp(-0.00368208 * cp))",
            },
            "depth": depth,
            "engine": engine_name,
        },
        "annotations": annotations,
    }


def _progress(job, done: int, total: int, label: str) -> None:
    if job is None:
        return
    job.set_progress(100.0 * done / max(1, total), f"{label} {done}/{total}")


def _units_to_score(units: int | None) -> dict | None:
    if units is None:
        return None
    if abs(units) >= accuracy.MATE_UNIT - 200:
        mate = (accuracy.MATE_UNIT - abs(units)) * (1 if units > 0 else -1)
        return {"type": "mate", "cp": None, "mate": mate}
    return {"type": "cp", "cp": units, "mate": None}


def _category_counts(move_reports: list[dict], color: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for m in move_reports:
        if m["mover"] != color:
            continue
        counts[m["category"]] = counts.get(m["category"], 0) + 1
    return counts


def _build_annotations(move_reports: list[dict]) -> list[dict]:
    annotations = []
    for m in move_reports:
        parts = [m["category_label"]]
        loss = m["metrics"].get("cp_loss")
        if m["metrics"].get("applicable") and loss:
            parts.append(f"{loss} cp loss")
        if m["best_move_san"] and m["category"] not in ("best", "book", "forced"):
            parts.append(f"best was {m['best_move_san']}")
        comment = ". ".join(parts) + "."
        annotations.append({"comment": comment, "nag": m.get("nag")})
    return annotations


def _cancelled_payload(game: dict, evals: list[dict], analyzed: int) -> dict:
    return {
        "ok": True,
        "complete": False,
        "cancelled": True,
        "game": {
            "headers": game.get("headers", {}),
            "result": game.get("result", "*"),
            "start_fen": game.get("start_fen"),
            "moves": game.get("moves", []),
            "content_hash": game.get("content_hash"),
        },
        "analysis": {"positions_analyzed": analyzed},
        "positions": [],
        "moves": [],
        "summary": None,
        "annotations": [],
    }
