'use strict';

// Rendering for Joplin HTML notes (markup_language = 2).
//
// These notes are stored as HTML (for example full-page web clips), not markdown,
// and Joplock shows them read-only. The HTML is UNTRUSTED - it may come from any
// web page - so it goes through an allowlist sanitizer here AND is then loaded
// into TinyMCE's sandboxed iframe, which sanitizes again.
//
//   - tags: structural / text-level tags only; scripts, styles, frames, forms,
//     svg/math, media and anything unknown never survive (unknown wrappers are
//     unwrapped so their text stays)
//   - attributes: a small allowlist; event handlers, hx-* and everything else drop
//   - URLs: http(s)/mailto/tel/relative only; Joplin resource links (`:/<id>`)
//     are rewritten to /resources/<id>; javascript:/data:/vbscript: etc. drop
//     (data: images are allowed for <img src>)

const domino = require('@mixmark-io/domino');

const DROP_WITH_CONTENT = new Set([
	'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
	'form', 'noscript', 'template', 'svg', 'math', 'audio', 'video', 'source', 'track', 'canvas', 'dialog',
	'input', 'button', 'select', 'textarea', 'option', 'head', 'title', 'xmp', 'plaintext', 'listing',
]);

const ALLOWED_TAGS = new Set([
	'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center',
	'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption',
	'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li',
	'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span',
	'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt',
	'u', 'ul', 'var', 'wbr',
]);

const ALLOWED_ATTRIBUTES = new Set([
	'class', 'title', 'lang', 'dir', 'align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'scope', 'span',
	'start', 'type', 'reversed', 'cite', 'datetime', 'alt', 'border', 'cellpadding', 'cellspacing', 'bgcolor',
	'color', 'face', 'size', 'open', 'style', 'href', 'src',
]);

const RESOURCE_LINK = /^:\/([0-9a-f]{32})(#.*)?$/i;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
const UNSAFE_STYLE = /(expression\s*\(|url\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding|position\s*:\s*(fixed|absolute|sticky))/i;

// Browsers ignore whitespace/control characters inside a scheme ("java\nscript:"),
// so strip them before looking at it.
const schemeOf = value => {
	const squashed = `${value}`.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
	const m = /^([a-z][a-z0-9+.-]*):/.exec(squashed);
	return m ? m[1] : '';
};

// Returns the safe replacement URL, or null to drop the attribute.
const safeUrl = (value, attr) => {
	const trimmed = `${value}`.trim();
	if (!trimmed) return null;
	const resource = RESOURCE_LINK.exec(trimmed);
	if (resource) return `/resources/${resource[1].toLowerCase()}${resource[2] || ''}`;
	const scheme = schemeOf(trimmed);
	if (!scheme) {
		// relative URL or fragment: keep
		return trimmed;
	}
	if (scheme === 'http' || scheme === 'https') return trimmed;
	if (attr === 'href' && (scheme === 'mailto' || scheme === 'tel')) return trimmed;
	if (attr === 'src' && scheme === 'data' && SAFE_DATA_IMAGE.test(trimmed)) return trimmed;
	return null;
};

const cleanAttributes = (element, tag) => {
	for (const attr of Array.from(element.attributes || [])) {
		const name = attr.name.toLowerCase();
		let keep = ALLOWED_ATTRIBUTES.has(name);
		// src only makes sense on <img>; href only on <a>
		if (name === 'src' && tag !== 'img') keep = false;
		if (name === 'href' && tag !== 'a') keep = false;
		if (!keep) { element.removeAttribute(attr.name); continue; }
		if (name === 'href' || name === 'src') {
			const url = safeUrl(attr.value, name);
			if (url === null) element.removeAttribute(attr.name);
			else if (url !== attr.value) element.setAttribute(attr.name, url);
		} else if (name === 'style') {
			if (UNSAFE_STYLE.test(attr.value)) element.removeAttribute(attr.name);
		}
	}
	if (tag === 'a' && element.hasAttribute('href') && !`${element.getAttribute('href')}`.startsWith('#')) {
		element.setAttribute('target', '_blank');
		element.setAttribute('rel', 'noopener noreferrer');
	}
};

const sanitizeChildren = parent => {
	for (const node of Array.from(parent.childNodes)) {
		if (node.nodeType === 3) continue; // text
		if (node.nodeType !== 1) { parent.removeChild(node); continue; } // comments, PIs, ...
		const tag = node.nodeName.toLowerCase();
		if (DROP_WITH_CONTENT.has(tag)) { parent.removeChild(node); continue; }
		if (!ALLOWED_TAGS.has(tag)) {
			// Unknown wrapper: keep its (sanitized) content, lose the element.
			sanitizeChildren(node);
			while (node.firstChild) parent.insertBefore(node.firstChild, node);
			parent.removeChild(node);
			continue;
		}
		cleanAttributes(node, tag);
		if (tag === 'img' && !node.hasAttribute('src')) { parent.removeChild(node); continue; }
		sanitizeChildren(node);
	}
};

// HTML note body -> safe HTML fragment. Never throws; unparseable input yields ''.
const renderHtmlNote = body => {
	try {
		const doc = domino.createDocument(`${body || ''}`);
		const root = doc.body || doc.documentElement;
		if (!root) return '';
		sanitizeChildren(root);
		return root.innerHTML;
	} catch {
		return '';
	}
};

module.exports = { renderHtmlNote, safeUrl, schemeOf };
