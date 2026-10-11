"""Unit tests for the file-backed :class:`Library` (index, tags, collections)."""

import chess

from backend.storage.library import Library


def _game(white="Alice", black="Bob", moves=None):
    board = chess.Board()
    out = []
    for san in (moves or ["e4", "e5", "Nf3"]):
        mv = board.parse_san(san)
        out.append({"san": san, "uci": mv.uci()})
        board.push(mv)
    return {
        "headers": {"White": white, "Black": black},
        "result": "1-0",
        "moves": out,
    }


def test_add_and_list(tmp_path):
    lib = Library(tmp_path)
    entry = lib.add(_game())
    assert entry["id"]
    games = lib.list()
    assert len(games) == 1
    assert games[0]["white"] == "Alice"
    assert games[0]["ply_count"] == 3
    # The game PGN is written under data/games and never overwritten on read.
    assert (tmp_path / "games" / f"{entry['id']}.pgn").is_file()


def test_dedup_by_content_hash(tmp_path):
    lib = Library(tmp_path)
    a = lib.add(_game())
    b = lib.add(_game())
    assert a["id"] == b["id"]
    assert b.get("duplicate") is True
    assert len(lib.list()) == 1


def test_search_filters(tmp_path):
    lib = Library(tmp_path)
    lib.add(_game(white="Kasparov", black="Karpov"))
    lib.add(_game(white="Fischer", black="Spassky", moves=["d4", "d5"]))
    assert len(lib.list(query="kasparov")) == 1
    assert len(lib.list(query="nobody")) == 0


def test_tags_add_and_remove(tmp_path):
    lib = Library(tmp_path)
    gid = lib.add(_game())["id"]
    lib.add_tag(gid, "sharp")
    lib.add_tag(gid, "sharp")  # idempotent
    assert lib.get(gid)["tags"] == ["sharp"]
    lib.remove_tag(gid, "sharp")
    assert lib.get(gid)["tags"] == []


def test_collections_add_remove_and_filter(tmp_path):
    lib = Library(tmp_path)
    a = lib.add(_game(white="A", black="B"))
    b = lib.add(_game(white="C", black="D", moves=["d4", "d5"]))
    lib.add_to_collection(a["id"], "study")
    lib.add_to_collection(b["id"], "study")
    lib.add_to_collection(b["id"], "other")
    assert lib.collections() == ["other", "study"]
    assert {g["id"] for g in lib.list(collection="study")} == {a["id"], b["id"]}
    lib.remove_from_collection(b["id"], "study")
    assert {g["id"] for g in lib.list(collection="study")} == {a["id"]}


def test_delete_removes_entry_and_files(tmp_path):
    lib = Library(tmp_path)
    gid = lib.add(_game())["id"]
    assert (tmp_path / "games" / f"{gid}.pgn").is_file()
    assert lib.delete(gid) is True
    assert lib.list() == []
    assert not (tmp_path / "games" / f"{gid}.pgn").exists()
    assert lib.delete("nope") is False


def test_mutations_on_missing_game_are_none(tmp_path):
    lib = Library(tmp_path)
    assert lib.remove_tag("nope", "x") is None
    assert lib.remove_from_collection("nope", "x") is None
    assert lib.add_tag("nope", "x") is None
