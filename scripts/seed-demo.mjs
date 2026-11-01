#!/usr/bin/env node
// Seeds the public demo's example notes through Joplock's HTTP API (signing in with the published
// demo login, like a visitor). Used by deploy/demo/app/build-golden.sh on a fresh database, whose
// state is then dumped and restored on every reset. Node 20+, no dependencies.
//
//   node scripts/seed-demo.mjs [--base http://joplock:3001] [--banner path/to/mountain-lake.jpg]
//   login: JOPLOCK_SEED_LOGIN / JOPLOCK_SEED_PASSWORD (default demo / demo)
//
// The first sign-in creates Joplock's own "Examples" notebook (the starter content); it is kept and
// pinned, without its "AI Features" note (AI is off in the demo). If "Homelab" exists, nothing is done.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './lib/seed-client.mjs';
import { titleOf, backupBody, mainBody, inventoryCsv, recipeBody, roadmapBody, kickoffBody, syncBody, travelBody } from './lib/seed-content.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const here = dirname(fileURLToPath(import.meta.url));
const BASE = opt('base', process.env.JOPLOCK_BASE_URL || 'http://127.0.0.1:3001');
const BANNER = opt('banner', join(here, 'mountain-lake.jpg'));

const main = async () => {
	const api = createClient({ base: BASE, login: process.env.JOPLOCK_SEED_LOGIN || 'demo', password: process.env.JOPLOCK_SEED_PASSWORD || 'demo' });
	await api.login();

	const folders = (await api.json('/api/web/folders')).items || [];
	if (folders.some(f => f.title === 'Homelab' && !f.parentId)) {
		console.log('seed-demo: already seeded (Homelab exists); nothing to do');
		return;
	}
	const folder = async (title, parentId = '') => (await api.json('/api/web/folders', 'POST', { title, parentId })).item;
	const note = async (body, parentId) => (await api.json('/api/web/notes', 'POST', { title: titleOf(body), body, parentId })).item;

	const bannerId = await api.upload('mountain-lake.jpg', 'image/jpeg', await readFile(BANNER));
	const csvId = await api.upload('server-inventory.csv', 'text/csv', Buffer.from(inventoryCsv));

	const homelab = await folder('Homelab');
	const backup = await note(backupBody(), homelab.id);
	const showcase = await note(mainBody({ bannerId, csvId, backupNoteId: backup.id }), homelab.id);

	const recipes = await folder('Recipes');
	await note(recipeBody(), recipes.id);

	const work = await folder('Work');
	await note(roadmapBody(), work.id);
	const meetings = await folder('Meetings', work.id);
	await note(kickoffBody(), meetings.id);
	await note(syncBody(), meetings.id);

	const travel = await folder('Travel');
	await note(travelBody(), travel.id);

	// the starter notebook's "AI Features" note would point visitors at something the demo turns off
	const headers = (await api.json('/api/web/notes/headers')).items || [];
	for (const n of headers.filter(h => h.title === 'AI Features')) await api.json(`/api/web/notes/${encodeURIComponent(n.id)}`, 'DELETE');

	// Joplock's own starter notebook first in the list
	const examples = ((await api.json('/api/web/folders')).items || []).find(f => f.title === 'Examples' && !f.parentId);
	if (examples) await api.json(`/api/web/pinned-folders/${encodeURIComponent(examples.id)}`, 'PUT', {});

	// open the showcase note last, so a visitor lands on it after signing in (resumeLastNote)
	const open = await api.http(`/fragments/editor/${encodeURIComponent(showcase.id)}?currentFolderId=${encodeURIComponent(homelab.id)}`);
	if (!open.ok) throw new Error(`opening the showcase note -> ${open.status}`);

	console.log(`seed-demo: seeded ${BASE} (landing note ${showcase.id})`);
};

main().catch(error => { console.error(`seed-demo: ${error.message}`); process.exit(1); });
