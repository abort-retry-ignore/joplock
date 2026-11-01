# Shared helpers for build-golden.sh and reset.sh (sourced, not run).
DEMO_DIR="${DEMO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
LOCK_FILE="${LOCK_FILE:-/run/lock/joplock-demo.lock}"

# compose.override.yml (not in git) is only for running the stack somewhere else, e.g. local testing
dc() {
	local files=(-f "$DEMO_DIR/compose.yml")
	[ -f "$DEMO_DIR/compose.override.yml" ] && files+=(-f "$DEMO_DIR/compose.override.yml")
	docker compose --project-directory "$DEMO_DIR" "${files[@]}" --env-file "$DEMO_DIR/.env" "$@"
}
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
env_value() { sed -n "s/^$1=//p" "$DEMO_DIR/.env" | tail -1; }

# one reset/build at a time (the timer and a deploy can overlap)
# A reset skips when another reset or a build holds the lock (the next one is 30 minutes away). A build
# waits its turn instead: skipping would let a deploy report success while the old snapshot stays.
take_lock() { # take_lock [wait]
	exec 9>"$LOCK_FILE"
	if [ "${1:-}" = wait ]; then
		flock -w 300 9 || { log "timed out waiting for the lock"; exit 1; }
	elif ! flock -n 9; then
		log "another reset or build is running; skipping"; exit 0
	fi
}

wait_for() { # wait_for <description> <timeout seconds> <command...>
	local what=$1 timeout=$2 start=$SECONDS
	shift 2
	until "$@" >/dev/null 2>&1; do
		if (( SECONDS - start > timeout )); then log "timed out after ${timeout}s waiting for $what"; return 1; fi
		sleep 2
	done
}

sql() { dc exec -T db psql -U joplin -d joplin -At -v ON_ERROR_STOP=1 -c "$1"; }
db_ready() { dc exec -T db pg_isready -U joplin -d postgres; }
# Joplin's first start is done (migrations run) once it has created its default admin row.
server_initialised() { [ "$(sql "select count(*) from users where email = 'admin@localhost'" 2>/dev/null)" = 1 ]; }
# Joplin Server only answers requests whose Host matches APP_BASE_URL.
server_up() {
	dc exec -T server node -e "require('http').get({host:'127.0.0.1',port:22300,path:'/api/ping',headers:{Host:process.argv[1]}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" "$(env_value DEMO_HOSTNAME)"
}
# The whole path a visitor takes: Joplock maps demo/demo and signs in through Joplin Server.
demo_login_works() {
	dc exec -T joplock node -e "fetch('http://127.0.0.1:3001/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'email=demo&password=demo'}).then(r=>process.exit(r.status===302&&r.headers.get('location')==='/'&&/sessionId=[^;]+/.test(r.headers.get('set-cookie')||'')?0:1),()=>process.exit(1))"
}
joplock_up() { dc exec -T joplock node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; }
recreate_db() {
	dc exec -T db psql -U joplin -d postgres -v ON_ERROR_STOP=1 \
		-c 'DROP DATABASE IF EXISTS joplin WITH (FORCE)' \
		-c 'CREATE DATABASE joplin OWNER joplin' >/dev/null
}
