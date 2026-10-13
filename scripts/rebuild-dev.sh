#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
	echo "Missing compose file: $COMPOSE_FILE" >&2
	exit 1
fi

# Recreating the container discards its logs, and /diag + viewport.kb device reports only live
# there: keep them in .diag-archive/ (gitignored; scripts/diag-reports.js reads it too). Best
# effort: this must never stop a rebuild.
CONTAINER="joplock-dev-joplock-1"
ARCHIVE_DIR="$ROOT_DIR/.diag-archive"
archive_reports() {
	docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER" || return 0
	mkdir -p "$ARCHIVE_DIR" || return 0
	local file
	file="$ARCHIVE_DIR/$(date +%Y%m%d-%H%M%S).log"
	docker logs -t "$CONTAINER" 2>&1 \
		| awk '/\[joplock client\] (diag\.viewport|viewport\.kb) \{$/ {p=1} p {print} p && / \}$/ {p=0}' > "$file" || true
	[[ -s "$file" ]] || rm -f "$file"
}
archive_reports || echo "[joplock] (could not archive device reports; continuing)"

echo "[joplock] Rebuilding dev app container..."
docker compose -f "$COMPOSE_FILE" build joplock
docker compose -f "$COMPOSE_FILE" up -d --no-deps joplock

echo "[joplock] Dev app container rebuilt."
