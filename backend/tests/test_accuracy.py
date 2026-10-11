"""Accuracy model tests using synthetic evaluation changes."""

from backend.analysis import accuracy


def test_equal_positions_no_loss():
    m = accuracy.evaluate_move(0, 0, white_to_move=True)
    assert m["cp_loss"] == 0
    assert m["accuracy"] == 100.0
    assert m["applicable"] is True


def test_white_blunder_cp_loss():
    # White to move was equal; after the move White is -300 (units White POV -300).
    m = accuracy.evaluate_move(0, -300, white_to_move=True)
    assert m["cp_loss"] == 300
    assert m["accuracy"] < 100


def test_black_blunder_cp_loss():
    # Black to move, equal; after the move White is +300 => Black lost 300.
    m = accuracy.evaluate_move(0, 300, white_to_move=False)
    assert m["cp_loss"] == 300


def test_perspective_improvement_is_not_a_loss():
    # White to move, best was +300, played keeps +300 => no loss.
    m = accuracy.evaluate_move(300, 300, white_to_move=True)
    assert m["cp_loss"] == 0


def test_forced_move_is_excluded():
    m = accuracy.evaluate_move(0, -900, white_to_move=True, forced=True)
    assert m["applicable"] is False
    assert m["accuracy"] == 100.0
    assert m["cp_loss"] == 0


def test_monotonic_accuracy_decreases_with_loss():
    small = accuracy.evaluate_move(50, 0, white_to_move=True)
    large = accuracy.evaluate_move(500, 0, white_to_move=True)
    assert small["accuracy"] > large["accuracy"]


def test_mate_handling_units():
    mate_units = accuracy.eval_to_white_units({"type": "mate", "mate": 3})
    assert mate_units is not None and mate_units > 9000
    mated = accuracy.eval_to_white_units({"type": "mate", "mate": -3})
    assert mated is not None and mated < -9000


def test_missed_mate_is_penalized():
    mate_units = accuracy.eval_to_white_units({"type": "mate", "mate": 2})
    m = accuracy.evaluate_move(mate_units, 0, white_to_move=True)
    assert m["cp_loss"] > 9000
    assert m["accuracy"] < 100


def test_accuracy_bounds():
    for before in (-5000, -200, 0, 120, 4000):
        for after in (-5000, -200, 0, 120, 4000):
            m = accuracy.evaluate_move(before, after, white_to_move=True)
            assert 0.0 <= m["accuracy"] <= 100.0
            assert m["cp_loss"] >= 0


def test_summarize_empty_and_populated():
    assert accuracy.summarize([])["accuracy"] is None
    metrics = [
        accuracy.evaluate_move(0, 0, True),
        accuracy.evaluate_move(0, -300, True),
    ]
    summary = accuracy.summarize(metrics)
    assert summary["moves_scored"] == 2
    assert 0 <= summary["accuracy"] <= 100
    assert summary["average_cp_loss"] is not None
