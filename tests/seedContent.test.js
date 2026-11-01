'use strict';

// The demo/screenshot seed content (scripts/lib/seed-content.mjs). Checklist items stay plain text:
// rendered mode does not yet format inline markdown inside "- [ ]" items, so bold, code, links or
// strikethrough there would show as raw markdown on the public demo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'scripts', 'lib', 'seed-content.mjs'));
const ids = { bannerId: 'a'.repeat(32), csvId: 'b'.repeat(32), backupNoteId: 'c'.repeat(32) };

test('every seeded body keeps checklist items plain text', async () => {
	const content = await load();
	const bodies = {
		mainBody: content.mainBody(ids), backupBody: content.backupBody(), recipeBody: content.recipeBody(),
		roadmapBody: content.roadmapBody(), kickoffBody: content.kickoffBody(), syncBody: content.syncBody(), travelBody: content.travelBody(),
	};
	let checklistLines = 0;
	for (const [name, body] of Object.entries(bodies)) {
		for (const line of body.split('\n').filter(l => /^\s*- \[[ x]\] /.test(l))) {
			checklistLines++;
			assert.doesNotMatch(line, /\*\*|`|~~|\]\(|<[a-z]/i, `${name}: inline markdown in a checklist item: ${line}`);
		}
	}
	assert.ok(checklistLines >= 25, `expected the demo checklists, found ${checklistLines} items`);
});

test('the showcase note references exactly the uploaded image, attachment and linked note', async () => {
	const { mainBody } = await load();
	const body = mainBody(ids);
	assert.ok(body.startsWith(`![Mountain lake at dawn](:/${ids.bannerId})`));
	assert.ok(body.includes(`[server-inventory.csv](:/${ids.csvId})`));
	assert.ok(body.includes(`[Backup routine](:/${ids.backupNoteId})`));
	assert.equal((body.match(/\(:\/[0-9a-f]{32}\)/g) || []).length, 3);
});

test('the demo ships a pre-rendered banner (the server-side seed has no image library)', () => {
	const banner = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'demo', 'app', 'seed', 'mountain-lake.jpg'));
	assert.deepEqual([...banner.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
	assert.ok(banner.length > 10000 && banner.length < 200000, `unexpected size ${banner.length}`);
});
