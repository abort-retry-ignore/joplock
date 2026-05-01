// markdown-it-based renderer replacing the hand-rolled regex pipeline.
// Preserves all Joplin-flavored extensions (resource URIs, checkboxes,
// underline, blank-line markers, spellcheck attrs, hx-* strip).
'use strict';

const MarkdownIt = require('markdown-it');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE_ID_RE = /^:\/([0-9a-fA-F]{32})$/;
const JOPLIN_SRC_RE = /src=":\/([0-9a-fA-F]{32})"/g;

function escapeHtmlAttr(str) {
	return String(str)
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

// ---------------------------------------------------------------------------
// markdown-it instance
// ---------------------------------------------------------------------------

const md = new MarkdownIt({
	html: true,        // allow passthrough <br>, &nbsp;, inline <img>
	breaks: false,     // no auto soft-break → <br> (we handle via override below)
	linkify: false,
	typographer: false,
});

// ---------------------------------------------------------------------------
// Softbreak: single \n within a paragraph → bare <br> (no trailing \n).
// This replicates old renderer's `replace(/\n/g, '<br>')` inside <p> so that
// Turndown sees actual <br> elements (not \n text nodes that collapse to space).
// ---------------------------------------------------------------------------

md.renderer.rules.softbreak = () => '<br>';

// ---------------------------------------------------------------------------
// ++underline++ — custom inline rule (runs after inline, safe to push)
// ---------------------------------------------------------------------------

md.core.ruler.push('underline', state => {
	for (const blockToken of state.tokens) {
		if (blockToken.type !== 'inline') continue;
		const children = [];
		let i = 0;
		while (i < blockToken.children.length) {
			const tok = blockToken.children[i];
			if (tok.type === 'text') {
				const parts = tok.content.split(/(\+\+.+?\+\+)/);
				if (parts.length === 1) { children.push(tok); i++; continue; }
				for (const part of parts) {
					if (part.startsWith('++') && part.endsWith('++') && part.length > 4) {
						const open = new state.Token('html_inline', '', 0);
						open.content = '<u>';
						children.push(open);
						const inner = new state.Token('text', '', 0);
						inner.content = part.slice(2, -2);
						children.push(inner);
						const close = new state.Token('html_inline', '', 0);
						close.content = '</u>';
						children.push(close);
					} else if (part) {
						const t = new state.Token('text', '', 0);
						t.content = part;
						children.push(t);
					}
				}
			} else {
				children.push(tok);
			}
			i++;
		}
		blockToken.children = children;
	}
});

// ---------------------------------------------------------------------------
// Render rule overrides
// ---------------------------------------------------------------------------

// fence: <pre spellcheck="false"><code class="language-X" spellcheck="false">
md.renderer.rules.fence = (tokens, idx) => {
	const token = tokens[idx];
	const lang = token.info ? token.info.trim().split(/\s+/)[0] : '';
	const cls = lang ? ` class="language-${escapeHtmlAttr(lang)}"` : '';
	const code = token.content;
	return `<pre spellcheck="false"><code${cls} spellcheck="false">${escapeHtmlForCode(code)}</code></pre>\n`;
};

// code_block (indented): same as fence, no language
md.renderer.rules.code_block = (tokens, idx) => {
	const code = tokens[idx].content;
	return `<pre spellcheck="false"><code spellcheck="false">${escapeHtmlForCode(code)}</code></pre>\n`;
};

// code_inline
md.renderer.rules.code_inline = (tokens, idx) => {
	return `<code spellcheck="false">${escapeHtmlForCode(tokens[idx].content)}</code>`;
};

function escapeHtmlForCode(str) {
	return String(str)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

// image: rewrite :/<id> src, add class="preview-img"
md.renderer.rules.image = (tokens, idx, options, _env, self) => {
	const token = tokens[idx];
	let src = token.attrGet('src') || '';
	const alt = self.renderInlineAsText(token.children, options, _env);
	const m = src.match(RESOURCE_ID_RE);
	if (m) src = `/resources/${m[1]}`;
	return `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" class="preview-img" />`;
};

// link_open: rewrite :/<id> href, add target+rel for external links
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	const token = tokens[idx];
	let href = token.attrGet('href') || '';
	const m = href.match(RESOURCE_ID_RE);
	if (m) {
		href = `/resources/${m[1]}`;
		token.attrSet('href', href);
		token.attrSet('target', '_blank');
		token.attrSet('rel', 'noopener');
	} else if (/^https?:\/\//i.test(href) || /^\/\//.test(href)) {
		token.attrSet('target', '_blank');
		token.attrSet('rel', 'noopener');
	}
	return defaultLinkOpen(tokens, idx, options, env, self);
};

// ---------------------------------------------------------------------------
// Pre-processing: transform source markdown before markdown-it sees it.
// Operations are applied in order on each line, skipping fenced code blocks.
// ---------------------------------------------------------------------------

/**
 * Apply line-by-line transformations to markdown source, skipping the content
 * of fenced code blocks (``` or ~~~).
 *
 * @param {string} src  Raw markdown source.
 * @param {(line: string) => string} transform  Line transformer (called for
 *   non-fence lines; fence open/close lines are kept verbatim).
 * @returns {string}
 */
function transformLines(src, transform) {
	const lines = src.split('\n');
	let inFence = false;
	let fenceMarker = '';
	const out = [];
	for (const line of lines) {
		if (!inFence) {
			const m = line.match(/^(\s{0,3})(```+|~~~+)/);
			if (m) {
				inFence = true;
				fenceMarker = m[2];
				out.push(line);
			} else {
				out.push(transform(line));
			}
		} else {
			out.push(line);
			// Closing fence: same or longer marker, same type, optional trailing spaces
			if (new RegExp(`^\\s{0,3}${fenceMarker[0]}+\\s*$`).test(line)) {
				inFence = false;
				fenceMarker = '';
			}
		}
	}
	return out.join('\n');
}

/**
 * Convert task-list lines (`- [ ] ...` / `- [x] ...`) to HTML blocks so they
 * render as <div class="md-checkbox"> elements that Turndown's `checkbox` rule
 * can pick up without the <ul>/<li> wrapper that causes indentation artefacts.
 */
function preProcessCheckboxes(src) {
	return transformLines(src, line => {
		const m = line.match(/^(- )\[( |x|X)\] (.*)$/);
		if (!m) return line;
		const checked = m[2].toLowerCase() === 'x';
		const text = m[3];
		const cls = checked ? 'md-checkbox checked' : 'md-checkbox';
		const glyph = checked ? '&#9745;' : '&#9744;';
		return `<div class="${cls}"><span class="md-cb-icon">${glyph}</span>&nbsp;${text}</div>`;
	});
}

/**
 * Replace runs of 3+ newlines with explicit md-blank-line divs so Turndown's
 * `blankLine` rule can reconstruct the extra blank lines on round-trip.
 * Uses direct HTML blocks instead of NUL sentinels (markdown-it replaces U+0000
 * with U+FFFD, breaking sentinel-based approaches).
 */
function injectBlankLineBlocks(src) {
	return src.replace(/\n{3,}/g, match => {
		const extra = match.length - 2;
		return '\n\n' + '<div class="md-blank-line"><br></div>\n\n'.repeat(extra);
	});
}

// ---------------------------------------------------------------------------
// Post-process: rewrite :/<id> in raw-HTML img src, strip hx-* attrs
// ---------------------------------------------------------------------------

function postProcess(html) {
	// Rewrite :/<id> in src attrs from raw HTML passthrough (<img src=":/...">)
	html = html.replace(JOPLIN_SRC_RE, (_m, id) => `src="/resources/${id}"`);

	// Strip hx-* attributes (htmx injection guard)
	html = html.replace(/\s+hx-[a-z-]+="[^"]*"/g, '');

	return html;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const renderMarkdown = (markdown) => {
	if (!markdown) return '';
	let src = String(markdown);
	src = preProcessCheckboxes(src);
	src = injectBlankLineBlocks(src);
	const html = md.render(src);
	return postProcess(html);
};

module.exports = { renderMarkdown };
