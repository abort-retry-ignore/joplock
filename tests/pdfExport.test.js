const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');

let hasPandoc = false;
try {
	execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
	hasPandoc = true;
} catch {}

let hasWeasyprint = false;
try {
	execFileSync('weasyprint', ['--version'], { stdio: 'ignore' });
	hasWeasyprint = true;
} catch {}

// Minimal 1x1 white PNG (base64) for image inlining tests
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`;

const pandocHtmlToPdf = (html) =>
	new Promise((resolve, reject) => {
		const p = spawn('pandoc', [
			'-f', 'html',
			'-t', 'pdf',
			'--pdf-engine=weasyprint',
			'--pdf-engine-opt=--presentational-hints',
		], { stdio: ['pipe', 'pipe', 'pipe'] });
		p.stdin.write(html);
		p.stdin.end();
		const chunks = [], errs = [];
		p.stdout.on('data', c => chunks.push(c));
		p.stderr.on('data', c => errs.push(c));
		p.on('close', code => {
			if (code !== 0) reject(new Error('pandoc exit ' + code + ': ' + Buffer.concat(errs).toString()));
			else resolve(Buffer.concat(chunks));
		});
		p.on('error', reject);
	});

const wrapBody = (body) =>
	`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body>${body}</body></html>`;

const pdfIsValid = (buf) => buf.length > 100 && buf.slice(0, 4).toString() === '%PDF';

if (hasPandoc && hasWeasyprint) {

describe('PDF export', () => {

	test('produces valid PDF from simple HTML', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody('<h1>Hello</h1><p>World</p>'));
		assert.ok(pdfIsValid(pdf), 'should start with %PDF');
		assert.ok(pdf.length > 1000, 'should be a non-trivial PDF');
	});

	test('headings render without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('inline formatting renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<p><strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <code>inline code</code></p>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('code block renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<pre class="language-js"><code class="language-js">' +
			'<span class="token keyword">const</span> x <span class="token operator">=</span> <span class="token number">1</span>;</code></pre>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('table renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
			'<tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('unordered and ordered lists render without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<ul><li>alpha</li><li>beta</li></ul><ol><li>one</li><li>two</li></ol>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('blockquote renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody('<blockquote><p>quoted text</p></blockquote>'));
		assert.ok(pdfIsValid(pdf));
	});

	test('checkbox divs render without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<div class="md-checkbox">unchecked task</div>' +
			'<div class="md-checkbox checked">checked task</div>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('blank-line markers render without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<p>before</p><p class="md-blank-line"><br></p><p>after</p>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('image as data URI renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			`<p><img src="${TINY_PNG_DATA_URI}" alt="test" /></p>`
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('image with width attribute renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			`<p><img src="${TINY_PNG_DATA_URI}" alt="test" width="50" /></p>`
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('horizontal rule renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody('<p>above</p><hr><p>below</p>'));
		assert.ok(pdfIsValid(pdf));
	});

	test('links render without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(
			'<p><a href="https://example.com">external link</a></p>'
		));
		assert.ok(pdfIsValid(pdf));
	});

	test('full note-style document renders without error', async () => {
		const pdf = await pandocHtmlToPdf(wrapBody(`
			<h1>My Note</h1>
			<p><strong>Prepared for:</strong> Test Suite</p>
			<h2>Section</h2>
			<p>Some paragraph text with <em>italic</em> and <code>inline code</code>.</p>
			<ul><li>Item one</li><li>Item two</li></ul>
			<pre class="language-bash"><code>echo "hello world"</code></pre>
			<table>
				<thead><tr><th>Col A</th><th>Col B</th></tr></thead>
				<tbody><tr><td>value 1</td><td>value 2</td></tr></tbody>
			</table>
			<div class="md-checkbox checked">Done task</div>
			<div class="md-checkbox">Pending task</div>
		`));
		assert.ok(pdfIsValid(pdf));
		assert.ok(pdf.length > 2000, 'should be a substantive PDF');
	});

});

} else if (!hasPandoc) {
	test('PDF export tests skipped (pandoc not installed)', () => {});
} else {
	test('PDF export tests skipped (weasyprint not installed)', () => {});
}
