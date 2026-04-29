'use strict';

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	ensureMobileFoldersScreen,
	login,
	logout,
	openMobileFolder,
	openSettings,
	setNoteBody,
	slug,
	waitForSaved,
} = require('./helpers');

test.describe('Mobile shell UI', () => {
	test('covers mobile shell navigation, note creation, editor modes, search, settings, and logout', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);
		const projectName = testInfo.project.name;
		const noteBody = `${slug(`pw-${projectName}-note`)}\n\n${projectName} body update`;

		await login(page);
		await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
		await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
		await ensureMobileFoldersScreen(page);
		await expect(page.locator('#mobile-folders-body .mobile-folder-row', { hasText: 'All Notes' }).first()).toBeVisible();

		await openMobileFolder(page, 'All Notes');
		await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();

		await page.locator('#mobile-md-toggle').click();
		await expect(page.locator('#mobile-editor-body #cm-host')).toBeVisible();
		await setNoteBody(page, noteBody);
		await waitForSaved(page);

		await page.locator('#mobile-preview-toggle').click();
		await expect(page.locator('#mobile-editor-body #note-preview')).toBeVisible();
		await expect(page.locator('#mobile-editor-body #note-preview')).toContainText(`${projectName} body update`);

		await page.locator('#mobile-editor-back').click();
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await expect(page.locator('#mobile-notes-body')).toContainText('Untitled note');

		await page.locator('#mobile-notes-body .mobile-note-row').first().click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
		await page.locator('#mobile-editor-search-open').click();
		await expect(page.locator('#mobile-editor-search-header')).toBeVisible();
		await page.locator('#mobile-editor-search-input').fill(projectName);
		await expect(page.locator('#mobile-search-next-btn')).toBeVisible();
		await page.locator('#mobile-search-next-btn').click();
		await page.locator('#mobile-editor-search-header .mobile-back-btn').click();

		await page.locator('#mobile-editor-back').click();
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await page.locator('#mobile-notes-screen .mobile-back-btn').click();
		await expect(page.locator('#mobile-folders-screen.mobile-screen-active')).toBeVisible();
		await openMobileFolder(page, 'All Notes');
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await expect(page.locator('#mobile-notes-title')).toContainText('All Notes');
		await page.locator('#mobile-notes-screen .mobile-back-btn').click();
		await expect(page.locator('#mobile-folders-screen.mobile-screen-active')).toBeVisible();

		await page.locator('#mobile-folders-header .mobile-header-btn[title="Search"]').click();
		await page.locator('#mobile-search-input').fill(projectName);
		await expect(page.locator('#mobile-folders-body')).toContainText(projectName, { timeout: 10000 });
		await page.locator('#mobile-folders-body .mobile-note-row', { hasText: projectName }).first().click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
		await expect(page.locator('#mobile-editor-body #note-preview')).toContainText(projectName);

		await openSettings(page);
		await page.locator('[data-tab="appearance"]').click();
		await page.locator('#settings-note-open-mode').selectOption('markdown');
		await expect(page.locator('#settings-note-open-mode')).toHaveValue('markdown');
		await page.getByRole('link', { name: 'Back to notes' }).click();
		await page.waitForURL(/\/$/);

		await logout(page);
	});

	test('FAB hidden in editor, visible on folders/notes', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);

		await login(page);
		await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
		await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
		await ensureMobileFoldersScreen(page);

		const fab = page.locator('#mobile-fab');
		await expect(fab).toBeVisible();

		await openMobileFolder(page, 'All Notes');
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await expect(fab).toBeVisible();

		await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
		await expect(fab).toBeHidden();
		await expect(page.locator('.app-statusbar')).toBeHidden();
		await expect(page.locator('#mobile-editor-body #note-meta')).toBeHidden();

		await page.locator('#mobile-editor-back').click();
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await expect(fab).toBeVisible();

		await logout(page);
	});

	test('mobile editor menu shows note created/edited meta', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);

		await login(page);
		await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
		await ensureMobileFoldersScreen(page);
		await openMobileFolder(page, 'All Notes');
		await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
		await expect(page.locator('#mobile-editor-body #note-meta')).toHaveAttribute('data-created-time', /\d+/, { timeout: 10000 });

		await page.locator('#mobile-editor-menu-btn').click();
		await expect(page.locator('#mobile-ctx-sheet')).toBeVisible();
		await expect(page.locator('#mobile-ctx-meta')).toBeVisible();
		await expect(page.locator('#mobile-ctx-meta')).toContainText(/Created .* Edited /);
		await page.locator('#mobile-ctx-sheet .mobile-ctx-btn-cancel').click();

		await logout(page);
	});

	test('mobile folder rename via context menu', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);

		const original = `pw-fld-${slug('orig')}`;
		const renamed = `pw-fld-${slug('new')}`;

		// Create notebook via desktop API path: temporarily switch to desktop UI mode is overkill;
		// use the htmx fragment endpoint directly via page.request.
		await login(page);
		await page.request.post('/fragments/folders', {
			form: { title: original },
			headers: { 'hx-request': 'true' },
		});
		await page.reload();
		await expect(page.locator('#mobile-folders-body')).toContainText(original, { timeout: 15000 });
		await ensureMobileFoldersScreen(page);

		const row = page.locator('#mobile-folders-body .mobile-folder-row', { hasText: original }).first();
		await expect(row).toBeVisible();
		await row.dispatchEvent('contextmenu');
		await expect(page.locator('#mobile-folder-ctx-sheet')).toBeVisible();
		await expect(page.locator('#mobile-folder-ctx-title')).toContainText(original);

		await page.locator('#mobile-folder-ctx-rename').click();
		await expect(page.locator('#folder-modal')).toBeVisible();
		await page.locator('#folder-edit-title').fill(renamed);
		await page.locator('#folder-modal form').evaluate(form => form.requestSubmit());
		await expect(page.locator('#folder-modal')).toBeHidden();
		await expect(page.locator('#mobile-folders-body')).toContainText(renamed, { timeout: 10000 });
		await expect(page.locator('#mobile-folders-body')).not.toContainText(original);

		// Cleanup: delete via mobile ctx
		const renamedRow = page.locator('#mobile-folders-body .mobile-folder-row', { hasText: renamed }).first();
		await renamedRow.dispatchEvent('contextmenu');
		await expect(page.locator('#mobile-folder-ctx-sheet')).toBeVisible();
		await page.locator('#mobile-folder-ctx-delete').click();
		await expect(page.locator('#mobile-folders-body')).not.toContainText(renamed, { timeout: 10000 });

		await logout(page);
	});
});
