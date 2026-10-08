'use strict';

// Real-browser coverage for the markdown-mode (CodeMirror 6) extras in
// public/cm-extras.js: inline image previews + drag-resize, attachment chips,
// clickable task checkboxes, table helper, paste-as-markdown, status bar +
// outline, folding, live-preview marker hiding and the code-block Copy button.
// Desktop only.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	ensureMobileFoldersScreen,
	login,
	openMobileFolder,
	setNoteTitle,
	teardownTestData,
	waitForSaved,
} = require('./helpers');

const TEST_IMAGE = path.resolve(__dirname, '..', 'public', 'icon-192.png');
const IMG_B64 = fs.readFileSync(TEST_IMAGE).toString('base64');
const PDF_B64 = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

// These specs assert on DOM text, which depends on the user's markdown-editor
// settings (e.g. "hide formatting marks" removes `## ` from every line the caret
// is not on). Pin the defaults for the whole file and put the account's real
// settings back afterwards.
const MD_SETTING_DEFAULTS = { mdInlineWidgets: true, mdLivePreview: false, mdStatusBar: true, mdFolding: true };
const MD_SETTING_IDS = {
	mdInlineWidgets: 'settings-md-inline-widgets',
	mdLivePreview: 'settings-md-live-preview',
	mdStatusBar: 'settings-md-status-bar',
	mdFolding: 'settings-md-folding',
};
async function readMdSettings(page) {
	const html = await page.evaluate(async () => (await fetch('/settings', { credentials: 'same-origin' })).text());
	const out = {};
	for (const [key, id] of Object.entries(MD_SETTING_IDS)) {
		const tag = (html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`)) || [''])[0].replace(/onchange="[^"]*"/, '');
		out[key] = /\schecked\b/.test(tag);
	}
	return out;
}
async function putMdSettings(page, values) {
	return page.evaluate(async v => (await fetch('/api/web/settings', {
		method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(v),
	})).status, values);
}
let originalMdSettings = null;
test.beforeAll(async ({ browser }) => {
	const page = await browser.newPage();
	try {
		await login(page);
		originalMdSettings = await readMdSettings(page);
		expect(await putMdSettings(page, MD_SETTING_DEFAULTS)).toBe(204);
	} finally {
		await page.close();
	}
});
test.afterAll(async ({ browser }) => {
	if (!originalMdSettings) return;
	const page = await browser.newPage();
	try {
		await login(page);
		await putMdSettings(page, originalMdSettings);
	} finally {
		await page.close();
	}
});

async function setDoc(page, text) {
	await page.evaluate(t => {
		const v = getCM();
		v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, selection: { anchor: 0 } });
	}, text);
}
const getDoc = page => page.evaluate(() => getCM().state.doc.toString());

// Upload a file through the real drop handler on the CM content element.
async function dropFile(page, { name, mime, data }) {
	await page.evaluate(async ({ name, mime, data }) => {
		const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
		const dt = new DataTransfer();
		dt.items.add(new File([bytes], name, { type: mime }));
		const target = document.querySelector('#editor-panel .cm-content');
		target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
	}, { name, mime, data });
}

async function pasteData(page, { text, html }) {
	await page.evaluate(({ text, html }) => {
		const dt = new DataTransfer();
		if (text != null) dt.setData('text/plain', text);
		if (html != null) dt.setData('text/html', html);
		const target = document.querySelector('#editor-panel .cm-content');
		target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
	}, { text, html });
}

async function openFreshNote(page, folder, title) {
	await login(page);
	await createNotebook(page, folder);
	await createDesktopNote(page, folder);
	await setNoteTitle(page, title);
	const md = page.locator('#editor-panel #markdown-toggle');
	if (await md.count()) await md.click();
	await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
}

test.describe('Markdown mode extras', () => {
	test.beforeEach(({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
	});

	let folder;
	test.beforeEach(async ({ page }, testInfo) => {
		if (testInfo.project.name !== 'desktop') return;
		folder = `pw-mdx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		await openFreshNote(page, folder, `MD extras ${Date.now()}`);
	});
	test.afterEach(async ({ page }, testInfo) => {
		if (testInfo.project.name !== 'desktop') return;
		await teardownTestData(page, { folders: [folder] });
	});

	test('uploaded image shows an inline preview that can be resized and reset', async ({ page }) => {
		await setDoc(page, 'Intro\n\n');
		await dropFile(page, { name: 'pic.png', mime: 'image/png', data: IMG_B64 });

		const img = page.locator('#editor-panel .cm-jl-img img').first();
		await expect(img).toBeVisible({ timeout: 15000 });
		await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth), { timeout: 10000 }).toBeGreaterThan(0);
		expect(await getDoc(page)).toMatch(/!\[pic\.png\]\(:\/[0-9a-f]{32}\)/);
		await page.screenshot({ path: 'test-results/mdx-image-preview.png' });

		// Real mouse drag on the resize handle.
		const fig = page.locator('#editor-panel .cm-jl-img').first();
		await fig.hover();
		const handle = fig.locator('.cm-jl-img-handle');
		const hb = await handle.boundingBox();
		const before = (await img.boundingBox()).width;
		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(hb.x + hb.width / 2 - 60, hb.y + hb.height / 2, { steps: 6 });
		await page.mouse.up();

		await expect.poll(() => getDoc(page), { timeout: 5000 }).toMatch(/<img src=":\/[0-9a-f]{32}" alt="pic\.png" width="\d+" \/>/);
		const width = Number((await getDoc(page)).match(/width="(\d+)"/)[1]);
		expect(width).toBeLessThan(before);
		await expect.poll(async () => Math.round((await page.locator('#editor-panel .cm-jl-img img').first().boundingBox()).width), { timeout: 5000 }).toBe(width);

		// Rendered mode honours the same width, and the width survives a round trip.
		await page.locator('#editor-panel #preview-toggle').click();
		const frame = page.frameLocator('iframe.tox-edit-area__iframe');
		await expect(frame.locator('img[width]').first()).toBeVisible({ timeout: 15000 });
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		expect(await getDoc(page)).toMatch(new RegExp(`width="${width}"`));

		// Double-click the handle: back to natural size, plain markdown.
		const fig2 = page.locator('#editor-panel .cm-jl-img').first();
		await fig2.hover();
		await fig2.locator('.cm-jl-img-handle').dblclick();
		await expect.poll(() => getDoc(page), { timeout: 5000 }).toMatch(/!\[pic\.png\]\(:\/[0-9a-f]{32}\)/);
	});

	test('images and attachments can be downloaded from markdown mode like in rendered mode', async ({ page }) => {
		await setDoc(page, 'Files:\n\n');
		await dropFile(page, { name: 'dl-pic.png', mime: 'image/png', data: IMG_B64 });
		await dropFile(page, { name: 'dl-sheet.pdf', mime: 'application/pdf', data: PDF_B64 });

		const img = page.locator('#editor-panel .cm-jl-img img').first();
		await expect(img).toBeVisible({ timeout: 15000 });
		const chip = page.locator('#editor-panel .cm-jl-chip').first();
		await expect(chip).toHaveAttribute('data-kind', 'resource', { timeout: 15000 });

		// Image preview: hover reveals the button; clicking it opens the Save sheet.
		await page.locator('#editor-panel .cm-jl-img').first().hover();
		const imgBtn = page.locator('#editor-panel .cm-jl-img-dl').first();
		await expect(imgBtn).toBeVisible();
		await imgBtn.click();
		await expect(page.locator('#resource-action-sheet')).toBeVisible();
		const [imgDownload] = await Promise.all([
			page.waitForEvent('download'),
			page.locator('#resource-action-sheet').getByRole('button', { name: 'Save' }).click(),
		]);
		expect(imgDownload.suggestedFilename()).toBe('dl-pic.png');
		await page.screenshot({ path: 'test-results/mdx-download-image.png' });

		// Attachment chip: the arrow inside the chip downloads, the chip itself opens it.
		await chip.hover();
		const chipBtn = chip.locator('.cm-jl-chip-dl');
		await expect(chipBtn).toBeVisible();
		await chipBtn.click();
		await expect(page.locator('#resource-action-sheet')).toBeVisible();
		const [pdfDownload] = await Promise.all([
			page.waitForEvent('download'),
			page.locator('#resource-action-sheet').getByRole('button', { name: 'Save' }).click(),
		]);
		expect(pdfDownload.suggestedFilename()).toBe('dl-sheet.pdf');
		expect(await getDoc(page)).toMatch(/!\[dl-pic\.png\]/); // note untouched by downloading
		await page.screenshot({ path: 'test-results/mdx-download-chip.png' });
	});

	test('rendered mode image download button shows the arrow glyph (not mis-escaped CSS text)', async ({ page }) => {
		await setDoc(page, 'Pic:\n\n');
		await dropFile(page, { name: 'glyph.png', mime: 'image/png', data: IMG_B64 });
		await expect(page.locator('#editor-panel .cm-jl-img img').first()).toBeVisible({ timeout: 15000 });
		await waitForSaved(page);
		await page.locator('#editor-panel #preview-toggle').click();
		const frame = page.frameLocator('iframe.tox-edit-area__iframe');
		await expect(frame.locator('img.preview-img').first()).toBeVisible({ timeout: 15000 });
		const content = await frame.locator('.preview-img-download-btn').first().evaluate(
			btn => btn.ownerDocument.defaultView.getComputedStyle(btn, '::after').content,
		);
		// A single-backslash JS string once produced "\u0002B07FE0F" here (box glyph + literal text).
		expect(content).toBe('"\u2b07\ufe0f"');
	});

	test('Export note works in markdown mode: .md, .html, .docx and .pdf', async ({ page }) => {
		test.setTimeout(150000);
		await setDoc(page, '# Export me\n\nBody with **bold** text.\n\n- [x] done\n- [ ] todo\n\n');
		await dropFile(page, { name: 'export-pic.png', mime: 'image/png', data: IMG_B64 });
		await expect(page.locator('#editor-panel .cm-jl-img img')).toBeVisible({ timeout: 15000 });
		await waitForSaved(page);

		const readDownload = async (itemText) => {
			await page.locator('#editor-panel #export-note-btn').click();
			const menu = page.locator('#export-menu');
			await expect(menu).toBeVisible();
			// Every format is offered while in markdown mode.
			await expect(menu.locator('button', { hasText: /Markdown|HTML|Word|PDF/ })).toHaveCount(4);
			const [download] = await Promise.all([
				page.waitForEvent('download', { timeout: 90000 }),
				menu.locator('button', { hasText: itemText }).click(),
			]);
			const file = await download.path();
			return { name: download.suggestedFilename(), data: fs.readFileSync(file) };
		};

		const md = await readDownload('Markdown');
		expect(md.name).toMatch(/\.md$/);
		expect(md.data.toString('utf8')).toContain('# Export me');

		const html = await readDownload('HTML');
		expect(html.name).toMatch(/\.html$/);
		const htmlText = html.data.toString('utf8');
		expect(htmlText).toContain('<h1>Export me</h1>');
		expect(htmlText).toContain('data:image/png;base64,');
		expect(htmlText).not.toMatch(/:\/[0-9a-f]{32}/);

		const docx = await readDownload('Word');
		expect(docx.name).toMatch(/\.docx$/);
		expect(docx.data.subarray(0, 2).toString()).toBe('PK');
		expect(docx.data.includes(Buffer.from('word/media/'))).toBe(true); // the image is embedded

		const pdf = await readDownload('PDF');
		expect(pdf.name).toMatch(/\.pdf$/);
		expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
		expect(pdf.data.length).toBeGreaterThan(2000);
		await page.screenshot({ path: 'test-results/mdx-export.png' });
	});

	test('clicking a preview selects its source so Delete removes the image', async ({ page }) => {
		await setDoc(page, 'Top\n\n');
		await dropFile(page, { name: 'del.png', mime: 'image/png', data: IMG_B64 });
		const img = page.locator('#editor-panel .cm-jl-img img').first();
		await expect(img).toBeVisible({ timeout: 15000 });
		await img.click();
		await page.keyboard.press('Delete');
		await expect(page.locator('#editor-panel .cm-jl-img')).toHaveCount(0);
		expect(await getDoc(page)).not.toMatch(/:\/[0-9a-f]{32}/);
	});

	test('an attachment becomes a chip with hover info; the caret reveals the raw link', async ({ page }) => {
		await setDoc(page, 'Files:\n\n');
		await dropFile(page, { name: 'spec-sheet.pdf', mime: 'application/pdf', data: PDF_B64 });
		const chip = page.locator('#editor-panel .cm-jl-chip').first();
		await expect(chip).toBeVisible({ timeout: 15000 });
		await expect(chip).toContainText('spec-sheet.pdf');
		await expect(chip).toHaveAttribute('data-kind', 'resource', { timeout: 10000 });
		// A text-like file must be uploaded, NOT also pasted into the note as text
		// (CodeMirror's own drop handler used to do exactly that).
		expect(await getDoc(page)).not.toContain('%PDF');
		await page.screenshot({ path: 'test-results/mdx-chip.png' });

		// Hover tooltip with file info.
		await chip.hover();
		await expect(page.locator('.cm-tooltip .cm-jl-tip')).toContainText('spec-sheet.pdf', { timeout: 8000 });

		// Put the caret inside the link text: the raw markdown is revealed.
		await page.evaluate(() => {
			const v = getCM();
			const i = v.state.doc.toString().indexOf('spec-sheet');
			v.focus();
			v.dispatch({ selection: { anchor: i + 2 } });
		});
		await expect(page.locator('#editor-panel .cm-jl-chip')).toHaveCount(0);
		await expect(page.locator('#editor-panel .cm-content')).toContainText('](:/');
	});

	test('task checkboxes toggle on click and the change is saved', async ({ page }) => {
		await setDoc(page, '- [ ] first\n- [x] second\n');
		const boxes = page.locator('#editor-panel .cm-jl-check');
		await expect(boxes).toHaveCount(2);
		await expect(page.locator('#editor-panel .cm-jl-task-done')).toContainText('second');
		await boxes.first().click();
		await expect.poll(() => getDoc(page)).toBe('- [x] first\n- [x] second\n');
		await boxes.nth(1).click();
		await expect.poll(() => getDoc(page)).toBe('- [x] first\n- [ ] second\n');
		await expect(page.locator('#editor-panel #note-body')).toHaveValue('- [x] first\n- [ ] second\n');
		await page.screenshot({ path: 'test-results/mdx-checkboxes.png' });
	});

	test('table helper: Tab aligns and moves between cells and appends rows; typing a table by hand still works', async ({ page }) => {
		await setDoc(page, '| a | b |\n|-|-|\n| 1 | 2 |\n');
		await page.evaluate(() => {
			const v = getCM();
			v.focus();
			v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf('1') + 1 } });
		});
		await page.keyboard.press('Tab');
		expect(await getDoc(page)).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |\n');
		await page.keyboard.type('X');
		await page.keyboard.press('Tab'); // last cell of last row -> new row
		await page.keyboard.type('new');
		await page.keyboard.press('Tab');
		await page.keyboard.type('cell');
		await page.keyboard.press('Tab');
		const doc = await getDoc(page);
		expect(doc).toBe('| a   | b    |\n| --- | ---- |\n| 1   | 2X   |\n| new | cell |\n|     |      |\n');
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.type('!');
		expect((await getDoc(page)).split('\n')[3]).toMatch(/^\| new\s+\| cell!\s+\|$/);

		// Enter is never hijacked: a table typed by hand, row by row, stays exactly as typed.
		await setDoc(page, '');
		await page.evaluate(() => getCM().focus());
		await page.keyboard.type('| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |\n');
		expect(await getDoc(page)).toBe('| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |\n');
	});

	test('paste: rich HTML becomes markdown, URL over a selection becomes a link, code stays raw', async ({ page }) => {
		await setDoc(page, '');
		await page.evaluate(() => getCM().focus());
		await pasteData(page, { text: 'Title\nitem', html: '<h2>Title</h2><ul><li>item one</li><li><a href="https://example.com/x">link</a></li></ul>' });
		const doc = await getDoc(page);
		expect(doc).toContain('## Title');
		expect(doc).toMatch(/-\s+item one/);
		expect(doc).toContain('[link](https://example.com/x)');

		await setDoc(page, 'see the docs here');
		await page.evaluate(() => {
			const v = getCM();
			v.focus();
			v.dispatch({ selection: { anchor: 8, head: 12 } });
		});
		await pasteData(page, { text: 'https://example.com/docs' });
		expect(await getDoc(page)).toBe('see the [docs](https://example.com/docs) here');

		// Inside a fenced code block HTML is not converted.
		await setDoc(page, '```\n\n```');
		await page.evaluate(() => { const v = getCM(); v.focus(); v.dispatch({ selection: { anchor: 4 } }); });
		await pasteData(page, { text: 'raw text', html: '<h1>raw text</h1>' });
		expect(await getDoc(page)).toBe('```\nraw text\n```');
	});

	test('status bar shows counts; outline jumps to a heading; headings fold', async ({ page }) => {
		const body = '# One\n\nfirst section text\n\n## Two\n\nsecond section text\n\n### Three\n\nthird\n';
		await setDoc(page, body);
		const status = page.locator('#editor-panel .cm-jl-status');
		await expect(status).toContainText(/\d+ words/);
		await page.screenshot({ path: 'test-results/mdx-statusbar.png' });

		await page.locator('#editor-panel .cm-jl-outline-btn').click();
		const items = page.locator('#editor-panel .cm-jl-outline-item');
		await expect(items).toHaveText(['One', 'Two', 'Three']);
		await items.nth(2).click();
		await expect.poll(() => page.evaluate(() => {
			const v = getCM();
			return v.state.doc.lineAt(v.state.selection.main.head).text;
		})).toBe('### Three');

		// Fold "## Two" through its gutter marker.
		const lineCountBefore = await page.locator('#editor-panel .cm-content .cm-line').count();
		const twoLine = page.locator('#editor-panel .cm-content .cm-line', { hasText: '## Two' });
		await twoLine.hover();
		await page.locator('#editor-panel .cm-foldGutter .cm-gutterElement', { has: page.locator('.cm-jl-fold-marker.open') }).nth(1).click();
		await expect(page.locator('#editor-panel .cm-jl-fold-placeholder')).toHaveCount(1);
		await expect(page.locator('#editor-panel .cm-content')).not.toContainText('second section text');
		expect(await page.locator('#editor-panel .cm-content .cm-line').count()).toBeLessThan(lineCountBefore);
		// The folded text is still in the document / textarea.
		expect(await getDoc(page)).toContain('second section text');
		await page.screenshot({ path: 'test-results/mdx-fold.png' });
		await page.locator('#editor-panel .cm-jl-fold-placeholder').click();
		await expect(page.locator('#editor-panel .cm-content')).toContainText('second section text');
	});

	test('code blocks get a Copy button that copies just the code', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await setDoc(page, 'Before\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\nAfter\n');
		await expect(page.locator('#editor-panel .cm-jl-codeline')).toHaveCount(4);
		await page.locator('#editor-panel .cm-jl-copy').click();
		await expect(page.locator('#editor-panel .cm-jl-copy')).toHaveText('Copied');
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const a = 1;\nconsole.log(a);');
		await page.screenshot({ path: 'test-results/mdx-codeblock.png' });
	});

	test('note links show hover info with the target note title', async ({ page }) => {
		const id = await page.evaluate(() => (document.querySelector('#editor-panel #note-editor-form').getAttribute('hx-put') || '').split('/').pop());
		await setDoc(page, `Self link: [My own note](:/${id}) end\n`);
		// Let the autosave land first: the note-title cache is invalidated by saves,
		// and the tooltip reads the saved title.
		await waitForSaved(page);
		const chip = page.locator('#editor-panel .cm-jl-chip').first();
		await expect(chip).toBeVisible();
		await expect(chip).toHaveAttribute('data-kind', 'note', { timeout: 10000 });
		await page.mouse.move(5, 5);
		await chip.hover();
		await expect(page.locator('.cm-tooltip .cm-jl-tip')).toContainText('MD extras', { timeout: 8000 });
	});
});

test.describe('Markdown mode live preview (setting)', () => {
	test('hides formatting marks off the caret line and reveals them on it', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folder = `pw-mdx-lp-${Date.now()}`;
		try {
			await openFreshNote(page, folder, `LP ${Date.now()}`);
			const put = value => page.evaluate(async v => (await fetch('/api/web/settings', {
				method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ mdLivePreview: v }),
			})).status, value);
			expect(await put(true)).toBe(204);
			await page.reload();
			await expect(page.locator('body.app-shell')).toBeVisible({ timeout: 15000 });
			// Reopen the note in markdown mode.
			await page.locator(`.nav-folder[data-folder-title="${folder}"]`).first().click().catch(() => {});
			const note = page.locator(`.nav-folder[data-folder-title="${folder}"] .notelist-item`).first();
			await expect(note).toBeVisible({ timeout: 15000 });
			await note.click();
			const md = page.locator('#editor-panel #markdown-toggle');
			if (await md.count()) await md.click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });

			await setDoc(page, '# Big title\n\nsome **bold** and [a link](https://example.com) and `code`\n\nlast line\n');
			await page.evaluate(() => { const v = getCM(); v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); });
			const content = page.locator('#editor-panel .cm-content');
			await expect(content).not.toContainText('# Big title');
			await expect(content).not.toContainText('**bold**');
			await expect(content).not.toContainText('](https://example.com)');
			await expect(content).toContainText('some bold and a link and code');
			await page.screenshot({ path: 'test-results/mdx-livepreview-hidden.png' });

			// Marks are revealed per construct: caret in the bold word shows ** only...
			await page.evaluate(() => { const v = getCM(); v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf('bold') } }); });
			await expect(content).toContainText('**bold**');
			await expect(content).not.toContainText('](https://example.com)');
			await expect(content).not.toContainText('# Big title');
			// ...caret in the link shows the link syntax.
			await page.evaluate(() => { const v = getCM(); v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf('a link') + 2 } }); });
			await expect(content).toContainText('[a link](https://example.com)');
			await expect(content).not.toContainText('**bold**');
			// ...and the heading's when the caret goes there.
			await page.evaluate(() => { getCM().dispatch({ selection: { anchor: 3 } }); });
			await expect(content).toContainText('# Big title');
			await page.screenshot({ path: 'test-results/mdx-livepreview-reveal.png' });
		} finally {
			await page.evaluate(async () => fetch('/api/web/settings', {
				method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ mdLivePreview: false }),
			})).catch(() => {});
			await teardownTestData(page, { folders: [folder] });
		}
	});
});

test.describe('Markdown mode extras (mobile shell)', () => {
	test('checkboxes toggle on tap, previews fit the screen, status bar is visible', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);
		try {
			await login(page);
			await ensureMobileFoldersScreen(page);
			await openMobileFolder(page, 'All Notes');
			await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
			await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
			await page.locator('#mobile-md-toggle').click();
			await expect(page.locator('#mobile-editor-body #cm-host')).toBeVisible();

			await setDoc(page, '# pw-mdx-mobile heading\n\n- [ ] task one\n- [x] task two\n\n');
			await page.evaluate(async data => {
				const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
				const dt = new DataTransfer();
				dt.items.add(new File([bytes], 'm.png', { type: 'image/png' }));
				const v = getCM();
				v.dispatch({ selection: { anchor: v.state.doc.length } });
				document.querySelector('#mobile-editor-body .cm-content').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
			}, IMG_B64);

			const img = page.locator('#mobile-editor-body .cm-jl-img img').first();
			await expect(img).toBeVisible({ timeout: 15000 });
			const vw = page.viewportSize().width;
			const box = await img.boundingBox();
			expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);

			await page.locator('#mobile-editor-body .cm-jl-check').first().tap();
			await expect.poll(() => getDoc(page)).toContain('- [x] task one');

			const status = page.locator('#mobile-editor-body .cm-jl-status');
			await expect(status).toBeVisible();
			const sb = await status.boundingBox();
			expect(sb.y + sb.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
			// Export is reachable from the mobile editor menu in markdown mode too.
			await page.locator('#mobile-editor-menu-btn').click();
			await expect(page.locator('#mobile-ctx-export')).toBeVisible();
			await page.locator('#mobile-ctx-export').click();
			await expect(page.locator('#export-menu')).toBeVisible();
			await expect(page.locator('#export-menu #export-pdf-btn')).toBeVisible();
			await page.screenshot({ path: 'test-results/mdx-mobile.png' });
		} finally {
			await teardownTestData(page, { titlePrefixes: ['pw-mdx-mobile'] });
		}
	});
});
