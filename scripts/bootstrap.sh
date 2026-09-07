#!/usr/bin/env bash
# One-shot, idempotent environment bootstrap:
#   deps check -> .env -> docker compose up -> wait healthy -> pull models -> ensure Qdrant collection
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 1; }; }
need bun; need docker; need curl

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi
set -a; source .env; set +a

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"
EMBED_MODEL="${EMBED_MODEL:-bge-m3}"
LLM_MODEL="${LLM_MODEL:-llama3.1}"

echo "==> bun install"
bun install --silent

echo "==> docker compose up"
if [[ "${USE_DOCKER_OLLAMA:-0}" == "1" ]]; then
  docker compose --profile ollama up -d
else
  docker compose up -d
fi

echo "==> waiting for services"
bash scripts/wait-for.sh "$QDRANT_URL/readyz" 90
bash scripts/wait-for.sh "http://127.0.0.1:9000/minio/health/live" 90
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-rag}" -d "${POSTGRES_DB:-rag}" >/dev/null 2>&1; do sleep 1; done
echo "ready: postgres"

echo "==> checking ollama at $OLLAMA_URL"
if ! curl -sf "$OLLAMA_URL/api/tags" >/dev/null; then
  echo "ollama not reachable at $OLLAMA_URL." >&2
  echo "install it (https://ollama.com) or run: USE_DOCKER_OLLAMA=1 bun run bootstrap" >&2
  exit 1
fi

pull_model() {
  local model="$1"
  if curl -sf "$OLLAMA_URL/api/tags" | grep -q "\"name\":\"$model"; then
    echo "model present: $model"
  else
    echo "pulling model: $model"
    curl -sf "$OLLAMA_URL/api/pull" -d "{\"name\":\"$model\",\"stream\":false}" >/dev/null
    echo "pulled: $model"
  fi
}
pull_model "$EMBED_MODEL"
pull_model "$LLM_MODEL"

echo "==> ensuring qdrant collection"
bun src/cli/setup.ts

echo
echo "bootstrap complete."
echo "  ingest samples:  bun run ingest data/samples"
echo "  ask a question:  bun run ask \"¿Qué es un chunk?\""
echo "  start the API:   bun run dev"
