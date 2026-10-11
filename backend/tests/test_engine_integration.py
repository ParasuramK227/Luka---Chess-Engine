"""Integration tests against the real Stockfish binary.

These are skipped automatically when the engine is not present.
"""

import os

import chess
import chess.engine
import pytest

from backend.engine.stockfish_manager import EngineUnavailable, StockfishManager

ENGINE = os.environ.get("LUKA_ENGINE_PATH", "/usr/bin/stockfish")
pytestmark = pytest.mark.skipif(
    not os.path.exists(ENGINE), reason="Stockfish not installed"
)


@pytest.fixture
def manager():
    m = StockfishManager(ENGINE, {"threads": 1, "hash_mb": 16, "show_wdl": True})
    yield m
    m.quit()


def test_uci_handshake(manager):
    status = manager.start()
    assert status["available"] is True
    assert status["name"]
    assert "Threads" in status["options"]


def test_analysis_known_position(manager):
    result = manager.analyse_multi(chess.Board(), chess.engine.Limit(depth=10), multipv=1)
    lines = result["lines"]
    assert lines
    score = lines[0]["score"]
    assert score["type"] in ("cp", "mate")
    assert lines[0]["pv_san"]
    assert result["depth"] >= 8


def test_multipv_output(manager):
    result = manager.analyse_multi(chess.Board(), chess.engine.Limit(depth=8), multipv=3)
    assert len(result["lines"]) >= 2


def test_cancellation(manager):
    import threading
    import time

    def cancel_soon():
        time.sleep(0.5)
        manager.cancel()

    threading.Thread(target=cancel_soon).start()
    result = manager.analyse_multi(chess.Board(), chess.engine.Limit(depth=40), multipv=1)
    assert result["cancelled"] is True


def test_wdl_available(manager):
    result = manager.analyse_multi(chess.Board(), chess.engine.Limit(depth=10), multipv=1)
    wdl = result["lines"][0].get("wdl")
    # Stockfish 19 supports UCI_ShowWDL; if enabled we expect a triple.
    if wdl is not None:
        assert len(wdl) == 3
        assert sum(wdl) > 0


def test_mate_score_normalization(manager):
    # White to move with a forced back-rank mate in one: Re8#.
    board = chess.Board("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1")
    result = manager.analyse_multi(board, chess.engine.Limit(depth=12), multipv=1)
    score = result["lines"][0]["score"]
    assert score["type"] == "mate"
    assert score["mate"] > 0  # White delivers mate


def test_recovers_after_engine_crash(manager, monkeypatch):
    """A dead engine must not permanently break the manager (spec non-negotiable)."""
    assert manager.analyse_multi(chess.Board(), chess.engine.Limit(depth=6))["lines"]

    def boom(*_args, **_kwargs):
        raise chess.engine.EngineTerminatedError("simulated crash")

    monkeypatch.setattr(manager._engine, "analysis", boom)
    stale = manager._engine
    with pytest.raises(EngineUnavailable):
        manager.analyse_multi(chess.Board(), chess.engine.Limit(depth=6))
    assert manager._meta["available"] is False
    assert manager._engine is None
    stale.quit()  # the simulated crash bypasses the real context manager

    # The next call must transparently relaunch Stockfish and analyse again.
    monkeypatch.undo()
    result = manager.analyse_multi(chess.Board(), chess.engine.Limit(depth=8))
    assert result["lines"]
    assert manager._meta["available"] is True

