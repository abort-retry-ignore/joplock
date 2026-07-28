'use strict';

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	setNoteTitle,
	waitForSaved,
	slug,
} = require('./helpers');

// ── Theme persistence ────────────────────────────────────────────────

test.describe('Theme persistence', () => {
	test('theme chosen via setTheme survives page reload', async ({ page }, testInfo) => {
		await login(page);
		await page.waitForSelector('.theme-picker');

		// Pick a known non-default theme
		const picker = page.locator('.theme-picker');
		await picker.selectOption('matrix-amber');
		await page.waitForTimeout(300);

		// Verify body class changed
		await expect(page.locator('body')).toHaveClass(/theme-matrix-amber/);

		// Reload and verify theme still applied
		await page.reload();
		await page.waitForURL(/\/$/);
		await page.locator('body.app-shell').waitFor();
		await expect(page.locator('body')).toHaveClass(/theme-matrix-amber/);

		// Restore default
		await page.locator('.theme-picker').selectOption('earth');
		await page.waitForTimeout(300);
	});

	test('theme chosen in settings survives navigation to main page', async ({ page }, testInfo) => {
		await login(page);

		await page.goto('/settings');
		await page.waitForURL(/\/settings/);

		// Change theme in settings
		const settingsTheme = page.locator('#settings-theme');
		await settingsTheme.selectOption('matrix-blue');
		// Wait for the async fetch to complete (saveSetting is async)
		await page.waitForTimeout(500);

		await expect(page.locator('body')).toHaveClass(/theme-matrix-blue/);

		// Navigate to main page
		await page.goto('/');
		await page.waitForURL(/\/$/);
		await page.locator('body.app-shell').waitFor();

		await expect(page.locator('body')).toHaveClass(/theme-matrix-blue/);

		// Reload and verify
		await page.reload();
		await page.waitForURL(/\/$/);
		await page.locator('body.app-shell').waitFor();
		await expect(page.locator('body')).toHaveClass(/theme-matrix-blue/);

		// Restore default
		await page.locator('.theme-picker').selectOption('earth');
		await page.waitForTimeout(300);
	});
});

// ── Ctrl+Z undo ──────────────────────────────────────────────────────

test.describe('Ctrl+Z undo', () => {
	let folder;

	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'Desktop only');
		acceptDialogs(page);
		await login(page);
		folder = slug('undo');
		await createNotebook(page, folder);
		await createDesktopNote(page, folder);
	});

	test.afterEach(async ({ page }) => {
		await deleteNotebook(page, folder).catch(() => {});
	});

	test('Ctrl+Z in markdown (CodeMirror) mode undoes typed text', async ({ page }) => {
		// Ensure markdown mode
		const mdToggle = page.locator('#editor-panel #markdown-toggle');
		if (!(await mdToggle.evaluate(el => el.classList.contains('active')))) {
			await mdToggle.click();
			await page.waitForTimeout(500);
		}
		await page.locator('#editor-panel .cm-content').click();

		// Type text
		await page.keyboard.type('Hello World');
		await page.waitForTimeout(200);

		// Read current content
		const before = await page.evaluate(() => {
			const c = window.getCM && window.getCM();
			if (c) return c.state.doc.toString();
			const ta = document.querySelector('#editor-panel #note-body');
			return ta ? ta.value : 'n/a';
		});
		expect(before).toBe('Hello World');

		// Ctrl+Z to undo
		await page.keyboard.press('Control+z');
		await page.waitForTimeout(200);

		const after = await page.evaluate(() => {
			const c = window.getCM && window.getCM();
			if (c) return c.state.doc.toString();
			const ta = document.querySelector('#editor-panel #note-body');
			return ta ? ta.value : 'n/a';
		});
		// Should be empty (only default content if any)
		expect(after).not.toBe('Hello World');
	});

	test('Ctrl+Z in preview (TinyMCE) mode undoes typed text', async ({ page }) => {
		// Switch to preview mode
		const pvToggle = page.locator('#editor-panel #preview-toggle');
		if (!(await pvToggle.evaluate(el => el.classList.contains('active')))) {
			await pvToggle.click();
			await page.waitForTimeout(1000);
		}

		const iframe = page.frameLocator('iframe.tox-edit-area__iframe');
		await iframe.locator('body').click();
		await page.keyboard.type('Test typing');
		await page.waitForTimeout(300);

		const t1 = await iframe.locator('body').innerText();

		await page.keyboard.press('Control+z');
		await page.waitForTimeout(300);

		const t2 = await iframe.locator('body').innerText();
		expect(t2).not.toBe(t1);
	});

	test('Ctrl+Z works in preview mode after switching to a note from the list', async ({ page }) => {
		test.fixme(true, 'Note list navigation from different folder is flaky after note-title change');
		const noteTitle = slug('undos');
		await setNoteTitle(page, noteTitle);
		await waitForSaved(page);

		// Navigate away to another note first, then back
		const allNotes = page.locator('.nav-folder-title', { hasText: 'All Notes' });
		await allNotes.click();
		await page.waitForTimeout(500);
		const otherBtn = page.locator('.notelist-item-title').first();
		await otherBtn.click();
		await page.waitForTimeout(500);

		// Now click our test note from the list
		await page.locator('.nav-folder-title', { hasText: folder }).click();
		await page.waitForTimeout(500);
		const noteBtn = page.locator('.notelist-item-title').filter({ hasText: noteTitle }).first();
		await expect(noteBtn).toBeVisible({ timeout: 10000 });
		await noteBtn.click();
		await page.waitForTimeout(1000);

		// Switch to preview mode
		const pvToggle = page.locator('#editor-panel #preview-toggle');
		if (!(await pvToggle.evaluate(el => el.classList.contains('active')))) {
			await pvToggle.click();
			await page.waitForTimeout(1000);
		}

		// Type and undo in preview
		const iframe = page.frameLocator('iframe.tox-edit-area__iframe');
		await iframe.locator('body').click();
		await page.keyboard.type('AfterReopen');
		await page.waitForTimeout(300);

		const t1 = await iframe.locator('body').innerText();

		await page.keyboard.press('Control+z');
		await page.waitForTimeout(300);

		const t2 = await iframe.locator('body').innerText();
		expect(t2).not.toBe(t1);
	});
});
