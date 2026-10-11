"""Move classification tests."""

from backend.analysis import accuracy, move_classifier


def _metrics(before, after, white_to_move=True, forced=False):
    return accuracy.evaluate_move(before, after, white_to_move, forced=forced)


def test_forced_move():
    result = move_classifier.classify_move(
        played_uci="a1a2",
        best_uci="a1a2",
        before_units=0,
        after_units=0,
        white_to_move=True,
        metrics=_metrics(0, 0, forced=True),
        legal_moves=1,
    )
    assert result["category"] == "forced"


def test_book_move():
    result = move_classifier.classify_move(
        played_uci="e2e4",
        best_uci="e2e4",
        before_units=20,
        after_units=20,
        white_to_move=True,
        metrics=_metrics(20, 20),
        legal_moves=20,
        is_book=True,
    )
    assert result["category"] == "book"


def test_best_move():
    result = move_classifier.classify_move(
        played_uci="g1f3",
        best_uci="g1f3",
        before_units=30,
        after_units=30,
        white_to_move=True,
        metrics=_metrics(30, 30),
        legal_moves=20,
    )
    assert result["category"] == "best"


def test_blunder_threshold():
    result = move_classifier.classify_move(
        played_uci="a2a3",
        best_uci="g1f3",
        before_units=0,
        after_units=-900,
        white_to_move=True,
        metrics=_metrics(0, -900),
        legal_moves=20,
        thresholds={"blunder_loss": 500},
    )
    assert result["category"] in ("blunder", "missed_win")
    assert result["reason"]["loss_cp"] >= 500


def test_inaccuracy_band():
    result = move_classifier.classify_move(
        played_uci="a2a3",
        best_uci="g1f3",
        before_units=0,
        after_units=-80,
        white_to_move=True,
        metrics=_metrics(0, -80),
        legal_moves=20,
        thresholds={"excellent_loss": 20, "good_loss": 50, "inaccuracy_loss": 100,
                    "mistake_loss": 250, "blunder_loss": 500, "missed_win_cp": 300},
    )
    assert result["category"] == "inaccuracy"


def test_missed_win():
    mate = accuracy.eval_to_white_units({"type": "mate", "mate": 2})
    result = move_classifier.classify_move(
        played_uci="a2a3",
        best_uci="g1f3",
        before_units=mate,
        after_units=50,
        white_to_move=True,
        metrics=_metrics(mate, 50),
        legal_moves=20,
    )
    assert result["category"] == "missed_win"


def test_great_only_move():
    result = move_classifier.classify_move(
        played_uci="g1f3",
        best_uci="g1f3",
        before_units=400,
        after_units=400,
        white_to_move=True,
        metrics=_metrics(400, 400),
        legal_moves=20,
        second_best_units=-100,
    )
    assert result["category"] == "great"


def test_brilliant_requires_sacrifice_and_best():
    result = move_classifier.classify_move(
        played_uci="d1h5",
        best_uci="d1h5",
        before_units=200,
        after_units=150,
        white_to_move=True,
        metrics=_metrics(200, 150),
        legal_moves=30,
        material_given=500,
        opponent_best_is_capture=True,
        second_best_units=None,
    )
    assert result["category"] == "brilliant"


def test_best_without_sacrifice_is_not_brilliant():
    result = move_classifier.classify_move(
        played_uci="g1f3",
        best_uci="g1f3",
        before_units=30,
        after_units=30,
        white_to_move=True,
        metrics=_metrics(30, 30),
        legal_moves=20,
        material_given=0,
    )
    assert result["category"] == "best"
