'use strict';

// Global safety-net cleanup: after the entire Playwright run, log in once and
// permanently remove any leftover test-created data (notebooks, their notes,
// and orphaned resources) so runs never accumulate data in the shared Joplin
// DB. Per-test teardown keeps things clean mid-run; this guarantees the final
// state is clean even if a test crashed before its own cleanup.
//
// It only touches folders whose names use the test naming conventions
// (slug() prefixes) so it never deletes a real user's notebooks.

const { chromium } = require('@playwright/test');

// Folder-name prefixes used by the test suite (see slug('...') calls), plus a
// few legacy prefixes from earlier/removed test versions so historical cruft in
// the shared dev DB also gets drained.
const TEST_FOLDER_PREFIXES = [
	'pw-', 'pw ',
	'dnd-',
	'esc-',
	'search-',
	'upload-',
	'orig-',
	'new-',
	'res-lifecycle-',
	// legacy / removed-test prefixes
	'up-reload-',
	'pnb-', 'p3nb-', 'p4nb-', 'p5nb-',
	'Findable-', 'Esc-',
];

// Note-title prefixes for notes created outside a dedicated notebook, or left
// orphaned in "General" by earlier incomplete cleanups. Only unambiguous test
// titles are listed so real notes are never touched. (Titles are auto-derived
// from the note body's first line, which is what these strings are.)
const TEST_TITLE_PREFIXES = [
	'pw ',
	'Anchor line',
	'Desktop anchor line',
	'Lightbox anchor text.',
	'Drop anchor text.',
	'Picker anchor text.',
	'Resource test anchor text.',
	'Intro text.',
	'Findable note-',
	'Findable-note',
	'Esc-note',
	'temporary switch note',
	'This paragraph contains the zqxmrb',
];

function resolveCredentials() {
	const email =
		process.env.PLAYWRIGHT_ADMIN_EMAIL ||
		process.env.PLAYWRIGHT_EMAIL ||
		process.env.JOPLOCK_ADMIN_EMAIL ||
		'';
	const password =
		process.env.PLAYWRIGHT_ADMIN_PASSWORD ||
		process.env.PLAYWRIGHT_PASSWORD ||
		process.env.JOPLOCK_ADMIN_PASSWORD ||
		'';
	return { email, password };
}

module.exports = async function globalTeardown(config) {
	const { email, password } = resolveCredentials();
	if (!email || !password) return; // nothing we can authenticate with — skip.

	const baseURL =
		(config && config.projects && config.projects[0] && config.projects[0].use && config.projects[0].use.baseURL) ||
		process.env.PLAYWRIGHT_BASE_URL ||
		'http://127.0.0.1:5445';

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ baseURL });
		page.setDefaultTimeout(120000);
		// Log in.
		await page.goto('/login');
		await page.getByPlaceholder('Email').fill(email);
		await page.locator('#login-password').fill(password);
		await page.getByRole('button', { name: 'Login' }).click();
		await page.waitForURL(/\/$/, { timeout: 30000 }).catch(() => {});

		// Purge test-prefixed folders + their notes + orphaned resources. Runs in
		// bounded passes: deleting a folder moves its notes to General and each
		// delete round-trips upstream, so a large backlog may need several passes.
		// Each pass deletes at most `batch` folders to stay well under timeouts.
		for (let pass = 0; pass < 40; pass += 1) {
			const remaining = await page.evaluate(async ({ folderPrefixes, titlePrefixes, batch }) => {
				const j = async (url, opts) => {
					try {
						const res = await fetch(url, { credentials: 'same-origin', ...opts });
						const text = await res.text();
						try { return { status: res.status, data: JSON.parse(text) }; }
						catch { return { status: res.status, data: null }; }
					} catch { return { status: 0, data: null }; }
				};

				const folderRes = await j('/api/web/folders');
				const allFolders = (folderRes.data && folderRes.data.items) || [];
				const testFolders = allFolders.filter(
					f => typeof f.title === 'string' && folderPrefixes.some(p => f.title.startsWith(p)),
				);
				const batchFolders = testFolders.slice(0, batch);
				const batchIds = new Set(batchFolders.map(f => f.id));

				// Purge notes belonging to the folders in this batch, plus any
				// stray notes matching a test title prefix.
				const headerRes = await j('/api/web/notes/headers');
				const notes = (headerRes.data && headerRes.data.items) || [];
				const doomed = new Set();
				for (const n of notes) {
					if ((n.parentId && batchIds.has(n.parentId)) ||
						titlePrefixes.some(p => typeof n.title === 'string' && n.title.startsWith(p))) {
						doomed.add(n.id);
					}
				}
				for (const id of doomed) {
					await j('/fragments/notes/' + encodeURIComponent(id), { method: 'DELETE' });
					await j('/fragments/notes/' + encodeURIComponent(id), { method: 'DELETE' });
				}
				await j('/fragments/trash/empty', { method: 'POST' });
				for (const id of batchIds) {
					await j('/api/web/folders/' + encodeURIComponent(id), { method: 'DELETE' });
				}
				await j('/admin/orphaned-resources/cleanup', { method: 'POST' });
				return testFolders.length - batchFolders.length;
			}, { folderPrefixes: TEST_FOLDER_PREFIXES, titlePrefixes: TEST_TITLE_PREFIXES, batch: 20 });
			if (!remaining) break;
		}
	} catch {
		// best-effort — never fail the run because global teardown hiccuped.
	} finally {
		await browser.close();
	}
};
