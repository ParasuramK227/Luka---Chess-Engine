# ChessLab

A fully **local, offline chess analysis workbench**. Play, analyze, and get a
game review with the real Stockfish engine — no accounts, no cloud, no
telemetry, no fabricated numbers.

| Component | Stack |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind 4, `chess.js`, `react-chessboard`, Recharts |
| Backend | Python 3 + Flask, `python-chess` |
| Engine | Stockfish 19 via UCI at `/usr/bin/stockfish` (any Stockfish 16+ binary works) |
| Storage | Local JSON + PGN files under `data/` (no database, no network) |

---

## Features

- **Board** — play/edit positions (drag-and-drop, click-to-move, promotion
  dialog), FEN import/export, history navigation, coordinates, legal-move
  dots, board flip.
- **Engine analysis** — one managed Stockfish process; depth or move-time/node
  limits; **MultiPV** (1–6 lines); live lines streamed over **SSE** with a
  polling fallback; WDL win/draw/loss percentages via `UCI_ShowWDL`; best-move
  arrow on the board; real cancellation (job system, not thread-killing).
- **Game review** — per-move engine eval at a configured depth, move
  **classification** (book / best / excellent / good / forced / inaccuracy /
  mistake / blunder / missed win / great / brilliant), **accuracy** per player,
  average/median centipawn loss, critical-moment list, opening detection.
- **Eval graph** — white eval (cp) and white win-probability series with
  clickable markers at critical moves.
- **Library** — import PGN (file or paste), search, tags, collections,
  de-duplication, per-game review status, delete. Original PGNs are **never
  silently overwritten**: imports are hashed and stored as new files; exports
  are generated artifacts.
- **Openings** — live opening-name detection from the move list plus a searchable
  explorer over a bundled dataset (names + ECO only). Optionally extend with
  `data/openings.json`. Win rates/popularity are **not** shown because no
  statistical database ships with the app.
- **Tablebases** — optional local Syzygy path (set in Settings; used by
  Stockfish when present).
- **Tactics** — not a separate mode; the position analyzer and review surface
  mates (`M#`) and missed wins directly.
- **Reports & exports** — annotated PGN (comments + NAGs), HTML report, CSV of
  per-move metrics, JSON review dump. Written under `data/reports/`.
- **Settings** — engine threads/hash/path/MultiPV/WDL, review depth & caps,
  classification thresholds, board prefs, eval-cache clearing — all persisted
  in `data/settings.json`.

## Accuracy model (documented caveat)

Accuracy is computed per move from **win-probability loss**:

```
wp  = 1 / (1 + exp(-k · cp))          # k = 0.00368208 (settings.accuracy.cp_scale)
Δwp = wp(before move) - wp(after move)   # for the side to move
accuracy  = 100 · (1 - Δwp)^1.5
```

- Mate scores are handled separately (mate → huge cp offset, ±(100000−n)).
- This is an approximation and is **not** an exact match for Chess.com or
  Lichess accuracy numbers. It is documented in the Settings tab.
- A forced mate *missed* in the game can still yield a mid-30s accuracy —
  this follows directly from the documented formula.

## Architecture

```
Browser (React SPA)
   │  /api  (Vite dev proxy → http://127.0.0.1:5001)
   ▼
Flask app (backend/app.py)  — all endpoints under /api/v1
   │
   ├─ Job manager  — bounded thread pool, SSE + polling, cancel, live data
   ├─ Stockfish manager — ONE persistent engine process, config applied at start
   ├─ Analysis service — analyse_fen (MultiPV), game review pipeline
   ├─ Eval cache — keyed by (fen, depth, multipv, engine id, options)
   ├─ Storage — PGN parse/export, library (JSON index + PGN files), reports
   └─ Opening book — bundled dataset + optional data/openings.json
```

- Engines run under **UCI** via `python-chess`; limits are depth / movetime /
  nodes. **MultiPV is managed with python-chess's `multipv=` param** (never a
  raw UCI `MultiPV` option, which leaks across commands).
- Scores are normalized to **white-POV** (`pov_cp`) — mate and cp are handled as
  distinct types end-to-end.
- The backend binds **127.0.0.1** by default; paths are validated against the
  data directory (no path traversal); engine paths are passed as argument
  arrays (no shell interpolation).
- An engine crash never takes the app down: jobs fail gracefully, the engine
  is restarted, and the UI stays usable (analysis disabled with a clear
  message until the engine returns).

## Setup

Prerequisites: Python 3.10+, Node 20+, and a Stockfish binary at
`/usr/bin/stockfish` (or symlinked there; any Stockfish 16+ works).

```bash
# 1. Backend
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# 2. Frontend
cd frontend && npm install && cd ..

# 3. One-command dev
./scripts/start_dev.sh        # backend :5001 + frontend :5173
```

Production build (served statically — serve `frontend/dist` behind the same
proxy):

```bash
cd frontend && npm run build
```

Data lives in `data/` (configurable at startup via environment — see
`backend/config.py`):

```
data/
  settings.json        # persisted user settings
  library.json         # library index (game metadata, tags, analysis status)
  games/<id>.pgn       # imported games (never overwritten)
  reports/             # exported reports / annotated PGNs / CSV / JSON
  positions/           # persisted per-position cache snapshots
  eval_cache.json      # engine-eval cache
  openings.json        # optional custom opening dataset
```

## API (all under `/api/v1`)

- `GET /health`, `GET /engine/status`, `POST /engine/restart`, `POST /engine/configure`
- `POST /fen/validate`, `POST /legal-moves`
- `POST /jobs/analyze` · `POST /jobs/review` · `GET /jobs/<id>` ·
  `GET /jobs/<id>/result` · `POST /jobs/<id>/cancel` ·
  `GET /jobs/<id>/events` (SSE) · `GET /jobs`
- `POST /pgn/parse`, `POST /pgn/export`
- `GET/POST/DELETE /library…` (list, get, delete, import, tags, collections)
- `GET /library/<id>/review` · `GET /library/<id>/report/<html|pgn|csv|json>`
- `GET /settings`, `PUT /settings`
- `POST /openings/lookup`, `POST /openings/list`
- `POST /cache/clear`, `GET /files/list`

## Testing

```bash
# Backend: 50 tests — unit tests use a deterministic fake UCI engine;
#          the integration suite verifies a real Stockfish 19 end-to-end.
./backend/.venv/bin/python -m pytest backend/tests -q

# Frontend: 28 tests (Vitest + Testing Library) — format helpers, board state,
#           move table, and full-App smoke rendering against a mocked API.
cd frontend && npm test
```

## Known limitations

- **Accuracy parity** — ChessLab does not claim percentage-identical results to
  Chess.com/Lichess; the model is documented, deterministic, and reproducible.
- **Opening stats** — no win rates/popularity: those need a statistical game
  database which is not bundled (add `data/openings.json` to extend names/ECO
  only).
- **Tatics coach** — no supervised puzzle trainer; tactics appear inside
  analysis/review (mate scores, missed wins, blunder identification).
- **Multi-variation PGNs** — imports keep the main line; variations/NALs are
  noted but not rendered as movable lines.
- **Long games** — review is capped by `review.max_positions` (default 600) to
  bound runtime on modest hardware.
- **Memory-tight hosts** — engine defaults are conservative (Threads=2,
  Hash=64 MB) because some target machines run with very little free RAM.
- **Sounds** — move sounds use the Web Audio API (Chrome/Edge/Firefox;
  Safari has a user-gesture quirk).

## Repository layout

```
backend/        Flask API + analysis + engine manager + storage + tests
frontend/       React SPA + tests
samples/        sample.pgn (Opera Game + a casual game)
scripts/        start_dev.sh
examples/       generated example report + annotated PGN
data/           runtime data (gitignored)
```