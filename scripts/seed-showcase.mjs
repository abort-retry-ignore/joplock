#!/usr/bin/env node
// Seeds a "Homelab" notebook with a showcase note for screenshots (desktop and mobile): a banner
// image, checklists, a table, highlighted code blocks, a quote, an attachment and a link to a
// second note. Everything goes through Joplock's own HTTP API, like a browser would, so the notes
// are ordinary Joplin items that sync to every Joplin app.
//
//   JOPLOCK_ADMIN_EMAIL=... JOPLOCK_ADMIN_PASSWORD=... node scripts/seed-showcase.mjs [--base http://127.0.0.1:5445]
//   node scripts/seed-showcase.mjs --preview-banner /tmp/banner.jpg   (just render the image)
//
// Credentials come from the environment only (the dev compose file sets JOPLOCK_ADMIN_*; any
// account works). If the notebook already exists the script stops instead of duplicating it.
// The banner is generated here (no network, no third-party artwork).
// Checklist items are kept plain text: rendered mode does not yet format inline markdown
// (bold, code, links, strikethrough) inside `- [ ]` items, so formatting lives in normal text.
// --update rewrites the two notes in place (same ids, same uploaded image and attachment).

import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', process.env.JOPLOCK_BASE_URL || 'http://127.0.0.1:5445').replace(/\/+$/, '');
const EMAIL = process.env.JOPLOCK_SEED_EMAIL || process.env.JOPLOCK_ADMIN_EMAIL;
const PASSWORD = process.env.JOPLOCK_SEED_PASSWORD || process.env.JOPLOCK_ADMIN_PASSWORD;
const NOTEBOOK = opt('notebook', 'Homelab');

if ((!EMAIL || !PASSWORD) && !args.includes('--preview-banner')) {
	console.error('Set JOPLOCK_ADMIN_EMAIL and JOPLOCK_ADMIN_PASSWORD (or JOPLOCK_SEED_EMAIL / JOPLOCK_SEED_PASSWORD).');
	process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// banner: a dawn mountain lake, drawn as SVG and rendered to JPEG

const bannerSvg = () => {
	const W = 1600, H = 640, horizon = 430;
	const stars = Array.from({ length: 70 }, (_, i) => {
		const x = (i * 211 + 37) % W, y = (i * 97 + 11) % 120, r = (i % 3 === 0) ? 1.6 : 1;
		return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.25 + (i % 5) * 0.12}"/>`;
	}).join('');
	const ridge = (pts, fill) => `<polygon points="0,${horizon} ${pts} ${W},${horizon}" fill="${fill}"/>`;
	const far = '0,330 120,280 230,310 340,240 450,290 560,215 680,275 790,230 900,285 1010,205 1130,265 1250,225 1370,280 1480,245 1600,290';
	const mid = '0,370 150,300 260,345 390,275 520,340 640,300 760,355 880,290 1000,345 1130,280 1260,340 1380,305 1500,350 1600,320';
	const near = '0,410 100,360 200,395 330,345 460,400 600,370 720,405 850,355 980,400 1100,365 1240,410 1360,372 1480,402 1600,380';
	const trees = Array.from({ length: 26 }, (_, i) => {
		const x = 20 + i * 63 + ((i * 37) % 25), h = 38 + ((i * 53) % 34), w = h * 0.42;
		return `<polygon points="${x},${horizon - h} ${x - w / 2},${horizon} ${x + w / 2},${horizon}" fill="#0f1712"/>`;
	}).join('');
	const scene = `${ridge(far, 'url(#far)')}${ridge(mid, 'url(#mid)')}${ridge(near, 'url(#near)')}${trees}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<defs>
		<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#16203d"/><stop offset="0.16" stop-color="#3a3b66"/>
			<stop offset="0.3" stop-color="#9a5b72"/><stop offset="0.42" stop-color="#e48a5a"/>
			<stop offset="0.55" stop-color="#f7c47c"/><stop offset="1" stop-color="#f7c47c"/>
		</linearGradient>
		<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0" stop-color="#fff4d6"/><stop offset="0.25" stop-color="#ffd58a" stop-opacity="0.9"/>
			<stop offset="1" stop-color="#f3a35f" stop-opacity="0"/>
		</radialGradient>
		<linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b5a78"/><stop offset="1" stop-color="#4d4560"/></linearGradient>
		<linearGradient id="mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f3a50"/><stop offset="1" stop-color="#2c2a3b"/></linearGradient>
		<linearGradient id="near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232733"/><stop offset="1" stop-color="#181c24"/></linearGradient>
		<linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#e09a62" stop-opacity="0.55"/><stop offset="0.4" stop-color="#3a3c58" stop-opacity="0.85"/>
			<stop offset="1" stop-color="#10131d"/>
		</linearGradient>
	</defs>
	<rect width="${W}" height="${H}" fill="url(#sky)"/>
	${stars}
	<circle cx="1180" cy="195" r="260" fill="url(#sun)"/>
	<circle cx="1180" cy="195" r="48" fill="#fff1cf"/>
	${scene}
	<g transform="translate(0 ${2 * horizon}) scale(1 -1)" opacity="0.38">${scene}</g>
	<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#water)"/>
	${Array.from({ length: 9 }, (_, i) => `<rect x="${1010 + (i % 3) * 30 - i * 4}" y="${horizon + 14 + i * 19}" width="${200 - i * 16}" height="2" fill="#ffe0a8" opacity="${0.5 - i * 0.045}"/>`).join('')}
</svg>`;
};

// ---------------------------------------------------------------------------------------------
// HTTP: log in like the login form, then call the JSON API with the session cookie

let cookie = '';
const http = async (path, init = {}) => {
	const res = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init, headers: { ...(init.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
	return res;
};
const json = async (path, method, body) => {
	const res = await http(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	const text = await res.text();
	let data = null;
	try { data = JSON.parse(text); } catch { /* not json */ }
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data && data.error ? data.error : text.slice(0, 200)}`);
	return data;
};
const upload = async (filename, mime, buffer) => {
	const form = new FormData();
	form.append('file', new Blob([buffer], { type: mime }), filename);
	const res = await http('/fragments/upload', { method: 'POST', body: form });
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.resourceId) throw new Error(`upload ${filename} -> ${res.status} ${data.error || ''}`);
	return data.resourceId;
};

const login = async () => {
	const res = await http('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: EMAIL, password: PASSWORD }) });
	const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
	const session = setCookie.map(c => /(?:^|;\s*)sessionId=([^;]+)/.exec(c) || /^sessionId=([^;]+)/.exec(c)).find(Boolean);
	if (res.headers.get('location') === '/login/mfa') throw new Error('this account has MFA turned on; use an account without it');
	if (!session) throw new Error(`login failed (${res.status} -> ${res.headers.get('location') || 'no redirect'})`);
	cookie = `sessionId=${session[1]}`;
};

// ---------------------------------------------------------------------------------------------
// content

const backupBody = () => `Run on the first Sunday of every month. It takes about ten minutes.

## Checklist

- [x] Confirm last night's dump exists and is not empty
- [x] Copy the newest dump to the external drive
- [ ] Restore it into a scratch database
- [ ] Open a few notes in Joplock and spot-check them
- [ ] Rotate the external drive with the one at the office

## Restore test

\`\`\`bash
createdb joplin_restore_test
pg_restore -d joplin_restore_test \\
  /backups/joplin-latest.dump
psql -d joplin_restore_test \\
  -c "select count(*) from items"
\`\`\`

> If the count looks wrong, stop and compare it with last month's number in the log.
`;

const mainBody = ({ bannerId, csvId, backupNoteId }) => `![Mountain lake at dawn](:/${bannerId})

A small, quiet home server that keeps my notes **private**, *synced* and reachable from every device. Everything runs on one mini PC with \`docker compose\`, and the phone uses Joplock as a home-screen app.

## Setup checklist

- [x] Mini PC with a 1 TB SSD
- [x] Debian with unattended upgrades
- [x] Point the domain at the proxy
- [x] Joplin Server and Joplock running
- [ ] Nightly backups
- [ ] Test a restore on a spare machine
- [ ] Add Joplock to the phone's home screen

The backup steps live in [Backup routine](:/${backupNoteId}).

## Services

| Service | Port | Role |
|---|---|---|
| Joplin Server | 22300 | Sync |
| Joplock | 3001 | Web app |
| PostgreSQL | 5432 | Database |
| Proxy | 443 | TLS |

## docker-compose.yml

\`\`\`yaml
services:
  joplock:
    image: ghcr.io/abort-retry-ignore/joplock
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      JOPLIN_SERVER_ORIGIN: http://server:22300
\`\`\`

## Nightly backup

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail
stamp=$(date +%F)
pg_dump -Fc -d joplin \\
  > "/backups/joplin-$stamp.dump"
find /backups -name '*.dump' \\
  -mtime +14 -delete
\`\`\`

> **Tip:** keep one copy off-site. A backup you have never restored is only a hope.

## Notes

1. Joplock reads the same database as Joplin Server, so nothing is copied.
2. Vault notebooks are encrypted in the browser; the server never sees the password.
3. Desktop, mobile and the CLI keep working alongside it.

Inventory: [server-inventory.csv](:/${csvId}) · More on [Joplin](https://joplinapp.org)
`;

const inventoryCsv = `device,role,cpu,ram_gb,disk_tb
mini-pc,docker host,Intel N100,16,1
nas,backups,ARM Cortex-A55,4,8
router,network,MediaTek,1,0
`;

// ---------------------------------------------------------------------------------------------

const main = async () => {
	const preview = opt('preview-banner', '');
	if (preview) { // render the banner to a file and stop: no server needed
		await sharp(Buffer.from(bannerSvg())).jpeg({ quality: 86, mozjpeg: true }).toFile(preview);
		console.log(`banner written to ${preview}`);
		return;
	}
	await login();
	const folders = (await json('/api/web/folders', 'GET')).items || [];
	const existing = folders.find(f => f.title === NOTEBOOK && !f.parentId);
	if (existing && args.includes('--update')) {
		const headers = ((await json('/api/web/notes/headers', 'GET')).items || []).filter(n => n.parentId === existing.id);
		const byTitle = title => headers.find(n => n.title === title);
		const main = byTitle('Home server setup'), backup = byTitle('Backup routine');
		if (!main || !backup) throw new Error(`"${NOTEBOOK}" exists but its two notes were not found; delete the notebook and seed again`);
		const current = (await json(`/api/web/notes/${encodeURIComponent(main.id)}`, 'GET')).item.body;
		const bannerId = (/!\[[^\]]*\]\(:\/([0-9a-f]{32})\)/.exec(current) || [])[1];
		const csvId = (/\[server-inventory\.csv\]\(:\/([0-9a-f]{32})\)/.exec(current) || [])[1];
		if (!bannerId || !csvId) throw new Error('could not find the existing image/attachment ids in the note');
		await json(`/api/web/notes/${encodeURIComponent(backup.id)}`, 'PUT', { title: 'Backup routine', body: backupBody() });
		await json(`/api/web/notes/${encodeURIComponent(main.id)}`, 'PUT', { title: 'Home server setup', body: mainBody({ bannerId, csvId, backupNoteId: backup.id }) });
		console.log(`Updated "${NOTEBOOK}": ${main.id}, ${backup.id} (image ${bannerId}, attachment ${csvId} kept)`);
		return;
	}
	if (existing) {
		console.log(`Notebook "${NOTEBOOK}" already exists (${existing.id}); nothing to do. Use --update to rewrite its notes, or delete it to seed again.`);
		return;
	}

	const banner = await sharp(Buffer.from(bannerSvg())).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
	const bannerId = await upload('mountain-lake.jpg', 'image/jpeg', banner);
	const csvId = await upload('server-inventory.csv', 'text/csv', Buffer.from(inventoryCsv));

	const folder = (await json('/api/web/folders', 'POST', { title: NOTEBOOK, parentId: '' })).item;
	const backup = (await json('/api/web/notes', 'POST', { title: 'Backup routine', body: backupBody(), parentId: folder.id })).item;
	const note = (await json('/api/web/notes', 'POST', { title: 'Home server setup', body: mainBody({ bannerId, csvId, backupNoteId: backup.id }), parentId: folder.id })).item;

	console.log(JSON.stringify({ base: BASE, notebook: { id: folder.id, title: folder.title }, notes: [{ id: note.id, title: note.title }, { id: backup.id, title: backup.title }], resources: { banner: bannerId, bannerBytes: banner.length, csv: csvId } }, null, 2));
};

main().catch(error => { console.error(`seed-showcase: ${error.message}`); process.exit(1); });
