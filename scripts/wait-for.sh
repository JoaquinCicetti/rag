#!/usr/bin/env bash
# Poll a URL until it returns HTTP 2xx. Usage: wait-for.sh <url> [timeout_seconds]
set -euo pipefail
url="${1:?url required}"
timeout="${2:-60}"
start=$(date +%s)
until curl -sf -o /dev/null "$url"; do
  if (( $(date +%s) - start > timeout )); then
    echo "timeout waiting for $url" >&2
    exit 1
  fi
  sleep 1
done
echo "ready: $url"
