'use strict';

// Regression: decoding `items.content` as JSON for EVERY item aborts the whole
// SQL statement as soon as the owner has one binary resource blob (jop_type 0 —
// any uploaded image/PDF): convert_from(..., 'UTF8') raises "invalid byte
// sequence". The share routes swallow DB errors, so invites silently stopped
// fanning user_items out to the recipient (shared notebook never appeared) and
// revoke / stop-sharing silently left the recipient's access behind.
//
// SQL does not guarantee AND/OR evaluation order, so the decode must sit inside
// a CASE that only touches note/folder rows (shareIdOf() in app/routes/shares.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../app/routes/shares.js'), 'utf8');

test('share routes never decode item content outside the jop_type CASE guard', () => {
	// The only place allowed to read share_id out of content is shareIdOf().
	const offenders = src.split('\n')
		.map((line, i) => ({ line, n: i + 1 }))
		.filter(({ line }) => /json\s*->>\s*'share_id'/.test(line) && !/CASE WHEN/.test(line));
	assert.deepEqual(offenders, [], `unguarded share_id decode: ${JSON.stringify(offenders)}`);
});

test('shareIdOf() only decodes notes and folders and honours a table alias', () => {
	const m = /const shareIdOf = \(alias = ''\) => `([^`]+)`;/.exec(src);
	assert.ok(m, 'shareIdOf helper must exist');
	assert.match(m[1], /CASE WHEN \$\{alias\}jop_type IN \(1, 2\) THEN convert_from\(\$\{alias\}content, 'UTF8'\)::json->>'share_id' END/);
});

test('every share fan-out / revoke query goes through shareIdOf()', () => {
	const uses = src.match(/\$\{shareIdOf\([^)]*\)\}/g) || [];
	assert.equal(uses.length, 5, 'populateUserItems, notebook lookup, stop-sharing user_items cleanup, stop-sharing share_id clearing and remove-invitee cleanup');
});
