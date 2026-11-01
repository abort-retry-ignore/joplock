#!/usr/bin/env bash
# Builds golden.dump: a fresh database holding only the demo account and the example notes.
# install.sh runs it on every deploy (new images may change the schema); reset.sh restores it.
# Visitors see the "resetting" page while it runs (a minute or two).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
take_lock
cd "$DEMO_DIR"
started=$SECONDS
host=$(env_value DEMO_HOSTNAME)
demo_email="demo@${host}"

log "golden: fresh database"
dc up -d db
wait_for "postgres" 120 db_ready
dc stop -t 2 joplock server >/dev/null
recreate_db

log "golden: Joplin Server migrations"
dc up -d server
# Joplin creates its default admin@localhost at the end of its first start; Joplock (started next) locks it
wait_for "Joplin Server first start" 300 server_initialised
wait_for "Joplin Server" 120 server_up

log "golden: Joplock (creates the demo account, locks the default admin)"
dc up -d joplock caddy
wait_for "Joplock" 180 joplock_up
wait_for "the demo account" 120 bash -c "[ \"\$(. '$DEMO_DIR/lib.sh'; sql \"select count(*) from users where email = '$demo_email' and enabled = 1 and is_admin = 0\")\" = 1 ]"
wait_for "the default admin to be locked" 120 bash -c "[ \"\$(. '$DEMO_DIR/lib.sh'; sql \"select count(*) from users where email = 'admin@localhost' and enabled = 1\")\" = 0 ]"

log "golden: example notes"
docker run --rm --network joplock-demo_default \
	-v "$DEMO_DIR/seed:/seed:ro" \
	-e JOPLOCK_SEED_LOGIN=demo -e JOPLOCK_SEED_PASSWORD=demo \
	node:20-alpine node /seed/seed-demo.mjs --base http://joplock:3001 --banner /seed/mountain-lake.jpg

# never ship a snapshot in which the default admin could sign in, or with a second admin
admins=$(sql "select count(*) from users where is_admin = 1 and enabled = 1")
if [ "$admins" != 0 ]; then log "golden: refusing to save: $admins enabled admin account(s)"; exit 1; fi

log "golden: saving the snapshot"
dc stop -t 2 joplock server >/dev/null
dc exec -T db pg_dump -U joplin -Fc joplin > golden.dump.tmp
mv golden.dump.tmp golden.dump
dc start server joplock >/dev/null
wait_for "Joplin Server" 120 server_up
wait_for "Joplock" 180 joplock_up
wait_for "the demo login" 60 demo_login_works
log "golden: done in $((SECONDS - started))s ($(du -h golden.dump | cut -f1))"
