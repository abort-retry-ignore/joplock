'use strict';

// Startup races with Postgres (app/tableInit.js, ensureIndexesWhenReady). On a fresh install, or after a
// host reboot starts every container at once, Joplock's first database calls can come before Postgres
// accepts connections or before Joplin Server has created its tables. A failure there used to be
// remembered until Joplock restarted: settings saves were silently dropped, note history skipped, vault
// notebooks looked like ordinary ones (so plain text was accepted in them), and the search indexes were
// never created.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTableInit } = require('../app/tableInit');
const { createSettingsService } = require('../app/settingsService');
const { createVaultService } = require('../app/vaultService');
const { ensureIndexesWhenReady } = require('../app/items/itemService');

const refused = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:5432'), { code: 'ECONNREFUSED' });

// A database that refuses connections until up() is called, then answers like a tiny Postgres.
const flakyDb = () => {
	let up = false;
	const tables = new Set();
	const rows = { settings: new Map(), vaults: [] };
	const statements = [];
	return {
		statements,
		up() { up = true; },
		query: async (sql, params = []) => {
			const s = sql.replace(/\s+/g, ' ').trim();
			statements.push(s);
			if (!up) throw refused();
			const created = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(s);
			if (created) { tables.add(created[1]); return { rows: [] }; }
			if (/^ALTER TABLE/.test(s)) return { rows: [] };
			if (/^INSERT INTO joplock_settings/.test(s)) { rows.settings.set(params[0], JSON.parse(params[1])); return { rows: [] }; }
			if (/^SELECT settings FROM joplock_settings/.test(s)) { const v = rows.settings.get(params[0]); return { rows: v ? [{ settings: v }] : [] }; }
			if (/^INSERT INTO joplock_vaults/.test(s)) { rows.vaults.push({ user_id: params[0], folder_id: params[1], salt: params[2], verify: params[3], created_at: 'now' }); return { rows: [] }; }
			if (/^SELECT .* FROM joplock_vaults WHERE user_id = \$1 AND folder_id = \$2/.test(s)) return { rows: rows.vaults.filter(v => v.user_id === params[0] && v.folder_id === params[1]) };
			if (/^SELECT .* FROM joplock_vaults/.test(s)) return { rows: rows.vaults.filter(v => v.user_id === params[0]) };
			return { rows: [] };
		},
	};
};

// The services read Date.now() through createTableInit; move the clock instead of waiting 5 seconds.
const withClock = async fn => {
	const realNow = Date.now;
	let clock = realNow();
	Date.now = () => clock;
	try { await fn(ms => { clock += ms; }); } finally { Date.now = realNow; }
};

test('a failed table creation is retried after a pause, not remembered for good', async () => {
	let clock = 0;
	let calls = 0;
	let fail = true;
	const ensure = createTableInit(async () => { calls++; if (fail) throw refused(); }, { retryMs: 5000, now: () => clock });
	assert.equal(await ensure(), false);
	assert.equal(await ensure(), false);
	assert.equal(calls, 1, 'no new attempt within the pause');
	fail = false;
	clock += 5000;
	assert.equal(await ensure(), true);
	assert.equal(await ensure(), true);
	assert.equal(calls, 2, 'created once, then never asked again');
});

test('callers that arrive during an attempt share it (two simultaneous CREATE TABLEs can collide)', async () => {
	let calls = 0;
	let release;
	const ensure = createTableInit(() => { calls++; return new Promise(r => { release = r; }); });
	const all = Promise.all([ensure(), ensure(), ensure()]);
	while (!release) await new Promise(r => setImmediate(r)); // the attempt starts on the next tick
	release();
	assert.deepEqual(await all, [true, true, true]);
	assert.equal(calls, 1);
});

test('settings saved after Postgres comes up are kept (they were silently dropped until a restart)', async () => {
	await withClock(async advance => {
		const db = flakyDb();
		const settings = createSettingsService(db);
		// Postgres not up yet: defaults, and a save that cannot be stored
		assert.equal((await settings.settingsByUserId('u1')).theme, 'earth');
		await settings.saveSettings('u1', { theme: 'nord' });
		db.up();
		advance(5000);
		await settings.saveSettings('u1', { theme: 'nord' });
		assert.equal((await settings.settingsByUserId('u1')).theme, 'nord');
		assert.ok(db.statements.some(s => s.startsWith('CREATE TABLE IF NOT EXISTS joplock_settings')));
	});
});

test('vault notebooks are recognised again once Postgres is up (the server refuses plain text in them)', async () => {
	await withClock(async advance => {
		const db = flakyDb();
		const vaults = createVaultService(db);
		assert.equal(await vaults.getVaultByFolderId('u1', 'f1'), null, 'while Postgres is down');
		db.up();
		advance(5000);
		await vaults.createVault('u1', 'f1', 'salt', 'verify');
		assert.equal((await vaults.getVaultByFolderId('u1', 'f1')).folderId, 'f1');
		assert.deepEqual([...(await vaults.getVaultFolderIdSet('u1'))], ['f1']);
	});
});

test('the search indexes are retried until Joplin Server has created its tables', async () => {
	let attempts = 0;
	const logs = [];
	const db = { query: async () => { attempts++; if (attempts <= 3) throw new Error('relation "items" does not exist'); return { rows: [] }; } };
	const slept = [];
	assert.equal(await ensureIndexesWhenReady(db, { delayMs: 15000, log: l => logs.push(l), sleep: async ms => { slept.push(ms); } }), true);
	assert.deepEqual(slept, [15000, 15000, 15000]);
	assert.match(logs[0], /not ready for indexes yet .*relation "items" does not exist.*retrying every 15s/);
	assert.match(logs[logs.length - 1], /Indexes created/);

	const never = { query: async () => { throw refused(); } };
	const errors = [];
	assert.equal(await ensureIndexesWhenReady(never, { attempts: 3, log: l => errors.push(l), sleep: async () => {} }), false);
	assert.match(errors[errors.length - 1], /Index creation error: connect ECONNREFUSED/);
});
