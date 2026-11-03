'use strict';

// Regression: on the phone, a note opens rendered and READ-ONLY. Opening it and going back (or switching to
// Markdown) must not save it. The leave/flush paths used to convert the read-only TinyMCE HTML back to
// markdown, and that conversion is not exact (`|---|` became `| --- |`, `1. ` became `1.  `, the final
// newline went), so every look at a note rewrote it and moved its modified time, which Joplin's own apps
// then synced as a change nobody made. A real edit made through the pencil (edit mode) must still be saved,
// even when read-only is switched back on before the autosave fires. Mobile-only.

const { test, expect } = require('@playwright/test');
const { hasAdminCredentials, login, openMobileFolder, ensureMobileFoldersScreen, teardownTestData } = require('./helpers');

// The constructs the HTML round trip changes; the body deliberately has no final newline.
const BODY = [
	'# Read-only round trip',
	'',
	'| Service | Port |',
	'|---|---|',
	'| Joplock | 3001 |',
	'',
	'1. first',
	'2. second',
	'',
	'Last line without a final newline',
].join('\n');

const api = (page, path, method = 'GET', body) => page.evaluate(async ([path, method, body]) => {
	const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 120)}`);
	return text ? JSON.parse(text) : null;
}, [path, method, body]);

const stored = async (page, noteId) => {
	const { item } = await api(page, `/api/web/notes/${noteId}`);
	return { body: item.body, updatedTime: item.updatedTime };
};

// TinyMCE's own mode: 'readonly' (the phone's default for rendered notes) or 'design' (pencil on)
const editorMode = page => page.evaluate(() => window.tinymce.activeEditor.mode.get());

async function openNote(page, folder, title) {
	await ensureMobileFoldersScreen(page);
	await openMobileFolder(page, folder);
	await page.locator('#mobile-notes-body').getByText(title, { exact: true }).first().click();
	await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
	// rendered and loaded, past the post-load reconcile window (820 ms)
	await expect.poll(() => page.evaluate(() => {
		const ed = window.tinymce && window.tinymce.activeEditor;
		return !!(ed && ed.getBody && /Last line without/.test(ed.getBody().textContent || ''));
	}), { timeout: 15000 }).toBe(true);
	await expect(page.locator('body.editor-rich-mode')).toHaveCount(1);
	await page.waitForTimeout(1200);
}

async function back(page) {
	await page.locator('#mobile-editor-back').click();
	await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
	await page.waitForTimeout(1500); // a flush save, if any, has landed
}

test.describe('Phone read-only rendered view never rewrites a note', () => {
	test('viewing, and switching to Markdown, saves nothing; an edit made in edit mode is saved', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		test.skip(!hasAdminCredentials(), 'Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD (or PLAYWRIGHT_ADMIN_*) for this test');
		const folder = `PW ReadOnly ${Date.now()}`;
		const title = 'Read-only round trip';
		await login(page);
		const previousOpenMode = await page.evaluate(() => (window._joplockConfig || {}).noteOpenMode || 'markdown');
		const previousResume = await page.evaluate(async () => {
			const html = await (await fetch('/settings', { credentials: 'same-origin' })).text();
			const input = (html.match(/<input[^>]*id="settings-resume-last-note"[^>]*>/) || [''])[0];
			return / checked/.test(input);
		});
		try {
			// notes open rendered, which on a phone means read-only; and the reload must not reopen (and so
			// touch) whatever note the account last had open
			await api(page, '/api/web/settings', 'PUT', { noteOpenMode: 'preview', resumeLastNote: false });
			const { item: nb } = await api(page, '/api/web/folders', 'POST', { title: folder, parentId: '' });
			const { item: note } = await api(page, '/api/web/notes', 'POST', { title, body: BODY, parentId: nb.id });
			await page.reload();
			const original = await stored(page, note.id);
			expect(original.body).toBe(BODY);

			// 1. look and leave
			await openNote(page, folder, title);
			expect(await editorMode(page)).toBe('readonly');
			await back(page);
			expect(await stored(page, note.id), 'opening and leaving a read-only note must not save it').toEqual(original);

			// 2. look, switch to Markdown, leave
			await openNote(page, folder, title);
			await page.locator('#mobile-md-toggle').click();
			await expect(page.locator('body.editor-markdown-mode')).toHaveCount(1);
			await page.waitForTimeout(1200);
			await back(page);
			expect(await stored(page, note.id), 'switching a read-only note to Markdown must not save it').toEqual(original);

			// 3. pencil on, type, pencil off straight away (before the autosave), leave: the edit is kept
			await openNote(page, folder, title);
			await page.locator('.tox-tbtn[aria-label="Toggle edit mode"]').first().click();
			expect(await editorMode(page)).toBe('design');
			await page.evaluate(() => { const ed = tinymce.activeEditor; ed.focus(); ed.selection.select(ed.getBody(), true); ed.selection.collapse(false); });
			await page.keyboard.type(' plus an edit');
			await page.locator('.tox-tbtn[aria-label="Toggle edit mode"]').first().click();
			expect(await editorMode(page)).toBe('readonly');
			await back(page);
			const edited = await stored(page, note.id);
			expect(edited.body).toContain('Last line without a final newline plus an edit');
			expect(edited.updatedTime).toBeGreaterThan(original.updatedTime);
		} finally {
			await api(page, '/api/web/settings', 'PUT', { noteOpenMode: previousOpenMode, resumeLastNote: previousResume }).catch(() => {});
			await teardownTestData(page, { folders: [folder] });
		}
	});
});
