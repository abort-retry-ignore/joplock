'use strict';

// The title Joplock's editor derives from a note body (autoTitle / _autoTitleCandidate in
// public/app.js): the first line with text, image-only lines skipped, heading marks and markdown removed.

const { stripMarkdownForTitle } = require('../../app/templates');

const editorTitle = body => {
	for (const line of `${body || ''}`.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || /^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) continue;
		return stripMarkdownForTitle(trimmed.replace(/^#+\s*/, ''));
	}
	return '';
};

module.exports = { editorTitle };
