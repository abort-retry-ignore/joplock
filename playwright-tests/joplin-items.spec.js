'use strict';

// Joplin items Joplock must treat carefully, in the real UI:
//   - HTML notes (markup_language 2): shown rendered and read-only, never rewritten
//   - end-to-end encrypted notes: locked placeholder, no editor at all
// The items are uploaded the way a stock Joplin client does (X-API-AUTH, sync API).

const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { acceptDialogs, login, slug, teardownTestData } = require('./helpers');

const id32 = () => crypto.randomBytes(16).toString('hex');
const TS = '2026-01-02T03:04:05.678Z';

const sessionId = async page => (await page.context().cookies()).find(c => c.name === 'sessionId').value;

// Raw sync-API calls use the standalone `request` fixture (no browser cookies) with only
// X-API-AUTH, like a stock Joplin client. page.request would also send Joplock's
// session cookie, which is not what a Joplin app does.
const putRaw = async (page, request, id, text) => {
	const boundary = `----pw${Date.now()}`;
	const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="item.md"\r\nContent-Type: text/markdown\r\n\r\n${text}\r\n--${boundary}--\r\n`;
	const res = await request.put(`/joplin/api/items/root:/${id}.md:/content`, {
		headers: { 'X-API-AUTH': await sessionId(page), 'Content-Type': `multipart/form-data; boundary=${boundary}` },
		data: Buffer.from(body),
	});
	expect(res.status(), await res.text()).toBeLessThan(300);
};
const getRaw = async (page, request, id) => (await request.get(`/joplin/api/items/root:/${id}.md:/content`, { headers: { 'X-API-AUTH': await sessionId(page) } })).text();
const delRaw = async (page, request, id) => request.delete(`/joplin/api/items/root:/${id}.md:`, { headers: { 'X-API-AUTH': await sessionId(page) } }).catch(() => null);

const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
	const res = await fetch(u, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
	const text = await res.text();
	let data = null; try { data = JSON.parse(text); } catch { /* html */ }
	return { status: res.status, data, text };
}, [method, url, body]);

const noteProps = (id, parent, extra = []) => [
	`id: ${id}`, `parent_id: ${parent}`, `created_time: ${TS}`, `updated_time: ${TS}`,
	'is_conflict: 0', 'latitude: 0.00000000', 'longitude: 0.00000000', 'altitude: 0.0000', 'author: ', 'source_url: ',
	'is_todo: 0', 'todo_due: 0', 'todo_completed: 0', 'source: joplin-desktop', 'source_application: net.cozic.joplin-desktop',
	'application_data: ', 'order: 1767323045678', `user_created_time: ${TS}`, `user_updated_time: ${TS}`,
	'encryption_cipher_text: ', 'encryption_applied: 0', ...extra, 'is_shared: 0', 'share_id: ',
	'conflict_original_id: ', 'master_key_id: ', 'user_data: ', 'deleted_time: 0', 'type_: 1',
].join('\n');

const openNote = async (page, folderTitle, noteTitle) => {
	const folder = page.locator(`#nav-panel .nav-folder[data-folder-title="${folderTitle}"]`).first();
	await expect(folder).toBeVisible({ timeout: 15000 });
	await folder.locator(':scope > .nav-folder-row .nav-folder-toggle').click();
	await folder.locator('.notelist-item', { hasText: noteTitle }).first().click();
};

test.describe('HTML notes', () => {
	test('desktop: rendered, sanitized, read-only, and never rewritten', async ({ page, request }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folder = slug('pw-joplinitems');
		const noteId = id32();
		const title = 'Clipped web page';
		const html = '<h2>Clipped heading</h2><p>Plain <b>bold</b> text</p><script>window.__pwx=1</script><img src="x" onerror="window.__pwx=2"><a href="javascript:window.__pwx=3">bad</a>';
		await login(page);
		try {
			const folderId = (await api(page, 'POST', '/api/web/folders', { title: folder, parentId: '' })).data.item.id;
			await putRaw(page, request, noteId, `${title}\n\n${html}\n\n${noteProps(noteId, folderId, ['markup_language: 2'])}`);
			const before = await getRaw(page, request, noteId);
			await page.reload();
			await openNote(page, folder, title);

			const form = page.locator('#editor-panel #note-editor-form[data-html-note="1"]');
			await expect(form).toBeVisible({ timeout: 15000 });
			await expect(page.locator('#editor-panel .html-note-banner')).toContainText('HTML note');
			await expect(page.locator('#editor-panel #markdown-toggle')).toBeHidden();
			await expect(page.locator('#editor-panel #preview-toggle')).toBeHidden();
			await expect(page.locator('#editor-panel #editor-toolbar')).toBeHidden();
			await expect(page.locator('#editor-panel .editor-title')).toHaveAttribute('contenteditable', 'false');

			// rendered in TinyMCE, with the hostile parts gone
			const frame = page.frameLocator('iframe.tox-edit-area__iframe');
			await expect(frame.locator('body')).toContainText('Clipped heading', { timeout: 15000 });
			await expect(frame.locator('h2')).toHaveText('Clipped heading');
			await expect(frame.locator('script, [onerror]')).toHaveCount(0);
			await expect(frame.locator('a[href^="javascript"]')).toHaveCount(0);
			expect(await page.evaluate(() => window.__pwx)).toBeUndefined();

			// read-only: typing does nothing and nothing gets saved
			await frame.locator('body').click({ force: true });
			await page.keyboard.type('SHOULD NOT APPEAR');
			await expect(frame.locator('body')).not.toContainText('SHOULD NOT APPEAR');
			await page.keyboard.press('Control+b');
			await page.waitForTimeout(3500); // longer than the 2s autosave debounce
			expect(await getRaw(page, request, noteId)).toBe(before);

			// the stored HTML is still HTML, byte for byte
			expect(before).toMatch(/markup_language: 2/);
			expect(await getRaw(page, request, noteId)).toContain('<script>window.__pwx=1</script>');
		} finally {
			await delRaw(page, request, noteId);
			await teardownTestData(page, { folders: [folder] });
		}
	});

	test('mobile: the HTML note opens rendered with no mode switch', async ({ page, request }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);
		const folder = slug('pw-joplinitems');
		const noteId = id32();
		const title = 'Clipped mobile page';
		await login(page);
		try {
			const folderId = (await api(page, 'POST', '/api/web/folders', { title: folder, parentId: '' })).data.item.id;
			await putRaw(page, request, noteId, `${title}\n\n<h3>Mobile heading</h3><p>body</p>\n\n${noteProps(noteId, folderId, ['markup_language: 2'])}`);
			await page.reload();
			await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
			await page.locator('#mobile-folders-body .mobile-folder-row', { hasText: folder }).first().click();
			await page.locator('#mobile-notes-body .mobile-note-row', { hasText: title }).first().click();
			await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
			await expect(page.locator('#mobile-editor-body .html-note-banner')).toBeVisible({ timeout: 15000 });
			await expect(page.locator('#mobile-md-toggle')).toBeHidden();
			await expect(page.locator('#mobile-preview-toggle')).toBeHidden();
			await expect(page.frameLocator('iframe.tox-edit-area__iframe').locator('h3')).toHaveText('Mobile heading', { timeout: 15000 });
		} finally {
			await delRaw(page, request, noteId);
			await teardownTestData(page, { folders: [folder] });
		}
	});

	test('switching from an HTML note to a markdown note restores the normal editor', async ({ page, request }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folder = slug('pw-joplinitems');
		const htmlId = id32();
		await login(page);
		try {
			const folderId = (await api(page, 'POST', '/api/web/folders', { title: folder, parentId: '' })).data.item.id;
			await putRaw(page, request, htmlId, `An html note\n\n<p>html</p>\n\n${noteProps(htmlId, folderId, ['markup_language: 2'])}`);
			await api(page, 'POST', '/api/web/notes', { title: 'A markdown note', body: '# md body', parentId: folderId });
			await page.reload();
			await openNote(page, folder, 'An html note');
			await expect(page.locator('#editor-panel #note-editor-form[data-html-note="1"]')).toBeVisible({ timeout: 15000 });
			await page.locator('#nav-panel .notelist-item', { hasText: 'A markdown note' }).first().click();
			const md = page.locator('#editor-panel #note-editor-form:not([data-html-note])');
			await expect(md).toBeVisible({ timeout: 15000 });
			await expect(page.locator('#editor-panel .html-note-banner')).toHaveCount(0);
			await expect(page.locator('#editor-panel #markdown-toggle')).toBeVisible();
			await expect(page.locator('#editor-panel .editor-title')).toHaveAttribute('contenteditable', 'true');
		} finally {
			await delRaw(page, request, htmlId);
			await teardownTestData(page, { folders: [folder] });
		}
	});
});

test.describe('Joplin end-to-end encrypted notes', () => {
	test('desktop: locked placeholder in the list and in the editor, nothing to edit', async ({ page, request }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folder = slug('pw-joplinitems');
		const noteId = id32();
		await login(page);
		try {
			const folderId = (await api(page, 'POST', '/api/web/folders', { title: folder, parentId: '' })).data.item.id;
			await putRaw(page, request, noteId, [`id: ${noteId}`, `parent_id: ${folderId}`, 'encryption_cipher_text: JED01000007fakeciphertextfakeciphertext', 'encryption_applied: 1', 'type_: 1'].join('\n'));
			const before = await getRaw(page, request, noteId);
			await page.reload();
			const f = page.locator(`#nav-panel .nav-folder[data-folder-title="${folder}"]`).first();
			await expect(f).toBeVisible({ timeout: 15000 });
			await f.locator(':scope > .nav-folder-row .nav-folder-toggle').click();
			const item = f.locator('.notelist-item[data-e2ee="1"]').first();
			await expect(item).toBeVisible();
			await expect(item).toContainText('Encrypted note');
			await expect(item.locator('.note-lock-icon')).toBeVisible();
			await item.click();
			await expect(page.locator('#editor-panel #editor-e2ee')).toBeVisible({ timeout: 15000 });
			await expect(page.locator('#editor-panel')).toContainText('end-to-end encrypted by Joplin');
			await expect(page.locator('#editor-panel #note-editor-form')).toHaveCount(0);
			await expect(page.locator('#editor-panel textarea')).toHaveCount(0);
			await page.waitForTimeout(2500);
			expect(await getRaw(page, request, noteId)).toBe(before);
		} finally {
			await delRaw(page, request, noteId);
			await teardownTestData(page, { folders: [folder] });
		}
	});
});
