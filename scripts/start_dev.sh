#!/usr/bin/env bash
# Luka - Chess Engine development launcher.
#
# Starts the local Flask backend (127.0.0.1:5001) and the Vite dev server
# (http://localhost:5173) with an /api proxy to the backend.
#
# Usage:  ./scripts/start_dev.sh
# Stop:   Ctrl-C stops both processes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENV_PY="$ROOT/backend/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "Creating backend virtualenv…"
  python3 -m venv backend/.venv
  "$VENV_PY" -m pip install --upgrade pip >/dev/null
  "$VENV_PY" -m pip install -r backend/requirements.txt
fi

if [[ ! -x /usr/bin/stockfish ]]; then
  echo "WARNING: /usr/bin/stockfish was not found — analysis will be disabled." >&2
  echo "         Install Stockfish 16+ and symlink it to /usr/bin/stockfish." >&2
fi

echo "Starting backend on http://127.0.0.1:5001 …"
"$VENV_PY" -m backend.app &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true; kill 0 2>/dev/null || true' EXIT INT TERM

sleep 1
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "Backend failed to start — see output above." >&2
  exit 1
fi

echo "Starting frontend on http://localhost:5173 …"
cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then
  echo "Installing frontend dependencies (first run)…"
  npm install
fi
npm run dev