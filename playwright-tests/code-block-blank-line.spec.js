'use strict';

// Regression: a blank line INSIDE a fenced code block must survive switching
// between markdown and rendered (TinyMCE) mode. The heading-gap collapse in
// tinymceToMarkdown() used to treat a C `#include` line as a markdown heading
// and delete the following blank line. Desktop-only.

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	hasAdminCredentials,
	login,
	logout,
	setNoteBody,
	setNoteTitle,
	teardownTestData,
	waitForSaved,
} = require('./helpers');

const FENCE = '```';
const CODE_BODY = [
	`${FENCE}c`,
	'#include <stdio.h>',
	'',
	'int main() {',
	'    printf("Hello, World!\\n");',
	'    return 0;',
	'}',
	FENCE,
].join('\n');

test.describe('Code block blank-line preservation', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('blank line inside a code block survives markdown <-> rendered switches', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials(), 'Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD (or PLAYWRIGHT_ADMIN_*) for this test');

		const folder = `pw-codeblank-${Date.now()}`;

		try {
			await login(page);
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);
			await setNoteTitle(page, `codeblank ${Date.now()}`);

			await page.locator('#editor-panel #markdown-toggle').click();
			await expect.poll(
				async () => page.locator('#editor-panel #note-editor-form').evaluate(f => f.dataset.editorMode || ''),
				{ timeout: 15000 },
			).toBe('markdown');
			await setNoteBody(page, CODE_BODY);
			await waitForSaved(page);

			const before = await page.locator('#editor-panel #note-body').inputValue();
			expect(before, 'sanity: seeded body has the blank line').toMatch(/stdio\.h>\n\s*\n\s*int main/);

			// markdown -> rendered (TinyMCE)
			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
			await page.waitForTimeout(1500);

			// rendered -> markdown
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect.poll(
				async () => page.locator('#editor-panel #note-editor-form').evaluate(f => f.dataset.editorMode || ''),
				{ timeout: 15000 },
			).toBe('markdown');
			await page.waitForTimeout(500);

			const after = await page.locator('#editor-panel #note-body').inputValue();
			expect(after, `blank line between #include and int main() must survive. after=${JSON.stringify(after)}`)
				.toMatch(/stdio\.h>\n\s*\n\s*int main/);
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});
});
