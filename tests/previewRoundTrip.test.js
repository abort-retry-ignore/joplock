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
		br: '<br>',
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
		br: '<br>',
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
		br: '<br>',
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

test('preview round-trip preserves strikethrough', () => {
	assert.equal(previewRoundTrip('~~struck~~'), '~~struck~~');
});

test('preview round-trip preserves underline', () => {
	assert.equal(previewRoundTrip('++underlined++'), '++underlined++');
});

test('logged in layout includes htmlToMarkdown normalization for preview save', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	// htmlToMarkdown and other editor functions are now in public/app.js
	assert.ok(html.includes('/app.js'));
	assert.ok(html.includes('_joplockConfig'));
	assert.ok(!html.includes('function htmlToMarkdown(el){'));
});
