"""Tests for per-move live analysis: the ``single_move`` pipeline and the
``POST /jobs/analyze_move`` endpoint.

Engine calls are stubbed (no Stockfish needed): ``analyse_fen`` is replaced with
canned per-FEN payloads, and the Flask endpoint is exercised through a stubbed
context.
"""

import chess
import types

import pytest

from backend.analysis import accuracy, single_move
from backend.app import create_app
from backend.config import Settings

START = chess.STARTING_FEN


def _after(before_fen: str, uci: str) -> str:
    board = chess.Board(before_fen)
    board.push_uci(uci)
    return board.fen()


def _canned(score_cp: int, pv_uci: list[str], pv_san: list[str]) -> dict:
    """Canned ``analyse_fen`` payload with a single MultiPV line (White POV cp)."""
    return {
        "fen": None,
        "turn": None,
        "legal_moves": 20,
        "is_game_over": False,
        "is_checkmate": False,
        "is_stalemate": False,
        "is_check": False,
        "lines": [
            {
                "multipv": 1,
                "depth": 18,
                "seldepth": 20,
                "nodes": 100,
                "nps": 0,
                "time": 0,
                "hashfull": 0,
                "wdl": None,
                "currmove": None,
                "currmovenumber": None,
                "turn": "white",
                "score": {"type": "cp", "cp": score_cp, "mate": None, "pov_cp": None},
                "pv_uci": pv_uci,
                "pv_san": pv_san,
            }
        ],
        "depth": 18,
        "engine": "fake",
    }


def _progress_job():
    return types.SimpleNamespace(set_progress=lambda *_: None)


def _two_lines(depth: int = 18) -> dict:
    """Canned payload exposing two lines so ``second_best_units`` is populated."""
    payload = _canned(30, ["c2c4"], ["c4"])
    payload["lines"].append(
        {
            "multipv": 2,
            "depth": depth,
            "seldepth": 20,
            "nodes": 100,
            "nps": 0,
            "time": 0,
            "hashfull": 0,
            "wdl": None,
            "currmove": None,
            "currmovenumber": None,
            "turn": "white",
            "score": {"type": "cp", "cp": 25, "mate": None, "pov_cp": None},
            "pv_uci": ["d2d4"],
            "pv_san": ["d4"],
        }
    )
    return payload


# ---------------------------------------------------------------------------
# single_move pipeline
# ---------------------------------------------------------------------------


def test_classifies_a_played_move(monkeypatch):
    """White plays e4, losing 100cp vs best: classification ``inaccuracy``."""
    start_after_e4 = _after(START, "e2e4")
    results = {
        START: _two_lines(),
        start_after_e4: _canned(-70, ["e7e5"], ["e5"]),
    }

    def fake_analyse_fen(manager, fen, **_kw):
        payload = results[fen] if fen in results else _canned(0, ["e2e4"], ["e4"])
        payload["fen"] = fen
        return payload

    monkeypatch.setattr(single_move, "analyse_fen", fake_analyse_fen)

    out = single_move.analyse_move(
        types.SimpleNamespace(),
        fen=start_after_e4,
        prev_fen=START,
        depth=18,
        multipv=2,
    )

    move = out["move"]
    assert move is not None
    assert move["uci"] == "e2e4"
    assert move["san"] == "e4"
    assert move["mover"] == "white"
    assert move["category"] == "inaccuracy"
    assert move["category_label"] == "Inaccuracy"
    assert move["metrics"]["cp_loss"] == 100
    assert move["best_move_san"] == "c4"
    assert move["nag"] == 6
    assert out["fen"] is start_after_e4
    assert out["engine"] == "fake"


def test_no_prev_fen_skips_classification(monkeypatch):
    monkeypatch.setattr(
        single_move, "analyse_fen", lambda manager, fen, **_kw: _canned(0, ["e2e4"], ["e4"])
    )
    out = single_move.analyse_move(types.SimpleNamespace(), fen=START, depth=18)
    assert out["move"] is None
    assert len(out["lines"]) == 1


def test_book_detection_uses_san_history(monkeypatch):
    start_after_e4 = _after(START, "e2e4")
    monkeypatch.setattr(
        single_move, "analyse_fen", lambda manager, fen, **_kw: _canned(30, ["e2e4"], ["e4"])
    )
    book = types.SimpleNamespace(is_book_move=lambda sans: sans == ["e4"])

    out = single_move.analyse_move(
        types.SimpleNamespace(), fen=start_after_e4, prev_fen=START, sans=["e4"], depth=18, book=book
    )
    assert out["move"]["category"] == "book"

    # No history given -> falls back to the single SAN of the played move.
    out = single_move.analyse_move(
        types.SimpleNamespace(), fen=start_after_e4, prev_fen=START, depth=18, book=book
    )
    assert out["move"]["category"] == "book"


def test_black_forced_move(monkeypatch):
    """Black to move has a single legal king move -> ``forced``."""
    before_fen = "4k3/4Q3/8/8/8/8/8/1K6 b - - 0 1"
    before = chess.Board(before_fen)
    assert before.legal_moves.count() == 1
    after_fen = _after(before_fen, "e8e7")
    monkeypatch.setattr(
        single_move, "analyse_fen",
        lambda manager, fen, **_kw: _canned(0, ["e8e7"], ["Kxe7"])
        if fen == before_fen else _canned(9600, ["e8e7"], ["Kxe7"]),
    )
    out = single_move.analyse_move(
        types.SimpleNamespace(), fen=after_fen, prev_fen=before_fen, depth=18
    )
    move = out["move"]
    assert move["category"] == "forced"
    assert move["mover"] == "black"
    assert move["metrics"]["forced"] is True
    assert move["metrics"]["applicable"] is False


def test_fens_must_be_consecutive(monkeypatch):
    monkeypatch.setattr(
        single_move, "analyse_fen", lambda manager, fen, **_kw: _canned(0, ["e2e4"], ["e4"])
    )
    # Two plies away from START -> no single move connects them.
    after_e4 = _after(START, "e2e4")
    far = _after(after_e4, "e7e5")
    with pytest.raises(ValueError):
        single_move.analyse_move(
            types.SimpleNamespace(), fen=far, prev_fen=START, depth=18
        )


def test_rating_estimate_knots():
    assert accuracy.estimate_rating(None) is None
    assert accuracy.estimate_rating(240) == 600
    assert accuracy.estimate_rating(300) == 600  # clamped to floor
    assert accuracy.estimate_rating(100) == 950  # on a knot
    assert accuracy.estimate_rating(50) == 1350
    assert accuracy.estimate_rating(0) == 2200
    mid = accuracy.estimate_rating(120)
    assert 800 < mid < 950  # linear interpolation between (140, 800) and (100, 950)
    assert accuracy.estimate_rating(30) == 1575


# ---------------------------------------------------------------------------
# Flask endpoint
# ---------------------------------------------------------------------------


def _make_ctx(tmp_path):
    settings = Settings(tmp_path)
    submitted = {}

    def submit(kind, run):
        submitted["kind"] = kind
        submitted["run"] = run
        return "job-1"

    return types.SimpleNamespace(
        settings=settings,
        book=types.SimpleNamespace(is_book_move=lambda sans: False),
        engine=types.SimpleNamespace(name="fake"),
        ensure_engine=lambda: None,
        jobs=types.SimpleNamespace(submit=submit),
        submitted=submitted,
    )


@pytest.fixture()
def client():
    return create_app().test_client()


def test_endpoint_submits_job(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)
    seen = {}

    def fake_analyse_move(engine, **kw):
        seen.update(kw)
        seen["engine"] = engine
        return {"ok": True}

    monkeypatch.setattr("backend.app.analyse_move", fake_analyse_move)

    res = client.post(
        "/api/v1/jobs/analyze_move",
        json={"fen": START, "prev_fen": _after(START, "e2e4"), "sans": ["e4"], "depth": 22, "multipv": 3},
    )
    assert res.status_code == 202
    assert res.get_json() == {"job_id": "job-1"}
    assert ctx.submitted["kind"] == "analyze_move"

    out = ctx.submitted["run"](_progress_job())
    assert out == {"ok": True}
    assert seen["depth"] == 22
    assert seen["multipv"] == 3
    assert seen["sans"] == ["e4"]
    assert seen["engine"] is ctx.engine
    assert seen["book"] is ctx.book


def test_endpoint_defaults_from_board_live_depth(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)
    seen = {}
    monkeypatch.setattr(
        "backend.app.analyse_move", lambda engine, **kw: (seen.update(kw) or {"ok": True})
    )

    ctx.settings.update({"board": {"live_depth": 24}})
    res = client.post("/api/v1/jobs/analyze_move", json={"fen": START})
    assert res.status_code == 202
    ctx.submitted["run"](_progress_job())
    assert seen["depth"] == 24
    assert seen["prev_fen"] is None


def test_endpoint_validates_payload(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)

    res = client.post("/api/v1/jobs/analyze_move", json={"fen": "not a fen"})
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "invalid_fen"

    res = client.post("/api/v1/jobs/analyze_move", json={"fen": START, "prev_fen": "garbage"})
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "invalid_fen"

    res = client.post("/api/v1/jobs/analyze_move", json={"fen": START, "sans": "e4"})
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "bad_request"