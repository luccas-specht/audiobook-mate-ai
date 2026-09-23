#!/usr/bin/env bash
# Sobe frontend (Vite) + Cloudflare Worker (wrangler dev) juntos, localmente.
# Ctrl+C encerra os dois.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ worker  → wrangler dev (http://localhost:8787)"
echo "▶ front   → vite        (http://localhost:5173)"
echo

# encerra todos os processos filhos ao sair
trap 'kill 0' EXIT INT TERM

# worker (cwd = worker/, encontra wrangler.toml e .dev.vars)
npm --prefix worker run dev &

# frontend (usa .env.local → VITE_WORKER_URL=http://localhost:8787)
npm run dev &

wait
