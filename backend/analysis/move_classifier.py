"""Move classification with documented, configurable rules.

Objective engine findings (loss, best move, mate, WDL) are kept separate from
the heuristic labels. Every classification carries a ``reason`` so the UI can
explain exactly why a move received it.
"""

from __future__ import annotations

from typing import Any

from . import accuracy

# Default thresholds (centipawns). Overridable from settings.
DEFAULT_THRESHOLDS = {
    "excellent_loss": 20,
    "good_loss": 50,
    "inaccuracy_loss": 100,
    "mistake_loss": 250,
    "blunder_loss": 500,
    "great_gap": 150,       # minimum gap to second-best for "great"
    "missed_win_cp": 300,   # advantage considered clearly winning
    "missed_win_after": 120,
    "sacrifice_min": 200,   # material given up, in centipawns
}

CATEGORIES = [
    "book",
    "forced",
    "brilliant",
    "great",
    "best",
    "excellent",
    "good",
    "inaccuracy",
    "mistake",
    "blunder",
    "missed_win",
]

# NAG codes for annotated PGN export.
NAGS = {
    "brilliant": 3,   # !!
    "great": 1,       # !
    "best": 1,
    "excellent": 1,
    "good": None,
    "inaccuracy": 6,  # ?!
    "mistake": 2,     # ?
    "blunder": 4,     # ??
    "missed_win": 4,
    "book": None,
    "forced": None,
}


def classify_move(
    *,
    played_uci: str,
    best_uci: str | None,
    before_units: int | None,
    after_units: int | None,
    white_to_move: bool,
    metrics: dict,
    legal_moves: int,
    is_book: bool = False,
    second_best_units: int | None = None,
    opponent_best_is_capture: bool = False,
    material_given: int = 0,
    thresholds: dict | None = None,
) -> dict[str, Any]:
    """Return ``{"category", "reason", "nag"}`` for one played move."""
    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}

    reason: dict[str, Any] = {
        "best_move": best_uci,
        "played_move": played_uci,
        "loss_cp": metrics.get("cp_loss"),
        "delta_wp": metrics.get("delta_wp"),
        "accuracy": metrics.get("accuracy"),
        "legal_moves": legal_moves,
    }

    if before_units is not None:
        reason["eval_before_cp"] = _display_cp(before_units, white_to_move)
    if after_units is not None:
        reason["eval_after_cp"] = _display_cp(after_units, white_to_move)

    # --- forced ---------------------------------------------------------
    if legal_moves <= 1:
        reason["rule"] = "Only one legal move in the position."
        return _result("forced", reason)

    # --- book -----------------------------------------------------------
    if is_book:
        reason["rule"] = "Move is part of the bundled opening dataset."
        return _result("book", reason)

    best_pov = _pov(before_units, white_to_move)
    played_pov = _pov(after_units, white_to_move)
    is_best = bool(best_uci) and played_uci == best_uci

    # --- missed win -----------------------------------------------------
    if before_units is not None and after_units is not None and not is_best:
        winning_before = (
            _is_mate_for(before_units, white_to_move)
            or (best_pov is not None and best_pov >= t["missed_win_cp"])
        )
        winning_after = (
            _is_mate_for(after_units, white_to_move)
            or (played_pov is not None and played_pov >= t["missed_win_cp"])
        )
        if winning_before and not winning_after and played_pov is not None and played_pov < t["missed_win_after"]:
            reason["rule"] = (
                "The move gives up a clearly winning advantage "
                f"(best {reason.get('eval_before_cp')} cp -> {reason.get('eval_after_cp')} cp)."
            )
            return _result("missed_win", reason)

    # --- brilliant (heuristic, conservative) ----------------------------
    if (
        is_best
        and metrics.get("applicable")
        and material_given >= t["sacrifice_min"]
        and played_pov is not None
        and played_pov >= 0
    ):
        reason["rule"] = (
            "Best move that sacrifices material ({0} cp) yet keeps the position sound. "
            "Heuristic sacrifice detection.".format(material_given)
        )
        return _result("brilliant", reason)

    # --- great (only move) ----------------------------------------------
    if is_best and second_best_units is not None and before_units is not None:
        best_mover = _pov(before_units, white_to_move)
        second_mover = _pov(second_best_units, white_to_move)
        if best_mover is not None and second_mover is not None and best_mover - second_mover >= t["great_gap"]:
            reason["rule"] = (
                "Best move and effectively the only move that holds the advantage "
                f"(next-best is {best_mover - second_mover} cp worse)."
            )
            return _result("great", reason)

    # --- best -----------------------------------------------------------
    if is_best:
        reason["rule"] = "Matches the engine's top choice."
        return _result("best", reason)

    # --- loss-based categories -----------------------------------------
    loss = metrics.get("cp_loss")
    if loss is None:
        reason["rule"] = "No comparable evaluation available."
        return _result("good", reason)

    if loss <= t["excellent_loss"]:
        cat = "excellent"
    elif loss <= t["good_loss"]:
        cat = "good"
    elif loss <= t["inaccuracy_loss"]:
        cat = "inaccuracy"
    elif loss <= t["mistake_loss"]:
        cat = "mistake"
    else:
        cat = "blunder"
    reason["rule"] = (
        f"Centipawn loss {loss} falls in the '{cat}' band "
        f"(thresholds: excellent<={t['excellent_loss']}, good<={t['good_loss']}, "
        f"inaccuracy<={t['inaccuracy_loss']}, mistake<={t['mistake_loss']})."
    )
    return _result(cat, reason)


def _result(category: str, reason: dict) -> dict:
    reason["category"] = category
    return {"category": category, "reason": reason, "nag": NAGS.get(category)}


def _pov(units_white: int | None, white_to_move: bool) -> int | None:
    if units_white is None:
        return None
    return accuracy.white_units_to_pov(units_white, white_to_move)


def _is_mate_for(units_white: int | None, white_to_move: bool) -> bool:
    if units_white is None:
        return False
    pov = accuracy.white_units_to_pov(units_white, white_to_move)
    return pov is not None and pov >= accuracy.MATE_UNIT - 200


def _display_cp(units_white: int | None, white_to_move: bool) -> int | None:
    """Centipawns from the mover's perspective, mate clamped to +/-10000."""
    return _pov(units_white, white_to_move)
