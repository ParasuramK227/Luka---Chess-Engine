"""ChessLab Flask application and versioned REST API.

Bind is 127.0.0.1 by default. All chess analysis runs locally through the
Stockfish binary configured in settings; nothing here performs network access.
"""

from __future__ import annotations

import io
import json
import logging

import chess
from flask import Blueprint, Flask, Response, jsonify, request, send_file, stream_with_context
from flask_cors import CORS

from .analysis import reports as report_service
from .analysis.game_review import run_review
from .context import AppContext
from .engine.analysis_service import analyse_fen, legal_moves
from .engine.stockfish_manager import EngineUnavailable
from .storage.pgn_service import PgnError, games_to_pgn, parse_pgn, validate_fen

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("chesslab.api")

api = Blueprint("api", __name__, url_prefix="/api/v1")

_ctx_singleton: AppContext | None = None


def get_ctx() -> AppContext:
    global _ctx_singleton
    if _ctx_singleton is None:
        _ctx_singleton = AppContext()
    return _ctx_singleton


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def error(message: str, status: int = 400, code: str = "bad_request") -> Response:
    return jsonify({"error": {"code": code, "message": message}}), status


def _engine_payload() -> dict:
    ctx = get_ctx()
    status = ctx.ensure_engine()
    return {
        "available": status.get("available", False),
        "name": status.get("name"),
        "author": status.get("author"),
        "path": status.get("path"),
        "error": status.get("error"),
        "supported_options": status.get("options", {}),
        "defaults": ctx.settings.get("engine"),
    }


def _resolve_game(body: dict) -> dict:
    """Return a parsed game dict from a request body."""
    ctx = get_ctx()
    game_id = body.get("game_id")
    if game_id:
        entry = ctx.library.get(game_id)
        if entry is None:
            raise PgnError(f"Unknown game: {game_id}")
        return {
            "headers": entry.get("headers") or {},
            "result": entry.get("result", "*"),
            "start_fen": entry.get("start_fen"),
            "moves": entry.get("moves") or [],
            "content_hash": entry.get("content_hash"),
        }
    if body.get("pgn"):
        parsed = parse_pgn(body["pgn"])
        if not parsed["games"]:
            raise PgnError(parsed["errors"][0]["error"] if parsed["errors"] else "No games found")
        index = int(body.get("game_index", 0))
        if index >= len(parsed["games"]):
            raise PgnError("game_index out of range")
        return parsed["games"][index]
    if body.get("moves") is not None:
        return {
            "headers": body.get("headers") or {},
            "result": body.get("result", "*"),
            "start_fen": body.get("start_fen") or chess.STARTING_FEN,
            "moves": body["moves"],
            "content_hash": None,
        }
    raise PgnError("Provide game_id, pgn, or moves")


# ---------------------------------------------------------------------------
# Health & engine
# ---------------------------------------------------------------------------

@api.get("/health")
def health():
    ctx = get_ctx()
    return jsonify(
        {
            "status": "ok",
            "engine": ctx.engine_health(),
            "data_dir": str(ctx.data_dir),
            "cache_entries": len(ctx.cache),
        }
    )


@api.get("/engine/status")
def engine_status():
    return jsonify(_engine_payload())


@api.post("/engine/restart")
def engine_restart():
    ctx = get_ctx()
    try:
        ctx.engine.restart()
    except EngineUnavailable as exc:
        return error(str(exc), 503, "engine_unavailable")
    return jsonify(_engine_payload())


@api.post("/engine/configure")
def engine_configure():
    ctx = get_ctx()
    body = request.get_json(silent=True) or {}
    patch = {}
    if "path" in body:
        patch["path"] = body["path"]
    if "extra_options" in body:
        patch["extra_options"] = body["extra_options"]
    if patch:
        ctx.apply_settings({"engine": patch})
    return jsonify(_engine_payload())


# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------

@api.post("/fen/validate")
def fen_validate():
    body = request.get_json(silent=True) or {}
    return jsonify(validate_fen(body.get("fen", "")))


@api.post("/legal-moves")
def legal_moves_endpoint():
    body = request.get_json(silent=True) or {}
    fen = body.get("fen") or chess.STARTING_FEN
    try:
        return jsonify({"fen": fen, "moves": legal_moves(fen)})
    except ValueError as exc:
        return error(str(exc), 400, "invalid_fen")


# ---------------------------------------------------------------------------
# Jobs: analysis and review
# ---------------------------------------------------------------------------

@api.post("/jobs/analyze")
def job_analyze():
    ctx = get_ctx()
    body = request.get_json(silent=True) or {}
    fen = body.get("fen") or chess.STARTING_FEN
    check = validate_fen(fen)
    if not check["valid"]:
        return error(check["error"] or "Invalid FEN", 400, "invalid_fen")

    eng = ctx.settings.get("engine")
    depth = int(body.get("depth", eng["depth"]))
    movetime_ms = int(body.get("movetime_ms", eng["movetime_ms"]))
    nodes = int(body.get("nodes", eng["nodes"]))
    multipv = int(body.get("multipv", eng["multipv"]))

    def run(job):
        ctx.ensure_engine()
        lines: dict[int, dict] = {}

        def on_info(info, board):
            lines[info["multipv"]] = info
            target = depth or 20
            job.set_progress(100.0 * min(info.get("depth") or 0, target) / max(1, target),
                             f"depth {info.get('depth')}")
            job.set_data(
                {
                    "fen": board.fen(),
                    "turn": info.get("turn"),
                    "lines": [lines[k] for k in sorted(lines)],
                }
            )

        result = analyse_fen(
            ctx.engine,
            fen,
            depth=depth,
            movetime_ms=movetime_ms,
            nodes=nodes,
            multipv=multipv,
            on_info=on_info,
        )
        return result

    job_id = ctx.jobs.submit("analyze", run)
    return jsonify({"job_id": job_id}), 202


@api.post("/jobs/review")
def job_review():
    ctx = get_ctx()
    body = request.get_json(silent=True) or {}
    try:
        game = _resolve_game(body)
    except PgnError as exc:
        return error(str(exc), 400, "invalid_game")

    review_cfg = ctx.settings.get("review")
    depth = int(body.get("depth", review_cfg["depth"]))
    multipv = int(body.get("multipv", 2))
    game_id = body.get("game_id")
    thresholds = ctx.settings.get("classification")

    def run(job):
        ctx.ensure_engine()
        review = run_review(
            ctx.engine,
            game,
            depth=depth,
            multipv=multipv,
            thresholds=thresholds,
            book=ctx.book,
            cache=ctx.cache,
            job=job,
        )
        job.set_data({})
        if review.get("complete"):
            try:
                ctx.cache.flush()
            except Exception:
                logger.warning("cache flush failed", exc_info=True)
            if game_id:
                _persist_report(ctx, game_id, review)
        return review

    job_id = ctx.jobs.submit("review", run)
    return jsonify({"job_id": job_id}), 202


def _persist_report(ctx: AppContext, game_id: str, review: dict) -> None:
    contents = {
        "review.json": report_service.review_to_json(review),
        "report.html": report_service.review_to_html(review),
        "annotated.pgn": report_service.review_to_annotated_pgn(review),
        "review.csv": report_service.review_to_csv(review),
    }
    ctx.library.save_report_files(game_id, contents)
    summary = review.get("summary") or {}
    ctx.library.set_analysis(
        game_id,
        status="complete",
        depth=review.get("analysis", {}).get("depth"),
        multipv=review.get("analysis", {}).get("multipv"),
        engine=review.get("analysis", {}).get("engine"),
        accuracy={
            "white": (summary.get("white") or {}).get("accuracy"),
            "black": (summary.get("black") or {}).get("accuracy"),
        },
        reviewed_at=__import__("time").time(),
    )


@api.get("/jobs/<job_id>")
def job_status(job_id: str):
    job = get_ctx().jobs.get(job_id)
    if job is None:
        return error("Unknown job", 404, "not_found")
    return jsonify(job.result_payload() if request.args.get("result") == "1" else job.snapshot())


@api.get("/jobs/<job_id>/result")
def job_result(job_id: str):
    job = get_ctx().jobs.get(job_id)
    if job is None:
        return error("Unknown job", 404, "not_found")
    if job.status != "done":
        return error(f"Job is {job.status}", 409, "not_ready")
    return jsonify(job.result_payload())


@api.post("/jobs/<job_id>/cancel")
def job_cancel(job_id: str):
    ctx = get_ctx()
    ok = ctx.jobs.cancel(job_id)
    if not ok:
        return error("Unknown job", 404, "not_found")
    ctx.engine.cancel()
    return jsonify({"cancelled": True, "job_id": job_id})


@api.get("/jobs/<job_id>/events")
def job_events(job_id: str):
    ctx = get_ctx()

    def generate():
        for snap in ctx.jobs.events(job_id):
            yield f"data: {json.dumps(snap)}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


@api.get("/jobs")
def job_list():
    return jsonify({"jobs": get_ctx().jobs.list_jobs()})


# ---------------------------------------------------------------------------
# PGN
# ---------------------------------------------------------------------------

@api.post("/pgn/parse")
def pgn_parse():
    body = request.get_json(silent=True) or {}
    try:
        return jsonify(parse_pgn(body.get("pgn", "")))
    except PgnError as exc:
        return error(str(exc), 400, "invalid_pgn")


@api.post("/pgn/export")
def pgn_export():
    body = request.get_json(silent=True) or {}
    games = body.get("games")
    if not isinstance(games, list):
        return error("games must be a list", 400)
    return jsonify({"pgn": games_to_pgn(games)})


# ---------------------------------------------------------------------------
# Library
# ---------------------------------------------------------------------------

@api.get("/library")
def library_list():
    ctx = get_ctx()
    return jsonify(
        {
            "games": ctx.library.list(
                query=request.args.get("q"),
                collection=request.args.get("collection"),
                tag=request.args.get("tag"),
                status=request.args.get("status"),
            ),
            "collections": ctx.library.collections(),
        }
    )


@api.get("/library/<game_id>")
def library_get(game_id: str):
    entry = get_ctx().library.get(game_id)
    if entry is None:
        return error("Game not found", 404, "not_found")
    return jsonify(entry)


@api.delete("/library/<game_id>")
def library_delete(game_id: str):
    ok = get_ctx().library.delete(game_id)
    if not ok:
        return error("Game not found", 404, "not_found")
    return jsonify({"deleted": True, "id": game_id})


@api.post("/library/import")
def library_import():
    """Import from a pasted PGN body or an uploaded file."""
    ctx = get_ctx()
    source_name = "import"
    text = None
    if "file" in request.files:
        upload = request.files["file"]
        source_name = upload.filename or "upload.pgn"
        raw = upload.read(25 * 1024 * 1024 + 1)
        if len(raw) > 25 * 1024 * 1024:
            return error("File exceeds the 25 MiB import limit", 413, "too_large")
        text = raw.decode("utf-8", errors="replace")
    else:
        body = request.get_json(silent=True) or {}
        text = body.get("pgn")
        source_name = body.get("source_name", "pasted.pgn")

    if not text:
        return error("No PGN supplied", 400, "no_pgn")
    try:
        parsed = parse_pgn(text)
    except PgnError as exc:
        return error(str(exc), 400, "invalid_pgn")

    added = []
    for game in parsed["games"]:
        entry = ctx.library.add(game, source_name=source_name)
        added.append({"id": entry["id"], "duplicate": entry.get("duplicate", False)})

    return jsonify(
        {
            "imported": len(added),
            "games": added,
            "errors": parsed["errors"],
        }
    )


@api.post("/library/<game_id>/tags")
def library_add_tag(game_id: str):
    body = request.get_json(silent=True) or {}
    tag = (body.get("tag") or "").strip()
    if not tag:
        return error("tag required", 400)
    entry = get_ctx().library.add_tag(game_id, tag)
    if entry is None:
        return error("Game not found", 404, "not_found")
    return jsonify(entry)


@api.post("/library/<game_id>/collections")
def library_add_collection(game_id: str):
    body = request.get_json(silent=True) or {}
    name = (body.get("collection") or "").strip()
    if not name:
        return error("collection required", 400)
    entry = get_ctx().library.add_to_collection(game_id, name)
    if entry is None:
        return error("Game not found", 404, "not_found")
    return jsonify(entry)


@api.delete("/library/<game_id>/tags/<tag>")
def library_remove_tag(game_id: str, tag: str):
    entry = get_ctx().library.remove_tag(game_id, tag)
    if entry is None:
        return error("Game not found", 404, "not_found")
    return jsonify(entry)


@api.delete("/library/<game_id>/collections/<collection>")
def library_remove_collection(game_id: str, collection: str):
    entry = get_ctx().library.remove_from_collection(game_id, collection)
    if entry is None:
        return error("Game not found", 404, "not_found")
    return jsonify(entry)


@api.get("/library/<game_id>/review")
def library_review(game_id: str):
    ctx = get_ctx()
    entry = ctx.library.get(game_id)
    if entry is None:
        return error("Game not found", 404, "not_found")
    rel = (entry.get("files") or {}).get("review.json")
    if not rel:
        return error("No saved review for this game", 404, "no_review")
    try:
        text = ctx.library.fm.read_text(ctx.data_dir / rel)
        return jsonify(json.loads(text))
    except Exception as exc:
        return error(f"Failed to read review: {exc}", 500, "read_error")


@api.get("/library/<game_id>/report/<fmt>")
def library_report(game_id: str, fmt: str):
    ctx = get_ctx()
    entry = ctx.library.get(game_id)
    if entry is None:
        return error("Game not found", 404, "not_found")
    files = entry.get("files") or {}
    fmt = fmt.lower()
    media = {
        "json": "application/json",
        "html": "text/html",
        "csv": "text/csv",
        "pgn": "application/x-chess-pgn",
    }
    if fmt not in media:
        return error("Unsupported format", 400, "bad_format")

    # CSV is generated on demand from the saved review.
    if fmt == "csv":
        rel = files.get("review.json")
        if not rel:
            return error("No saved review for this game", 404, "no_review")
        review = json.loads(ctx.library.fm.read_text(ctx.data_dir / rel))
        content = report_service.review_to_csv(review)
        rel_name = f"{game_id}.review.csv"
    else:
        key = {"json": "review.json", "html": "report.html", "pgn": "annotated.pgn"}[fmt]
        rel = files.get(key)
        if not rel:
            return error("No saved report for this game", 404, "no_report")
        content = ctx.library.fm.read_text(ctx.data_dir / rel)
        rel_name = rel.split("/")[-1]

    return send_file(
        io.BytesIO(content.encode("utf-8")),
        mimetype=media[fmt],
        as_attachment=True,
        download_name=rel_name,
    )


# ---------------------------------------------------------------------------
# Settings & files
# ---------------------------------------------------------------------------

@api.get("/settings")
def settings_get():
    ctx = get_ctx()
    return jsonify({"settings": ctx.settings.as_dict(), "engine": ctx.engine_health()})


@api.put("/settings")
def settings_put():
    ctx = get_ctx()
    body = request.get_json(silent=True) or {}
    patch = body.get("settings", body)
    if not isinstance(patch, dict):
        return error("settings must be an object", 400)
    try:
        updated = ctx.apply_settings(patch)
    except ValueError as exc:
        return error(str(exc), 400, "invalid_settings")
    return jsonify({"settings": updated, "engine": ctx.engine_health()})


@api.post("/cache/clear")
def cache_clear():
    ctx = get_ctx()
    n = len(ctx.cache)
    ctx.cache.clear()
    return jsonify({"cleared": n})


@api.post("/files/allow-root")
def files_allow_root():
    ctx = get_ctx()
    body = request.get_json(silent=True) or {}
    path = body.get("path")
    if not path:
        return error("path required", 400)
    try:
        root = ctx.library.fm.allow_root(path)
    except Exception as exc:
        return error(str(exc), 400, "path_error")
    return jsonify({"allowed": str(root), "roots": [str(r) for r in ctx.library.fm.allowed_roots()]})


@api.get("/files/list")
def files_list():
    ctx = get_ctx()
    path = request.args.get("path")
    if not path:
        return error("path required", 400)
    try:
        return jsonify({"path": path, "entries": ctx.library.fm.list_dir(path)})
    except Exception as exc:
        return error(str(exc), 400, "path_error")


# ---------------------------------------------------------------------------
# Openings
# ---------------------------------------------------------------------------

@api.post("/openings/lookup")
def openings_lookup():
    ctx = get_ctx()
    body = request.get_json(silent=True) or {}
    moves = body.get("moves") or []
    if not isinstance(moves, list):
        return error("moves must be a list of SAN strings", 400)
    return jsonify({"opening": ctx.book.lookup(moves), "source": ctx.book.source})


@api.post("/openings/list")
def openings_list():
    ctx = get_ctx()
    body = request.get_json(silent=True) or {}
    q = body.get("q")
    if q is not None and not isinstance(q, str):
        return error("q must be a string", 400)
    items = ctx.book.entries(q)
    return jsonify({"openings": items, "count": len(items), "source": ctx.book.source})


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 26 * 1024 * 1024

    # Same-origin via the Vite dev proxy; CORS limited to exact local origins.
    CORS(
        app,
        resources={r"/api/*": {"origins": ["http://127.0.0.1:5173", "http://localhost:5173"]}},
    )
    app.register_blueprint(api)

    @app.errorhandler(404)
    def _404(_):
        return error("Not found", 404, "not_found")

    @app.errorhandler(405)
    def _405(_):
        return error("Method not allowed", 405, "method_not_allowed")

    @app.errorhandler(413)
    def _413(_):
        return error("Request body too large", 413, "too_large")

    @app.errorhandler(500)
    def _500(exc):  # pragma: no cover
        logger.exception("Unhandled error")
        return error("Internal server error", 500, "internal_error")

    return app


app = create_app()


if __name__ == "__main__":
    import os

    host = os.environ.get("CHESSLAB_HOST", "127.0.0.1")
    port = int(os.environ.get("CHESSLAB_PORT", "5001"))
    ctx = get_ctx()
    status = ctx.ensure_engine()
    if status.get("available"):
        logger.info("Stockfish ready: %s (%s)", status.get("name"), status.get("path"))
    else:
        logger.warning("Stockfish unavailable: %s", status.get("error"))
    app.run(host=host, port=port, debug=False, threaded=True)
