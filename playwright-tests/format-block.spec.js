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

const BODY = [
	'First paragraph stays as paragraph.',
	'',
	'Second paragraph becomes a heading.',
	'',
	'Third paragraph stays as paragraph.',
].join('\n');

// Note with heading already present and multiple blank lines
const BODY_WITH_HEADING = [
	'# Existing heading',
	'',
	'Normal paragraph one.',
	'',
	'Normal paragraph two.',
	'',
	'Normal paragraph three.',
].join('\n');

async function setupNote(page, body) {
	body = body || BODY;
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
	// Wait for something from the body
	await expect(iframeBody).not.toBeEmpty({ timeout: 15000 });
	return iframeBody;
}

// Click the TinyMCE blocks dropdown and choose a block type by name
async function applyBlockFormat(page, formatName) {
	const blocksBtn = page.locator('button[data-mce-name="blocks"]');
	await expect(blocksBtn).toBeVisible({ timeout: 5000 });
	await blocksBtn.click();
	const option = page.locator('.tox-collection__item').filter({ hasText: new RegExp(`^${formatName}$`) }).first();
	await expect(option).toBeVisible({ timeout: 5000 });
	await option.click();
	await page.waitForTimeout(300);
}

// Get block structure from the TinyMCE iframe
async function getBlocks(iframeBody) {
	return iframeBody.evaluate(body =>
		Array.from(body.querySelectorAll('p,h1,h2,h3,h4,h5,h6'))
			.map(el => ({ tag: el.tagName.toLowerCase(), text: el.textContent.trim() }))
			.filter(b => b.text)
	);
}

test.describe('rendered mode FormatBlock (blocks dropdown)', () => {
	let folder;

	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'Desktop only — TinyMCE blocks toolbar not present on mobile');
		acceptDialogs(page);
		await login(page);
		folder = slug('fmt');
		await createNotebook(page, folder);
		await createDesktopNote(page, folder);
	});

	test.afterEach(async ({ page }) => {
		await teardownTestData(page, { folders: [folder] });
	});

	test('blocks dropdown formats only the paragraph where caret is placed', async ({ page }) => {
		const iframeBody = await setupNote(page);

		// Verify initial: no headings
		const initial = await getBlocks(iframeBody);
		expect(initial.filter(b => b.tag !== 'p').length, 'no headings before formatting').toBe(0);

		const secondPara = iframeBody.locator('p', { hasText: 'Second paragraph becomes a heading.' }).first();
		await expect(secondPara).toBeVisible();
		await secondPara.click();

		await applyBlockFormat(page, 'Heading 3');

		const after = await getBlocks(iframeBody);
		const h3s = after.filter(b => b.tag === 'h3');
		expect(h3s.length, 'exactly one h3').toBe(1);
		expect(h3s[0].text).toContain('Second paragraph');

		expect(after.find(b => b.text.includes('First paragraph'))?.tag, 'first unchanged').toBe('p');
		expect(after.find(b => b.text.includes('Third paragraph'))?.tag, 'third unchanged').toBe('p');
	});

	test('blocks dropdown with triple-click selection formats only that paragraph', async ({ page }) => {
		const iframeBody = await setupNote(page);

		const secondPara = iframeBody.locator('p', { hasText: 'Second paragraph becomes a heading.' }).first();
		await secondPara.click({ clickCount: 3 });

		await applyBlockFormat(page, 'Heading 2');

		const after = await getBlocks(iframeBody);
		const h2s = after.filter(b => b.tag === 'h2');
		expect(h2s.length, 'exactly one h2').toBe(1);
		expect(h2s[0].text).toContain('Second paragraph');
		expect(after.find(b => b.text.includes('First paragraph'))?.tag, 'first unchanged').toBe('p');
		expect(after.find(b => b.text.includes('Third paragraph'))?.tag, 'third unchanged').toBe('p');
	});

	test('blocks dropdown keyboard selection formats only selected block', async ({ page }) => {
		const iframeBody = await setupNote(page);

		const secondPara = iframeBody.locator('p', { hasText: 'Second paragraph becomes a heading.' }).first();
		await secondPara.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');

		await applyBlockFormat(page, 'Heading 1');

		const after = await getBlocks(iframeBody);
		const h1s = after.filter(b => b.tag === 'h1');
		expect(h1s.length, 'exactly one h1').toBe(1);
		expect(h1s[0].text).toContain('Second paragraph');
		expect(after.find(b => b.text.includes('First paragraph'))?.tag, 'first unchanged').toBe('p');
		expect(after.find(b => b.text.includes('Third paragraph'))?.tag, 'third unchanged').toBe('p');
	});

	test('blocks dropdown does not reformat existing heading to wrong type', async ({ page }) => {
		const iframeBody = await setupNote(page, BODY_WITH_HEADING);

		await expect(iframeBody.locator('h1', { hasText: 'Existing heading' })).toBeVisible({ timeout: 5000 });

		// Click in paragraph one and apply H2
		const para1 = iframeBody.locator('p', { hasText: 'Normal paragraph one.' }).first();
		await para1.click();

		await applyBlockFormat(page, 'Heading 2');

		const after = await getBlocks(iframeBody);
		// Original h1 still h1
		expect(after.find(b => b.text.includes('Existing heading'))?.tag, 'existing h1 unchanged').toBe('h1');
		// Para 1 now h2
		expect(after.find(b => b.text.includes('Normal paragraph one'))?.tag, 'para1 now h2').toBe('h2');
		// Paragraphs 2 and 3 still p
		expect(after.find(b => b.text.includes('Normal paragraph two'))?.tag, 'para2 unchanged').toBe('p');
		expect(after.find(b => b.text.includes('Normal paragraph three'))?.tag, 'para3 unchanged').toBe('p');
	});

	test('applying Paragraph type reverts a heading back to paragraph', async ({ page }) => {
		const iframeBody = await setupNote(page, BODY_WITH_HEADING);

		await expect(iframeBody.locator('h1', { hasText: 'Existing heading' })).toBeVisible({ timeout: 5000 });

		// Click in the h1 and apply Paragraph
		const heading = iframeBody.locator('h1', { hasText: 'Existing heading' }).first();
		await heading.click();

		await applyBlockFormat(page, 'Paragraph');

		const after = await getBlocks(iframeBody);
		// Former h1 is now p
		expect(after.find(b => b.text.includes('Existing heading'))?.tag, 'heading reverted to p').toBe('p');
		// Other paragraphs unchanged
		expect(after.filter(b => b.tag === 'h1').length, 'no h1 remains').toBe(0);
	});

	test('blocks dropdown on linebreak-mode note formats only the selected line, not whole note', async ({ page }) => {
		// This is the bug scenario: notes written without blank lines (linebreak mode)
		// render as a single <p> with <br> separators. FormatBlock must not convert
		// the whole <p> when only one line is selected.
		const linebreakBody = [
			'First line of note.',
			'Second line becomes heading.',
			'Third line stays as is.',
		].join('\n'); // no blank lines — renders as single <p> with <br>

		const iframeBody = await setupNote(page, linebreakBody);

		// Verify it renders as a single block (all text in one element)
		const initialBlocks = await getBlocks(iframeBody);
		// All text should be in one block element
		const allText = initialBlocks.map(b => b.text).join(' ');
		expect(allText).toContain('First line');
		expect(allText).toContain('Second line');
		expect(allText).toContain('Third line');

		// Click on the second line text — it's inside the <br>-joined block
		// We use evaluate to click on the text node of the second line
		await iframeBody.evaluate(body => {
			// Find a text node containing 'Second line' and click it
			const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				if (node.textContent.includes('Second line')) {
					const range = document.createRange();
					range.setStart(node, 0);
					range.collapse(true);
					const sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
					break;
				}
			}
		});

		await applyBlockFormat(page, 'Heading 3');

		const after = await getBlocks(iframeBody);
		const h3s = after.filter(b => b.tag === 'h3');

		// Only the second line should be h3 — NOT the entire note
		expect(h3s.length, 'exactly one h3').toBe(1);
		expect(h3s[0].text).toContain('Second line');
		expect(h3s[0].text).not.toContain('First line');
		expect(h3s[0].text).not.toContain('Third line');
	});
});
