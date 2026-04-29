'use strict';

const { expect } = require('@playwright/test');

const DEV_EMAIL = process.env.PLAYWRIGHT_EMAIL || 'admin@localhost';
const DEV_PASSWORD = process.env.PLAYWRIGHT_PASSWORD || 'admin';

const slug = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const desktopEditor = page => page.locator('#editor-panel #note-editor-form');
const mobileEditor = page => page.locator('#mobile-editor-body #note-editor-form');

async function login(page) {
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
	await page.getByRole('button', { name: '+ Notebook' }).click();
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

module.exports = {
	acceptDialogs,
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
	searchDesktop,
	setNoteBody,
	setNoteTitle,
	setUiMode,
	slug,
	waitForSaved,
};
