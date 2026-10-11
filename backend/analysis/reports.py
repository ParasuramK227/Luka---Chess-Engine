"""Human- and machine-readable report generation (no external assets)."""

from __future__ import annotations

import csv
import html
import io
import json

from ..storage.pgn_service import game_to_annotated_pgn


def review_to_json(review: dict) -> str:
    return json.dumps(review, indent=2, sort_keys=False)


def review_to_csv(review: dict) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "ply",
            "move_number",
            "mover",
            "san",
            "category",
            "cp_loss",
            "delta_wp",
            "accuracy",
            "eval_before",
            "eval_after",
            "best_move",
            "reason",
        ]
    )
    for m in review.get("moves", []):
        metrics = m.get("metrics", {})
        writer.writerow(
            [
                m.get("ply"),
                m.get("move_number"),
                m.get("mover"),
                m.get("san"),
                m.get("category"),
                metrics.get("cp_loss"),
                metrics.get("delta_wp"),
                metrics.get("accuracy"),
                _eval_text(m.get("eval_before")),
                _eval_text(m.get("eval_after")),
                m.get("best_move_san") or m.get("best_move_uci") or "",
                (m.get("reason") or {}).get("rule", ""),
            ]
        )
    return buf.getvalue()


def review_to_annotated_pgn(review: dict) -> str:
    game = review.get("game") or {}
    annot = review.get("annotations") or []
    pgn_game = {
        "headers": game.get("headers") or {},
        "result": game.get("result", "*"),
        "start_fen": game.get("start_fen"),
        "moves": [{"san": m["san"], "uci": m["uci"]} for m in game.get("moves", [])],
    }
    return game_to_annotated_pgn(pgn_game, annot)


def _eval_text(evaluation: dict | None) -> str:
    if not evaluation:
        return ""
    if evaluation.get("type") == "mate":
        return f"M{evaluation.get('mate')}"
    cp = evaluation.get("cp")
    return f"{cp / 100:+.2f}" if cp is not None else ""


def review_to_html(review: dict) -> str:
    game = review.get("game") or {}
    headers = game.get("headers") or {}
    summary = review.get("summary") or {}
    analysis = review.get("analysis") or {}

    white = summary.get("white") or {}
    black = summary.get("black") or {}
    opening = summary.get("opening") or {}

    def esc(value) -> str:
        return html.escape(str(value if value is not None else ""))

    rows = []
    for m in review.get("moves", []):
        metrics = m.get("metrics", {})
        reason = (m.get("reason") or {}).get("rule", "")
        rows.append(
            "<tr class='cat-{cat}'>"
            "<td>{ply}</td><td>{num}{dots}</td><td>{san}</td>"
            "<td>{label}</td><td>{loss}</td><td>{acc}</td>"
            "<td>{before}</td><td>{after}</td><td>{best}</td><td class='reason'>{reason}</td>"
            "</tr>".format(
                cat=esc(m.get("category")),
                ply=esc(m.get("ply")),
                num=esc(m.get("move_number")),
                dots="..." if m.get("mover") == "black" else ".",
                san=esc(m.get("san")),
                label=esc(m.get("category_label")),
                loss=esc(metrics.get("cp_loss") if metrics.get("applicable") else ""),
                acc=esc(metrics.get("accuracy") if metrics.get("applicable") else ""),
                before=esc(_eval_text(m.get("eval_before"))),
                after=esc(_eval_text(m.get("eval_after"))),
                best=esc(m.get("best_move_san") or m.get("best_move_uci") or ""),
                reason=esc(reason),
            )
        )

    critical = summary.get("critical_moments") or []
    critical_rows = "".join(
        f"<li>Move {esc(c.get('move_number'))}{'...' if c.get('mover')=='black' else '.'} "
        f"{esc(c.get('san'))} ({esc(c.get('category'))}) — cp loss {esc(c.get('cp_loss'))}, "
        f"win-prob swing {esc(c.get('delta_wp'))}</li>"
        for c in critical
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChessLab report — {esc(headers.get('White','?'))} vs {esc(headers.get('Black','?'))}</title>
<style>
  :root {{ --bg:#f5f6f7; --panel:#1f2429; --line:#d6dade; --accent:#5aa469; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background:var(--bg); color:#1a1d20; }}
  header {{ background:var(--panel); color:#f2f4f6; padding:20px 28px; }}
  header h1 {{ margin:0 0 4px; font-size:20px; }}
  header .sub {{ color:#a9b1b8; font-size:13px; }}
  main {{ padding:20px 28px 60px; max-width:1100px; margin:0 auto; }}
  .cards {{ display:flex; gap:16px; flex-wrap:wrap; margin-bottom:24px; }}
  .card {{ background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 18px; min-width:200px; }}
  .card h2 {{ margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:#66707a; }}
  .big {{ font-size:26px; font-weight:600; }}
  table {{ border-collapse:collapse; width:100%; background:#fff; font-size:13px; }}
  th, td {{ border-bottom:1px solid var(--line); padding:6px 8px; text-align:left; }}
  th {{ background:#eceff1; font-size:12px; text-transform:uppercase; letter-spacing:.03em; color:#546069; }}
  td.reason {{ color:#5a646d; font-size:12px; }}
  tr.cat-blunder {{ background:#fdecea; }}
  tr.cat-mistake {{ background:#fef3e2; }}
  tr.cat-inaccuracy {{ background:#fffbe6; }}
  tr.cat-best {{ background:#eef7f0; }}
  tr.cat-brilliant {{ background:#e6f5ee; }}
  .note {{ color:#66707a; font-size:12px; }}
  ul {{ padding-left:18px; }}
</style>
</head>
<body>
<header>
  <h1>{esc(headers.get('White','White'))} vs {esc(headers.get('Black','Black'))}</h1>
  <div class="sub">{esc(headers.get('Event',''))} {esc(headers.get('Date',''))} — result {esc(game.get('result','*'))}</div>
</header>
<main>
  <div class="cards">
    <div class="card"><h2>White accuracy</h2><div class="big">{esc(white.get('accuracy'))}</div>
      <div class="note">avg cp loss {esc(white.get('average_cp_loss'))}</div></div>
    <div class="card"><h2>Black accuracy</h2><div class="big">{esc(black.get('accuracy'))}</div>
      <div class="note">avg cp loss {esc(black.get('average_cp_loss'))}</div></div>
    <div class="card"><h2>Opening</h2><div class="big" style="font-size:16px">{esc(opening.get('name') or '—')}</div>
      <div class="note">{esc(opening.get('eco') or '')}</div></div>
    <div class="card"><h2>Engine</h2><div class="big" style="font-size:16px">{esc(analysis.get('engine') or '—')}</div>
      <div class="note">depth {esc(analysis.get('depth'))}, MultiPV {esc(analysis.get('multipv'))}</div></div>
  </div>

  <p class="note">{esc((summary.get('accuracy_method') or {}).get('note',''))}</p>

  <h2>Critical moments</h2>
  <ul>{critical_rows or '<li>None identified.</li>'}</ul>

  <h2>Move analysis</h2>
  <table>
    <thead><tr><th>Ply</th><th>Move</th><th>SAN</th><th>Class</th><th>cp loss</th>
      <th>Accuracy</th><th>Before</th><th>After</th><th>Best</th><th>Reason</th></tr></thead>
    <tbody>{''.join(rows) or '<tr><td colspan="10">No moves.</td></tr>'}</tbody>
  </table>
</main>
</body>
</html>
"""
