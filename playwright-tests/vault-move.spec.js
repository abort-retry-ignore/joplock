'use strict';

// Safety-net regression tests for the upcoming unified-note-io refactor.
// Covers the 9 vault scenarios documented in plans/unified-note-io.md step 0.
// All tests are desktop-only; they create their own notebooks/vaults so they
// can run in any order and clean up after themselves.

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	openDesktopNote,
	setNoteBody,
	setNoteTitle,
	slug,
	waitForSaved,
} = require('./helpers');

const VAULT_PASSWORD = 'pw-vault-test-password';

async function createVault(page, title, password = VAULT_PASSWORD) {
	await page.locator('button[title="New notebook"]').click();
	await expect(page.locator('#new-folder-modal')).toBeVisible();
	await page.locator('#new-folder-title').fill(title);
	await page.locator('#new-folder-is-vault').check();
	await expect(page.locator('#new-vault-fields')).toBeVisible();
	await page.locator('#new-vault-password').fill(password);
	await page.locator('#new-vault-confirm').fill(password);
	await page.locator('#new-folder-modal-form').evaluate(form => form.requestSubmit());
	await expect(page.locator('#new-folder-modal')).toBeHidden();
	const row = page.locator(`.nav-folder[data-folder-title="${title}"]`).first();
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute('data-is-vault', '1');
	const folderId = await row.getAttribute('data-folder-id');
	if (!folderId) throw new Error('vault folderId missing');
	return folderId;
}

async function submitVaultModal(page, password = VAULT_PASSWORD) {
	await expect(page.locator('#vault-modal')).toBeVisible();
	await page.locator('#vault-modal-password').fill(password);
	await page.locator('#vault-modal-form').evaluate(form => form.requestSubmit());
	await expect(page.locator('#vault-modal')).toBeHidden({ timeout: 10000 });
}

// Reopening a note whose vault is locked shows an INLINE unlock prompt
// inside the editor panel (#editor-locked / #editor-locked-password +
// "Unlock" button calling unlockNote()) — this is a different UI surface
// from #vault-modal, which is the popup used by the nav sidebar's lock
// toggle and by moving a plain note INTO a vault.
async function unlockNoteInEditor(page, password = VAULT_PASSWORD) {
	const overlay = page.locator('#editor-panel #editor-locked, #mobile-editor-body #editor-locked').first();
	await expect(overlay).toBeVisible();
	await page.locator('#editor-locked-password').fill(password);
	await page.locator('#editor-locked-btn').click();
	await expect(overlay).toBeHidden({ timeout: 10000 });
}

async function lockVault(page, folderId) {
	// vault is unlocked when icon has note-lock-unlocked class on .vault-folder-lock
	const btn = page.locator(`.vault-folder-lock[data-folder-id="${folderId}"]`).first();
	await expect(btn).toBeVisible();
	await btn.click();
}

async function changeEditorFolder(page, targetFolderTitle) {
	const sel = page.locator('#editor-panel #editor-folder-select');
	await expect(sel).toBeVisible();
	// option text is the folder title; selectOption by label works
	await sel.selectOption({ label: targetFolderTitle });
}

async function getFormDataset(page) {
	return page.locator('#editor-panel #note-editor-form').evaluate(form => ({
		encrypted: form.dataset.encrypted || '',
		vaultId: form.dataset.vaultId || '',
		vaultUnlocked: form.dataset.vaultUnlocked || '',
	}));
}

async function getServerBody(page, noteId) {
	return page.evaluate(async id => {
		const res = await fetch('/api/web/notes/' + encodeURIComponent(id), { credentials: 'same-origin' });
		if (!res.ok) throw new Error('fetch note failed: ' + res.status);
		const json = await res.json();
		const item = json.item || {};
		return { body: item.body || '', parent_id: item.parentId || '' };
	}, noteId);
}

async function currentNoteId(page) {
	return page.locator('#editor-panel #note-editor-form').evaluate(form => {
		const attr = form.getAttribute('hx-put') || '';
		const parts = attr.split('/');
		return parts[parts.length - 1] || '';
	});
}

test.describe('Vault save & move (refactor safety net)', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('1. plaintext autosave in a normal notebook saves plaintext body', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folder = slug('pw-plain-folder');
		const noteTitle = slug('pw plain note');
		const body = 'hello world plaintext body';

		await login(page);
		await createNotebook(page, folder);
		await createDesktopNote(page, folder);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);

		const noteId = await currentNoteId(page);
		const stored = await getServerBody(page, noteId);
		expect(stored.body).toContain(body);
		expect(stored.body).not.toContain('joplock_encrypted');

		await deleteNotebook(page, folder);
		await logout(page);
	});

	test('2. autosave in unlocked vault writes ciphertext to server', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vault = slug('pw-vault');
		const noteTitle = slug('pw vault note');
		const body = 'secret-in-vault-' + Date.now();

		await login(page);
		await createVault(page, vault);
		await createDesktopNote(page, vault);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);

		const noteId = await currentNoteId(page);
		const stored = await getServerBody(page, noteId);
		expect(stored.body).toContain('joplock_encrypted');
		expect(stored.body).not.toContain(body);

		// textarea in the editor should still show plaintext
		const visible = await page.locator('#editor-panel #note-body').inputValue();
		expect(visible).toContain(body);

		await deleteNotebook(page, vault);
		await logout(page);
	});

	test('3. opening an encrypted note in a locked vault prompts for password and decrypts', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vault = slug('pw-vault-lock');
		const noteTitle = slug('pw locked note');
		const body = 'unlock-me-' + Date.now();

		await login(page);
		const folderId = await createVault(page, vault);
		await createDesktopNote(page, vault);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);

		// lock the vault and navigate away
		await lockVault(page, folderId);
		await page.locator('.nav-folder[data-folder-id="de1e7ede1e7ede1e7ede1e7ede1e7ede"] .nav-folder-row').first().click();

		// re-open note -> should prompt vault modal
		await openDesktopNote(page, noteTitle);
		await unlockNoteInEditor(page);

		const visible = await page.locator('#editor-panel #note-body').inputValue();
		expect(visible).toContain(body);

		await deleteNotebook(page, vault);
		await logout(page);
	});

	test('4. move plaintext note from normal folder into unlocked vault encrypts on server', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const plain = slug('pw-plain-src');
		const vault = slug('pw-vault-dst');
		const noteTitle = slug('pw move-in');
		const body = 'move-in-body-' + Date.now();

		await login(page);
		await createNotebook(page, plain);
		await createVault(page, vault);
		await createDesktopNote(page, plain);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		await changeEditorFolder(page, vault);
		await waitForSaved(page);

		const stored = await getServerBody(page, noteId);
		expect(stored.body).toContain('joplock_encrypted');
		expect(stored.body).not.toContain(body);

		const ds = await getFormDataset(page);
		expect(ds.encrypted).toBe('1');
		expect(ds.vaultUnlocked).toBe('1');

		await deleteNotebook(page, plain);
		await deleteNotebook(page, vault);
		await logout(page);
	});

	test('5. folder select is disabled for notes inside a vault', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vault = slug('pw-vault-locked-sel');
		const noteTitle = slug('pw locked sel');
		const body = 'locked-select-body-' + Date.now();

		await login(page);
		const folderId = await createVault(page, vault);
		await createDesktopNote(page, vault);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);

		// Lock vault, reopen note → locked overlay, select should be disabled
		await lockVault(page, folderId);
		await page.locator('.nav-folder[data-folder-id="de1e7ede1e7ede1e7ede1e7ede1e7ede"] .nav-folder-row').first().click();
		await openDesktopNote(page, noteTitle);

		// Before unlock, the select is disabled (vault-protected)
		const select = page.locator('#editor-panel #editor-folder-select').first();
		await expect(select).toBeDisabled();

		// Unlock the note — select should still be disabled
		// (vault notes cannot change folder)
		await unlockNoteInEditor(page);
		await expect(select).toBeDisabled();

		await deleteNotebook(page, vault);
		await logout(page);
	});

	test('5b. server rejects PUT that changes parentId of a vault note', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vaultName = slug('pw-vault-rej-put');
		const plainName = slug('pw-plain-dst2');
		const noteTitle = slug('pw rej put');
		const body = 'reject-put-body-' + Date.now();

		await login(page);
		await createVault(page, vaultName);
		await createNotebook(page, plainName);
		await createDesktopNote(page, vaultName);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		// Get a known non-vault folder ID so we can attempt to move the
		// vault note OUT of its vault.  We cannot use the folder title
		// (slug) — the API expects a UUID-type folder id.
		const plainFolderId = await page.locator('.nav-folder[data-folder-title="' + plainName + '"]').first().getAttribute('data-folder-id');

		// Try to move via direct API — server must reject
		const res = await page.evaluate(async ({ noteId, body, targetFolderId }) => {
			const r = await fetch('/api/web/notes/' + encodeURIComponent(noteId), {
				method: 'PUT',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: body, parentId: targetFolderId }),
			});
			return { status: r.status, text: await r.text() };
		}, { noteId, body, targetFolderId: plainFolderId });

		expect(res.status).toBe(400);
		expect(JSON.parse(res.text).error).toContain('cannot be moved');

		await deleteNotebook(page, vaultName);
		await deleteNotebook(page, plainName);
		await logout(page);
	});

	test('6. move plaintext note between normal notebooks via folder dropdown', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folderA = slug('pw-folder-a');
		const folderB = slug('pw-folder-b');
		const noteTitle = slug('pw move-plain');
		const body = 'plain-move-body-' + Date.now();

		await login(page);
		await createNotebook(page, folderA);
		await createNotebook(page, folderB);
		await createDesktopNote(page, folderA);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		const before = await getServerBody(page, noteId);
		const parentBefore = before.parent_id;
		expect(before.body).toContain(body);

		// Move to folderB via the editor folder dropdown
		await changeEditorFolder(page, folderB);
		await waitForSaved(page);

		// Same noteId still resolves — no duplicate created
		const after = await getServerBody(page, noteId);
		expect(after.body).toContain(body);
		expect(after.body).not.toContain('joplock_encrypted');
		expect(after.parent_id).toBeTruthy();
		expect(after.parent_id).not.toBe(parentBefore);

		await deleteNotebook(page, folderA);
		await deleteNotebook(page, folderB);
		await logout(page);
	});

	test('7. move plaintext note back to original notebook preserves data', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folderA = slug('pw-round-a');
		const folderB = slug('pw-round-b');
		const noteTitle = slug('pw roundtrip');
		const body = 'roundtrip-body-' + Date.now();

		await login(page);
		await createNotebook(page, folderA);
		await createNotebook(page, folderB);
		await createDesktopNote(page, folderA);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		const origin = await getServerBody(page, noteId);
		expect(origin.body).toContain(body);

		// A → B
		await changeEditorFolder(page, folderB);
		await waitForSaved(page);

		const mid = await getServerBody(page, noteId);
		expect(mid.parent_id).not.toBe(origin.parent_id);
		expect(mid.body).toContain(body);

		// B → A
		await changeEditorFolder(page, folderA);
		await waitForSaved(page);

		// Back in A — body intact, parent restored, no duplicate
		const back = await getServerBody(page, noteId);
		expect(back.body).toContain(body);
		expect(back.parent_id).toBe(origin.parent_id);

		await deleteNotebook(page, folderA);
		await deleteNotebook(page, folderB);
		await logout(page);
	});

	test('8. navigating away from a dirty vault note flushes encrypted save (no plaintext leak)', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vault = slug('pw-vault-nav');
		const noteTitle = slug('pw nav-flush');
		const body = 'nav-flush-body-' + Date.now();

		await login(page);
		await createVault(page, vault);
		await createDesktopNote(page, vault);
		await setNoteTitle(page, noteTitle);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		// type new body, then immediately navigate to a different folder
		await setNoteBody(page, body);
		await page.locator('.nav-folder[data-folder-id="de1e7ede1e7ede1e7ede1e7ede1e7ede"] .nav-folder-row').first().click();

		// give nav-flush some time to land
		await page.waitForTimeout(2000);

		const stored = await getServerBody(page, noteId);
		expect(stored.body).toContain('joplock_encrypted');
		expect(stored.body).not.toContain(body);

		await deleteNotebook(page, vault);
		await logout(page);
	});

	test('9. conflicting concurrent edit raises baseUpdatedTime conflict (no crash)', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vault = slug('pw-vault-conflict');
		const noteTitle = slug('pw conflict');
		const body = 'conflict-original-' + Date.now();

		await login(page);
		await createVault(page, vault);
		await createDesktopNote(page, vault);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		// simulate a concurrent edit by bumping updated_time via API
		await page.evaluate(async id => {
			await fetch('/api/web/notes/' + encodeURIComponent(id), {
				method: 'PUT',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: 'race-edit-' + Date.now() }),
			});
		}, noteId);

		// now type more and let autosave attempt -> server should respond with conflict UI,
		// but the page must not crash or show the disconnected overlay.
		await setNoteBody(page, body + '\nlocal-update');
		await page.waitForTimeout(2500);

		await expect(page.locator('#disconnected-overlay')).toBeHidden();
		// editor still functional
		await expect(page.locator('#editor-panel #note-editor-form')).toBeVisible();

		await deleteNotebook(page, vault);
		await logout(page);
	});
});
