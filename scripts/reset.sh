#!/usr/bin/env bash
# Destroys all docker volumes (Qdrant, Postgres, MinIO data), deletes downloaded papers and rebuilds the environment.
# Traces and data/uploads are kept.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi
PAPERS_DIR="${PAPERS_DIR:-data/papers}"

echo "==> docker compose down -v (this deletes all indexed data)"
docker compose --profile ollama down -v --remove-orphans

if [[ -d "$PAPERS_DIR" ]]; then
  echo "==> deleting downloaded papers in $PAPERS_DIR"
  find "$PAPERS_DIR" -maxdepth 1 -type f \( -name '*.md' -o -name '*.pdf' \) -delete
fi

bash scripts/bootstrap.sh
