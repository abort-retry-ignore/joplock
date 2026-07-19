'use strict';

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	login,
	setNoteBody,
	teardownTestData,
	waitForSaved,
	slug,
} = require('./helpers');

async function setupNote(page, body) {
	const mdToggle = page.locator('#editor-panel #markdown-toggle');
	if (!(await mdToggle.evaluate(el => el.classList.contains('active')))) {
		await mdToggle.click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 10000 });
	}
	await setNoteBody(page, body);
	await waitForSaved(page);
	await page.locator('#editor-panel #preview-toggle').click();
	await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
	const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
	await expect(iframeBody).not.toBeEmpty({ timeout: 15000 });
	return iframeBody;
}

// Click inside a <li> and use arrow keys to position caret at a character offset.
// This keeps TinyMCE's internal selection in sync (unlike programmatic setRange).
async function positionCaretInLi(page, iframeBody, charOffset) {
	const li = iframeBody.locator('li').first();
	await li.click();
	await page.keyboard.press('Home');
	for (let i = 0; i < charOffset; i++) await page.keyboard.press('ArrowRight');
}

async function getListItems(iframeBody, listTag) {
	return iframeBody.evaluate((_body, tag) => {
		const list = document.querySelector(tag);
		if (!list) return [];
		return Array.from(list.querySelectorAll('li')).map(li => li.textContent.trim());
	}, listTag);
}

test.describe('Enter splits list items in rendered mode', () => {
	let folder;

	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'Desktop only — TinyMCE not on mobile');
		acceptDialogs(page);
		await login(page);
		folder = slug('lists');
		await createNotebook(page, folder);
		await createDesktopNote(page, folder);
	});

	test.afterEach(async ({ page }) => {
		await teardownTestData(page, { folders: [folder] });
	});

	test('Enter in middle of bullet list item splits text', async ({ page }) => {
		const iframeBody = await setupNote(page, '- Hello World');

		const before = await getListItems(iframeBody, 'ul');
		expect(before).toEqual(['Hello World']);

		// Position caret after "Hello " (offset 6)
		await positionCaretInLi(page, iframeBody, 6);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		const after = await getListItems(iframeBody, 'ul');
		expect(after).toEqual(['Hello', 'World']);
	});

	test('Enter in middle of numbered list item splits text', async ({ page }) => {
		const iframeBody = await setupNote(page, '1. First Second');

		const before = await getListItems(iframeBody, 'ol');
		expect(before).toEqual(['First Second']);

		// Position caret after "First " (offset 6)
		await positionCaretInLi(page, iframeBody, 6);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		const after = await getListItems(iframeBody, 'ol');
		expect(after).toEqual(['First', 'Second']);
	});

	test('Enter at end of list item creates empty <li> below', async ({ page }) => {
		const iframeBody = await setupNote(page, '- Hello World');

		// Position caret at end (offset 11)
		await positionCaretInLi(page, iframeBody, 11);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		const after = await getListItems(iframeBody, 'ul');
		expect(after.length).toBe(2);
		expect(after[0]).toBe('Hello World');
	});

	test('Enter at start of list item creates empty <li> above', async ({ page }) => {
		const iframeBody = await setupNote(page, '- Hello World');

		// Position caret at start (offset 0)
		await positionCaretInLi(page, iframeBody, 0);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		const after = await getListItems(iframeBody, 'ul');
		// All text moves to new <li>, original becomes empty
		expect(after.length).toBe(2);
	});

	test('Enter in list item with inline formatting preserves formatting', async ({ page }) => {
		const iframeBody = await setupNote(page, '- Hello **World** Test');

		// **World** renders as <strong>World</strong>, text content is "Hello World Test"
		const before = await getListItems(iframeBody, 'ul');
		expect(before).toEqual(['Hello World Test']);

		// Position caret after "Hello " (offset 6 in rendered text)
		await positionCaretInLi(page, iframeBody, 6);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		const after = await getListItems(iframeBody, 'ul');
		expect(after.length).toBe(2);
		expect(after[0]).toBe('Hello');
		expect(after[1]).toContain('World');
		expect(after[1]).toContain('Test');
	});
});
