'use strict';

const { expect } = require('@playwright/test');

// Admin credentials are read from the environment only — never hardcoded.
// The dev container (docker-compose.dev.yml / .env) provisions the admin
// account via JOPLOCK_ADMIN_EMAIL / JOPLOCK_ADMIN_PASSWORD, so tests use those
// by default. PLAYWRIGHT_* variables override them (e.g. for CI or a staging
// account). If none are set, login() fails loudly rather than silently trying
// a bogus credential.
const DEV_EMAIL =
	process.env.PLAYWRIGHT_ADMIN_EMAIL ||
	process.env.PLAYWRIGHT_EMAIL ||
	process.env.JOPLOCK_ADMIN_EMAIL ||
	'';
const DEV_PASSWORD =
	process.env.PLAYWRIGHT_ADMIN_PASSWORD ||
	process.env.PLAYWRIGHT_PASSWORD ||
	process.env.JOPLOCK_ADMIN_PASSWORD ||
	'';

function requireCredentials() {
	if (!DEV_EMAIL || !DEV_PASSWORD) {
		throw new Error(
			'Missing admin credentials. Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD ' +
			'(as the dev container does) or PLAYWRIGHT_ADMIN_EMAIL/PLAYWRIGHT_ADMIN_PASSWORD. ' +
			'Credentials are never hardcoded in the test suite.',
		);
	}
}

const slug = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const desktopEditor = page => page.locator('#editor-panel #note-editor-form');
const mobileEditor = page => page.locator('#mobile-editor-body #note-editor-form');

async function login(page) {
	requireCredentials();
	await page.goto('/login');
	await expect(page.getByRole('heading', { name: 'Joplock' })).toBeVisible();
	await page.getByPlaceholder('Email').fill(DEV_EMAIL);
	await page.locator('#login-password').fill(DEV_PASSWORD);
	await page.getByRole('button', { name: 'Login' }).click();
	await page.waitForURL(/\/$/);
	await expect(page.locator('body.app-shell')).toBeVisible();
}

function acceptDialogs(page) {
	page.on('dialog', dialog => dialog.accept());
}

async function waitForSaved(page) {
	await expect(page.locator('#editor-panel #autosave-status .autosave-ok, #mobile-editor-body #autosave-status .autosave-ok').first()).toHaveText('Saved', { timeout: 10000 });
	const mobileSaved = page.locator('#mobile-editor-status .autosave-ok');
	if (await mobileSaved.count()) {
		await expect(mobileSaved).toHaveText('Saved', { timeout: 10000 });
	}
}

async function setNoteBody(page, body) {
	const cmContent = page.locator('#editor-panel .cm-content, #mobile-editor-body .cm-content').first();
	if (await cmContent.count()) {
		await cmContent.click();
		await page.keyboard.press('Control+A');
		await page.keyboard.press('Delete');
		await page.keyboard.type(body);
		return;
	}
	const textarea = page.locator('#editor-panel #note-body, #mobile-editor-body #note-body').first();
	await expect(textarea).toHaveCount(1);
	await textarea.evaluate((el, value) => {
		el.value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}, body);
}

async function setNoteTitle(page, title) {
	const hiddenInput = page.locator('#editor-panel .editor-title-hidden, #mobile-editor-body .editor-title-hidden').first();
	await expect(hiddenInput).toHaveCount(1);
	await hiddenInput.evaluate((el, value) => {
		el.value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}, title);
	const titleDiv = page.locator('#editor-panel .editor-title, #mobile-editor-body .editor-title').first();
	if (await titleDiv.count()) {
		await titleDiv.evaluate((el, value) => {
			el.textContent = value;
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}, title);
	}
}

async function createNotebook(page, title) {
	await page.locator('button[title="New notebook"]').click();
	await expect(page.locator('#new-folder-modal')).toBeVisible();
	await page.locator('#new-folder-title').fill(title);
	await page.locator('#new-folder-modal-form').evaluate(form => form.requestSubmit());
	await expect(page.locator('#new-folder-modal')).toBeHidden();
	await expect(page.locator('.nav-folder-title', { hasText: title })).toBeVisible();
}

async function deleteNotebook(page, folderName) {
	const folderTitle = page.locator('.nav-folder-title', { hasText: folderName }).first();
	await expect(folderTitle).toBeVisible();
	const row = folderTitle.locator('xpath=ancestor::div[contains(@class,"nav-folder-row")]').first();
	await row.click({ button: 'right' });
	await expect(page.locator('#folder-context-menu')).toBeVisible();
	await page.getByRole('button', { name: 'Delete notebook' }).click();
	await expect(page.locator('.nav-folder-title', { hasText: folderName })).toHaveCount(0, { timeout: 15000 });
}

async function trashDesktopNote(page) {
	const deleteBtn = page.locator('#editor-panel .btn-danger').first();
	await expect(deleteBtn).toBeVisible();
	await deleteBtn.click();
	await expect(page.locator('.nav-folder[data-folder-id="de1e7ede1e7ede1e7ede1e7ede1e7ede"]')).toBeVisible();
}

async function createDesktopNote(page, folderName) {
	const button = page.locator(`.nav-folder[data-folder-title="${folderName}"] .nav-folder-add`).first();
	await expect(button).toBeVisible();
	await button.click();
	await expect(desktopEditor(page)).toBeVisible();
}

async function openDesktopNote(page, noteTitle) {
	await page.getByRole('button', { name: noteTitle, exact: true }).click();
	await expect(desktopEditor(page)).toBeVisible();
	await expect(page.locator('#editor-panel .editor-title')).toContainText(noteTitle);
}

async function searchDesktop(page, query) {
	const search = page.locator('#nav-search');
	await search.fill(query);
	await search.press('Enter');
	await expect(page.locator('.nav-folder-title', { hasText: 'Search Results' })).toBeVisible();
}

async function openSettings(page) {
	await page.goto('/settings');
	await page.waitForURL(/\/settings/);
	await expect(page.getByRole('heading', { name: 'Joplock Settings' })).toBeVisible();
}

async function ensureMobileFoldersScreen(page) {
	await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
	if (await page.locator('#mobile-editor-screen.mobile-screen-active').count()) {
		await page.locator('#mobile-editor-back').click();
	}
	if (await page.locator('#mobile-notes-screen.mobile-screen-active').count()) {
		await page.locator('#mobile-notes-screen .mobile-back-btn').click();
	}
	await expect(page.locator('#mobile-folders-screen.mobile-screen-active')).toBeVisible();
}

async function setUiMode(page, mode) {
	const result = await page.evaluate(async value => {
		const res = await fetch('/api/web/settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ uiMode: value }),
		});
		return res.status;
	}, mode);
	if (result !== 204) throw new Error(`setUiMode failed: ${result}`);
}

async function logout(page) {
	await page.goto('/logout');
	await expect(page.locator('#logout-login-link')).toBeVisible({ timeout: 15000 });
	await page.locator('#logout-login-link').click();
	await page.waitForURL(/\/login\?loggedOut=1/);
	await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
}

async function openMobileFolder(page, folderName) {
	await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
	const row = page.locator('#mobile-folders-body .mobile-folder-row', { hasText: folderName }).first();
	await expect(row).toBeVisible();
	await row.click();
	await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
	await expect(page.locator('#mobile-notes-title')).toContainText(folderName);
}

async function openMobileNote(page, noteTitle) {
	await page.getByRole('button', { name: new RegExp(noteTitle) }).click();
	await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
	await expect(mobileEditor(page)).toBeVisible();
}

// Best-effort id of the note currently open in the editor (desktop or mobile),
// read from the editor form's hx-put target. Returns '' if none.
async function getActiveNoteId(page) {
	const form = page.locator('#editor-panel #note-editor-form, #mobile-editor-body #note-editor-form').first();
	if (!(await form.count())) return '';
	const hxPut = (await form.getAttribute('hx-put')) || '';
	const id = hxPut.split('/').pop() || '';
	return /^[0-9a-fA-F]{32}$/.test(id) ? id : '';
}

// Permanently remove test-created data so runs never leave notes/notebooks/
// resources in the shared Joplin DB. Best-effort: never throws, safe to call in
// a finally block even after a failed test. Requires an authenticated page.
//
// It deletes:
//   - every non-deleted note whose parent is one of `folders` (matched by name)
//     OR whose title matches one of `titlePrefixes`; each note is trashed then
//     permanently deleted (DELETE /fragments/notes/:id twice).
//   - the named `folders` themselves (DELETE /api/web/folders/:id).
//   - any resources left orphaned afterwards (admin cleanup).
//
// NOTE: deleting a notebook in the app moves its notes to "General" rather than
// removing them, which is why we purge the notes explicitly BEFORE the folders.
async function teardownTestData(page, { folders = [], folderPrefixes = [], titlePrefixes = [], noteIds = [] } = {}) {
	try {
		await page.evaluate(async ({ folderNames, folderPrefixes, prefixes, ids }) => {
			const j = async (url, opts) => {
				try {
					const res = await fetch(url, { credentials: 'same-origin', ...opts });
					const text = await res.text();
					try { return { status: res.status, data: JSON.parse(text) }; }
					catch { return { status: res.status, data: null }; }
				} catch { return { status: 0, data: null }; }
			};

			// Resolve target folders by exact name or name-prefix.
			const folderRes = await j('/api/web/folders');
			const allFolders = (folderRes.data && folderRes.data.items) || [];
			const targetFolderIds = new Set(
				allFolders
					.filter(f =>
						folderNames.includes(f.title) ||
						folderPrefixes.some(p => p && typeof f.title === 'string' && f.title.startsWith(p)),
					)
					.map(f => f.id),
			);

			// Find notes to purge: explicit ids, notes in a target folder, or
			// notes whose title matches a prefix.
			const headerRes = await j('/api/web/notes/headers');
			const notes = (headerRes.data && headerRes.data.items) || [];
			const doomed = new Set(ids || []);
			for (const n of notes) {
				if (doomed.has(n.id)) continue;
				if ((n.parentId && targetFolderIds.has(n.parentId)) ||
					prefixes.some(p => p && typeof n.title === 'string' && n.title.startsWith(p))) {
					doomed.add(n.id);
				}
			}

			// Trash then permanently delete each note (DELETE twice).
			for (const id of doomed) {
				await j('/fragments/notes/' + encodeURIComponent(id), { method: 'DELETE' });
				await j('/fragments/notes/' + encodeURIComponent(id), { method: 'DELETE' });
			}

			// Purge anything else already sitting in Trash from this run.
			await j('/fragments/trash/empty', { method: 'POST' });

			// Delete the test folders.
			for (const id of targetFolderIds) {
				await j('/api/web/folders/' + encodeURIComponent(id), { method: 'DELETE' });
			}

			// Remove now-orphaned resources (uploaded images/files).
			await j('/admin/orphaned-resources/cleanup', { method: 'POST' });
		}, { folderNames: folders, folderPrefixes, prefixes: titlePrefixes, ids: noteIds });
	} catch {
		// best-effort cleanup — never fail a test because teardown hiccuped
	}
}

module.exports = {
	acceptDialogs,
	ADMIN_EMAIL: DEV_EMAIL,
	ADMIN_PASSWORD: DEV_PASSWORD,
	hasAdminCredentials: () => !!(DEV_EMAIL && DEV_PASSWORD),
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	ensureMobileFoldersScreen,
	openDesktopNote,
	openMobileFolder,
	openMobileNote,
	openSettings,
	getActiveNoteId,
	searchDesktop,
	setNoteBody,
	setNoteTitle,
	setUiMode,
	slug,
	teardownTestData,
	trashDesktopNote,
	waitForSaved,
};
