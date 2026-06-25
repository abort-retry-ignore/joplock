const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, layoutPage } = require('../app/templates');
const { JSDOM } = require('jsdom');
const TurndownService = require('../vendor/turndown-lib/turndown.cjs.js');

const previewRoundTrip = markdown => {
	const html = renderMarkdown(markdown);
	const dom = new JSDOM(`<div id="root">${html}</div>`);
	dom.window.document.querySelectorAll('img.preview-img[data-resource-id]').forEach(img => {
		const wrap = dom.window.document.createElement('span');
		wrap.className = 'preview-img-download-wrap';
		img.parentNode.insertBefore(wrap, img);
		wrap.appendChild(img);
		const btn = dom.window.document.createElement('button');
		btn.type = 'button';
		btn.className = 'preview-img-download-btn';
		btn.textContent = 'Download';
		wrap.appendChild(btn);
	});
	const td = new TurndownService({
		headingStyle: 'atx',
		hr: '---',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '*',
		strongDelimiter: '**',
		br: '',
	});
	td.addRule('joplinImg', {
		filter: node => node.nodeName === 'IMG',
		replacement: (_content, node) => {
			const alt = node.getAttribute('alt') || '';
			const src = node.getAttribute('src') || '';
			const w = node.style.width || node.getAttribute('width');
			const h = node.style.height || node.getAttribute('height');
			const rm = src.match(/^\/resources\/([0-9a-zA-Z]{32})$/);
			if (src.startsWith('data:')) return alt ? `[${alt}]` : '';
			if (w || h) {
				const imgSrc = rm ? `:/${rm[1]}` : src;
				return `<img src="${imgSrc}" alt="${alt}"${w ? ` width="${parseInt(w, 10)}"` : ''}${h ? ` height="${parseInt(h, 10)}"` : ''} />`;
			}
			if (rm) return `![${alt}](:/${rm[1]})`;
			return `![${alt}](${src})`;
		},
	});
	td.addRule('joplinLink', {
		filter: node => node.nodeName === 'A' && /^\/resources\/[0-9a-zA-Z]{32}(?:\?download=1)?$/.test((node.getAttribute('href') || '').split('#')[0]),
		replacement: (content, node) => {
			const m = (node.getAttribute('href') || '').match(/^\/resources\/([0-9a-zA-Z]{32})/);
			return `[${content}](:/${m[1]})`;
		},
	});
	td.addRule('externalLink', {
		filter: node => {
			const href = (node.getAttribute('href') || '').trim();
			return node.nodeName === 'A' && !!href && !/^\/resources\//.test(href);
		},
		replacement: (content, node) => {
			const href = (node.getAttribute('href') || '').trim();
			const label = (content || '').trim() || href;
			return `[${label}](${href})`;
		},
	});
	td.addRule('checkbox', {
		filter: node => node.nodeName === 'DIV' && node.classList.contains('md-checkbox'),
		replacement: (content, node) => {
			const checked = node.classList.contains('checked');
			const text = content.replace(/^[\u2611\u2610\u2612\u2705\u00a0 ]+/, '');
			return `${checked ? '- [x] ' : '- [ ] '}${text}\n`;
		},
	});
	td.addRule('strikethrough', {
		filter: ['del', 's', 'strike'],
		replacement: content => content.trim() ? `~~${content.trim()}~~` : '',
	});
	td.addRule('underline', {
		filter: 'u',
		replacement: content => content.trim() ? `++${content.trim()}++` : '',
	});
	td.addRule('emptyDiv', {
		filter: node => node.nodeName === 'DIV' && !node.classList.length && (!node.textContent.trim() || node.innerHTML === '<br>'),
		replacement: () => '\n<br>\n',
	});
	td.addRule('emptyP', {
		filter: node => node.nodeName === 'P' && !node.querySelector('img') && (!node.textContent.trim() || node.innerHTML === '<br>'),
		replacement: () => '\n\n<br>\n\n',
	});
	td.addRule('blankLine', {
		filter: node => node.nodeName === 'DIV' && node.classList.contains('md-blank-line'),
		replacement: () => '\x00BL\x00',
	});
	const root = dom.window.document.getElementById('root').cloneNode(true);
	root.querySelectorAll('.preview-img-download-btn').forEach(btn => btn.remove());
	root.querySelectorAll('.preview-img-download-wrap').forEach(wrap => {
		const img = wrap.querySelector('img');
		if (img) wrap.replaceWith(img);
	});
	let md = td.turndown(root.innerHTML);
	const nl = String.fromCharCode(10);
	const headingGapRe = new RegExp(`^(#{1,6}[^${nl}]*)${nl}{2,}(?=\\S)`, 'gm');
	const headingLeadRe = new RegExp(`([^${nl}])${nl}{2,}(#{1,6}\\s)`, 'g');
	md = md.split('<br/>').join('<br>');
	md = md.split(`<br>${nl}`).join(nl);
	while (md.includes('<br><br>')) md = md.split('<br><br>').join(`<br>${nl}`);
	md = md.replace(/^-\s{2,}/gm, '- ');
	md = md.replace(headingLeadRe, `$1${nl}$2`);
	md = md.replace(/^(\d+)\.\s+/gm, '$1. ');
	md = md.replace(headingGapRe, `$1${nl}`);
	md = md.replace(new RegExp(`${nl}${nl}<br>$`), '');
	// Replace runs of blank-line placeholders: count them, emit \n\n + one extra \n per placeholder
	md = md.replace(/\n*(?:\x00BL\x00\n*)+/g, m => {
		const count = (m.match(/\x00BL\x00/g) || []).length;
		return `${nl}${nl}${nl.repeat(count)}`;
	});
	let out = '';
	for (let i = 0; i < md.length; i++) {
		const ch = md.charAt(i);
		const nx = md.charAt(i + 1);
		if (ch === '\\' && ['[', ']', '`', '*', '_', '\\', '$'].includes(nx)) {
			out += nx;
			i += 1;
			continue;
		}
		out += ch;
	}
	return out;
};

const previewHtmlRoundTrip = html => {
	const rendered = renderMarkdown(html);
	const dom = new JSDOM(`<div id="root">${rendered}</div>`);
	dom.window.document.querySelectorAll('img.preview-img[data-resource-id]').forEach(img => {
		const wrap = dom.window.document.createElement('span');
		wrap.className = 'preview-img-download-wrap';
		img.parentNode.insertBefore(wrap, img);
		wrap.appendChild(img);
		const btn = dom.window.document.createElement('button');
		btn.type = 'button';
		btn.className = 'preview-img-download-btn';
		btn.textContent = 'Download';
		wrap.appendChild(btn);
	});
	const td = new TurndownService({
		headingStyle: 'atx',
		hr: '---',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '*',
		strongDelimiter: '**',
		br: '',
	});
	td.addRule('joplinImg', {
		filter: node => node.nodeName === 'IMG',
		replacement: (_content, node) => {
			const alt = node.getAttribute('alt') || '';
			const src = node.getAttribute('src') || '';
			const w = node.style.width || node.getAttribute('width');
			const h = node.style.height || node.getAttribute('height');
			const rm = src.match(/^\/resources\/([0-9a-zA-Z]{32})$/);
			const imgSrc = rm ? `:/${rm[1]}` : src;
			if (w || h) return `<img src="${imgSrc}" alt="${alt}"${w ? ` width="${parseInt(w, 10)}"` : ''}${h ? ` height="${parseInt(h, 10)}"` : ''} />`;
			if (rm) return `![${alt}](:/${rm[1]})`;
			return `![${alt}](${src})`;
		},
	});
	td.addRule('joplinLink', {
		filter: node => node.nodeName === 'A' && /^\/resources\/[0-9a-zA-Z]{32}(?:\?download=1)?$/.test((node.getAttribute('href') || '').split('#')[0]),
		replacement: (content, node) => {
			const m = (node.getAttribute('href') || '').match(/^\/resources\/([0-9a-zA-Z]{32})/);
			return `[${content}](:/${m[1]})`;
		},
	});
	td.addRule('externalLink', {
		filter: node => {
			const href = (node.getAttribute('href') || '').trim();
			return node.nodeName === 'A' && !!href && !/^\/resources\//.test(href);
		},
		replacement: (content, node) => {
			const href = (node.getAttribute('href') || '').trim();
			const label = (content || '').trim() || href;
			return `[${label}](${href})`;
		},
	});
	const root = dom.window.document.getElementById('root').cloneNode(true);
	root.querySelectorAll('.preview-img-download-btn').forEach(btn => btn.remove());
	root.querySelectorAll('.preview-img-download-wrap').forEach(wrap => {
		const img = wrap.querySelector('img');
		if (img) wrap.replaceWith(img);
	});
	return td.turndown(root.innerHTML);
};

const previewRoundTripWithCopyButtons = markdown => {
	const html = renderMarkdown(markdown);
	const dom = new JSDOM(`<div id="root">${html}</div>`);
	dom.window.document.querySelectorAll('pre').forEach(pre => {
		const btn = dom.window.document.createElement('button');
		btn.type = 'button';
		btn.className = 'pre-copy-btn';
		btn.textContent = 'Copy';
		pre.insertBefore(btn, pre.firstChild);
	});
	const td = new TurndownService({
		headingStyle: 'atx',
		hr: '---',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '*',
		strongDelimiter: '**',
		br: '',
	});
	let root = dom.window.document.getElementById('root').cloneNode(true);
	root.querySelectorAll('.pre-copy-btn').forEach(btn => btn.remove());
	root.querySelectorAll('.preview-img-download-btn').forEach(btn => btn.remove());
	let md = td.turndown(root.innerHTML);
	return md;
};

test('preview round-trip preserves printable ascii', () => {
	const asciiBody = Array.from({ length: 95 }, (_value, index) => {
		const code = index + 32;
		return `${String(code).padStart(3, '0')}: before${String.fromCharCode(code)}after`;
	}).join('\n');
	assert.equal(previewRoundTrip(asciiBody), asciiBody);
});

test('preview round-trip preserves raw html resource image sizing', () => {
	const body = '<img src=":/49a3f012f300473d98a33b97940306b1" alt="Custom mini 3d" width="454" height="654" />';
	assert.equal(previewHtmlRoundTrip(body), body);
});

test('preview round-trip ignores injected resource image download buttons', () => {
	const body = '![diagram](:/49a3f012f300473d98a33b97940306b1)';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip preserves blank-line markers', () => {
	const body = 'line one\n<br>\nline two\n<br>\n<br>\nline three';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip preserves extra blank lines (triple newlines)', () => {
	assert.equal(previewRoundTrip('line one\n\n\nline two'), 'line one\n\n\nline two');
	assert.equal(previewRoundTrip('line one\n\n\n\nline two'), 'line one\n\n\n\nline two');
	// stable across multiple round-trips
	const rt1 = previewRoundTrip('a\n\n\nb\n\n\n\nc');
	assert.equal(previewRoundTrip(rt1), rt1);
});

test('preview round-trip does not add blank line after heading followed by text', () => {
	const body = '# Heading\nBody';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip does not pad around reloaded subheadings', () => {
	const body = 'Intro\n## Heading 2\nBody\n### Heading 3\nMore';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip preserves fenced code block line breaks', () => {
	const body = '```\nline one\nline two\n```';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip ignores injected code block copy buttons', () => {
	const body = '```\nline one\nline two\n```';
	assert.equal(previewRoundTripWithCopyButtons(body), body);
});

test('preview round-trip preserves mixed formatting note', () => {
	const body = [
		'# Heading 1',
		'Intro with **bold**, *italic*, ++underline++, ~~strike~~, and `inline code`.',
		'## Heading 2',
		'1. First numbered',
		'2. Second numbered',
		'',
		'- Bullet item',
		'',
		'- [ ] Checkbox item',
		'- [x] Checked item',
		'',
		'> Quoted line',
		'',
		'```',
		'code line one',
		'code line two',
		'```',
		'',
		'---',
		'### Heading 3',
		'[Example](https://example.com)',
		'',
		'![image](https://example.com/test.png)',
	].join('\n');
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip converts setext headings to ATX style', () => {
	// Setext === -> h1 -> ATX # (not identity, but stable)
	assert.equal(previewRoundTrip('Hello\n====='), '# Hello');
	assert.equal(previewRoundTrip('Sub\n---'), '## Sub');
	// Already-ATX headings are stable
	assert.equal(previewRoundTrip('# Hello'), '# Hello');
});

test('preview round-trip expands reference links to inline', () => {
	// Reference-style links are normalised to inline on round-trip
	const result = previewRoundTrip('[Example][ref]\n\n[ref]: https://example.com');
	assert.equal(result, '[Example](https://example.com)');
});

test('preview round-trip preserves plain url markdown links', () => {
	assert.equal(previewRoundTrip('[https://example.com](https://example.com)'), '[https://example.com](https://example.com)');
});

test('preview html round-trip keeps auto-linked url text as markdown link', () => {
	assert.equal(previewHtmlRoundTrip('<p><a href="https://example.com">https://example.com</a></p>'), '[https://example.com](https://example.com)');
});

test('preview html round-trip keeps named links as inline markdown links', () => {
	assert.equal(previewHtmlRoundTrip('<p><a href="https://example.com">Example</a></p>'), '[Example](https://example.com)');
});

test('preview round-trip preserves strikethrough', () => {
	assert.equal(previewRoundTrip('~~struck~~'), '~~struck~~');
});

test('preview round-trip preserves underline', () => {
	assert.equal(previewRoundTrip('++underlined++'), '++underlined++');
});

test('preview round-trip preserves soft-break lines within a paragraph', () => {
	// Single \n between lines = soft break. The renderer emits <br> for each.
	// Turndown must convert <br> back to \n, not \n\n (which would create separate
	// paragraphs in the markdown editor and look "double spaced").
	const md = 'Line one\nLine two\nLine three';
	assert.equal(previewRoundTrip(md), md);
});

test('preview round-trip preserves soft-break lines across multiple paragraphs', () => {
	// Mirrors the real "New Note 1" note shape: paragraphs with soft breaks
	// and a trailing list. (Heading blank-line normalisation is tested separately.)
	const md = 'First line.\nSecond line.\nThird line.\n\nNew paragraph.\nAnother line.\n\n- item 1\n- item 2';
	assert.equal(previewRoundTrip(md), md);
});

test('preview round-trip is stable after simulated render-mode text edit', () => {
	// Verifies that adding text to an existing line does not change line spacing.
	// The original note has soft-break lines; after one round-trip the result must
	// equal the (modified) source so that a second round-trip produces no further change.
	const before = 'Line one\nLine two\nLine three\n\nParagraph two.';
	const after  = 'Line one extra text added\nLine two\nLine three\n\nParagraph two.';
	assert.equal(previewRoundTrip(after), after);
	// Also confirm the unmodified source round-trips cleanly.
	assert.equal(previewRoundTrip(before), before);
});

test('preview round-trip does not add blank line after trailing code block', () => {
	// ensureEditableAfterPre injects <p data-pv-trail><br></p> after the last
	// <pre> in the DOM to give contenteditable a cursor target. htmlToMarkdown
	// must strip those injected nodes before Turndown runs so they don't become
	// extra blank lines in the saved markdown.
	const { JSDOM } = require('jsdom');
	const md = 'Some text.\n\n```js\nconst x = 1;\n```';
	const html = renderMarkdown(md);
	const dom = new JSDOM(`<div id="root">${html}</div>`);
	const pv = dom.window.document.getElementById('root');

	// Simulate ensureEditableAfterPre: inject a pv-trail paragraph after the trailing <pre>.
	const pres = pv.querySelectorAll('pre');
	pres.forEach(pre => {
		if (!pre.nextElementSibling) {
			const p = dom.window.document.createElement('p');
			p.innerHTML = '<br>';
			p.dataset.pvTrail = '1';
			pv.appendChild(p);
		}
	});

	// Run previewRoundTrip on the modified DOM's innerHTML.
	const TurndownService = require('../vendor/turndown-lib/turndown.cjs.js');
	const td = new TurndownService({ headingStyle: 'atx', hr: '---', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**', br: '' });
	td.addRule('blankLine', { filter: n => n.nodeName === 'DIV' && n.classList.contains('md-blank-line') && !n.querySelector('img,a,pre,code,ul,ol,blockquote,table') && !n.textContent.trim(), replacement: () => '\x00BL\x00' });
	td.addRule('emptyDiv', { filter: n => n.nodeName === 'DIV' && !n.classList.length && !n.querySelector('img,a,pre,code,ul,ol,blockquote,table') && (!n.textContent.trim() || n.innerHTML === '<br>'), replacement: () => '\x00BL\x00' });
	td.addRule('emptyP', { filter: n => n.nodeName === 'P' && !n.querySelector('img') && (!n.textContent.trim() || n.innerHTML === '<br>'), replacement: () => '\x00BL\x00' });
	const root = pv.cloneNode(true);
	// Apply the data-pv-trail filter (mirrors htmlToMarkdown in app.js).
	root.querySelectorAll('p[data-pv-trail]').forEach(p => p.remove());
	const nl = '\n';
	let result = td.turndown(root.innerHTML);
	const headingGapRe = new RegExp(`^(#{1,6}[^${nl}]*)${nl}{2,}(?=\\S)`, 'gm');
	result = result.replace(headingGapRe, `$1${nl}`);
	result = result.replace(/\n*(?:\x00BL\x00\n*)+/g, m => {
		const count = (m.match(/\x00BL\x00/g) || []).length;
		return `${nl}${nl}${nl.repeat(count)}`;
	});
	assert.equal(result.trimEnd(), md.trimEnd(),
		'trailing code block should not gain an extra blank line from injected pv-trail node');
});

test('logged in layout includes htmlToMarkdown normalization for preview save', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	// htmlToMarkdown and other editor functions are now in public/app.js
	assert.ok(html.includes('/app.js'));
	assert.ok(html.includes('_joplockConfig'));
	assert.ok(!html.includes('function htmlToMarkdown(el){'));
});
