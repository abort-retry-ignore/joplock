#!/usr/bin/env node
// Seeds a "Homelab" notebook with a showcase note for screenshots (desktop and mobile): a banner
// image, checklists, a table, highlighted code blocks, a quote, an attachment and a link to a
// second note. Everything goes through Joplock's own HTTP API, like a browser would, so the notes
// are ordinary Joplin items that sync to every Joplin app.
//
//   JOPLOCK_ADMIN_EMAIL=... JOPLOCK_ADMIN_PASSWORD=... node scripts/seed-showcase.mjs [--base http://127.0.0.1:5445]
//   node scripts/seed-showcase.mjs --preview-banner /tmp/banner.jpg   (just render the image)
//   ... --update   rewrites the two notes in place (same ids, same uploaded image and attachment)
//
// Credentials come from the environment only (the dev compose file sets JOPLOCK_ADMIN_*; any
// account works). If the notebook already exists the script stops instead of duplicating it.
// The banner is generated here (no network, no third-party artwork). For the whole public demo
// content see scripts/seed-demo.mjs.

import { createClient } from './lib/seed-client.mjs';
import { bannerSvg, backupBody, mainBody, inventoryCsv } from './lib/seed-content.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', process.env.JOPLOCK_BASE_URL || 'http://127.0.0.1:5445');
const EMAIL = process.env.JOPLOCK_SEED_EMAIL || process.env.JOPLOCK_ADMIN_EMAIL;
const PASSWORD = process.env.JOPLOCK_SEED_PASSWORD || process.env.JOPLOCK_ADMIN_PASSWORD;
const NOTEBOOK = opt('notebook', 'Homelab');

const renderBanner = async () => {
	const { default: sharp } = await import('sharp'); // dev dependency: only needed to draw the banner
	return sharp(Buffer.from(bannerSvg())).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
};

const main = async () => {
	const preview = opt('preview-banner', '');
	if (preview) { // render the banner to a file and stop: no server needed
		const { writeFile } = await import('node:fs/promises');
		await writeFile(preview, await renderBanner());
		console.log(`banner written to ${preview}`);
		return;
	}
	if (!EMAIL || !PASSWORD) throw new Error('set JOPLOCK_ADMIN_EMAIL and JOPLOCK_ADMIN_PASSWORD (or JOPLOCK_SEED_EMAIL / JOPLOCK_SEED_PASSWORD)');
	const api = createClient({ base: BASE, login: EMAIL, password: PASSWORD });
	await api.login({ attempts: 1 });

	const folders = (await api.json('/api/web/folders')).items || [];
	const existing = folders.find(f => f.title === NOTEBOOK && !f.parentId);
	if (existing && args.includes('--update')) {
		const headers = ((await api.json('/api/web/notes/headers')).items || []).filter(n => n.parentId === existing.id);
		const byTitle = title => headers.find(n => n.title === title);
		const main = byTitle('Home server setup'), backup = byTitle('Backup routine');
		if (!main || !backup) throw new Error(`"${NOTEBOOK}" exists but its two notes were not found; delete the notebook and seed again`);
		const current = (await api.json(`/api/web/notes/${encodeURIComponent(main.id)}`)).item.body;
		const bannerId = (/!\[[^\]]*\]\(:\/([0-9a-f]{32})\)/.exec(current) || [])[1];
		const csvId = (/\[server-inventory\.csv\]\(:\/([0-9a-f]{32})\)/.exec(current) || [])[1];
		if (!bannerId || !csvId) throw new Error('could not find the existing image/attachment ids in the note');
		await api.json(`/api/web/notes/${encodeURIComponent(backup.id)}`, 'PUT', { title: 'Backup routine', body: backupBody() });
		await api.json(`/api/web/notes/${encodeURIComponent(main.id)}`, 'PUT', { title: 'Home server setup', body: mainBody({ bannerId, csvId, backupNoteId: backup.id }) });
		console.log(`Updated "${NOTEBOOK}": ${main.id}, ${backup.id} (image ${bannerId}, attachment ${csvId} kept)`);
		return;
	}
	if (existing) {
		console.log(`Notebook "${NOTEBOOK}" already exists (${existing.id}); nothing to do. Use --update to rewrite its notes, or delete it to seed again.`);
		return;
	}

	const banner = await renderBanner();
	const bannerId = await api.upload('mountain-lake.jpg', 'image/jpeg', banner);
	const csvId = await api.upload('server-inventory.csv', 'text/csv', Buffer.from(inventoryCsv));
	const folder = (await api.json('/api/web/folders', 'POST', { title: NOTEBOOK, parentId: '' })).item;
	const backup = (await api.json('/api/web/notes', 'POST', { title: 'Backup routine', body: backupBody(), parentId: folder.id })).item;
	const note = (await api.json('/api/web/notes', 'POST', { title: 'Home server setup', body: mainBody({ bannerId, csvId, backupNoteId: backup.id }), parentId: folder.id })).item;
	console.log(JSON.stringify({ base: BASE, notebook: { id: folder.id, title: folder.title }, notes: [{ id: note.id, title: note.title }, { id: backup.id, title: backup.title }], resources: { banner: bannerId, bannerBytes: banner.length, csv: csvId } }, null, 2));
};

main().catch(error => { console.error(`seed-showcase: ${error.message}`); process.exit(1); });
