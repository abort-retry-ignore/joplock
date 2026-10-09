const test = require('node:test');
const assert = require('node:assert/strict');
const { renderHtmlNote, safeUrl } = require('../app/htmlNoteRenderer');

const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('ordinary HTML note content is preserved', () => {
	const html = renderHtmlNote('<h1>Title</h1><p>Hello <b>bold</b> and <i>italic</i> <a href="https://example.com/x">link</a></p><ul><li>one</li><li>two</li></ul><table><tr><td colspan="2">cell</td></tr></table><pre><code>x &lt; y</code></pre>');
	assert.match(html, /<h1>Title<\/h1>/);
	assert.match(html, /<b>bold<\/b>/);
	assert.match(html, /<li>one<\/li>/);
	assert.match(html, /<td colspan="2">cell<\/td>/);
	assert.match(html, /<code>x &lt; y<\/code>/);
	assert.match(html, /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer">link<\/a>/);
});

test('full documents render just their body content', () => {
	const html = renderHtmlNote('<!DOCTYPE html><html><head><title>t</title><style>body{x:y}</style></head><body><p>only me</p></body></html>');
	assert.equal(html, '<p>only me</p>');
});

test('Joplin resource links become /resources/<id>', () => {
	const html = renderHtmlNote(`<p><img src=":/${RID}" alt="pic"> <a href=":/${RID}">file</a></p>`);
	assert.match(html, new RegExp(`<img src="/resources/${RID}" alt="pic">`));
	assert.match(html, new RegExp(`<a href="/resources/${RID}"`));
});

const PAYLOADS = [
	['script tag', '<p>a</p><script>alert(1)</script>', /script|alert/i],
	['inline handler', '<p onclick="alert(1)" onmouseover=alert(2)>x</p>', /onclick|onmouseover|alert/i],
	['img onerror', '<img src="x" onerror="alert(1)">', /onerror|alert/i],
	['javascript: href', '<a href="javascript:alert(1)">x</a>', /javascript/i],
	['obfuscated javascript:', '<a href="  jav\nascript:alert(1)">x</a>', /javascript|alert/i],
	['entity-encoded javascript:', '<a href="&#106;avascript:alert(1)">x</a>', /javascript|alert/i],
	['data: href', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', /data:/i],
	['vbscript', '<a href="vbscript:msgbox(1)">x</a>', /vbscript/i],
	['iframe', '<iframe src="https://evil.example"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>', /iframe|srcdoc/i],
	['object/embed', '<object data="x.swf"></object><embed src="x.swf">', /object|embed/i],
	['svg onload', '<svg onload="alert(1)"><script>alert(1)</script></svg>', /svg|onload|alert/i],
	['math', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>', /math|javascript/i],
	['form + input', '<form action="https://evil.example"><input name="pw"><button>go</button></form>', /form|input|button/i],
	['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">', /meta|refresh/i],
	['base hijack', '<base href="https://evil.example/">', /base/i],
	['link stylesheet', '<link rel="stylesheet" href="https://evil.example/x.css">', /link|stylesheet/i],
	['style element', '<style>@import url(https://evil.example/x.css);</style><p>t</p>', /style|import/i],
	['style attr url()', '<p style="background:url(https://evil.example/x)">x</p>', /url\(/i],
	['style attr expression', '<p style="width:expression(alert(1))">x</p>', /expression/i],
	['style fixed overlay', '<div style="position:fixed;top:0;left:0;width:100%;height:100%">x</div>', /position/i],
	['hx- injection', '<button hx-get="/api/x" hx-trigger="load">x</button><div hx-post="/fragments/notes" hx-trigger="load">y</div>', /hx-/i],
	['comment payload', '<!-- <script>alert(1)</script> --><p>ok</p>', /script|alert/i],
	['mixed case tags', '<ScRiPt>alert(1)</sCrIpT><IMG SRC=x ONERROR=alert(1)>', /script|onerror|alert/i],
	['unclosed tags', '<p><b><i>text<script>alert(1)', /script|alert/i],
	['nested unknown wrapper', '<foo><bar onclick="alert(1)">kept text</bar></foo>', /onclick|foo|bar/i],
	['data: img not an image', '<img src="data:text/html;base64,PHNjcmlwdD4=">', /data:/i],
	['xlink/xmlns attrs', '<a xlink:href="javascript:alert(1)" xmlns:x="x">x</a>', /xlink|javascript|xmlns/i],
	['id clobbering', '<p id="mobile-app" name="location">x</p>', /id=|name=/i],
];

for (const [name, payload, forbidden] of PAYLOADS) {
	test(`XSS: ${name}`, () => {
		const out = renderHtmlNote(payload);
		assert.doesNotMatch(out, forbidden, `leaked from ${payload}\n=> ${out}`);
	});
}

test('unknown wrappers keep their text', () => {
	assert.match(renderHtmlNote('<foo><bar>kept text</bar></foo>'), /kept text/);
});

test('data: images are allowed for <img> only when they are real image types', () => {
	assert.match(renderHtmlNote('<img src="data:image/png;base64,iVBORw0KGgo=">'), /src="data:image\/png;base64,iVBORw0KGgo="/);
	assert.doesNotMatch(renderHtmlNote('<img src="data:image/svg+xml;base64,PHN2Zz4=">'), /svg/);
});

test('mailto and tel links survive, anchors do not get target=_blank', () => {
	const html = renderHtmlNote('<a href="mailto:a@b.c">m</a><a href="tel:+123">t</a><a href="#sec">s</a>');
	assert.match(html, /href="mailto:a@b\.c"/);
	assert.match(html, /href="tel:\+123"/);
	assert.match(html, /<a href="#sec">s<\/a>/);
});

test('safeUrl', () => {
	assert.equal(safeUrl('https://a.b/c', 'href'), 'https://a.b/c');
	assert.equal(safeUrl('javascript:1', 'href'), null);
	assert.equal(safeUrl('mailto:x@y.z', 'src'), null);
	assert.equal(safeUrl(`:/${RID}#frag`, 'href'), `/resources/${RID}#frag`);
	assert.equal(safeUrl('relative/page.html', 'href'), 'relative/page.html');
	assert.equal(safeUrl('', 'href'), null);
});

test('never throws, empty/garbage input renders empty', () => {
	assert.equal(renderHtmlNote(''), '');
	assert.equal(renderHtmlNote(null), '');
	assert.doesNotThrow(() => renderHtmlNote('<<<>>>&&&\u0000'));
});
