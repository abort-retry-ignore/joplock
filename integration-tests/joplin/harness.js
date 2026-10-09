'use strict';

// Compatibility harness: drives the REAL Joplin terminal client (headless) against
// a running Joplock dev stack, so "does Joplock break Joplin?" is answered by an
// actual client and not by reading serializers.
//
//   npm run setup:joplin-cli     # once; installs the CLI under ~/.cache
//   npm run test:joplin          # needs the dev stack up + admin creds in env
//
// The client syncs through Joplock's own /joplin proxy, exactly like a desktop or
// mobile app configured for this server. It uses a dedicated throwaway account.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');

const BASE_URL = (process.env.JOPLOCK_URL || 'http://127.0.0.1:5445').replace(/\/$/, '');
const CLI_DIR = process.env.JOPLIN_CLI_DIR || path.join(os.homedir(), '.cache', 'joplock-joplin-cli');
const CLI_BIN = path.join(CLI_DIR, 'node_modules', '.bin', 'joplin');
const ACCOUNT = { email: 'compat-client@joplock.test', password: 'CompatClient1!', fullName: 'Compat Client' };
const ADMIN = {
	email: process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.JOPLOCK_ADMIN_EMAIL || '',
	password: process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.JOPLOCK_ADMIN_PASSWORD || '',
};

// Synchronous so test files can use it as a `skip` option at definition time.
const skipReason = () => {
	if (!fs.existsSync(CLI_BIN)) return 'Joplin CLI not installed (run: npm run setup:joplin-cli)';
	if (!ADMIN.email || !ADMIN.password) return 'set JOPLOCK_ADMIN_EMAIL / JOPLOCK_ADMIN_PASSWORD (the dev stack provisions them)';
	const probe = spawnSync(process.execPath, ['-e',
		'fetch(process.argv[1]).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))',
		`${BASE_URL}/health`], { timeout: 8000 });
	if (probe.status !== 0) return `Joplock not reachable at ${BASE_URL} (start the dev stack)`;
	return false;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Joplock over HTTP ────────────────────────────────────────────────────────

class Joplock {
	constructor(cookie = '') { this.cookie = cookie; }

	static async login(email, password) {
		const res = await fetch(`${BASE_URL}/login`, {
			method: 'POST',
			redirect: 'manual',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ email, password }),
		});
		const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
		const session = cookies.map(c => /^sessionId=([^;]+)/.exec(c)).find(Boolean);
		if (!session) throw new Error(`Joplock login failed for ${email} (HTTP ${res.status})`);
		return new Joplock(`sessionId=${session[1]}`);
	}

	// asClient: authenticate the way a stock Joplin client does (X-API-AUTH header,
	// no Joplock cookie) instead of the browser way.
	async request(method, url, { json, form, headers = {}, raw, asClient = false } = {}) {
		const auth = asClient ? { 'X-API-AUTH': this.cookie.replace(/^sessionId=/, '') } : { Cookie: this.cookie };
		const init = { method, headers: { ...auth, ...headers }, redirect: 'manual', signal: AbortSignal.timeout(30000) };
		if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
		if (form !== undefined) { init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form); }
		if (raw !== undefined) init.body = raw;
		const res = await fetch(`${BASE_URL}${url}`, init);
		const text = await res.text();
		let data = null;
		try { data = JSON.parse(text); } catch { /* html / empty */ }
		return { status: res.status, text, data, headers: res.headers };
	}

	async ok(method, url, opts) {
		const r = await this.request(method, url, opts);
		if (r.status >= 300) throw new Error(`${method} ${url} -> ${r.status}: ${r.text.slice(0, 300)}`);
		return r;
	}

	async folders() { return (await this.ok('GET', '/api/web/folders')).data.items; }
	async noteHeaders() { return (await this.ok('GET', '/api/web/notes/headers')).data.items; }
	async note(id) { return (await this.ok('GET', `/api/web/notes/${id}`)).data.item; }
	async createFolder(title, parentId = '') { return (await this.ok('POST', '/api/web/folders', { json: { title, parentId } })).data.item.id; }
	async createNote(title, body, parentId) { return (await this.ok('POST', '/api/web/notes', { json: { title, body, parentId } })).data.item.id; }
	updateNote(id, { title, body, parentId }) { return this.request('PUT', `/api/web/notes/${id}`, { json: { title, body, parentId } }); }

	// Raw Joplin item exactly as a sync client downloads it (through Joplock's /joplin proxy).
	async rawItem(id) {
		const r = await this.request('GET', `/joplin/api/items/root:/${id}.md:/content`, { asClient: true });
		if (r.status !== 200) throw new Error(`raw item ${id}: HTTP ${r.status}`);
		return r.text;
	}

	// Write a Joplin item as a sync client would (multipart, like Joplin's own uploader).
	// Delete an item through the sync API, as a Joplin client would. Needed for items the
	// Joplock UI refuses to remove (end-to-end encrypted, hidden conflict copies, notebooks
	// a client trashed).
	async deleteRawItem(id) {
		return this.request('DELETE', `/joplin/api/items/root:/${id}.md:`, { asClient: true });
	}

	async putRawItem(id, text) {
		(this.rawIds = this.rawIds || []).push(id);
		const boundary = `----jctest${Date.now()}`;
		const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="item.md"\r\nContent-Type: text/markdown\r\n\r\n${text}\r\n--${boundary}--\r\n`;
		const r = await this.request('PUT', `/joplin/api/items/root:/${id}.md:/content`, {
			headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, raw: body, asClient: true,
		});
		if (r.status >= 300) throw new Error(`put raw item ${id}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
	}

	// Upload an attachment the way the browser UI does (POST /fragments/upload).
	async uploadResource(filename, mime, data) {
		const boundary = `----jcupload${Date.now()}`;
		const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
		const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
		const r = await this.request('POST', '/fragments/upload', {
			headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
			raw: Buffer.concat([head, data, tail]),
		});
		if (r.status !== 200) throw new Error(`upload failed: ${r.status} ${r.text.slice(0, 200)}`);
		return r.data.resourceId;
	}

	// Remove everything whose title starts with the given prefix (best effort).
	async cleanup(prefix) {
		try {
			// items uploaded raw by the test come first (some can't be deleted any other way)
			for (const id of (this.rawIds || []).splice(0)) await this.deleteRawItem(id);
			const notes = (await this.noteHeaders()).filter(n => (n.title || '').startsWith(prefix));
			for (const n of notes) {
				await this.request('DELETE', `/fragments/notes/${n.id}`);
				await this.request('DELETE', `/fragments/notes/${n.id}`);
			}
			await this.request('POST', '/fragments/trash/empty');
			const folders = (await this.folders()).filter(f => (f.title || '').startsWith(prefix));
			for (const f of folders) await this.request('DELETE', `/api/web/folders/${f.id}`);
		} catch { /* never fail a test on cleanup */ }
	}
}

// Create the dedicated account once (admin only) and return a logged-in Joplock.
const connectAccount = async () => {
	try {
		return await Joplock.login(ACCOUNT.email, ACCOUNT.password);
	} catch {
		const admin = await Joplock.login(ADMIN.email, ADMIN.password);
		await admin.request('POST', '/admin/users', { form: { email: ACCOUNT.email, fullName: ACCOUNT.fullName, password: ACCOUNT.password } });
		await sleep(400);
		return Joplock.login(ACCOUNT.email, ACCOUNT.password);
	}
};

// ── The real Joplin client ───────────────────────────────────────────────────

class JoplinClient {
	constructor(label = 'client') {
		this.profile = fs.mkdtempSync(path.join(os.tmpdir(), `joplock-jc-${label}-`));
		this._db = null;
	}

	run(...args) {
		return new Promise((resolve, reject) => {
			execFile(CLI_BIN, ['--profile', this.profile, ...args], { timeout: 90000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
				if (error) reject(new Error(`joplin ${args.join(' ')} failed: ${stderr || stdout || error.message}`));
				else resolve(stdout);
			});
		});
	}

	async init(account = ACCOUNT) {
		await this.run('config', 'sync.target', '9');
		await this.run('config', 'sync.9.path', `${BASE_URL}/joplin`);
		await this.run('config', 'sync.9.username', account.email);
		await this.run('config', 'sync.9.password', account.password);
		await this.sync();
		return this;
	}

	async sync() { return this.run('sync'); }

	// The client's own SQLite profile is the source of truth for "what the client sees".
	sqlite() {
		if (!this._db) {
			const sqlite3 = require(path.join(CLI_DIR, 'node_modules', 'sqlite3'));
			this._db = new sqlite3.Database(path.join(this.profile, 'database.sqlite'), sqlite3.OPEN_READONLY);
		}
		return this._db;
	}

	all(sql, params = []) {
		return new Promise((resolve, reject) => this.sqlite().all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows))));
	}

	async folder(title) { return (await this.all('SELECT * FROM folders WHERE title = ?', [title]))[0]; }
	async note(title) { return (await this.all('SELECT * FROM notes WHERE title = ?', [title]))[0]; }
	async noteById(id) { return (await this.all('SELECT * FROM notes WHERE id = ?', [id]))[0]; }
	async folderById(id) { return (await this.all('SELECT * FROM folders WHERE id = ?', [id]))[0]; }

	close() {
		try { if (this._db) this._db.close(); } catch { /* ignore */ }
		this._db = null;
		fs.rmSync(this.profile, { recursive: true, force: true });
	}
}

module.exports = {
	BASE_URL, ACCOUNT, skipReason, sleep, Joplock, JoplinClient, connectAccount,
};
