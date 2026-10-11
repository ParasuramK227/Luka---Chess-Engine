"""PGN / FEN tests."""

import chess

from backend.storage import pgn_service

SIMPLE = """[Event "T"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
"""


def test_parse_pgn_basic():
    parsed = pgn_service.parse_pgn(SIMPLE)
    assert parsed["count"] == 1
    game = parsed["games"][0]
    assert game["headers"]["White"] == "A"
    assert game["result"] == "1-0"
    assert len(game["moves"]) == 6
    assert game["moves"][0]["san"] == "e4"
    assert game["content_hash"]


def test_parse_multiple_games():
    two = SIMPLE + "\n" + SIMPLE.replace('"A"', '"C"').replace('"B"', '"D"')
    parsed = pgn_service.parse_pgn(two)
    assert parsed["count"] == 2


def test_parse_empty_reports_error():
    parsed = pgn_service.parse_pgn("")
    assert parsed["count"] == 0
    assert parsed["errors"]


def test_malformed_pgn_does_not_crash():
    parsed = pgn_service.parse_pgn("this is not a pgn at all {{{{")
    assert "games" in parsed


def test_export_roundtrip():
    parsed = pgn_service.parse_pgn(SIMPLE)
    text = pgn_service.games_to_pgn(parsed["games"])
    reparsed = pgn_service.parse_pgn(text)
    assert reparsed["count"] == 1
    assert len(reparsed["games"][0]["moves"]) == 6


def test_annotated_export_adds_comment():
    parsed = pgn_service.parse_pgn(SIMPLE)
    game = parsed["games"][0]
    annotations = [{"comment": "Best move.", "nag": 1}] + [{} for _ in range(5)]
    text = pgn_service.game_to_annotated_pgn(game, annotations)
    assert "Best move." in text
    assert "Annotator" in text


def test_validate_fen_start():
    result = pgn_service.validate_fen(chess.STARTING_FEN)
    assert result["valid"] is True
    assert result["turn"] == "white"


def test_validate_fen_invalid():
    result = pgn_service.validate_fen("not a fen")
    assert result["valid"] is False
    assert result["error"]


def test_export_tolerates_move_without_uci():
    """A malformed move dict must not raise — export stops cleanly."""
    text = pgn_service.games_to_pgn([{"headers": {"White": "A"}, "moves": [{"san": "e4"}], "result": "*"}])
    assert "e4" in text


def test_annotated_export_tolerates_malformed_moves():
    text = pgn_service.game_to_annotated_pgn(
        {"headers": {"White": "A"}, "moves": [{"san": "e4"}, {"uci": "e7e5"}], "result": "*"},
        [{"comment": "ok"}, {}],
    )
    assert "e4" in text


def test_validate_fen_missing_king():
    result = pgn_service.validate_fen("8/8/8/8/8/8/8/8 w - - 0 1")
    assert result["valid"] is False
