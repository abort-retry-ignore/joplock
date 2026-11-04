'use strict';

// Joplin Server creates an administrator "admin@localhost" with the password "admin" on first start
// and expects it to be changed. When it is not, anyone who can reach the server (or Joplock's login,
// which signs in through it) becomes a Joplin admin: they can reset any user's password and so read
// every note. It is easy to miss, because nothing in Joplock's own UI ever shows that account.
//
// This guard looks for that account while it still has the default password and locks it: a long
// random password nobody knows, disabled, and its sessions removed. It only ever touches that one
// account, and only while its password is literally "admin"; it never changes a password someone
// chose. A Joplin admin can re-enable it (set a password in Joplin Server's admin pages).
// On a fresh install Joplin Server creates the account after Joplock has started, so the guard checks
// every 15 seconds until the account exists, then every 10 minutes. Checking only every 10 minutes from
// the start let the default login work for those first minutes and then locked it under whoever had
// signed in with it. Opt out with JOPLOCK_LOCK_DEFAULT_ADMIN=false.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DEFAULT_ADMIN_EMAIL = 'admin@localhost';
const DEFAULT_ADMIN_PASSWORD = 'admin';

// 'absent': Joplin Server has not created the account (yet). 'safe': it has a password someone chose.
// 'locked': it still had the default password and has just been locked.
const checkDefaultJoplinAdmin = async ({ database, log = () => {} }) => {
	const rows = (await database.query('SELECT id, password FROM users WHERE email = $1 LIMIT 1', [DEFAULT_ADMIN_EMAIL])).rows;
	if (!rows.length || !rows[0].password) return 'absent';
	if (!(await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, rows[0].password))) return 'safe';
	const hash = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 10);
	await database.query('UPDATE users SET password = $1, enabled = 0, updated_time = $2 WHERE id = $3', [hash, Date.now(), rows[0].id]);
	await database.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
	log(`[joplock] SECURITY: Joplin's default admin account ${DEFAULT_ADMIN_EMAIL} still had the default password "${DEFAULT_ADMIN_PASSWORD}". It has been locked (random password, disabled). Set JOPLOCK_LOCK_DEFAULT_ADMIN=false to opt out.`);
	return 'locked';
};

const lockDefaultJoplinAdmin = async options => (await checkDefaultJoplinAdmin(options)) === 'locked';

// Starts the checks. Until the account exists (or while the database is not ready) they run every
// pendingDelayMs, for at most pendingForMs after startup; after that every intervalMs.
const startDefaultAdminGuard = ({
	database, log = () => {}, env = process.env,
	firstDelayMs = 2000, pendingDelayMs = 15 * 1000, pendingForMs = 30 * 60 * 1000, intervalMs = 10 * 60 * 1000,
	now = Date.now, timers = { setTimeout, clearTimeout },
} = {}) => {
	if (`${env.JOPLOCK_LOCK_DEFAULT_ADMIN || ''}`.trim().toLowerCase() === 'false') return null;
	const startedAt = now();
	let timer = null;
	let stopped = false;
	const run = () => checkDefaultJoplinAdmin({ database, log }).catch(() => 'absent');
	const schedule = delay => {
		if (stopped) return;
		timer = timers.setTimeout(async () => {
			const status = await run();
			schedule(status === 'absent' && now() - startedAt < pendingForMs ? pendingDelayMs : intervalMs);
		}, delay);
		if (timer.unref) timer.unref();
	};
	schedule(firstDelayMs);
	return { run: async () => (await run()) === 'locked', stop: () => { stopped = true; timers.clearTimeout(timer); } };
};

module.exports = { checkDefaultJoplinAdmin, lockDefaultJoplinAdmin, startDefaultAdminGuard, DEFAULT_ADMIN_EMAIL };
