"""Tests for the optional online importer (importers + /library/import/online).

No real network access: ``urllib.request.urlopen`` is monkeypatched, and the
Flask endpoint is exercised through a stubbed context.
"""

import json
import types
import urllib.error

import pytest

from backend import online_import as imp
from backend.app import create_app
from backend.config import Settings
from backend.storage.library import Library

SAMPLE_PGN = """[Event "Test Game"]
[Site "?"]
[Date "2026.10.11"]
[Round "-"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0
"""


class FakeResp:
    """Context-manager response with a fixed byte payload."""

    def __init__(self, data: bytes):
        self._data = data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size: int = -1) -> bytes:
        return self._data if size == -1 else self._data[:size]


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def test_valid_username():
    assert imp.valid_username("DrNykterstein") is True
    assert imp.valid_username("user_name-1") is True
    assert imp.valid_username("bad user") is False
    assert imp.valid_username("x" * 41) is False
    assert imp.valid_username("") is False


def test_is_standard_variant():
    assert imp.is_standard_variant({"headers": {}}) is True
    assert imp.is_standard_variant({"headers": {"Variant": "Standard"}}) is True
    assert imp.is_standard_variant({"headers": {"Variant": "From Position"}}) is True
    assert imp.is_standard_variant({"headers": {"Variant": "Chess960"}}) is False
    assert imp.is_standard_variant({"headers": {"Variant": "Bughouse"}}) is False


# ---------------------------------------------------------------------------
# Importer helpers (mocked HTTP)
# ---------------------------------------------------------------------------

def _fake_urlopen(payloads):
    """Return a urlopen replacement that routes by URL substring."""

    def _get(url, *_, **__):
        urlstr = getattr(url, "full_url", url)
        for key, data in payloads.items():
            if key in urlstr:
                return FakeResp(data)
        raise imp.OnlineImportError(f"Unexpected URL {urlstr}", "http_error")

    return _get


def test_fetch_lichess_pgn(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen({"lichess.org": SAMPLE_PGN.encode()}))
    seen = {}

    def _capture(request, timeout=15):
        seen["url"] = request.full_url
        seen["accept"] = request.get_header("Accept")
        return FakeResp(SAMPLE_PGN.encode())

    monkeypatch.setattr("urllib.request.urlopen", _capture)
    pgn = imp.fetch_lichess_pgn("alice", 5, timeout=10)
    assert pgn == SAMPLE_PGN
    assert "?max=5" in seen["url"]
    assert seen["accept"] == "application/x-chess-pgn"


def test_fetch_chesscom_pgn_walks_archives_newest_first(monkeypatch):
    archives = {"archives": ["https://api.chess.com/pub/player/alice/games/2026/08",
                             "https://api.chess.com/pub/player/alice/games/2026/09"]}
    month08 = {"games": [{"rules": "chess", "pgn": "PGN-08"}]}
    month09 = {"games": [{"rules": "chess", "pgn": "PGN-09-B"},
                         {"rules": "chess960", "pgn": "PGN-09-VARIANT"},
                         {"rules": "chess", "pgn": "PGN-09-A"}]}
    payloads = {"archives": json.dumps(archives).encode(),
                "/2026/08": json.dumps(month08).encode(),
                "/2026/09": json.dumps(month09).encode()}
    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen(payloads))

    pgn = imp.fetch_chesscom_pgn("Alice", 2, timeout=10)
    parts = pgn.split("\n\n")
    # Games within the newest month are taken last-first, variants skipped,
    # limited to the requested count.
    assert parts == ["PGN-09-A", "PGN-09-B"]


def test_fetch_chesscom_pgn_stops_at_count_across_months(monkeypatch):
    archives = {"archives": ["https://api.chess.com/pub/player/alice/games/2026/08",
                             "https://api.chess.com/pub/player/alice/games/2026/09"]}
    payloads = {"archives": json.dumps(archives).encode(),
                "/2026/08": json.dumps({"games": [{"rules": "chess", "pgn": "PGN-08"}]}).encode(),
                "/2026/09": json.dumps({"games": [{"rules": "chess", "pgn": "PGN-09"}]}).encode()}
    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen(payloads))
    assert imp.fetch_chesscom_pgn("alice", 1) == "PGN-09"


def test_fetch_chesscom_no_games(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        _fake_urlopen({"archives": json.dumps({"archives": []}).encode()}),
    )
    with pytest.raises(imp.OnlineImportError) as exc:
        imp.fetch_chesscom_pgn("nobody", 5)
    assert exc.value.code == "no_games"


def test_fetch_maps_http_errors(monkeypatch):
    def _boom(url, *_, **__):
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", _boom)
    with pytest.raises(imp.OnlineImportError) as exc:
        imp.fetch_lichess_pgn("ghost", 5)
    assert exc.value.code == "user_not_found"

    def _boom_bad_gateway(url, *_, **__):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr("urllib.request.urlopen", _boom_bad_gateway)
    with pytest.raises(imp.OnlineImportError) as exc:
        imp.fetch_lichess_pgn("ghost", 5)
    assert exc.value.code == "network_error"


# ---------------------------------------------------------------------------
# Flask endpoint
# ---------------------------------------------------------------------------

def _make_ctx(tmp_path, enabled=True):
    settings = Settings(tmp_path)
    settings.update({"online_import": {"enabled": enabled}})
    return types.SimpleNamespace(settings=settings, library=Library(tmp_path))


@pytest.fixture()
def client():
    return create_app().test_client()


def test_endpoint_disabled_by_default(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path, enabled=False)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)
    res = client.post("/api/v1/library/import/online", json={"source": "lichess", "username": "alice"})
    assert res.status_code == 403
    assert res.get_json()["error"]["code"] == "online_import_disabled"


def test_endpoint_validates_input(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path, enabled=True)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)

    res = client.post("/api/v1/library/import/online", json={"source": "lichess", "username": "bad user!"})
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "bad_username"

    res = client.post("/api/v1/library/import/online", json={"source": "wat", "username": "alice"})
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "bad_source"


def test_endpoint_imports_and_adds_to_library(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path, enabled=True)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)
    monkeypatch.setattr("backend.app.fetch_lichess_pgn", lambda u, c, timeout=15: SAMPLE_PGN)

    res = client.post("/api/v1/library/import/online", json={"source": "lichess", "username": "alice", "count": 3})
    assert res.status_code == 200
    body = res.get_json()
    assert body["imported"] == 1
    assert body["games"][0]["white"] == "Alice"
    assert len(ctx.library.list()) == 1


def test_endpoint_clamps_count(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path, enabled=True)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)
    seen = {}

    def _fake_fetch(username, count, timeout=15):
        seen["count"] = count
        return SAMPLE_PGN

    monkeypatch.setattr("backend.app.fetch_lichess_pgn", _fake_fetch)
    res = client.post("/api/v1/library/import/online", json={"source": "lichess", "username": "alice", "count": 999})
    assert res.status_code == 200
    assert seen["count"] == 20


def test_endpoint_maps_fetch_error(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path, enabled=True)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)

    def _raise(username, count, timeout=15):
        raise imp.OnlineImportError("Player not found", "user_not_found")

    monkeypatch.setattr("backend.app.fetch_lichess_pgn", _raise)
    res = client.post("/api/v1/library/import/online", json={"source": "lichess", "username": "ghost"})
    assert res.status_code == 404
    assert res.get_json()["error"]["code"] == "user_not_found"


def test_endpoint_skips_variant_games(client, monkeypatch, tmp_path):
    ctx = _make_ctx(tmp_path, enabled=True)
    monkeypatch.setattr("backend.app.get_ctx", lambda: ctx)
    pgn960 = '[Event "960"]\n[Variant "Chess960"]\n[Result "*"]\n\n1. e4 *\n'
    monkeypatch.setattr("backend.app.fetch_chesscom_pgn", lambda u, c, timeout=15: pgn960)

    res = client.post("/api/v1/library/import/online", json={"source": "chess.com", "username": "alice"})
    assert res.status_code == 200
    body = res.get_json()
    assert body["imported"] == 0
    assert body["skipped_variants"] == 1
    assert len(ctx.library.list()) == 0