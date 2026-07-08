'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	openDesktopNote,
	openSettings,
	searchDesktop,
	setNoteBody,
	setNoteTitle,
	slug,
	trashDesktopNote,
	waitForSaved,
} = require('./helpers');

const USER_NOTE_BODY = [
	'TEST note',
	'',
	'this is anotehr note, with only',
	'4 lines in it, but shouldn\'t be double spaced.',
	'its not monospace. but should be.\u00a0',
	'if i edit i can see things fine.',
	'',
	'second paragraph, seems to',
	'work fine so far. does it hold?',
	'its not double spaced, which is good.',
	'but new paragraphs eat blank lines.',
	'how about more lines?',
].join('\n');

const MODE_SWITCH_CODE_BLOCK_BODY = [
	'Deliberation Mode Switch Test',
	'',
	'```python',
	'import litellm',
	'# 1. Define your workers and judge',
	'workers = ["gpt-4o", "claude-3-5-sonnet", "llama-3-70b-instruct"]',
	'judge = "claude-3-5-sonnet"',
	'',
	'def run_deliberation(user_prompt):',
	'    # 2. Fan-out (Async calls to different models)',
	'    responses = {}',
	'    for model in workers:',
	'        responses[model] = litellm.completion(model=model, messages=[{"role": "user", "content": user_prompt}])',
	'    ',
	'    # 3. Judge evaluation',
	'    eval_prompt = f"Here are three answers to: \'{user_prompt}\'\\n\\n"',
	'    for model, resp in responses.items():',
	'        eval_prompt += f"--- Answer from {model} ---\\n{resp.choices[0].message.content}\\n\\n"',
	'    ',
	'    final_verdict = litellm.completion(model=judge, messages=[{"role": "user", "content": eval_prompt}])',
	'    return final_verdict',
	'```',
	'',
	'End of snippet.',
].join('\n');

test.describe('Desktop UI', () => {
	test('covers login, notebook and note flows, search, settings, history, and logout', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const statusMeta = page.locator('.app-statusbar #status-note-meta');
		const statusMetaPattern = /^Created \d{2}-[A-Z][a-z]{2}-\d{2} \| Edited \d{2}-[A-Z][a-z]{2}-\d{2}$/;
		const folderName = slug('pw-desktop-folder');
		const noteTitle = slug('pw desktop note');
		const noteBody = `${noteTitle}\n\nDesktop body update.`;

		await login(page);
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);

		await setNoteTitle(page, noteTitle);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, noteBody);
		await waitForSaved(page);
		await expect(statusMeta).toBeVisible();
		await expect(statusMeta).toHaveText(statusMetaPattern);

		await expect(page.locator(`.nav-folder[data-folder-title="${folderName}"]`)).toBeVisible();

		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
		await expect(page.frameLocator('iframe.tox-edit-area__iframe').locator('body')).toContainText('Desktop body update.');

		await page.evaluate(() => {
			const form = document.getElementById('note-editor-form');
			const noteId = form && form.dataset ? form.dataset.noteId : '';
			if (noteId && typeof window.openHistoryModal === 'function') window.openHistoryModal(noteId);
		});
		await expect(page.locator('#history-modal')).toBeVisible();
		await expect(page.locator('#history-modal-inner')).not.toContainText('Loading...', { timeout: 15000 });
		await page.getByRole('button', { name: 'Close' }).click();
		await expect(page.locator('#history-modal')).toBeHidden();

		await searchDesktop(page, noteTitle);
		await expect(page.getByRole('button', { name: noteTitle, exact: true })).toBeVisible();
		await expect(page.locator('.nav-folder-title', { hasText: 'Search Results' })).toBeVisible();
		await openDesktopNote(page, noteTitle);
		await expect(statusMeta).toHaveText(statusMetaPattern);

		await openSettings(page);
		await page.locator('#settings-theme').selectOption('nord');
		await expect(page.locator('body')).toHaveClass(/theme-nord/);
		await page.locator('[data-tab="security"]').click();
		await expect(page.locator('#tab-security')).toHaveClass(/active/);
		await page.locator('#settings-confirm-trash').uncheck();
		await expect(page.locator('#settings-confirm-trash')).not.toBeChecked();
		await page.getByRole('link', { name: 'Back to notes' }).click();
		await page.waitForURL(/\/$/);

		await deleteNotebook(page, folderName);
		await logout(page);
	});

		test('preview and markdown mode preserve blank lines in note body', async ({ page }, testInfo) => {
			test.skip(testInfo.project.name !== 'desktop');
			acceptDialogs(page);
			const folderName = slug('pw-mode-folder');
		const noteTitle = slug('pw mode note');

		await login(page);
		await createNotebook(page, folderName);
			await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitle);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, USER_NOTE_BODY);
		await waitForSaved(page);
		const noteIdA = await page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.noteId || '');
		expect(noteIdA).toBeTruthy();

		const noteBody = page.locator('#editor-panel #note-body');
		await expect(noteBody).toHaveValue(USER_NOTE_BODY);

		await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
			await expect(page.frameLocator('iframe.tox-edit-area__iframe').locator('body')).toContainText('second paragraph, seems to');

			await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await expect(noteBody).toHaveValue(USER_NOTE_BODY);

		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(noteBody).toHaveValue(USER_NOTE_BODY);

		await waitForSaved(page);
		await deleteNotebook(page, folderName);
		await logout(page);
	});

	test('paragraph and blank-line spacing survives switching notes and returning', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folderName = slug('pw-switch-spacing-folder');
		const noteTitleA = slug('pw spacing note a');
		const noteTitleB = slug('pw spacing note b');

		await login(page);
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitleA);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, USER_NOTE_BODY);
		await waitForSaved(page);
		const noteIdA = await page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.noteId || '');
		expect(noteIdA).toBeTruthy();

		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
		const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
		const captureLayout = () => iframeBody.evaluate(body => Array.from(body.children)
			.filter(el => {
				const style = getComputedStyle(el);
				return style.display !== 'none' && el.textContent.trim().length > 0;
			})
			.map(el => ({
				tag: el.tagName,
				text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
			})));
		const beforeSwitchLayout = await captureLayout();

		await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitleB);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, 'temporary switch note');
		await waitForSaved(page);

		const noteAButton = page.locator(`.notelist-item[data-note-id="${noteIdA}"]`).first();
		await expect(noteAButton).toBeVisible({ timeout: 15000 });
		await noteAButton.click();
		await expect.poll(async () => page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.noteId || ''), { timeout: 15000 }).toBe(noteIdA);
		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
		const afterSwitchLayout = await captureLayout();
		expect(afterSwitchLayout).toEqual(beforeSwitchLayout);

		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await expect(page.locator('#editor-panel #note-body')).toHaveValue(USER_NOTE_BODY);

		await deleteNotebook(page, folderName);
		await logout(page);
	});

	test('typing a new paragraph in preview mode matches existing paragraph spacing', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folderName = slug('pw-para-gap-folder');
		const noteTitle = slug('pw para gap note');

		await login(page);
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitle);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, USER_NOTE_BODY);
		await waitForSaved(page);

		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
		const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
		await expect(iframeBody).toContainText('how about more lines?');

		// Type a fresh paragraph the typewriter way: caret at end of note, one
		// Enter to start a new paragraph, then type. No stray double-Enter blank
		// line — that path is covered by the typewriter caret test.
		await iframeBody.click();
		await page.keyboard.press('Control+End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('third paragraph! hey it looks ok, mostly.');
		await page.keyboard.press('Enter');
		await page.keyboard.type('but the space between paragraph 2 and 3 should match paragraph 1 and 2.');

		const gapInfo = await iframeBody.evaluate(body => {
			const blocks = Array.from(body.children).filter(el => {
				const style = getComputedStyle(el);
				return style.display !== 'none' && el.offsetHeight > 0 && el.textContent.trim().length > 0;
			});
			if (blocks.length < 3) return { blockCount: blocks.length, gaps: [], html: body.innerHTML };
			const rect = i => blocks[i].getBoundingClientRect();
			const gaps = [];
			for (let i = 1; i < blocks.length; i += 1) {
				gaps.push(Math.round(rect(i).top - rect(i - 1).bottom));
			}
			return { blockCount: blocks.length, gaps, html: body.innerHTML };
		});

		expect(gapInfo.blockCount).toBeGreaterThanOrEqual(3);
		expect(gapInfo.gaps.every(g => g > 4),
			`every paragraph gap must be visible. gaps=${JSON.stringify(gapInfo.gaps)} html=${gapInfo.html}`,
		).toBe(true);
		const maxGap = Math.max(...gapInfo.gaps);
		const minGap = Math.min(...gapInfo.gaps);
		expect(maxGap - minGap <= 2,
			`paragraph gaps must be uniform when new paragraphs are inserted the same way as loaded ones. gaps=${JSON.stringify(gapInfo.gaps)} html=${gapInfo.html}`,
		).toBe(true);

		await deleteNotebook(page, folderName);
		await logout(page);
	});

	test('code block round-trip: click-to-edit, language change, syntax class, markdown persistence', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folderName = slug('pw-codeblock-folder');
		const noteTitle = slug('pw codeblock note');
		const yamlCode = ['apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: demo'].join('\n');
		const fence = String.fromCharCode(96).repeat(3);

		await login(page);
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitle);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, `Before code.\n\n${fence}yaml\n${yamlCode}\n${fence}\n\nAfter code.`);
		await waitForSaved(page);

		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
		const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
		await expect(iframeBody.locator('pre.language-yaml')).toHaveCount(1, { timeout: 15000 });
		await expect(iframeBody.locator('pre.language-yaml')).toContainText('apiVersion: v1');

		const codePre = iframeBody.locator('pre.language-yaml').first();
		await codePre.click();
		// Rendered-mode <pre> editing opens the custom full-screen CM6 code modal
		// (#code-modal), NOT TinyMCE's built-in codesample dialog.
		const codeModal = page.locator('#code-modal');
		await expect(codeModal).toBeVisible({ timeout: 15000 });
		await codeModal.locator('#code-lang').selectOption('javascript');
		const codeInput = codeModal.locator('#code-input .cm-content');
		await codeInput.click();
		await page.keyboard.press('Control+A');
		await page.keyboard.press('Delete');
		await page.keyboard.type('const answer = 42;\nconsole.log(answer);');
		await codeModal.locator('#code-modal-submit').click();
		await expect(codeModal).toBeHidden({ timeout: 15000 });

		await expect.poll(async () => iframeBody.evaluate(body => !!body.querySelector('pre.language-javascript')), { timeout: 15000 }).toBe(true);
		await expect(iframeBody).toContainText('const answer = 42;');

		await page.locator('#editor-panel #markdown-toggle').click();
		const noteBody = page.locator('#editor-panel #note-body');
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await expect.poll(async () => noteBody.inputValue(), { timeout: 15000 }).toContain('```javascript');
		await expect.poll(async () => noteBody.inputValue(), { timeout: 15000 }).toContain('const answer = 42;');
		await expect.poll(async () => noteBody.inputValue(), { timeout: 15000 }).not.toContain('```yaml');

		await deleteNotebook(page, folderName);
		await logout(page);
	});

	test('code block mode-switch keeps markdown stable', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folderName = slug('pw-codeblock-modeswitch-folder');
		const noteTitle = slug('pw codeblock modeswitch note');

		await login(page);
		await expect(page.locator('body.app-shell')).toBeVisible();

		const markdownToggle = page.locator('#editor-panel #markdown-toggle');
		const previewToggle = page.locator('#editor-panel #preview-toggle');
		const readMarkdownSource = async () => page.evaluate(() => {
			const cm = window.getCM && window.getCM();
			if (cm && cm.state && cm.state.doc) return cm.state.doc.toString();
			const ta = document.querySelector('#editor-panel #note-body');
			return ta ? ta.value : '';
		});
		const attachEditorDebug = async label => {
			const snapshot = await page.evaluate(tag => {
				const form = document.querySelector('#editor-panel #note-editor-form');
				const ta = document.querySelector('#editor-panel #note-body');
				const cm = window.getCM && window.getCM();
				const tiny = window.getTinyMCE && window.getTinyMCE();
				let tinyText = '';
				let tinyHtml = '';
				let tinyTextLen = 0;
				let tinyHtmlLen = 0;
				try {
					if (tiny && tiny.getContent) {
						tinyHtml = tiny.getContent({ format: 'html' }) || '';
						tinyText = tiny.getContent({ format: 'text' }) || '';
						tinyHtmlLen = tinyHtml.length;
						tinyTextLen = tinyText.length;
					}
				} catch (_e) {
					// ignore debug collection failures
				}
				let cmText = '';
				let cmLen = 0;
				try {
					if (cm && cm.state && cm.state.doc) {
						cmText = cm.state.doc.toString() || '';
						cmLen = cmText.length;
					}
				} catch (_e) {
					// ignore debug collection failures
				}
				const editorMode = form && form.dataset ? (form.dataset.editorMode || '') : '';
				const taValue = ta ? (ta.value || '') : '';
				const taVisible = !!(ta && ta.offsetParent !== null);
				const iframe = document.querySelector('iframe.tox-edit-area__iframe');
				let iframeBodyText = '';
				let iframeBodyHtml = '';
				try {
					const body = iframe && iframe.contentDocument ? iframe.contentDocument.body : null;
					if (body) {
						iframeBodyText = body.textContent || '';
						iframeBodyHtml = body.innerHTML || '';
					}
				} catch (_e) {
					// ignore debug collection failures
				}
				return {
					label: tag,
					editorMode,
					taVisible,
					taLength: taValue.length,
					taPreview: taValue.slice(0, 800),
					cmLength: cmLen,
					cmPreview: cmText.slice(0, 800),
					tinyTextLength: tinyTextLen,
					tinyTextPreview: tinyText.slice(0, 800),
					tinyHtmlLength: tinyHtmlLen,
					tinyHtmlPreview: tinyHtml.slice(0, 1200),
					iframeBodyTextLength: iframeBodyText.length,
					iframeBodyTextPreview: iframeBodyText.slice(0, 800),
					iframeBodyHtmlLength: iframeBodyHtml.length,
					iframeBodyHtmlPreview: iframeBodyHtml.slice(0, 1200),
				};
			}, label);
			const debugPath = testInfo.outputPath('editor-debug-' + label + '.json');
			await fs.writeFile(debugPath, JSON.stringify(snapshot, null, 2), 'utf8');
			console.log('[editor-debug]', label, JSON.stringify({
				editorMode: snapshot.editorMode,
				taLength: snapshot.taLength,
				cmLength: snapshot.cmLength,
				tinyTextLength: snapshot.tinyTextLength,
				tinyHtmlLength: snapshot.tinyHtmlLength,
				iframeBodyTextLength: snapshot.iframeBodyTextLength,
				iframeBodyHtmlLength: snapshot.iframeBodyHtmlLength,
			}));
			await testInfo.attach('editor-debug-' + label, {
				path: debugPath,
				contentType: 'application/json',
			});
		};
		const cleanupResourcesFromMarkdown = async () => {
			const md = await readMarkdownSource();
			const ids = [...new Set(Array.from(md.matchAll(/:\/([0-9a-fA-F]{32})/g)).map(m => m[1]))];
			if (!ids.length) return;
			await page.evaluate(async resourceIds => {
				for (const id of resourceIds) {
					try {
						await fetch('/resources/' + id, { method: 'DELETE', credentials: 'same-origin' });
					} catch (_e) {
						// best-effort cleanup
					}
				}
			}, ids);
		};

		try {
			await createNotebook(page, folderName);
			await createDesktopNote(page, folderName);
			await setNoteTitle(page, noteTitle);

			await markdownToggle.click();
			await expect.poll(async () => page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.editorMode || ''), { timeout: 15000 }).toBe('markdown');
			await page.evaluate(body => {
				const cm = window.getCM && window.getCM();
				if (cm) {
					const cur = cm.state.doc.toString();
					cm.dispatch({ changes: { from: 0, to: cur.length, insert: body } });
					return;
				}
				const ta = document.querySelector('#editor-panel #note-body');
				if (ta) {
					ta.value = body;
					ta.dispatchEvent(new Event('input', { bubbles: true }));
				}
			}, MODE_SWITCH_CODE_BLOCK_BODY);
			await waitForSaved(page);
			await attachEditorDebug('baseline-after-save');
			await expect.poll(readMarkdownSource, { timeout: 15000 }).toContain('```python');
			const baselineMarkdown = await readMarkdownSource();

			for (let i = 0; i < 3; i += 1) {
				await previewToggle.click();
				await expect.poll(async () => page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.editorMode || ''), { timeout: 15000 }).toBe('rich');
				await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
				await attachEditorDebug('loop-' + i + '-after-preview');
				const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
				await expect(iframeBody).toContainText('Deliberation Mode Switch Test');
				await expect(iframeBody).toContainText('import litellm');

				await markdownToggle.click();
				await expect.poll(async () => page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.editorMode || ''), { timeout: 15000 }).toBe('markdown');
				await attachEditorDebug('loop-' + i + '-after-markdown');
				await expect.poll(readMarkdownSource, { timeout: 15000 }).toBe(baselineMarkdown);
			}
		} catch (err) {
			await attachEditorDebug('failure-state').catch(() => {});
			throw err;
		} finally {
			await cleanupResourcesFromMarkdown();
			await deleteNotebook(page, folderName).catch(() => {});
			await logout(page).catch(() => {});
		}
	});

	test('preview mode Enter behaves like a typewriter', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folderName = slug('pw-typewriter-folder');
		const noteTitle = slug('pw typewriter note');

		await login(page);
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitle);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, 'anchor line');
		await waitForSaved(page);

		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
		const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
		await expect(iframeBody).toContainText('anchor line');

		await iframeBody.click();
		await page.keyboard.press('Control+End');

		const caretTop = async () => iframeBody.evaluate(body => {
			const win = body.ownerDocument.defaultView;
			const sel = win.getSelection();
			if (!sel || sel.rangeCount === 0) return null;
			const range = sel.getRangeAt(0).cloneRange();
			const rects = range.getClientRects();
			if (rects.length) return Math.round(rects[0].top);
			const marker = body.ownerDocument.createElement('span');
			marker.textContent = '\u200b';
			range.insertNode(marker);
			const top = Math.round(marker.getBoundingClientRect().top);
			marker.remove();
			return top;
		});

		const bodyLineHeight = await iframeBody.evaluate(body => {
			const el = body.querySelector('p') || body;
			return parseFloat(getComputedStyle(el).lineHeight);
		});

		const before = await caretTop();
		await page.keyboard.press('Enter');
		const afterFirst = await caretTop();
		await page.keyboard.press('Enter');
		const afterSecond = await caretTop();
		await page.keyboard.type('third');
		const afterType = await caretTop();

		expect(bodyLineHeight,
			'need a real line-height to reason about caret motion',
		).toBeGreaterThan(0);

		// After the first Enter the caret should drop about one full line.
		expect(afterFirst - before,
			`first Enter must move caret one line down. before=${before} afterFirst=${afterFirst} lineHeight=${bodyLineHeight}`,
		).toBeGreaterThanOrEqual(Math.round(bodyLineHeight * 0.8));

		// After the second Enter the caret should drop another full line so the
		// user can actually type on a fresh line below.
		expect(afterSecond - afterFirst,
			`second Enter must move caret one more line down. afterFirst=${afterFirst} afterSecond=${afterSecond} lineHeight=${bodyLineHeight}`,
		).toBeGreaterThanOrEqual(Math.round(bodyLineHeight * 0.8));

		// The freshly typed line must land on the same visual row the caret was on
		// after the second Enter — i.e. Enter really did open a new line to type on.
		expect(Math.abs(afterType - afterSecond),
			`typed text must appear on the line the caret opened. afterSecond=${afterSecond} afterType=${afterType}`,
		).toBeLessThanOrEqual(2);

		// And the underlying markdown must reflect that we now have a third
		// paragraph on its own line — not just extra <br>s stuck to paragraph 2.
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		const bodyValue = await page.locator('#editor-panel #note-body').inputValue();
		const lines = bodyValue.split('\n');
		const thirdIdx = lines.findIndex(l => l.trim() === 'third');
		expect(thirdIdx,
			`markdown must contain a "third" line on its own. body=${JSON.stringify(bodyValue)}`,
		).toBeGreaterThan(0);
		expect(lines[thirdIdx - 1] === '' || lines[thirdIdx - 1] === undefined,
			`the line before "third" must be blank so it round-trips as a real paragraph break. body=${JSON.stringify(bodyValue)}`,
		).toBe(true);

		await deleteNotebook(page, folderName);
		await logout(page);
	});

	test('trash row uses explicit empty-trash confirm modal', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folderName = slug('pw-trash-folder');
		const noteTitle = slug('pw trash note');

		await login(page);
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitle);
		await waitForSaved(page);
		await trashDesktopNote(page);

		const trashRow = page.locator('.nav-folder[data-folder-id="de1e7ede1e7ede1e7ede1e7ede1e7ede"] .nav-folder-row').first();
		await expect(trashRow.locator('.trash-folder-empty')).toBeVisible();

		await trashRow.locator('.trash-folder-empty').click();
		await expect(page.locator('#empty-trash-modal')).toBeVisible();
		await expect(page.locator('#empty-trash-modal')).toContainText('This will permanently delete every note in Trash.');

		await page.locator('#empty-trash-modal').getByRole('button', { name: 'Cancel' }).click();
		await expect(page.locator('#empty-trash-modal')).toBeHidden();
		await expect(page.getByRole('button', { name: noteTitle, exact: true })).toBeVisible();

		await trashRow.locator('.trash-folder-empty').click();
		await page.locator('#empty-trash-form').evaluate(form => form.requestSubmit());
		await expect(page.locator('#empty-trash-modal')).toBeHidden();
		await expect(page.getByRole('button', { name: noteTitle, exact: true })).toHaveCount(0, { timeout: 15000 });

		await deleteNotebook(page, folderName);
		await logout(page);
	});

});
