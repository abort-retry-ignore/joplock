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
// It runs at startup and periodically, because on a fresh install Joplin Server creates the account
// after Joplock may already have looked. Opt out with JOPLOCK_LOCK_DEFAULT_ADMIN=false.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DEFAULT_ADMIN_EMAIL = 'admin@localhost';
const DEFAULT_ADMIN_PASSWORD = 'admin';

const lockDefaultJoplinAdmin = async ({ database, log = () => {} }) => {
	const rows = (await database.query('SELECT id, password FROM users WHERE email = $1 LIMIT 1', [DEFAULT_ADMIN_EMAIL])).rows;
	if (!rows.length || !rows[0].password) return false;
	if (!(await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, rows[0].password))) return false;
	const hash = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 10);
	await database.query('UPDATE users SET password = $1, enabled = 0, updated_time = $2 WHERE id = $3', [hash, Date.now(), rows[0].id]);
	await database.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
	log(`[joplock] SECURITY: Joplin's default admin account ${DEFAULT_ADMIN_EMAIL} still had the default password "${DEFAULT_ADMIN_PASSWORD}". It has been locked (random password, disabled). Set JOPLOCK_LOCK_DEFAULT_ADMIN=false to opt out.`);
	return true;
};

// Starts the periodic check. Errors (e.g. the users table not there yet) are retried quietly.
const startDefaultAdminGuard = ({ database, log = () => {}, intervalMs = 10 * 60 * 1000, firstDelayMs = 2000, env = process.env } = {}) => {
	if (`${env.JOPLOCK_LOCK_DEFAULT_ADMIN || ''}`.trim().toLowerCase() === 'false') return null;
	const run = () => lockDefaultJoplinAdmin({ database, log }).catch(() => false);
	const first = setTimeout(run, firstDelayMs);
	const timer = setInterval(run, intervalMs);
	if (first.unref) first.unref();
	if (timer.unref) timer.unref();
	return { run, stop: () => { clearTimeout(first); clearInterval(timer); } };
};

module.exports = { lockDefaultJoplinAdmin, startDefaultAdminGuard, DEFAULT_ADMIN_EMAIL };
