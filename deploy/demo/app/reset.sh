#!/usr/bin/env bash
# Puts the demo back to its starting state: restores golden.dump and restarts Joplin Server and
# Joplock (which also signs every visitor out). Run by joplock-demo-reset.timer at :00 and :30 UTC.
# Visitors see the "resetting" page for the few seconds it takes.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
cd "$DEMO_DIR"
if [ ! -s golden.dump ]; then log "reset: no golden.dump yet; building it"; exec ./build-golden.sh; fi
take_lock
started=$SECONDS
# the database is replaced next, so there is nothing to shut down gracefully for
dc stop -t 2 joplock server >/dev/null
recreate_db
dc exec -T db pg_restore -U joplin -d joplin --no-owner --exit-on-error < golden.dump
dc start server joplock >/dev/null
wait_for "Joplin Server" 120 server_up
wait_for "Joplock" 180 joplock_up
wait_for "the demo login" 60 demo_login_works
log "reset: done in $((SECONDS - started))s"
