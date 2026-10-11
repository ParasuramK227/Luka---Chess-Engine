"""Accuracy and centipawn-loss calculations.

These are ChessLab's own documented metrics. They are **not** Chess.com's or
Lichess's algorithms, and we do not claim parity with either service.

Model summary
-------------
Every evaluation is stored from White's perspective as *units*: centipawns for
normal scores, or ``+(10000 - n)`` / ``-(10000 - n)`` for mate-in-*n*. A score
is converted to a win probability with a logistic curve

    wp(x) = 1 / (1 + exp(-k * x)),   k = 0.00368208

For the side that moved in position *i* we compare the win probability of the
engine's best continuation with the win probability after the move actually
played. The drop ``delta`` in ``[0, 1]`` is mapped to a per-move accuracy

    accuracy = 100 * (1 - delta) ** 1.5

Game accuracy is the arithmetic mean of the eligible per-move accuracies.
Centipawn loss is ``max(0, best_units - played_units)`` for the mover.
Forced moves (a single legal move) and terminal positions are excluded from the
loss statistics and treated as fully accurate.
"""

from __future__ import annotations

import math
from typing import Any

MATE_UNIT = 10000
DEFAULT_K = 0.00368208
DEFAULT_EXPONENT = 1.5


def eval_to_white_units(evaluation: dict | None) -> int | None:
    """Convert a White-perspective {type,cp,mate} evaluation into signed units."""
    if not evaluation or evaluation.get("type") is None:
        return None
    if evaluation.get("type") == "mate":
        mate = evaluation.get("mate")
        if mate is None:
            return None
        sign = 1 if mate > 0 else -1
        return sign * (MATE_UNIT - abs(int(mate)))
    cp = evaluation.get("cp")
    if cp is None:
        return None
    return int(cp)


def white_units_to_pov(units_white: int, white_to_move: bool) -> int:
    """Return units relative to the player to move."""
    return units_white if white_to_move else -units_white


def logistic_wp(cp: float, k: float = DEFAULT_K) -> float:
    """Win probability from the perspective of the player whose cp this is."""
    try:
        return 1.0 / (1.0 + math.exp(-k * cp))
    except OverflowError:
        return 0.0 if cp < 0 else 1.0


def pov_wp(units_white: int, white_to_move: bool, k: float = DEFAULT_K) -> float:
    return logistic_wp(white_units_to_pov(units_white, white_to_move), k)


def move_accuracy(delta_wp: float, exponent: float = DEFAULT_EXPONENT) -> float:
    delta = max(0.0, min(1.0, delta_wp))
    return 100.0 * (max(0.0, 1.0 - delta) ** exponent)


def evaluate_move(
    before_units: int | None,
    after_units: int | None,
    white_to_move: bool,
    *,
    forced: bool = False,
    k: float = DEFAULT_K,
    exponent: float = DEFAULT_EXPONENT,
) -> dict[str, Any]:
    """Compute loss metrics for one played move.

    ``before_units`` is the engine's best evaluation at the position before the
    move; ``after_units`` is the evaluation of the position after the move.
    Both are White-perspective units.
    """
    if forced or before_units is None or after_units is None:
        return {
            "cp_loss": 0,
            "delta_wp": 0.0,
            "accuracy": 100.0,
            "best_wp": None,
            "played_wp": None,
            "forced": forced,
            "applicable": False,
        }

    best_pov = white_units_to_pov(before_units, white_to_move)
    played_pov = white_units_to_pov(after_units, white_to_move)

    cp_loss = max(0, best_pov - played_pov)

    best_wp = logistic_wp(best_pov, k)
    played_wp = logistic_wp(played_pov, k)
    delta_wp = max(0.0, best_wp - played_wp)

    return {
        "cp_loss": cp_loss,
        "delta_wp": round(delta_wp, 6),
        "accuracy": round(move_accuracy(delta_wp, exponent), 3),
        "best_wp": round(best_wp, 6),
        "played_wp": round(played_wp, 6),
        "forced": False,
        "applicable": True,
    }


def summarize(move_metrics: list[dict]) -> dict:
    """Aggregate per-move metrics for one player into game-level statistics."""
    applicable = [m for m in move_metrics if m.get("applicable")]
    cp_losses = [m["cp_loss"] for m in applicable]
    accuracies = [m["accuracy"] for m in applicable]

    return {
        "moves_analyzed": len(move_metrics),
        "moves_scored": len(applicable),
        "average_cp_loss": round(sum(cp_losses) / len(cp_losses), 2) if cp_losses else None,
        "accuracy": round(sum(accuracies) / len(accuracies), 2) if accuracies else None,
        "median_cp_loss": round(sorted(cp_losses)[len(cp_losses) // 2], 2) if cp_losses else None,
    }
