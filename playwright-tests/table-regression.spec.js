'use strict';

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	setNoteBody,
	setNoteTitle,
	slug,
	teardownTestData,
	waitForSaved,
} = require('./helpers');

const IFRAME = 'iframe.tox-edit-area__iframe';
const TABLE_MD = [
	'| A | B | C | D |',
	'| --- | --- | --- | --- |',
	'| 1 | 2 | 3 | 4 |',
	'| 5 | 6 | 7 | 8 |',
	'| 9 | 10 | 11 | 12 |',
].join('\n');

test.describe('Table rendering regression', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('4-column table survives adding a row on top then switching notes and returning', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folder = slug('pw-table-folder');
		const noteA = slug('pw table a');
		const noteB = slug('pw table b');

		await login(page);
		try {
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);
			await setNoteTitle(page, noteA);

			// Write table in markdown mode
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			const ta = page.locator('#editor-panel #note-body');
			await ta.fill(TABLE_MD);
			await ta.dispatchEvent('input');
			await waitForSaved(page);
			const noteIdA = await page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.noteId || '');
			expect(noteIdA).toBeTruthy();

			// Switch to rendered mode
			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator(IFRAME)).toBeVisible({ timeout: 15000 });
			const iframeBody = page.frameLocator(IFRAME).locator('body');
			await expect(iframeBody.locator('table')).toBeVisible({ timeout: 10000 });

			// Capture table structure before insert
			const tableHtmlBefore = await iframeBody.locator('table').evaluate(el => el.outerHTML);
			expect(tableHtmlBefore).toContain('<thead>');

			// Insert a row above the first body row via TinyMCE API
			const inserted = await page.evaluate(() => {
				try {
					const ed = window.getTinyMCE && window.getTinyMCE();
					if (!ed) return 'no editor';
					// Place caret in the first data cell of the first body row
					const body = ed.dom.select('tbody tr td, tbody tr th');
					if (!body.length) return 'no body cells';
					ed.selection.select(body[0]);
					ed.focus();
					ed.execCommand('mceTableInsertRowBefore');
					return 'ok';
				} catch (e) {
					return 'error: ' + e.message;
				}
			});
			expect(inserted).toBe('ok');

			// Type a distinct value into the new row's first cell so we can track it
			const firstNewCell = page.frameLocator(IFRAME).locator('table tbody tr').first().locator('td').first();
			await expect(firstNewCell).toBeVisible({ timeout: 5000 });
			await firstNewCell.click();
			await page.keyboard.selectAll();
			await page.keyboard.type('NEW_TOP');

			// Create second note to switch away
			await createDesktopNote(page, folder);
			await setNoteTitle(page, noteB);
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			await setNoteBody(page, 'switching notes body');
			await waitForSaved(page);

			// Switch back to note A
			const noteABtn = page.locator(`.notelist-item[data-note-id="${noteIdA}"]`).first();
			await expect(noteABtn).toBeVisible({ timeout: 15000 });
			await noteABtn.click();
			await expect.poll(async () => page.locator('#editor-panel #note-editor-form').evaluate(f => f.dataset.noteId || ''), { timeout: 15000 }).toBe(noteIdA);

			// Go to rendered mode
			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator(IFRAME)).toBeVisible({ timeout: 15000 });
			const iframeBody2 = page.frameLocator(IFRAME).locator('body');
			await expect(iframeBody2.locator('table')).toBeVisible({ timeout: 10000 });

			// Table should have 5 rows (1 thead + 4 tbody = original 3 + 1 inserted on top)
			const tableRows = await iframeBody2.locator('table').evaluate(el => {
				return {
					theadCount: el.querySelectorAll('thead tr').length,
					tbodyCount: el.querySelectorAll('tbody tr').length,
					allRows: Array.from(el.querySelectorAll('tr')).map(tr =>
						Array.from(tr.querySelectorAll('th, td')).map(c => (c.textContent || '').trim()),
					),
				};
			});
			expect(tableRows.theadCount).toBe(1);
			expect(tableRows.tbodyCount).toBe(4);
			// Header row must still be A B C D (not duplicated NEW_TOP)
			expect(tableRows.allRows[0]).toEqual(['A', 'B', 'C', 'D']);
			expect(tableRows.allRows[1][0]).toBe('NEW_TOP');

			// Switch to markdown mode and verify no duplication in the source
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			const mdBody = await page.locator('#editor-panel #note-body').inputValue();

			// The markdown must contain exactly one header row (| A | B | C | D |)
			const tableLines = mdBody.split('\n').filter(l => l.startsWith('|'));
			const headerLines = tableLines.filter(l => l.includes('A') && l.includes('B') && l.includes('C') && l.includes('D'));
			expect(headerLines.length).toBe(1, `header row must appear exactly once, got ${headerLines.length}: ${JSON.stringify(mdBody)}`);
			expect(mdBody).toContain('NEW_TOP');
			expect(mdBody).toContain('| 5 | 6 | 7 | 8 |');
			expect(mdBody).toContain('| 9 | 10 | 11 | 12 |');

			// The NEW_TOP line must NOT also appear as a header row
			const newTopLines = tableLines.filter(l => l.includes('NEW_TOP'));
			expect(newTopLines.length).toBe(1, `NEW_TOP row must appear exactly once, got ${newTopLines.length}: ${JSON.stringify(mdBody)}`);

		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});

	test('multiple rendered-to-markdown round-trips of a table with row added on top are stable', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folder = slug('pw-table-roundtrip-folder');
		const note = slug('pw table roundtrip');

		await login(page);
		try {
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);
			await setNoteTitle(page, note);

			// Start with a 4-column table in markdown mode
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			const ta = page.locator('#editor-panel #note-body');
			await ta.fill(TABLE_MD);
			await ta.dispatchEvent('input');
			await waitForSaved(page);
			const noteId = await page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.noteId || '');
			expect(noteId).toBeTruthy();
			const baselineTableLines = (TABLE_MD + '\n').split('\n').filter(l => l.startsWith('|')).length;
			expect(baselineTableLines).toBeGreaterThanOrEqual(4);

			// Round-trip: rendered → markdown → rendered → markdown multiple times
			for (let i = 0; i < 3; i += 1) {
				await page.locator('#editor-panel #preview-toggle').click();
				await expect(page.locator(IFRAME)).toBeVisible({ timeout: 15000 });
				await expect(page.frameLocator(IFRAME).locator('body table')).toBeVisible({ timeout: 10000 });

				await page.locator('#editor-panel #markdown-toggle').click();
				await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			}

			// After multiple round-trips, table must still be intact
			const finalMd = await page.locator('#editor-panel #note-body').inputValue();
			const finalTableLines = finalMd.split('\n').filter(l => l.startsWith('|'));
			// Should have same number of table lines (header + separator + 3 data rows = 5)
			expect(finalTableLines.length).toBe(baselineTableLines);
			expect(finalMd).toContain('| A | B | C | D |');
			expect(finalMd).toContain('| 9 | 10 | 11 | 12 |');

		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});
});
