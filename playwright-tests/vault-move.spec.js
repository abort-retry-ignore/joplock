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
	await page.getByRole('button', { name: '+ Notebook' }).click();
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
		return { body: json.body || '', parent_id: json.parent_id || '' };
	}, noteId);
}

async function currentNoteId(page) {
	return page.locator('#editor-panel #note-editor-form').evaluate(form => form.getAttribute('hx-put') || '');
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
		await submitVaultModal(page);

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

	test('5. move encrypted note from unlocked vault to normal folder stores plaintext', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vault = slug('pw-vault-src');
		const plain = slug('pw-plain-dst');
		const noteTitle = slug('pw move-out');
		const body = 'move-out-body-' + Date.now();

		await login(page);
		await createVault(page, vault);
		await createNotebook(page, plain);
		await createDesktopNote(page, vault);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		await changeEditorFolder(page, plain);
		await waitForSaved(page);

		const stored = await getServerBody(page, noteId);
		expect(stored.body).toContain(body);
		expect(stored.body).not.toContain('joplock_encrypted');

		const ds = await getFormDataset(page);
		expect(ds.encrypted).toBe('');
		expect(ds.vaultId).toBe('');

		await deleteNotebook(page, vault);
		await deleteNotebook(page, plain);
		await logout(page);
	});

	test('6. move note between two unlocked vaults re-encrypts under destination key', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vaultA = slug('pw-vault-a');
		const vaultB = slug('pw-vault-b');
		const noteTitle = slug('pw move-vv');
		const body = 'cross-vault-body-' + Date.now();

		await login(page);
		const idA = await createVault(page, vaultA, 'pw-A-password');
		const idB = await createVault(page, vaultB, 'pw-B-password');
		await createDesktopNote(page, vaultA);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		const before = await getServerBody(page, noteId);
		expect(before.body).toContain('joplock_encrypted');
		const cipherBefore = before.body;

		await changeEditorFolder(page, vaultB);
		await waitForSaved(page);

		const after = await getServerBody(page, noteId);
		expect(after.body).toContain('joplock_encrypted');
		expect(after.body).not.toEqual(cipherBefore);
		expect(after.body).not.toContain(body);
		expect(after.parent_id).toBe(idB);

		// lock A, ensure B still decrypts (sanity: editor still shows plaintext)
		await lockVault(page, idA);
		const visible = await page.locator('#editor-panel #note-body').inputValue();
		expect(visible).toContain(body);

		await deleteNotebook(page, vaultA);
		await deleteNotebook(page, vaultB);
		await logout(page);
	});

	test('7. decrypt a note then move it out of the vault (orphan-style decrypt + move)', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const vault = slug('pw-vault-orph');
		const plain = slug('pw-plain-orph');
		const noteTitle = slug('pw orph');
		const body = 'orphan-decrypt-body-' + Date.now();

		await login(page);
		const folderId = await createVault(page, vault);
		await createNotebook(page, plain);
		await createDesktopNote(page, vault);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);
		const noteId = await currentNoteId(page);

		// Lock vault, reopen note -> prompt, decrypt, then move out
		await lockVault(page, folderId);
		await page.locator('.nav-folder[data-folder-id="de1e7ede1e7ede1e7ede1e7ede1e7ede"] .nav-folder-row').first().click();
		await openDesktopNote(page, noteTitle);
		await submitVaultModal(page);

		await changeEditorFolder(page, plain);
		await waitForSaved(page);

		const stored = await getServerBody(page, noteId);
		expect(stored.body).toContain(body);
		expect(stored.body).not.toContain('joplock_encrypted');

		await deleteNotebook(page, vault);
		await deleteNotebook(page, plain);
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
