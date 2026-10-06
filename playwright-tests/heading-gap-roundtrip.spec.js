'use strict';

// Regression: blank lines the user types around an ATX heading must survive the
// markdown -> rendered -> markdown mode switch. The HTML round trip cannot
// represent a blank line adjacent to a heading (Turndown always emits one, the
// renderer cannot show one), and the old unconditional gap collapse silently
// ate it — and saved the collapsed body. The authored markdown in #note-body
// must win whenever the fresh conversion differs only in heading-gap shape.
// Desktop-only.

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	hasAdminCredentials,
	login,
	logout,
	setNoteBody,
	teardownTestData,
	waitForSaved,
} = require('./helpers');

// Optional: a pre-minted sessionId (cookie auth) for environments where the
// admin account is MFA-protected and interactive login is not possible.
// When set, login() is skipped and the cookie is injected instead. The session
// is NOT logged out at the end (logout would delete it from the DB).
const SESSION_ID = process.env.PLAYWRIGHT_SESSION_ID || '';

async function ensureLogin(page) {
	if (SESSION_ID) {
		await page.context().addCookies([{
			name: 'sessionId',
			value: SESSION_ID,
			url: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5445',
		}]);
		await page.goto('/');
		await expect(page.locator('body.app-shell')).toBeVisible({ timeout: 15000 });
	} else {
		await login(page);
	}
}

async function switchToMarkdown(page) {
	await page.locator('#editor-panel #markdown-toggle').click();
	await expect.poll(
		async () => page.locator('#editor-panel #note-editor-form').evaluate(f => f.dataset.editorMode || ''),
		{ timeout: 15000 },
	).toBe('markdown');
	await expect(page.locator('#editor-panel .cm-content').first()).toBeVisible({ timeout: 15000 });
}

async function switchToRich(page) {
	await page.locator('#editor-panel #preview-toggle').click();
	await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
}

// Read the CodeMirror DOCUMENT, not the rendered DOM text: with the per-user
// "hide formatting marks" (live preview) setting on, `## ` is not in the DOM
// of lines the caret is not on, although it is in the markdown.
async function getCmText(page) {
	await page.locator('#editor-panel .cm-content').first().waitFor();
	return page.evaluate(() => getCM().state.doc.toString());
}

test.describe('Heading blank lines survive mode switches', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test.skip(!hasAdminCredentials() && !SESSION_ID, 'Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD (or PLAYWRIGHT_ADMIN_*) for this test');

	test('blank line added after a heading survives rendered -> markdown switch', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');

		const folder = `pw-hgap-${Date.now()}`;

		try {
			await ensureLogin(page);
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);
			await setNoteBody(page, '# Title\nBody text');
			await waitForSaved(page);

			// The exact reported flow: add a blank line between the heading and
			// the second line in markdown mode, save, switch to rendered, back.
			await setNoteBody(page, '# Title\n\nBody text');
			await waitForSaved(page);

			await switchToRich(page);
			await page.waitForTimeout(1500);
			await switchToMarkdown(page);
			await page.waitForTimeout(400);

			await expect
				.poll(async () => getCmText(page), { timeout: 10000 })
				.toBe('# Title\n\nBody text');
		} finally {
			await teardownTestData(page, { folders: [folder] });
			if (!SESSION_ID) await logout(page).catch(() => {});
		}
	});

	test('blank line before a heading and untouched compact notes are stable', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');

		const folder = `pw-hgap2-${Date.now()}`;

		try {
			await ensureLogin(page);
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);

			// Untouched compact heading note: switching modes must NOT rewrite it.
			await setNoteBody(page, 'Intro\n## Section\nbody');
			await waitForSaved(page);
			await switchToRich(page);
			await page.waitForTimeout(1500);
			await switchToMarkdown(page);
			await page.waitForTimeout(400);
			await expect
				.poll(async () => getCmText(page), { timeout: 10000 })
				.toBe('Intro\n## Section\nbody');

			// Blank line above a heading survives the same round trip.
			await setNoteBody(page, 'Intro\n\n## Section\nbody');
			await waitForSaved(page);
			await switchToRich(page);
			await page.waitForTimeout(1500);
			await switchToMarkdown(page);
			await page.waitForTimeout(400);
			await expect
				.poll(async () => getCmText(page), { timeout: 10000 })
				.toBe('Intro\n\n## Section\nbody');
		} finally {
			await teardownTestData(page, { folders: [folder] });
			if (!SESSION_ID) await logout(page).catch(() => {});
		}
	});
});
