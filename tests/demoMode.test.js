'use strict';

// Demo mode (app/demoMode.js) and the default-admin guard (app/defaultAdminGuard.js): the config,
// the published-login mapping, every refusal through the real server, and the DB helpers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const bcrypt = require('bcryptjs');

const { readDemoConfig, demoCredentials, demoRefusal, DEMO_BLOCKED_SETTINGS, demoUploadCapBytes, ensureDemoAccount } = require('../app/demoMode');
const { lockDefaultJoplinAdmin, startDefaultAdminGuard } = require('../app/defaultAdminGuard');
const { createServer } = require('../app/createServer');

const SECRET = 'a-long-random-demo-account-secret';
const DEMO_ENV = { JOPLOCK_DEMO_MODE: 'true', JOPLOCK_DEMO_ACCOUNT_EMAIL: 'Demo@Joplock.Example', JOPLOCK_DEMO_ACCOUNT_PASSWORD: SECRET };

// ---------------------------------------------------------------------------------------------
// config and mapping

test('demo mode is off unless asked for, and needs a real account when on', () => {
	assert.equal(readDemoConfig({}).enabled, false);
	const config = readDemoConfig(DEMO_ENV);
	assert.deepEqual(
		{ enabled: config.enabled, login: config.login, loginPassword: config.loginPassword, accountEmail: config.accountEmail, resetMinutes: config.resetMinutes, maxUploadMb: config.maxUploadMb },
		{ enabled: true, login: 'demo', loginPassword: 'demo', accountEmail: 'demo@joplock.example', resetMinutes: 30, maxUploadMb: 5 },
	);
	assert.throws(() => readDemoConfig({ JOPLOCK_DEMO_MODE: 'true', JOPLOCK_DEMO_ACCOUNT_PASSWORD: SECRET }), /ACCOUNT_EMAIL/);
	assert.throws(() => readDemoConfig({ ...DEMO_ENV, JOPLOCK_DEMO_ACCOUNT_PASSWORD: 'short' }), /at least 16/);
	assert.throws(() => readDemoConfig({ ...DEMO_ENV, JOPLOCK_DEMO_LOGIN_PASSWORD: SECRET }), /differ/);
	assert.equal(readDemoConfig({ ...DEMO_ENV, JOPLOCK_DEMO_RESET_MINUTES: '15', JOPLOCK_DEMO_MAX_UPLOAD_MB: 'x' }).resetMinutes, 15);
	assert.equal(readDemoConfig({ ...DEMO_ENV, JOPLOCK_DEMO_MAX_UPLOAD_MB: 'x' }).maxUploadMb, 5);
});

test('only the published demo login maps to the real account', () => {
	const config = readDemoConfig(DEMO_ENV);
	assert.deepEqual(demoCredentials(config, 'demo', 'demo'), { email: 'demo@joplock.example', password: SECRET });
	assert.deepEqual(demoCredentials(config, '  DEMO ', 'demo'), { email: 'demo@joplock.example', password: SECRET });
	assert.equal(demoCredentials(config, 'demo', 'Demo'), null, 'password is exact');
	assert.equal(demoCredentials(config, 'demo@joplock.example', SECRET), null, 'the real credentials are not a way in');
	assert.equal(demoCredentials(config, 'admin@localhost', 'admin'), null);
	assert.equal(demoCredentials(readDemoConfig({}), 'demo', 'demo'), null, 'demo mode off');
});

test('the refusal list covers account changes, AI and sharing, and nothing else', () => {
	const refused = [
		['POST', '/settings/password'], ['POST', '/settings/profile'], ['POST', '/settings/security'],
		['POST', '/settings/mfa/setup'], ['POST', '/settings/mfa/verify'], ['POST', '/settings/mfa/disable'],
		['POST', '/api/web/ai/prose-complete'], ['POST', '/api/web/ai/ask'], ['POST', '/api/web/ai/test-profile'],
		['POST', '/api/web/shares'], ['POST', '/api/web/shares/abc/invites'], ['DELETE', '/api/web/shares/abc'],
		['PATCH', '/api/web/shares/invites/x'], ['GET', '/api/web/users/search'], ['POST', '/fragments/shares/abc'],
	];
	for (const [method, p] of refused) assert.ok(demoRefusal(p, method), `${method} ${p} must be refused`);
	const allowed = [
		['GET', '/settings'], ['GET', '/api/web/shares'], ['GET', '/api/web/shares/abc/invites'],
		['PUT', '/api/web/settings'], ['POST', '/api/web/notes'], ['PUT', '/fragments/editor/abc'], ['POST', '/fragments/upload'],
		['POST', '/api/web/folders'], ['POST', '/login'], ['GET', '/logout'], ['POST', '/api/web/vaults'],
	];
	for (const [method, p] of allowed) assert.equal(demoRefusal(p, method), null, `${method} ${p} must stay allowed`);
	assert.deepEqual(DEMO_BLOCKED_SETTINGS.sort(), ['aiProfiles', 'openRouterApiKey', 'openRouterModel']);
	assert.equal(demoUploadCapBytes(readDemoConfig(DEMO_ENV)), 5 * 1024 * 1024);
	assert.equal(demoUploadCapBytes(readDemoConfig({})), Infinity);
});

// ---------------------------------------------------------------------------------------------
// through the real server

const user = { id: 'demo-user', email: 'demo@joplock.example', sessionId: 'demo-session' };
const mocks = (overrides = {}) => ({
	publicDir: fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-demo-public-')),
	joplinPublicBasePath: '',
	joplinPublicBaseUrl: 'http://localhost:3001',
	joplinServerPublicUrl: overrides.joplinServerPublicUrl || 'http://localhost:3001/joplin',
	joplinServerOrigin: overrides.joplinServerOrigin || 'http://127.0.0.1:9',
	itemService: { foldersByUserId: async () => [{ id: 'f1', title: 'Welcome', parentId: '' }], noteHeadersByUserId: async () => [], folderNoteCountsByUserId: async () => new Map() },
	itemWriteService: { createFolder: async () => ({ id: 'f' }), createNote: async () => ({ id: 'n' }) },
	sessionService: { userBySessionId: async id => (id === 'demo-session' ? user : null), touchSession: async () => {}, getLastSeen: async () => null, deleteSession: async () => {} },
	settingsService: {
		settingsByUserId: async () => ({ theme: 'earth' }),
		saveSettings: overrides.saveSettings || (async (_id, s) => s),
		appSettings: async () => ({ authRateLimitAttempts: 20, maxUploadMb: 200 }),
		saveAppSettings: async s => s,
		getTotpSeed: async () => null,
	},
	historyService: { saveSnapshot: async () => {}, listSnapshots: async () => [], getSnapshot: async () => null },
	database: { query: async () => ({ rows: [] }) },
	demo: overrides.demo === undefined ? readDemoConfig(DEMO_ENV) : overrides.demo,
});
const withServer = async (options, fn) => {
	const server = createServer(options);
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try { await fn(server.address().port); } finally { await new Promise(resolve => server.close(resolve)); }
};
const send = (port, { method = 'GET', path: p = '/', headers = {}, body = null }) => new Promise((resolve, reject) => {
	const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
		let data = '';
		res.on('data', c => { data += c; });
		res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
	});
	req.on('error', reject);
	if (body) req.write(body);
	req.end();
});
const cookie = { Cookie: 'sessionId=demo-session' };

test('every refused request is refused by the server before any route runs', async () => {
	await withServer(mocks(), async port => {
		const pw = await send(port, { method: 'POST', path: '/settings/password', headers: { ...cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'currentPassword=demo&newPassword=hijack123456&confirmPassword=hijack123456' });
		assert.equal(pw.status, 302);
		assert.match(pw.headers.location, /^\/settings\?error=Account%20settings%20are%20fixed%20in%20the%20demo\.&tab=security$/);
		const profile = await send(port, { method: 'POST', path: '/settings/profile', headers: cookie });
		assert.match(profile.headers.location, /tab=profile$/);
		const mfa = await send(port, { method: 'POST', path: '/settings/mfa/setup', headers: cookie });
		assert.match(mfa.headers.location, /tab=security$/);
		for (const p of ['/api/web/ai/ask', '/api/web/ai/prose-complete', '/api/web/shares']) {
			const r = await send(port, { method: 'POST', path: p, headers: { ...cookie, 'Content-Type': 'application/json' }, body: '{}' });
			assert.equal(r.status, 403, p);
			assert.match(JSON.parse(r.body).error, /turned off in the demo/);
		}
		assert.equal((await send(port, { path: '/api/web/users/search?q=a', headers: cookie })).status, 403);
	});
});

test('without demo mode the same requests reach their routes', async () => {
	await withServer(mocks({ demo: { enabled: false } }), async port => {
		const r = await send(port, { method: 'POST', path: '/api/web/ai/ask', headers: { ...cookie, 'Content-Type': 'application/json' }, body: '{}' });
		assert.notEqual(r.status, 403);
	});
});

test('the demo login maps to the real account upstream; anything else never reaches Joplin', async () => {
	const posted = [];
	const upstream = http.createServer((req, res) => {
		let body = '';
		req.on('data', c => { body += c; });
		req.on('end', () => {
			posted.push(JSON.parse(body));
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id: 'demo-session' }));
		});
	});
	await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${upstream.address().port}`;
	try {
		await withServer(mocks({ joplinServerOrigin: origin, joplinServerPublicUrl: origin }), async port => {
			const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
			const ok = await send(port, { method: 'POST', path: '/login', headers: form, body: 'email=demo&password=demo' });
			assert.equal(ok.status, 302);
			assert.equal(ok.headers.location, '/');
			assert.match([].concat(ok.headers['set-cookie']).join(';'), /sessionId=demo-session/);
			assert.deepEqual(posted, [{ email: 'demo@joplock.example', password: SECRET }]);

			for (const body of ['email=admin%40localhost&password=admin', 'email=demo&password=wrong', `email=demo%40joplock.example&password=${SECRET}`]) {
				const r = await send(port, { method: 'POST', path: '/login', headers: form, body });
				assert.equal(r.status, 302);
				assert.match(r.headers.location, /^\/login\?error=Use%20the%20demo%20login/);
			}
			assert.equal(posted.length, 1, 'refused logins never reach Joplin Server');
		});
	} finally {
		await new Promise(resolve => upstream.close(resolve));
	}
});

test('the login page shows the demo login, prefilled', async () => {
	await withServer(mocks(), async port => {
		const page = await send(port, { path: '/login' });
		assert.equal(page.status, 200);
		assert.match(page.body, /class="login-demo"/);
		assert.match(page.body, /name="email" placeholder="Login" value="demo"/);
		assert.match(page.body, /Every 30 minutes everything is wiped/);
	});
});

test('AI keys and profiles are not stored for the demo account; other settings are', async () => {
	const saved = [];
	await withServer(mocks({ saveSettings: async (_id, s) => { saved.push(s); return s; } }), async port => {
		const r = await send(port, { method: 'PUT', path: '/api/web/settings', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'nord', openRouterApiKey: 'sk-real-key', aiProfiles: '[{"apiKey":"sk-x"}]' }) });
		assert.equal(r.status, 204);
	});
	assert.equal(saved.length, 1);
	assert.equal(saved[0].theme, 'nord');
	assert.equal(saved[0].openRouterApiKey, undefined);
	assert.equal(saved[0].aiProfiles, undefined);
});

test('uploads are capped at the demo limit before the body is read', async () => {
	await withServer(mocks(), async port => {
		const r = await send(port, { method: 'POST', path: '/fragments/upload', headers: { ...cookie, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(6 * 1024 * 1024), Connection: 'close' } });
		assert.equal(r.status, 413);
		assert.match(JSON.parse(r.body).error, /5MB/);
	});
});

// ---------------------------------------------------------------------------------------------
// DB helpers (fake database: records statements, answers the SELECTs)

const fakeDb = rowsByEmail => {
	const statements = [];
	return {
		statements,
		query: async (sql, params = []) => {
			statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
			if (/^SELECT/i.test(sql.trim())) return { rows: rowsByEmail[params[0]] ? [rowsByEmail[params[0]]] : [] };
			return { rows: [] };
		},
	};
};

test('the default Joplin admin is locked only while its password is literally "admin"', async () => {
	const open = fakeDb({ 'admin@localhost': { id: 'root', password: bcrypt.hashSync('admin', 4) } });
	const logs = [];
	assert.equal(await lockDefaultJoplinAdmin({ database: open, log: l => logs.push(l) }), true);
	const update = open.statements.find(s => s.sql.startsWith('UPDATE users'));
	assert.match(update.sql, /SET password = \$1, enabled = 0/);
	assert.equal(update.params[2], 'root');
	assert.ok(!bcrypt.compareSync('admin', update.params[0]), 'the new password is not "admin"');
	assert.ok(open.statements.some(s => s.sql === 'DELETE FROM sessions WHERE user_id = $1' && s.params[0] === 'root'));
	assert.match(logs[0], /SECURITY: .*admin@localhost/);

	const changed = fakeDb({ 'admin@localhost': { id: 'root', password: bcrypt.hashSync('a password someone chose', 4) } });
	assert.equal(await lockDefaultJoplinAdmin({ database: changed }), false);
	assert.equal(changed.statements.length, 1, 'only the SELECT: a chosen password is never touched');

	const absent = fakeDb({});
	assert.equal(await lockDefaultJoplinAdmin({ database: absent }), false);
});

test('the default-admin guard can be turned off', () => {
	assert.equal(startDefaultAdminGuard({ database: fakeDb({}), env: { JOPLOCK_LOCK_DEFAULT_ADMIN: 'false' } }), null);
	const guard = startDefaultAdminGuard({ database: fakeDb({}), env: {}, firstDelayMs: 60000, intervalMs: 60000 });
	assert.ok(guard);
	guard.stop();
});

test('the demo account is created when missing, repaired when tampered with, left alone when right', async () => {
	const config = readDemoConfig(DEMO_ENV);
	const missing = fakeDb({});
	assert.equal((await ensureDemoAccount({ database: missing, config })).created, true);
	const insert = missing.statements.find(s => s.sql.startsWith('INSERT INTO users'));
	assert.equal(insert.params[1], 'demo@joplock.example');
	assert.ok(bcrypt.compareSync(SECRET, insert.params[2]));
	assert.match(insert.sql, /VALUES \(\$1, \$2, \$3, \$4, 0, 1, 1,/, 'not an admin, enabled');

	const tampered = fakeDb({ 'demo@joplock.example': { id: 'd', password: bcrypt.hashSync('changed-by-a-visitor', 4), enabled: 0, is_admin: 0 } });
	assert.equal((await ensureDemoAccount({ database: tampered, config })).repaired, true);
	const update = tampered.statements.find(s => s.sql.startsWith('UPDATE users'));
	assert.ok(bcrypt.compareSync(SECRET, update.params[0]));
	assert.match(update.sql, /enabled = 1, is_admin = 0/);

	const fine = fakeDb({ 'demo@joplock.example': { id: 'd', password: bcrypt.hashSync(SECRET, 4), enabled: 1, is_admin: 0 } });
	const result = await ensureDemoAccount({ database: fine, config });
	assert.deepEqual([result.created, result.repaired], [false, false]);
	assert.equal(fine.statements.length, 1);
});
