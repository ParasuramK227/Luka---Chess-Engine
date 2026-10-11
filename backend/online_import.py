"""Optional, opt-in online game importer for chess.com and lichess.

This is the *only* place in Luka - Chess Engine that performs outbound network access, and
it is disabled by default (see ``settings.online_import.enabled``). It only
reads public game data for a username the user explicitly supplies; nothing is
uploaded and no account or token is used.

The rest of the application (board, engine analysis, review, library) never
requires a network connection.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request

# chess.com requires a descriptive User-Agent; lichess is happy with one too.
USER_AGENT = "Luka-Chess-Engine/0.1 (local chess analysis)"
MAX_BYTES = 5 * 1024 * 1024
USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,40}$")

# Variant headers that our standard-chess engine review can still handle.
_STANDARD_VARIANTS = {"", "standard", "chess", "from position"}


class OnlineImportError(Exception):
    """Raised when an online import cannot be completed.

    ``code`` is a stable machine-readable identifier surfaced to the client.
    """

    def __init__(self, message: str, code: str = "online_import_error"):
        super().__init__(message)
        self.code = code


def valid_username(username: str) -> bool:
    return bool(USERNAME_RE.match(username or ""))


def is_standard_variant(game: dict) -> bool:
    """True when a parsed game is standard chess we can review."""
    variant = str((game.get("headers") or {}).get("Variant", "")).strip().lower()
    return variant in _STANDARD_VARIANTS


def _fetch(url: str, accept: str, timeout: float) -> str:
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": accept}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:  # noqa: S310 - fixed https hosts
            data = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise OnlineImportError("Player not found", "user_not_found") from exc
        if exc.code == 429:
            raise OnlineImportError("Rate limited by the server; try again later", "rate_limited") from exc
        if exc.code in (401, 403):
            raise OnlineImportError("Access denied by the server", "forbidden") from exc
        raise OnlineImportError(f"Server returned HTTP {exc.code}", "http_error") from exc
    except urllib.error.URLError as exc:
        raise OnlineImportError(f"Network error: {exc.reason}", "network_error") from exc
    except (TimeoutError, OSError) as exc:
        raise OnlineImportError(f"Network error: {exc}", "network_error") from exc

    if len(data) > MAX_BYTES:
        raise OnlineImportError("Server response was too large", "too_large")
    return data.decode("utf-8", errors="replace")


def fetch_lichess_pgn(username: str, count: int, timeout: float = 15.0) -> str:
    """Return up to ``count`` most recent public games as a single PGN string."""
    url = (
        f"https://lichess.org/api/games/user/{urllib.parse.quote(username)}"
        f"?max={count}&opening=true&clocks=false&evals=false&literate=false"
    )
    return _fetch(url, "application/x-chess-pgn", timeout)


def fetch_chesscom_pgn(username: str, count: int, timeout: float = 15.0) -> str:
    """Return up to ``count`` most recent public games as a single PGN string."""
    archives_url = (
        f"https://api.chess.com/pub/player/{urllib.parse.quote(username.lower())}/games/archives"
    )
    archives = json.loads(_fetch(archives_url, "application/json", timeout)).get("archives") or []
    if not archives:
        raise OnlineImportError("No games found for this player", "no_games")

    pgns: list[str] = []
    # Archives are oldest-first; walk backwards from the newest month.
    for archive_url in reversed(archives):
        if not str(archive_url).startswith("https://api.chess.com/"):
            continue
        data = json.loads(_fetch(str(archive_url), "application/json", timeout))
        for game in reversed(data.get("games") or []):
            # Prefer standard chess when the payload tags the ruleset.
            if game.get("rules") not in (None, "chess"):
                continue
            pgn = game.get("pgn")
            if pgn:
                pgns.append(pgn)
            if len(pgns) >= count:
                break
        if len(pgns) >= count:
            break

    if not pgns:
        raise OnlineImportError("No games found for this player", "no_games")
    return "\n\n".join(pgns)
