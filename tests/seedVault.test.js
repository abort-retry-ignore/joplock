'use strict';

// The demo's vault seed (scripts/lib/seed-vault.mjs). Vault notes are encrypted by the browser and the
// server never sees a password, so the seed has to produce exactly what the browser would. If the browser's
// format changes and this does not, the public demo ships a vault that cannot be unlocked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertVaultNoteBodyEncrypted } = require('../app/routes/_helpers');

const load = name => import(path.join(__dirname, '..', 'scripts', 'lib', `${name}.mjs`));
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// What the browser calls them in public/app.js (the first definition of each).
const fromApp = pattern => {
	const match = appJs.match(pattern);
	assert.ok(match, `public/app.js no longer matches ${pattern}`);
	return match[1];
};

test('the seed uses the same vault format constants as the browser', async () => {
	const vault = await load('seed-vault');
	assert.equal(vault.PBKDF2_ITERATIONS, Number(fromApp(/var PBKDF2_ITERATIONS=(\d+);/)));
	assert.equal(vault.ENCRYPTION_VERSION, Number(fromApp(/var ENCRYPTION_VERSION=(\d+);/)));
	assert.equal(vault.ENCRYPTED_START, fromApp(/var ENCRYPTED_START='([^']+)';/));
	assert.equal(vault.ENCRYPTED_END, fromApp(/var ENCRYPTED_END='([^']+)';/));
	assert.equal(vault.VERIFY_PLAINTEXT, fromApp(/var _VAULT_CHECK_PLAINTEXT='([^']+)';/));
	// the notice other Joplin apps show; the source holds escapes, so compare what they evaluate to
	// eslint-disable-next-line no-eval
	assert.equal(vault.WRAPPER_HEAD, eval(`'${fromApp(/var ENCRYPTED_WRAPPER_HEAD='((?:[^'\\]|\\.)*)';/)}'`));
	// the blob fields the browser writes, in the order it writes them
	assert.match(appJs, /joplock_encrypted:1,v:ENCRYPTION_VERSION,vault:vaultId,salt:_b64Encode\(salt\),iv:_b64Encode\(iv\),ct:_b64Encode\(ct\)/);
	assert.match(appJs, /deriveKey\(password,salt\)[\s\S]{0,400}name:'PBKDF2',salt:salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'[\s\S]{0,200}name:'AES-GCM',length:256/);
});

// A stand-in for the Joplock API that applies the server's own vault guard to every note write.
const fakeApi = () => {
	const calls = [];
	const vaults = new Map();
	const notes = new Map();
	let next = 0;
	const vaultService = { getVaultByFolderId: async (_user, folderId) => vaults.get(folderId) || null };
	const api = {
		calls, vaults, notes,
		json: async (url, method = 'GET', body) => {
			calls.push({ url, method, body });
			if (url === '/api/web/folders' && method === 'POST') return { item: { id: `folder${++next}`.padEnd(32, '0') } };
			if (url === '/api/web/vaults' && method === 'POST') {
				vaults.set(body.folderId, { folderId: body.folderId, salt: body.salt, verify: body.verify });
				return { item: { folderId: body.folderId, salt: body.salt } };
			}
			if (url === '/api/web/notes' && method === 'POST') {
				await assertVaultNoteBodyEncrypted(vaultService, 'user', '', body.parentId, body.body);
				const id = `note${++next}`.padEnd(32, '0');
				notes.set(id, { id, parentId: body.parentId, title: body.title, body: body.body });
				return { item: { id } };
			}
			const put = url.match(/^\/api\/web\/notes\/([^/]+)$/);
			if (put && method === 'PUT') {
				const noteId = decodeURIComponent(put[1]);
				const existing = notes.get(noteId);
				assert.ok(existing, `PUT for an unknown note ${noteId}`);
				await assertVaultNoteBodyEncrypted(vaultService, 'user', existing.parentId, existing.parentId, body.body, noteId);
				notes.set(noteId, { ...existing, title: body.title, body: body.body });
				return { item: { id: noteId } };
			}
			throw new Error(`unexpected ${method} ${url}`);
		},
	};
	return api;
};

test('a seeded vault unlocks with its password and its note decrypts to the original text', async () => {
	const vault = await load('seed-vault');
	const api = fakeApi();
	const text = '# What is a vault?\n\nSecret sentence about zebras.\n';

	const created = await vault.createVaultNotebook(api, { title: 'demo-vault', password: 'demo' });
	const note = await created.addNote({ title: 'What is a vault?', body: text });

	// the stored vault record is what the browser's unlock reads (salt + verify)
	const record = api.vaults.get(created.folder.id);
	const salt = new Uint8Array(Buffer.from(record.salt, 'base64'));
	const key = await vault.deriveVaultKey('demo', salt);
	assert.equal(await vault.checkVerify(key, record.verify), true, 'the right password opens the vault');
	await assert.rejects(vault.checkVerify(await vault.deriveVaultKey('not-demo', salt), record.verify), 'a wrong password does not');

	const stored = api.notes.get(note.id);
	assert.equal(stored.parentId, created.folder.id);
	assert.equal(stored.title, 'What is a vault?', 'titles stay readable');
	assert.equal(await vault.decryptNoteBody(stored.body, key), text);

	// the ciphertext is bound to this vault and this note, which is what the server checks
	const blob = JSON.parse(stored.body.slice(stored.body.indexOf(vault.ENCRYPTED_START) + vault.ENCRYPTED_START.length, stored.body.indexOf(vault.ENCRYPTED_END)));
	assert.equal(blob.vault, created.folder.id);
	assert.equal(blob.noteId, note.id);
	assert.equal(blob.v, vault.ENCRYPTION_VERSION);
});

test('the note text and the password never reach the server in the clear', async () => {
	const vault = await load('seed-vault');
	const api = fakeApi();
	const created = await vault.createVaultNotebook(api, { title: 'demo-vault', password: 'hunter2-password' });
	await created.addNote({ title: 'Note', body: 'Secret sentence about zebras.' });
	const wire = JSON.stringify(api.calls);
	assert.doesNotMatch(wire, /zebras/);
	assert.doesNotMatch(wire, /hunter2/);
});

test('a note written to the vault in the clear is refused (so the seed could not do it silently)', async () => {
	const vault = await load('seed-vault');
	const api = fakeApi();
	const created = await vault.createVaultNotebook(api, { title: 'demo-vault', password: 'demo' });
	await assert.rejects(api.json('/api/web/notes', 'POST', { title: 'Plain', body: 'not encrypted', parentId: created.folder.id }), /must be saved encrypted/);
});

test('the demo seed creates the demo-vault vault, the features note and the demo settings, and ships the helper', async () => {
	const content = await load('seed-content');
	const { validThemes, normalizeSettings } = require('../app/settingsService');
	assert.equal(content.DEMO_VAULT_TITLE, 'demo-vault');
	assert.equal(content.DEMO_VAULT_PASSWORD, 'demo');

	// each starts with its own title (the editor derives a note's title from the first line)
	assert.equal(content.titleOf(content.vaultBody()), 'What is a vault?');
	assert.equal(content.titleOf(content.featuresBody()), "Joplock's top 10 features");

	const vaultNote = content.vaultBody();
	assert.match(vaultNote, /encrypted in your browser/);
	assert.match(vaultNote, /password `demo`/);

	// ten numbered features, and the facts in it that the code can check
	const features = content.featuresBody();
	assert.deepEqual([...features.matchAll(/^(\d+)\. \*\*/gm)].map(m => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	for (const topic of [/server-side rendering/i, /no copy of your notes/i, /two-factor/i, /backups/i, /word, pdf/i, /demo-vault/]) assert.match(features, topic);
	assert.match(features, new RegExp(`\\*\\*${validThemes.length} themes\\.\\*\\*`), 'the theme count matches app/settingsService.js');
	assert.match(features, /up to 50 earlier versions/);
	assert.match(fs.readFileSync(path.join(__dirname, '..', 'app', 'historyService.js'), 'utf8'), /const MAX_SNAPSHOTS = 50;/);

	// the demo account's settings are ones Joplock keeps (an unknown value would silently fall back)
	assert.deepEqual({ ...content.DEMO_SETTINGS }, { theme: 'light', noteOpenMode: 'preview' });
	const normalized = normalizeSettings({ ...content.DEMO_SETTINGS });
	assert.equal(normalized.theme, 'light');
	assert.equal(normalized.noteOpenMode, 'preview');

	const seed = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed-demo.mjs'), 'utf8');
	assert.match(seed, /createVaultNotebook\(api, \{ title: DEMO_VAULT_TITLE, password: DEMO_VAULT_PASSWORD \}\)/);
	assert.match(seed, /note\(featuresBody\(\), examples\.id\)/);
	assert.match(seed, /api\.json\('\/api\/web\/settings', 'PUT', DEMO_SETTINGS\)/);

	// the demo host gets only the files deploy.sh copies: every module the seed imports must be among them
	const deploy = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'demo', 'deploy.sh'), 'utf8');
	for (const file of ['seed-client.mjs', 'seed-content.mjs', 'seed-vault.mjs']) {
		assert.ok(deploy.includes(`scripts/lib/${file}`), `deploy/demo/deploy.sh does not copy ${file}`);
	}
	for (const [, imported] of seed.matchAll(/from '\.\/lib\/([^']+)'/g)) {
		assert.ok(deploy.includes(`scripts/lib/${imported}`), `seed-demo.mjs imports ${imported}, which deploy.sh does not copy`);
	}
});
