'use strict';

// The "Examples" notebook a new account starts with. Joplock's editor takes a note's title from its
// first line of text (autoTitle in public/app.js), so a starter note whose title differs from its first
// line is renamed to that line at the first edit. Each body must start with "# <title>".

const test = require('node:test');
const assert = require('node:assert/strict');
const { starterNotes, titleFromBody } = require('../app/starterContent');
const { editorTitle } = require('./support/editorTitle');

test('every starter note starts with its title as a heading, the title the editor would derive', () => {
	const notes = starterNotes();
	assert.deepEqual(notes.map(n => n.title), ['Start Here', 'AI Features']);
	for (const note of notes) {
		assert.equal(note.body.split('\n')[0], `# ${note.title}`, `${note.title}: first line`);
		assert.equal(editorTitle(note.body), note.title, `${note.title}: the editor would rename it`);
	}
});

test('titleFromBody reads the first non-empty line without its heading marks', () => {
	assert.equal(titleFromBody('\n\n## Weekly sync\n\ntext'), 'Weekly sync');
	assert.equal(titleFromBody('# Start Here\n'), 'Start Here');
});
