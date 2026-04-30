// Shared utilities and constants used across all template modules
'use strict';

const { validDateFormats, validDatetimeFormats } = require('../settingsService');

const escapeHtml = value => `${value}`
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll('\'', '&#39;');

const appleSplashLinks = [
	['1320x2868.png', 'screen and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2868x1320.png', 'screen and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1290x2796.png', 'screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2796x1290.png', 'screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1179x2556.png', 'screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2556x1179.png', 'screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1170x2532.png', 'screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2532x1170.png', 'screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1125x2436.png', 'screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2436x1125.png', 'screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1242x2688.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2688x1242.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['828x1792.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['1792x828.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['1536x2048.png', 'screen and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2048x1536.png', 'screen and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['1668x2388.png', 'screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2388x1668.png', 'screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['1640x2360.png', 'screen and (device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2360x1640.png', 'screen and (device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['2048x2732.png', 'screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2732x2048.png', 'screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
].map(([fileName, media]) => `<link rel="apple-touch-startup-image" href="/apple-splash/${fileName}" media="${media}" />`).join('\n\t');

const folderOutlineIcon = '<svg viewBox="0 0 24 24" class="folder-outline-icon" aria-hidden="true"><path d="M3.75 6.75h5.25l1.5 2h9.75v8.5A1.75 1.75 0 0 1 18.5 19H5.5a1.75 1.75 0 0 1-1.75-1.75v-8.75A1.75 1.75 0 0 1 5.5 6.75Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.75 8.75h16.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const allNotesIcon = '&#128196;';
const trashFolderId = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';
const themeOptions = [['matrix','Matrix'],['matrix-blue','Dark Blue'],['matrix-purple','Dark Purple'],['matrix-amber','Dark Amber'],['matrix-orange','Dark Orange'],['dark-grey','Dark Grey'],['dark-red','Dark Red'],['dark','Dark'],['light','Light'],['oled-dark','OLED Dark'],['solarized-light','Solarized Light'],['solarized-dark','Solarized Dark'],['nord','Nord'],['dracula','Dracula'],['aritim-dark','Aritim Dark']];

const stripMarkdownForTitle = value => {
	let text = `${value || ''}`.trim();
	text = text.replace(/<[^>]+>/g, ' ');
	while (text.startsWith('#')) text = text.slice(1).trimStart();
	text = text
		.replaceAll('**', '')
		.replaceAll('__', '')
		.replaceAll('++', '')
		.replaceAll('*', '')
		.replaceAll('_', '')
		.replaceAll('~~', '')
		.replaceAll('`', '');
	let output = '';
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (ch === '!' && text[i + 1] === '[') {
			const altEnd = text.indexOf(']', i + 2);
			const imgOpen = altEnd >= 0 ? text.indexOf('(', altEnd + 1) : -1;
			const imgClose = imgOpen >= 0 ? text.indexOf(')', imgOpen + 1) : -1;
			if (altEnd >= 0 && imgOpen === altEnd + 1 && imgClose >= 0) {
				output += text.slice(i + 2, altEnd);
				i = imgClose;
				continue;
			}
		}
		if (ch === '[') {
			const labelEnd = text.indexOf(']', i + 1);
			const linkOpen = labelEnd >= 0 ? text.indexOf('(', labelEnd + 1) : -1;
			const linkClose = linkOpen >= 0 ? text.indexOf(')', linkOpen + 1) : -1;
			if (labelEnd >= 0 && linkOpen === labelEnd + 1 && linkClose >= 0) {
				output += text.slice(i + 1, labelEnd);
				i = linkClose;
				continue;
			}
		}
		output += ch;
	}
	return output.trim();
};

// Render only inline markdown (bold, italic, strikethrough, inline code) — no block elements
const renderInlineMarkdown = (text) => {
	if (!text) return '';
	let html = text;
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
	html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
	html = html.replace(/`(.+?)`/g, '<code spellcheck="false">$1</code>');
	return html;
};

// Simple markdown to HTML renderer (handles common Joplin markdown)
const renderMarkdown = (markdown) => {
	if (!markdown) return '';
	const codeBlocks = [];
	const storeCodeBlock = (code, lang) => {
		const i = codeBlocks.length;
		codeBlocks.push({code, lang: lang || ''});
		return `\x00CB${i}\x00`;
	};

	let text = String(markdown);

	// Pass A: fences nested inside list items.
	//   - <indent><marker> ```<lang>
	//         <body lines, each indented at least as much as content>
	//     ```
	// Outdent the body, store the code block, and rewrite the line so the
	// surrounding list-item wrapping (later in the pipeline) still works.
	text = text.replace(/^([ \t]*)([-*+])[ \t]+```(\w*)[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm, (_m, indent, marker, lang, body) => {
		// Outdent body: strip the longest common leading whitespace from non-empty lines
		const lines = body.split('\n');
		let minIndent = Infinity;
		for (const line of lines) {
			if (!line.trim()) continue;
			const m = line.match(/^[ \t]*/);
			if (m && m[0].length < minIndent) minIndent = m[0].length;
		}
		if (!isFinite(minIndent)) minIndent = 0;
		const code = lines.map(l => l.slice(minIndent)).join('\n').trimEnd();
		return `${indent}${marker} ${storeCodeBlock(code, lang)}`;
	});

	// Pass B: column-0 (or up to 3 leading spaces, per CommonMark) fenced code blocks.
	// Extract code blocks before any markdown/html transforms so their contents stay opaque.
	text = text.replace(/^[ ]{0,3}```(\w*)[ \t]*\n([\s\S]*?)\n[ ]{0,3}```[ \t]*$/gm, (_m, lang, code) => storeCodeBlock(code, lang));

	// Consecutive full-line backtick spans → code block (ASCII art pasted as `line` per line)
	text = text.replace(/(^`.+`(?:\n(?:`.+`|[ \t]*))*)/gm, match => {
		const lines = match.split('\n');
		const code = lines.map(l => /^`([\s\S]*)`$/.test(l) ? l.replace(/^`([\s\S]*)`$/, '$1') : l).join('\n').trimEnd();
		return storeCodeBlock(code);
	});

	let html = escapeHtml(text);

	// Passthrough <br> tags (used for blank line preservation in Joplin)
	html = html.replace(/&lt;br&gt;/g, '<br>');

	// Passthrough &nbsp; (common in notes pasted from web/rich text)
	html = html.replace(/&amp;nbsp;/g, '&nbsp;');

	// Passthrough inline <img> HTML tags (restore escaped versions)
	// Handles: <img src=":/id" ...>, <img src=":/id" ... />, and normal URL src
	html = html.replace(/&lt;img\s([\s\S]*?)(?:\/)?&gt;/g, (_m, attrs) => {
		const restored = attrs.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
		const srcMatch = restored.match(/src=":\/([\w]{32})"/);
		const fixedAttrs = srcMatch ? restored.replace(/src=":\/([\w]{32})"/, `src="/resources/${srcMatch[1]}"`) : restored;
		return `<img ${fixedAttrs} class="preview-img" />`;
	});

	// Headings
	html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
	html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
	html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
	html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
	html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
	html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

	// Horizontal rule
	html = html.replace(/^---+$/gm, '<hr>');

	// Bold + italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	// Bold
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	// Italic
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	// Strikethrough
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
	// Underline (Joplin markdown-it plugin)
	html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
	// Inline code
	html = html.replace(/`([^`]+)`/g, '<code spellcheck="false">$1</code>');

	// Joplin resource images: ![alt](:/resourceId)
	html = html.replace(/!\[([^\]]*)\]\(:\/([0-9a-zA-Z]{32})\)/g, '<img src="/resources/$2" alt="$1" class="preview-img" />');
	// Regular images: ![alt](url)
	html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="preview-img" />');
	// Joplin resource links: [text](:/resourceId)
	html = html.replace(/\[([^\]]*)\]\(:\/([0-9a-zA-Z]{32})\)/g, '<a href="/resources/$2" target="_blank" rel="noopener">$1</a>');
	// Regular links: [text](url)
	html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

	// Checkboxes
	html = html.replace(/^- \[x\](?:\s+(.*))?$/gm, (_m, text) => `<div class="md-checkbox checked"><span class="md-cb-icon">&#9745;</span>&nbsp;${text || ''}</div>`);
	html = html.replace(/^- \[ \](?:\s+(.*))?$/gm, (_m, text) => `<div class="md-checkbox"><span class="md-cb-icon">&#9744;</span>&nbsp;${text || ''}</div>`);

	// Unordered lists
	html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
	// Wrap consecutive <li> in <ul>
	html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
	// Ordered lists
	html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="ol-item">$1</li>');
	// Wrap consecutive ol-item <li> in <ol>
	html = html.replace(/((?:<li class="ol-item">.*<\/li>\n?)+)/g, (_m, items) => `<ol>${items.replace(/ class="ol-item"/g, '')}</ol>`);
	// Isolate block tags so paragraph wrapping does not create invalid <p><h1>...</h1></p> markup.
	html = html.replace(/\n+(<(?:h[1-6]|pre|ul|ol|blockquote|hr|div)[> ])/g, '\n\n$1');
	html = html.replace(/(<\/(?:h[1-6]|pre|ul|ol|blockquote|div)>|<hr>)\n+/g, '$1\n\n');
	// Blockquote
	html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

	// Preserve extra blank lines (3+ newlines) as explicit markers before paragraph splitting
	html = html.replace(/\n{3,}/g, match => {
		const extraBlanks = match.length - 2; // beyond the normal paragraph break
		return `\n\n${Array.from({ length: extraBlanks }, () => '<div class="md-blank-line"><br></div>').join('')}\n\n`;
	});

	// Paragraphs: double newline → paragraph break
	const blocks = html.split('\n\n');
	const blockRe = /^<(?:h[1-6]|pre|ul|ol|blockquote|hr|div)|\x00CB\d+\x00/;
	const out = [];
	for (let i = 0; i < blocks.length; i++) {
		const trimmed = blocks[i].trim();
		if (!trimmed) continue;
		if (blockRe.test(trimmed)) { out.push(trimmed); continue; }
		out.push(`<p>${trimmed.replace(/\n/g, '<br>')}</p>`);
	}
	html = out.join('');

	// Restore code block placeholders
	html = html.replace(/\x00CB(\d+)\x00/g, (_m, i) => {
		const b = codeBlocks[i];
		const cls = b.lang ? ` class="language-${b.lang}"` : '';
		return `<pre spellcheck="false"><code${cls}>${escapeHtml(b.code)}</code></pre>`;
	});

	// Strip any hx-* attributes from rendered HTML to prevent htmx from
	// processing user content (e.g. data: URI images or pasted HTML with htmx attrs)
	html = html.replace(/\s+hx-[a-z-]+="[^"]*"/g, '');

	return html;
};

// Renders a password input + eye-toggle button pair.
//   name       — the input's name attribute
//   opts       — { placeholder, id, autocomplete, required, extraClass }
// The eye button uses parentNode.querySelector('input') so it works regardless of id.
// Special case: if opts.id is set, the eye button on the login page uses getElementById
// because the input is not a direct sibling but shares a wrapper.
const passwordField = (name, opts = {}) => {
	const { placeholder = '', id = '', autocomplete = '', required = true, extraClass = '' } = opts;
	const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
	const autocompleteAttr = autocomplete ? ` autocomplete="${escapeHtml(autocomplete)}"` : '';
	const requiredAttr = required ? ' required' : '';
	const classes = ['login-input', extraClass].filter(Boolean).join(' ');
	const eyeTarget = id
		? `var p=document.getElementById('${escapeHtml(id)}')`
		: `var p=this.parentNode.querySelector('input')`;
	return `<input type="password" name="${escapeHtml(name)}"${idAttr} placeholder="${escapeHtml(placeholder)}" class="${classes}"${autocompleteAttr}${requiredAttr} />` +
		`<button type="button" class="login-eye" onclick="${eyeTarget};if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>`;
};

const svgLockClosed = '<svg class="vault-svg-icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke-width="2.5"/></svg>';
const svgLockOpen = '<svg class="vault-svg-icon" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="15" width="18" height="11" rx="2"/><path d="M7 15V8a5 5 0 0 1 10 0"/></svg>';

module.exports = {
	escapeHtml,
	appleSplashLinks,
	folderOutlineIcon,
	allNotesIcon,
	trashFolderId,
	themeOptions,
	validDateFormats,
	validDatetimeFormats,
	stripMarkdownForTitle,
	renderInlineMarkdown,
	renderMarkdown,
	passwordField,
	svgLockClosed,
	svgLockOpen,
};
