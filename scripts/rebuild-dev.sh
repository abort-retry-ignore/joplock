#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
	echo "Missing compose file: $COMPOSE_FILE" >&2
	exit 1
fi

echo "[joplock] Rebuilding dev app container..."
docker compose -f "$COMPOSE_FILE" build joplock
docker compose -f "$COMPOSE_FILE" up -d --no-deps joplock

echo "[joplock] Dev app container rebuilt."
