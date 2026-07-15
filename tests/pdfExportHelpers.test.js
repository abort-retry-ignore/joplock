const { test, describe } = require('node:test');
const assert = require('node:assert');
const { inlineResourceImages, stripResourceLinks, inlineResourceLinks, extractCssBlocks } = require('../app/routes/api');

const RID = 'a1b2c3d4e5f6789012345678abcdef00';
const ALT_TEXT = 'photo.png';

const fakeItemService = (overrides = {}) => ({
	async resourceBlobByUserId(_userId, id) {
		if (overrides.blob === null) return null;
		return overrides.blob || Buffer.from('fakeblob-' + id);
	},
	async resourceMetaByUserId(_userId, id) {
		if (overrides.meta === null) return null;
		return overrides.meta || { mime: 'image/png', filename: ALT_TEXT };
	},
});

// base64 of 'fakeblob-<id>' — a stable, recognisable fragment that appears in the data URI
const B64_FRAGMENT = Buffer.from('fakeblob-' + RID).toString('base64').slice(0, 16);

describe('PDF export HTML pre-processing', () => {

	describe('inlineResourceImages', () => {
		test('inlines relative /resources/<id> src as base64 data URI', async () => {
			const html = `<p><img src="/resources/${RID}" alt="x" /></p>`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.ok(out.includes('data:image/png;base64,'), 'src should be replaced with data URI');
			assert.ok(!out.includes(`/resources/${RID}`), 'original /resources/ src should be gone');
		});

		test('inlines absolute https://.../resources/<id> src (TinyMCE default)', async () => {
			const html = `<p><img src="https://joplinweb.021407.xyz/resources/${RID}" alt="x" /></p>`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.ok(out.includes('data:image/png;base64,'),
				'absolute URL src should be replaced with data URI — TinyMCE converts relative → absolute on getContent()');
			assert.ok(!out.includes('joplinweb.021407.xyz'),
				'absolute domain should not appear in output');
		});

		test('inlines absolute http://.../resources/<id> src', async () => {
			const html = `<p><img src="http://localhost:3001/resources/${RID}" alt="x" /></p>`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.ok(out.includes('data:image/png;base64,'),
				'http absolute URL should be inlined');
		});

		test('inlines bare "resources/<id>" src with NO leading slash (TinyMCE actual output)', async () => {
			// TinyMCE strips the leading slash when it thinks the URL is relative to the document.
			// This is what the browser actually sends — was the cause of the "shows filename, no image" bug.
			const html = `<p><img src="resources/${RID}" alt="obc-billing.png" class="preview-img" data-resource-id="${RID}" /></p>`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.ok(out.includes('data:image/png;base64,'),
				'bare "resources/<id>" src must inline — TinyMCE strips the leading slash');
			assert.ok(!out.includes('src="resources/'),
				'original bare src should be replaced');
		});

		test('preserves width, height, alt, class attributes when inlining', async () => {
			const html = `<img src="/resources/${RID}" alt="my image" width="320" height="240" class="preview-img" />`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.ok(out.includes('alt="my image"'), 'alt preserved');
			assert.ok(out.includes('width="320"'), 'width preserved');
			assert.ok(out.includes('height="240"'), 'height preserved');
			assert.ok(out.includes('class="preview-img"'), 'class preserved');
			assert.ok(out.includes('data:image/png;base64,'), 'src inlined');
		});

		test('handles query string on absolute URL src', async () => {
			const html = `<img src="https://example.com/resources/${RID}?v=2" alt="x" />`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.ok(out.includes('data:image/png;base64,'),
				'query string on src should still match and inline');
		});

		test('falls back to 1x1 transparent placeholder when blob is missing', async () => {
			const html = `<img src="/resources/${RID}" alt="missing" />`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService({ blob: null }));
			assert.ok(out.includes('data:image/png;base64,'),
				'missing blob should still produce a data URI (placeholder)');
		});

		test('uses resource mime type from meta in data URI', async () => {
			const html = `<img src="/resources/${RID}" alt="x" />`;
			const itemService = fakeItemService({ meta: { mime: 'image/jpeg' } });
			const out = await inlineResourceImages(html, 'user-1', itemService);
			assert.ok(out.includes('data:image/jpeg;base64,'), 'should use image/jpeg from meta');
			assert.ok(!out.includes('data:image/png;'),
				'should not default to image/png when meta has different mime');
		});

		test('does not touch non-resource images (e.g. https://external.com/foo.png)', async () => {
			const html = `<img src="https://external.com/foo.png" alt="x" />`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.equal(out, html, 'external image should pass through unchanged');
		});

		test('does not touch img without resource-like src', async () => {
			const html = `<img src="data:image/png;base64,AAAA" alt="x" />`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			assert.equal(out, html, 'already-base64 image should pass through');
		});

		test('handles multiple images in one document', async () => {
			const RID2 = 'ffffffffffffffffffffffffffffffff';
			const html = `<p><img src="/resources/${RID}" alt="a" /></p><p><img src="https://x.com/resources/${RID2}" alt="b" /></p>`;
			const out = await inlineResourceImages(html, 'user-1', fakeItemService());
			const occurrences = out.match(/data:image\/png;base64,/g) || [];
			assert.equal(occurrences.length, 2, 'both images should be inlined');
		});
	});

	describe('stripResourceLinks', () => {
		test('strips <a> wrapping relative /resources/<id> link, keeps text', () => {
			const html = `<p>see <a href="/resources/${RID}?download=1">report.pdf</a> here</p>`;
			const out = stripResourceLinks(html);
			assert.ok(out.includes('report.pdf'), 'link text preserved');
			assert.ok(!out.includes('<a '), 'anchor removed');
			assert.ok(!out.includes('/resources/'), 'href removed');
		});

		test('strips <a> wrapping absolute https://.../resources/<id> link (TinyMCE default)', () => {
			const html = `<p>see <a href="https://joplinweb.021407.xyz/resources/${RID}?download=1" target="_blank" rel="noopener">doc.docx</a></p>`;
			const out = stripResourceLinks(html);
			assert.ok(out.includes('doc.docx'), 'link text preserved');
			assert.ok(!out.includes('<a '), 'anchor removed even with target/rel attributes');
			assert.ok(!out.includes('joplinweb.021407.xyz'), 'absolute href removed');
		});

		test('strips <a> wrapping bare "resources/<id>" href with NO leading slash (TinyMCE actual output)', () => {
			const html = `<p>see <a href="resources/${RID}?download=1">report.pdf</a></p>`;
			const out = stripResourceLinks(html);
			assert.ok(out.includes('report.pdf'), 'link text preserved');
			assert.ok(!out.includes('<a '), 'anchor removed');
			assert.ok(!out.includes('resources/'), 'href removed');
		});

		test('leaves external https links untouched', () => {
			const html = `<p>see <a href="https://example.com/page">link</a> here</p>`;
			const out = stripResourceLinks(html);
			assert.equal(out, html, 'external link should be preserved');
		});

		test('strips resource link even when href has extra query params', () => {
			const html = `<a href="https://x.com/resources/${RID}?download=1&token=abc">file.zip</a>`;
			const out = stripResourceLinks(html);
			assert.ok(out.includes('file.zip'));
			assert.ok(!out.includes('<a '));
		});

		test('does not match <img src> that happens to look like a link', () => {
			const html = `<img src="https://x.com/resources/${RID}" alt="x" />`;
			const out = stripResourceLinks(html);
			assert.equal(out, html, 'img tags should not be affected by link stripping');
		});
	});

	describe('integration: TinyMCE-style output round-trip', () => {
		test('full note with inline image (absolute URL) inlines correctly', async () => {
			// This is what TinyMCE's getContent() actually returns for a note with an image
			const tinyMceHtml = `<h1>My Note</h1>
<p>Here is an image:</p>
<p><img src="https://joplinweb.021407.xyz/resources/${RID}" alt="${ALT_TEXT}" class="preview-img" data-resource-id="${RID}" /></p>
<p>And a <a href="https://joplinweb.021407.xyz/resources/${RID}?download=1" target="_blank" rel="noopener" data-resource-id="${RID}">${ALT_TEXT}</a> attachment.</p>`;
			const stripped = stripResourceLinks(tinyMceHtml);
			const inlined = await inlineResourceImages(stripped, 'user-1', fakeItemService());

			assert.ok(inlined.includes('data:image/png;base64,'),
				'image should be inlined as data URI');
			assert.ok(!inlined.includes('joplinweb.021407.xyz'),
				'absolute domain should not appear anywhere in PDF HTML');
			assert.ok(!inlined.includes('href="'),
				'resource link anchor should be stripped to plain text');
			assert.ok(inlined.includes(ALT_TEXT),
				'both the img alt and the link text (filename) should remain as visible text');
			assert.ok(inlined.includes('class="preview-img"'),
				'preview-img class preserved on img');
		});
	});

	describe('inlineResourceLinks', () => {
		test('inlines relative resource link href as data URI with download attr', async () => {
			const html = `<p>see <a href="/resources/${RID}?download=1">report.pdf</a> here</p>`;
			const out = await inlineResourceLinks(html, 'user-1', fakeItemService({ meta: { mime: 'application/pdf', filename: 'report.pdf' } }));
			assert.ok(out.includes('data:application/pdf;base64,'), 'href should become data URI');
			assert.ok(out.includes('download="report.pdf"'), 'download attribute should carry filename');
			assert.ok(out.includes('report.pdf</a>'), 'link text preserved');
		});

		test('inlines absolute https://.../resources/<id> href', async () => {
			const html = `<a href="https://joplinweb.021407.xyz/resources/${RID}?download=1" target="_blank" rel="noopener">doc.docx</a>`;
			const out = await inlineResourceLinks(html, 'user-1', fakeItemService({ meta: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'doc.docx' } }));
			assert.ok(out.includes('data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'));
			assert.ok(out.includes('download="doc.docx"'));
			assert.ok(out.includes('target="_blank"'), 'other attributes preserved');
			assert.ok(out.includes('rel="noopener"'), 'other attributes preserved');
			assert.ok(!out.includes('joplinweb.021407.xyz'), 'absolute domain should not remain');
		});

		test('inlines bare "resources/<id>" href with no leading slash', async () => {
			const html = `<a href="resources/${RID}?download=1">file.zip</a>`;
			const out = await inlineResourceLinks(html, 'user-1', fakeItemService({ meta: { mime: 'application/zip', filename: 'file.zip' } }));
			assert.ok(out.includes('data:application/zip;base64,'));
			assert.ok(out.includes('download="file.zip"'));
		});

		test('leaves external https links untouched', async () => {
			const html = `<a href="https://example.com/page">link</a>`;
			const out = await inlineResourceLinks(html, 'user-1', fakeItemService());
			assert.equal(out, html, 'external link should be preserved');
		});

		test('falls back to plain text when resource blob is missing', async () => {
			const html = `<a href="/resources/${RID}?download=1">missing.pdf</a>`;
			const out = await inlineResourceLinks(html, 'user-1', fakeItemService({ blob: null }));
			assert.ok(out.includes('missing.pdf'), 'label preserved');
			assert.ok(!out.includes('<a '), 'anchor removed when resource unresolvable');
		});

		test('returns html unchanged when there are no resource links', async () => {
			const html = `<p>no links here</p>`;
			const out = await inlineResourceLinks(html, 'user-1', fakeItemService());
			assert.equal(out, html);
		});
	});

	describe('extractCssBlocks', () => {
		test('extracts a single-selector block', () => {
			const css = `.foo { color: red; }\n.bar { color: blue; }`;
			const out = extractCssBlocks(css, ['.foo']);
			assert.ok(out.includes('color: red'));
			assert.ok(!out.includes('color: blue'));
		});

		test('extracts multiple blocks by prefix, preserving order', () => {
			const css = `.editor-preview { a: 1; }\n.other { b: 2; }\n.editor-preview h1 { c: 3; }`;
			const out = extractCssBlocks(css, ['.editor-preview']);
			assert.ok(out.includes('a: 1'));
			assert.ok(out.includes('c: 3'));
			assert.ok(!out.includes('b: 2'));
			assert.ok(out.indexOf('a: 1') < out.indexOf('c: 3'), 'order preserved');
		});

		test('handles multi-line / nested-brace blocks', () => {
			const css = `.theme-earth {\n  --bg: #111;\n  --text: #eee;\n}\n.unrelated { x: 1; }`;
			const out = extractCssBlocks(css, ['.theme-earth']);
			assert.ok(out.includes('--bg: #111'));
			assert.ok(out.includes('--text: #eee'));
			assert.ok(!out.includes('x: 1'));
		});

		test('ignores blocks that do not match any prefix', () => {
			const css = `.nomatch { a: 1; }`;
			const out = extractCssBlocks(css, ['.editor-preview']);
			assert.equal(out, '');
		});

		test('matches comma-separated selector lists starting with prefix', () => {
			const css = `.editor-preview p,\n.editor-preview div { a: 1; }\n.skip { b: 2; }`;
			const out = extractCssBlocks(css, ['.editor-preview']);
			assert.ok(out.includes('a: 1'));
			assert.ok(!out.includes('b: 2'));
		});
	});
});
