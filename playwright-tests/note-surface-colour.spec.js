'use strict';

const { test, expect } = require('@playwright/test');
const { login, slug, teardownTestData, openMobileFolder, ensureMobileFoldersScreen } = require('./helpers');

// Switching a note between markdown and rendered mode must not change the colour it sits on. On the
// light "fruit" theme rendered mode used to turn cream/yellow (--bg #f5f5f0 instead of the white
// --bg-editor the markdown editor uses). The theme is forced in this browser only, before app.js
// runs; the account's saved theme is never written.

const THEME = 'fruit';
const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
	const res = await fetch(u, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
	return res.json();
}, [method, url, body]);
const paintedBehind = (page, selector) => page.evaluate(sel => {
	for (let e = document.querySelector(sel); e; e = e.parentElement) {
		const c = getComputedStyle(e).backgroundColor;
		if (c && c !== 'rgba(0, 0, 0, 0)') return c;
	}
	return null;
}, selector);
const renderedBody = page => page.evaluate(() => getComputedStyle(document.querySelector('iframe.tox-edit-area__iframe').contentDocument.body).backgroundColor);

test('the note keeps its background colour when switching to rendered mode', async ({ page }, testInfo) => {
	const mobile = testInfo.project.name === 'mobile';
	await page.addInitScript(theme => {
		document.addEventListener('DOMContentLoaded', () => {
			if (!document.body.classList.contains('app-shell')) return;
			[...document.body.classList].filter(c => c.startsWith('theme-')).forEach(c => document.body.classList.remove(c));
			document.body.classList.add(`theme-${theme}`);
		});
	}, THEME);
	await login(page);
	const folder = slug('pw-notesurface');
	try {
		const folderId = (await api(page, 'POST', '/api/web/folders', { title: folder, parentId: '' })).item.id;
		await api(page, 'POST', '/api/web/notes', { title: 'Surface colour', body: 'Plain paragraph text.\n\n- [ ] a task\n', parentId: folderId });
		await page.reload();
		expect(await page.evaluate(() => document.body.classList.contains('theme-fruit'))).toBe(true);

		let scope;
		if (mobile) {
			// the phone layout may resume into whatever note an earlier test left open
			await ensureMobileFoldersScreen(page);
			await openMobileFolder(page, folder);
			await page.locator('#mobile-notes-body .mobile-note-row', { hasText: 'Surface colour' }).first().click();
			scope = '#mobile-editor-body';
		} else {
			await page.locator('.nav-folder-row', { hasText: folder }).first().click();
			await page.getByRole('button', { name: 'Surface colour', exact: true }).click();
			scope = '#editor-panel';
		}
		const markdownToggle = mobile ? '#mobile-md-toggle' : '#editor-panel #markdown-toggle';
		const renderedToggle = mobile ? '#mobile-preview-toggle' : '#editor-panel #preview-toggle';
		// open in markdown mode whatever the account prefers
		if (!(await page.locator(`${scope} .cm-content`).isVisible().catch(() => false))) await page.locator(markdownToggle).click();
		// the editor panel swap re-mounts CodeMirror once more after it first appears: wait for this
		// note's text, then read the colour until it settles
		await expect(page.locator(`${scope} .cm-content`)).toContainText('Plain paragraph text.', { timeout: 15000 });
		await expect.poll(() => paintedBehind(page, `${scope} .cm-content`), { timeout: 5000 }).toBe('rgb(255, 255, 255)'); // fruit's --bg-editor
		const markdownBg = 'rgb(255, 255, 255)';

		await page.locator(renderedToggle).click();
		await expect(page.frameLocator('iframe.tox-edit-area__iframe').locator('body')).toContainText('Plain paragraph text.', { timeout: 15000 });
		expect(await renderedBody(page)).toBe(markdownBg);
		expect(await page.evaluate(() => getComputedStyle(document.getElementById('tinymce-host')).backgroundColor)).toBe(markdownBg);
	} finally {
		await teardownTestData(page, { folders: [folder] });
	}
});
