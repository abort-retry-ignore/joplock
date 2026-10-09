#!/usr/bin/env bash
# Installs the real Joplin terminal client (headless) for the opt-in compatibility
# tests in integration-tests/. It lives OUTSIDE the repo (default ~/.cache) so it
# never lands in node_modules or the Docker image.
#
#   npm run setup:joplin-cli
#   JOPLIN_CLI_DIR=/some/dir JOPLIN_CLI_VERSION=3.7.1 npm run setup:joplin-cli
set -euo pipefail

DIR="${JOPLIN_CLI_DIR:-$HOME/.cache/joplock-joplin-cli}"
VERSION="${JOPLIN_CLI_VERSION:-3.7.1}"

mkdir -p "$DIR"
cd "$DIR"
[ -f package.json ] || npm init -y >/dev/null
npm install "joplin@$VERSION" --no-audit --no-fund

# npm skips install scripts for transitive dependencies, so the CLI's sqlite3
# native binding has to be fetched explicitly (prebuilt download, source-build fallback).
if [ ! -d node_modules/sqlite3/lib/binding ]; then
	( cd node_modules/sqlite3 && node ../@mapbox/node-pre-gyp/bin/node-pre-gyp install --fallback-to-build )
fi

PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
./node_modules/.bin/joplin --profile "$PROFILE" version >/dev/null
echo "Joplin CLI $VERSION ready in $DIR"
