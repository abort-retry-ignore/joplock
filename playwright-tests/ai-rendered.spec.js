'use strict';

// Live end-to-end coverage for AI prose completion inside the rendered-mode
// (TinyMCE) editor. Requires admin credentials + a keyed AI profile for that
// user (the dev DB has one); skips gracefully otherwise.
//
// Rendered-mode AI now offers the SAME accept/dismiss popup as markdown mode:
//   - Ctrl/Cmd-Space (editor keydown) requests a completion and shows a popup.
//   - Esc discards it (nothing inserted); Enter/Tab accepts (inserted at caret).
//   - AI-action Expander triggers use the same popup.
//
// AI output is nondeterministic, so assertions check popup presence + that the
// accepted text grows the iframe content, not exact strings.

const { test, expect } = require('@playwright/test');
const {
	login,
	createNotebook,
	createDesktopNote,
	setNoteTitle,
	acceptDialogs,
	hasAdminCredentials,
	slug,
} = require('./helpers');

const IFRAME = 'iframe.tox-edit-area__iframe';
const POPUP = '.note-autocomplete-popup';
const PROMPT = 'The quick brown fox jumped over the lazy dog and then continued ';

async function aiConfigured(page) {
	return page.evaluate(() => !!(window._joplockConfig && window._joplockConfig.openRouterEnabled));
}

async function setAiExpander(page, trigger) {
	const status = await page.evaluate(async t => {
		const res = await fetch('/api/web/settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ textExpanders: [{ id: 'ai-e2e', trigger: t, action: 'ai', profileId: '', text: '' }] }),
		});
		return res.status;
	}, trigger);
	if (status !== 204) throw new Error(`setAiExpander failed: ${status}`);
}

test.describe('AI prose completion (rendered / TinyMCE mode)', () => {
	test.skip(!hasAdminCredentials(), 'requires admin credentials');

	test('Ctrl-Space shows an accept/dismiss popup; Esc discards, Enter inserts', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.setTimeout(120000);
		acceptDialogs(page);

		await login(page);
		if (!(await aiConfigured(page))) test.skip(true, 'no keyed AI profile configured');

		const folderName = slug('pw-ai-folder');
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, slug('pw ai note'));

		await page.locator('#editor-panel #preview-toggle').click();
		const body = page.frameLocator(IFRAME).locator('body');
		await expect(page.locator(IFRAME)).toBeVisible({ timeout: 15000 });

		await body.click();
		await page.keyboard.type(PROMPT);
		const seeded = (await body.innerText()).length;

		// Ctrl-Space -> popup appears (provider round-trip).
		await page.keyboard.press('Control+Space');
		await expect(page.locator(POPUP)).toBeVisible({ timeout: 60000 });
		// Nothing inserted yet.
		expect((await body.innerText()).length).toBeLessThanOrEqual(seeded + 1);

		// Esc discards the suggestion.
		await page.keyboard.press('Escape');
		await expect(page.locator(POPUP)).toBeHidden();
		expect((await body.innerText()).length).toBeLessThanOrEqual(seeded + 1);

		// Request again and accept with Enter.
		await body.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Control+Space');
		await expect(page.locator(POPUP)).toBeVisible({ timeout: 60000 });
		await page.keyboard.press('Enter');
		await expect(page.locator(POPUP)).toBeHidden();
		await expect
			.poll(async () => (await body.innerText()).length, { timeout: 10000 })
			.toBeGreaterThan(seeded + 3);
		expect(await body.innerText()).toContain('quick brown fox');

		// Accepted text synced into the markdown source of truth.
		const noteBodyLen = await page.locator('#editor-panel #note-body').evaluate(el => el.value.length);
		expect(noteBodyLen).toBeGreaterThan(0);
	});

	test('AI-action Expander trigger shows the popup and inserts on accept', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.setTimeout(120000);
		acceptDialogs(page);

		await login(page);
		if (!(await aiConfigured(page))) test.skip(true, 'no keyed AI profile configured');

		await setAiExpander(page, ';;ai');
		await page.reload();
		await expect(page.locator('body.app-shell')).toBeVisible();

		const folderName = slug('pw-ai-trig-folder');
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, slug('pw ai trigger note'));

		await page.locator('#editor-panel #preview-toggle').click();
		const body = page.frameLocator(IFRAME).locator('body');
		await expect(page.locator(IFRAME)).toBeVisible({ timeout: 15000 });

		await body.click();
		await page.keyboard.type(PROMPT);
		const seeded = (await body.innerText()).length;

		// Typing the trigger fires the AI action on keyup: trigger removed, popup shown.
		await page.keyboard.type(';;ai');
		await expect(page.locator(POPUP)).toBeVisible({ timeout: 60000 });
		await expect.poll(async () => await body.innerText()).not.toContain(';;ai');

		await page.keyboard.press('Enter');
		await expect(page.locator(POPUP)).toBeHidden();
		await expect
			.poll(async () => (await body.innerText()).length, { timeout: 10000 })
			.toBeGreaterThan(seeded);
	});
});
