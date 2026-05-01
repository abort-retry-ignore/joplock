// Shared utilities and constants used across all template modules
'use strict';

const { validDateFormats, validDatetimeFormats } = require('../settingsService');
const { renderMarkdown: renderMarkdownImpl } = require('../markdownRenderer');

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

// renderMarkdown delegates to app/markdownRenderer.js (markdown-it engine).
// Old regex implementation removed; markdownRenderer.js is the source of truth.
const renderMarkdown = renderMarkdownImpl;

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
