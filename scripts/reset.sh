#!/usr/bin/env bash
# Destroys all docker volumes (Qdrant, Postgres, MinIO data) and rebuilds the environment.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> docker compose down -v (this deletes all indexed data)"
docker compose --profile ollama down -v --remove-orphans
bash scripts/bootstrap.sh
