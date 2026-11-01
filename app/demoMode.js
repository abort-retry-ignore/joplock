'use strict';

// Demo mode (JOPLOCK_DEMO_MODE=true): a public demo with one shared, throw-away account.
// See docs/agents/demo.md for the deployment (deploy/demo/) and why each guard exists.
//
// - Visitors sign in with a short, published login (default demo / demo). Joplock maps it to the
//   real Joplin account (JOPLOCK_DEMO_ACCOUNT_EMAIL / _PASSWORD, a long secret), so the published
//   password is never a Joplin password, and no other account can sign in through this server.
// - Anything that would let one visitor lock out or harm the next is refused on the server:
//   changing the account (password, email/name, two-factor, session timeout), AI (provider URLs are
//   user-set, so the server would fetch arbitrary addresses, and typed keys would be shown to the
//   next visitor), and sharing.
// - The demo account's password is set back to the configured one on every start, so even a
//   change made some other way does not survive a restart (the deployment restarts every reset).

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const truthy = value => value === 'true' || value === '1';
const positiveInt = (value, fallback) => {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : fallback;
};

const readDemoConfig = (env = process.env, normalize = value => value) => {
	const enabled = truthy(`${env.JOPLOCK_DEMO_MODE || ''}`.trim());
	const config = {
		enabled,
		login: `${normalize(env.JOPLOCK_DEMO_LOGIN || 'demo')}`.trim().toLowerCase(),
		loginPassword: `${normalize(env.JOPLOCK_DEMO_LOGIN_PASSWORD || 'demo')}`,
		accountEmail: `${normalize(env.JOPLOCK_DEMO_ACCOUNT_EMAIL || '')}`.trim().toLowerCase(),
		accountPassword: `${normalize(env.JOPLOCK_DEMO_ACCOUNT_PASSWORD || '')}`,
		resetMinutes: positiveInt(env.JOPLOCK_DEMO_RESET_MINUTES, 30),
		maxUploadMb: positiveInt(env.JOPLOCK_DEMO_MAX_UPLOAD_MB, 5),
	};
	if (enabled) {
		if (!config.login || !config.loginPassword) throw new Error('JOPLOCK_DEMO_LOGIN and JOPLOCK_DEMO_LOGIN_PASSWORD must not be empty');
		if (!/^[^@\s]+@[^@\s]+$/.test(config.accountEmail)) throw new Error('JOPLOCK_DEMO_MODE needs JOPLOCK_DEMO_ACCOUNT_EMAIL (the real Joplin account)');
		if (config.accountPassword.length < 16) throw new Error('JOPLOCK_DEMO_ACCOUNT_PASSWORD must be at least 16 characters (visitors never type it)');
		if (config.accountPassword === config.loginPassword) throw new Error('JOPLOCK_DEMO_ACCOUNT_PASSWORD must differ from the published demo password');
	}
	return config;
};

// What a visitor typed -> the real Joplin credentials, or null when it is not the demo login.
const demoCredentials = (config, typedLogin, typedPassword) => {
	if (!config || !config.enabled) return null;
	if (`${typedLogin || ''}`.trim().toLowerCase() !== config.login) return null;
	if (`${typedPassword || ''}` !== config.loginPassword) return null;
	return { email: config.accountEmail, password: config.accountPassword };
};

// Requests demo mode refuses, and why (shown to the visitor). null = allowed.
const DEMO_REFUSALS = {
	account: 'Account settings are fixed in the demo.',
	ai: 'AI features are turned off in the demo.',
	sharing: 'Sharing is turned off in the demo.',
};
const demoRefusal = (pathname, method) => {
	const m = `${method || 'GET'}`.toUpperCase();
	if (m === 'POST' && (pathname === '/settings/password' || pathname === '/settings/profile'
		|| pathname === '/settings/security' || pathname.startsWith('/settings/mfa/'))) return { kind: 'account', message: DEMO_REFUSALS.account, tab: pathname === '/settings/profile' ? 'profile' : 'security' };
	if (pathname.startsWith('/api/web/ai/')) return { kind: 'ai', message: DEMO_REFUSALS.ai };
	if (pathname === '/api/web/users/search') return { kind: 'sharing', message: DEMO_REFUSALS.sharing };
	if ((pathname === '/api/web/shares' || pathname.startsWith('/api/web/shares/')) && m !== 'GET') return { kind: 'sharing', message: DEMO_REFUSALS.sharing };
	if (pathname.startsWith('/fragments/shares/') && m !== 'GET') return { kind: 'sharing', message: DEMO_REFUSALS.sharing };
	return null;
};

// Settings the demo account may not store: AI provider keys and profiles would be shown to the next
// visitor, and are unusable anyway.
const DEMO_BLOCKED_SETTINGS = ['aiProfiles', 'openRouterApiKey', 'openRouterModel'];

const demoUploadCapBytes = config => (config && config.enabled ? config.maxUploadMb * 1024 * 1024 : Infinity);

// Creates the demo Joplin user if it is missing and puts its password, enabled flag and role back.
// Same direct-insert approach as adminService.ensureAdminUser (Joplin Server is unmodified).
const ensureDemoAccount = async ({ database, config, log = () => {}, retryMs = 5000, timeoutMs = 180000 }) => {
	if (!config || !config.enabled) return null;
	const deadline = Date.now() + timeoutMs;
	let rows;
	for (;;) {
		try {
			rows = (await database.query('SELECT id, password, enabled, is_admin FROM users WHERE email = $1 LIMIT 1', [config.accountEmail])).rows;
			break;
		} catch (error) {
			if (Date.now() + retryMs > deadline) throw new Error(`demo account: users table not ready after ${timeoutMs / 1000}s (${error.message})`);
			await new Promise(resolve => setTimeout(resolve, retryMs));
		}
	}
	const now = Date.now();
	if (!rows.length) {
		const id = crypto.randomBytes(16).toString('hex');
		const hash = await bcrypt.hash(config.accountPassword, 10);
		await database.query(`
			INSERT INTO users (id, email, password, full_name, is_admin, enabled, email_confirmed, created_time, updated_time, must_set_password, account_type, max_item_size, can_share_folder, can_share_note, max_total_item_size)
			VALUES ($1, $2, $3, $4, 0, 1, 1, $5, $5, 0, 0, 0, 0, 0, 0)
		`, [id, config.accountEmail, hash, 'Demo', now]);
		log(`[joplock] demo: created the demo account ${config.accountEmail}`);
		return { id, created: true, repaired: false };
	}
	const row = rows[0];
	const passwordOk = await bcrypt.compare(config.accountPassword, row.password || '');
	if (passwordOk && Number(row.enabled) === 1 && Number(row.is_admin) === 0) return { id: row.id, created: false, repaired: false };
	const hash = passwordOk ? row.password : await bcrypt.hash(config.accountPassword, 10);
	await database.query('UPDATE users SET password = $1, enabled = 1, is_admin = 0, updated_time = $2 WHERE id = $3', [hash, now, row.id]);
	log(`[joplock] demo: restored the demo account's password/role`);
	return { id: row.id, created: false, repaired: true };
};

module.exports = {
	readDemoConfig,
	demoCredentials,
	demoRefusal,
	DEMO_REFUSALS,
	DEMO_BLOCKED_SETTINGS,
	demoUploadCapBytes,
	ensureDemoAccount,
};
