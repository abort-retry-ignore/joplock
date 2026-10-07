/* Joplock markdown-mode (CodeMirror 6) extras.
 *
 * Loaded after codemirror.min.js and before app.js. Exposes `window.JoplockMd`:
 *
 *   JoplockMd.createExtensions(window.CM, hooks, opts) -> Extension[]
 *   JoplockMd.<pure helpers>  (also exported through module.exports for tests)
 *
 * Everything that does NOT need CodeMirror is a pure function (scan a line,
 * format a table, count words, ...) so it can be unit-tested in plain Node.
 *
 * Features (each independently switchable through `opts`):
 *   inlineWidgets  image previews under `![](:/id)` lines (+ drag-to-resize),
 *                  attachment / note-link chips, clickable task checkboxes,
 *                  fenced-code background + Copy button
 *   livePreview    hide formatting markers (#, **, *, ~~, `, [](url)) on every
 *                  line the caret is not touching
 *   statusBar      word count / reading time + a heading outline popup
 *   folding        fold gutter (headings, lists, fenced code)
 *   (always on)    paste HTML -> markdown, paste URL over a selection -> link,
 *                  table helper (Tab / Shift-Tab), hover info on `:/id`
 *                  links
 */
(function (root) {
	'use strict';

	// ---------------------------------------------------------------------
	// Pure helpers
	// ---------------------------------------------------------------------

	var RES_ID = '[0-9a-zA-Z]{32}';
	var MD_IMG_SRC = '!\\[((?:[^\\]\\\\]|\\\\.)*)\\]\\(\\s*<?:\\/(' + RES_ID + ')>?(?:#[^\\s)]*)?(?:\\s+(?:"[^"]*"|\'[^\']*\'))?\\s*\\)';
	var MD_LINK_SRC = '\\[((?:[^\\]\\\\]|\\\\.)*)\\]\\(\\s*<?:\\/(' + RES_ID + ')>?(#[^\\s)]*)?(?:\\s+(?:"[^"]*"|\'[^\']*\'))?\\s*\\)';
	var TASK_RE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/;
	var HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

	function escapeAttr(s) {
		return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
	function unescapeHtml(s) {
		return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
	}
	function escMdAlt(s) { return String(s || '').replace(/([\\\]])/g, '\\$1'); }
	function unescMdAlt(s) { return String(s || '').replace(/\\(.)/g, '$1'); }

	// Fenced code blocks (``` or ~~~). Returns a per-line "inside a fence (fence
	// lines included)" mask plus the fence list. An unclosed fence runs to EOF,
	// exactly like CommonMark.
	function computeFences(lines) {
		var inFence = new Array(lines.length);
		var fences = [];
		var open = null;
		for (var i = 0; i < lines.length; i++) {
			var l = lines[i];
			if (!open) {
				inFence[i] = false;
				var m = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(l);
				if (m) {
					// A backtick fence's info string may not contain backticks
					// (otherwise it is an inline code span like ```x```).
					var rest = l.slice(l.indexOf(m[1]) + m[1].length);
					if (m[1].charAt(0) === '`' && rest.indexOf('`') >= 0) continue;
					open = { start: i, ch: m[1].charAt(0), len: m[1].length, lang: m[2] || '' };
					inFence[i] = true;
				}
			} else {
				inFence[i] = true;
				var closeRe = new RegExp('^[ \\t]*' + (open.ch === '`' ? '`' : '~') + '{' + open.len + ',}[ \\t]*$');
				if (closeRe.test(l)) {
					fences.push({ start: open.start, end: i, lang: open.lang, closed: true });
					open = null;
				}
			}
		}
		if (open) fences.push({ start: open.start, end: lines.length - 1, lang: open.lang, closed: false });
		return { inFence: inFence, fences: fences };
	}

	// [from,to) ranges of inline code spans on one line.
	function codeSpans(line) {
		var spans = [];
		var i = 0;
		var n = line.length;
		while (i < n) {
			if (line.charAt(i) !== '`') { i++; continue; }
			var j = i;
			while (j < n && line.charAt(j) === '`') j++;
			var run = j - i;
			var k = j;
			var found = -1;
			while (k < n) {
				if (line.charAt(k) === '`') {
					var e = k;
					while (e < n && line.charAt(e) === '`') e++;
					if (e - k === run) { found = e; break; }
					k = e;
				} else k++;
			}
			if (found >= 0) { spans.push([i, found]); i = found; } else i = j;
		}
		return spans;
	}
	function inSpans(spans, pos) {
		for (var i = 0; i < spans.length; i++) if (pos >= spans[i][0] && pos < spans[i][1]) return true;
		return false;
	}

	function parseAttrs(tag) {
		var attrs = {};
		var re = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
		var m;
		while ((m = re.exec(tag))) {
			attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
		}
		return attrs;
	}

	// Image references on one line: `![alt](:/id)` and `<img src=":/id" width=..>`.
	function findImageRefs(line) {
		var spans = codeSpans(line);
		var out = [];
		var m;
		var re = new RegExp(MD_IMG_SRC, 'g');
		while ((m = re.exec(line))) {
			if (inSpans(spans, m.index)) continue;
			out.push({ kind: 'md', from: m.index, to: m.index + m[0].length, id: m[2], alt: unescMdAlt(m[1]), width: 0, height: 0 });
		}
		var hre = /<img\b[^>]*>/gi;
		while ((m = hre.exec(line))) {
			if (inSpans(spans, m.index)) continue;
			var a = parseAttrs(m[0]);
			var sm = /^(?::\/|\/?resources\/)([0-9a-zA-Z]{32})(?:[?#].*)?$/.exec(a.src || '');
			if (!sm) continue;
			out.push({
				kind: 'html', from: m.index, to: m.index + m[0].length, id: sm[1],
				alt: unescapeHtml(a.alt || ''), width: parseInt(a.width, 10) || 0, height: parseInt(a.height, 10) || 0,
			});
		}
		out.sort(function (x, y) { return x.from - y.from; });
		return out;
	}

	// Source text for an image reference at a given width (0/null -> natural
	// size, plain markdown). Matches the Turndown `joplinImg` rule used by the
	// rendered editor so the two modes round-trip each other's resized images.
	function buildImageSource(ref, width) {
		if (!width) return '![' + escMdAlt(ref.alt) + '](:/' + ref.id + ')';
		return '<img src=":/' + ref.id + '" alt="' + escapeAttr(ref.alt || '') + '" width="' + Math.round(width) + '" />';
	}

	// Internal links `[text](:/id)` (NOT images). The id is either an attachment
	// or another note; the caller decides which.
	function findLinkRefs(line) {
		var spans = codeSpans(line);
		var out = [];
		var re = new RegExp(MD_LINK_SRC, 'g');
		var m;
		while ((m = re.exec(line))) {
			var prev = m.index > 0 ? line.charAt(m.index - 1) : '';
			if (prev === '!' || prev === '\\') continue;
			if (inSpans(spans, m.index)) continue;
			if (m[1].indexOf('![') >= 0) continue; // nested image inside the label
			out.push({ from: m.index, to: m.index + m[0].length, text: unescMdAlt(m[1]), id: m[2] });
		}
		return out;
	}

	function findTaskMarker(line) {
		var m = TASK_RE.exec(line);
		if (!m) return null;
		return { from: m[1].length, to: m[1].length + 3, checked: m[2] !== ' ' };
	}

	function plainHeadingText(s) {
		return String(s)
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/[*_`~]/g, '')
			.trim();
	}

	// One pass over the document -> everything the decorations need, with
	// absolute offsets. Content inside fenced code is never scanned.
	function scanDoc(text) {
		var lines = String(text).split('\n');
		var fx = computeFences(lines);
		var starts = new Array(lines.length);
		var off = 0;
		var i;
		for (i = 0; i < lines.length; i++) { starts[i] = off; off += lines[i].length + 1; }
		var res = { lineCount: lines.length, lineStarts: starts, inFence: fx.inFence, fences: fx.fences, images: [], links: [], tasks: [], headings: [] };
		for (i = 0; i < lines.length; i++) {
			if (fx.inFence[i]) continue;
			var l = lines[i];
			var start = starts[i];
			if (l.indexOf('](') >= 0 || l.indexOf('<img') >= 0) {
				var refs = findImageRefs(l);
				if (refs.length) {
					res.images.push({ line: i, from: start, to: start + l.length, refs: refs });
				}
				if (l.indexOf('](') >= 0) {
					var links = findLinkRefs(l);
					for (var k = 0; k < links.length; k++) {
						res.links.push({ line: i, from: start + links[k].from, to: start + links[k].to, text: links[k].text, id: links[k].id });
					}
				}
			}
			if (l.indexOf('[') >= 0) {
				var t = findTaskMarker(l);
				if (t) res.tasks.push({ line: i, from: start + t.from, to: start + t.to, checked: t.checked, lineEnd: start + l.length });
			}
			if (l.indexOf('#') >= 0) {
				var hm = HEADING_RE.exec(l);
				if (hm && hm[2]) {
					res.headings.push({ line: i, from: start + l.indexOf('#'), level: hm[1].length, text: plainHeadingText(hm[2]) });
				}
			}
		}
		return res;
	}

	// Word / reading-time statistics for the status bar.
	function countWords(text) {
		if (!text) return 0;
		var t = String(text)
			.replace(/^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[ xX]\]/gm, '$1')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
			.replace(/<img\b[^>]*>/gi, ' ')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/<[^>]+>/g, ' ');
		var m;
		try {
			m = t.match(new RegExp("[\\p{L}\\p{N}]+(?:['\u2019][\\p{L}\\p{N}]+)*", 'gu'));
		} catch (_e) {
			m = t.match(/[A-Za-z0-9\u00C0-\uFFFF]+/g);
		}
		return m ? m.length : 0;
	}
	function readingMinutes(words) { return words <= 0 ? 0 : Math.max(1, Math.round(words / 220)); }

	// --- tables ------------------------------------------------------------

	function isTableRow(l) { return /^[ \t]*\|.*\|[ \t]*$/.test(l); }
	function isDelimiterRow(l) {
		return l.indexOf('-') >= 0 && l.indexOf('|') >= 0 &&
			/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(l);
	}

	// Locate the pipe-table containing line `idx`. getLine(i) -> text.
	function tableBlockAt(getLine, lineCount, idx, inFence) {
		if (idx < 0 || idx >= lineCount) return null;
		if (inFence && inFence[idx]) return null;
		if (!isTableRow(getLine(idx))) return null;
		var s = idx;
		while (s > 0 && isTableRow(getLine(s - 1)) && !(inFence && inFence[s - 1])) s--;
		var e = idx;
		while (e < lineCount - 1 && isTableRow(getLine(e + 1)) && !(inFence && inFence[e + 1])) e++;
		if (e - s < 1) return null;
		if (!isDelimiterRow(getLine(s + 1))) return null;
		return { start: s, end: e };
	}

	// Split a row into trimmed cells. Only backslash-escaped pipes protect a `|`
	// (GFM splits cells even inside code spans).
	function splitRow(line) {
		var s = line.trim();
		if (s.charAt(0) === '|') s = s.slice(1);
		if (s.length && s.charAt(s.length - 1) === '|') {
			var bs = 0;
			for (var q = s.length - 2; q >= 0 && s.charAt(q) === '\\'; q--) bs++;
			if (bs % 2 === 0) s = s.slice(0, -1);
		}
		var cells = [];
		var cur = '';
		for (var i = 0; i < s.length; i++) {
			var ch = s.charAt(i);
			if (ch === '\\' && i + 1 < s.length) { cur += ch + s.charAt(i + 1); i++; continue; }
			if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
			cur += ch;
		}
		cells.push(cur.trim());
		return cells;
	}

	function strWidth(s) { return Array.from(s).length; }
	function spaces(n) { return n > 0 ? new Array(n + 1).join(' ') : ''; }
	function dashes(n) { return n > 0 ? new Array(n + 1).join('-') : ''; }
	// Pad `s` to display width `w`. Returns the padded text and how many columns
	// of left padding were added (needed to place the caret after the content).
	function padCell(s, w, align) {
		var gap = Math.max(0, w - strWidth(s));
		if (align === 'r') return { text: spaces(gap) + s, left: gap };
		if (align === 'c') { var l = Math.floor(gap / 2); return { text: spaces(l) + s + spaces(gap - l), left: l }; }
		return { text: s + spaces(gap), left: 0 };
	}

	// Aligns a table. `rows` = array of raw row strings (row 1 = delimiter row).
	// Returns { lines, cells, ncols } where cells[r][c] = {start,end}: the offsets
	// (within the formatted line) of the cell's padded text start and the end of
	// its trimmed content (where the caret should go).
	function formatTable(rows) {
		var parsed = rows.map(splitRow);
		var ncols = 0;
		parsed.forEach(function (r) { if (r.length > ncols) ncols = r.length; });
		var aligns = [];
		var delim = parsed[1] || [];
		var c;
		for (c = 0; c < ncols; c++) {
			var d = delim[c] || '---';
			var left = d.charAt(0) === ':';
			var right = d.charAt(d.length - 1) === ':';
			aligns.push(left && right ? 'c' : (right ? 'r' : (left ? 'l' : '')));
		}
		var widths = [];
		for (c = 0; c < ncols; c++) {
			var w = 3;
			for (var ri = 0; ri < parsed.length; ri++) {
				if (ri === 1) continue;
				var wc = strWidth(parsed[ri][c] || '');
				if (wc > w) w = wc;
			}
			widths.push(w);
		}
		var lines = [];
		var cells = [];
		parsed.forEach(function (r, rIdx) {
			var line = '|';
			var rowCells = [];
			for (var c2 = 0; c2 < ncols; c2++) {
				var text;
				var contentEnd;
				line += ' ';
				var start = line.length;
				if (rIdx === 1) {
					var a = aligns[c2];
					var wd = widths[c2];
					text = a === 'c' ? ':' + dashes(wd - 2) + ':' : (a === 'l' ? ':' + dashes(wd - 1) : (a === 'r' ? dashes(wd - 1) + ':' : dashes(wd)));
					contentEnd = start + text.length;
				} else {
					var content = r[c2] || '';
					var padded = padCell(content, widths[c2], aligns[c2]);
					text = padded.text;
					contentEnd = start + padded.left + content.length;
				}
				rowCells.push({ start: start, end: contentEnd });
				line += text + ' |';
			}
			lines.push(line);
			cells.push(rowCells);
		});
		return { lines: lines, cells: cells, ncols: ncols };
	}

	// Index of the cell containing column `col` of a row line.
	function cellIndexAt(line, col) {
		var idx = -1;
		var seenFirst = false;
		for (var i = 0; i < line.length && i < col; i++) {
			var ch = line.charAt(i);
			if (ch === '\\') { i++; continue; }
			if (ch === '|') {
				if (!seenFirst && /^[ \t]*$/.test(line.slice(0, i))) { seenFirst = true; idx = 0; continue; }
				idx++;
			}
		}
		return Math.max(0, idx);
	}

	function emptyRowFor(ncols) {
		var cells = [];
		for (var i = 0; i < ncols; i++) cells.push('');
		return '|' + cells.map(function () { return '  '; }).join('|') + '|';
	}

	// --- paste -------------------------------------------------------------

	function isSingleUrl(s) { return /^(?:https?:\/\/|mailto:)[^\s<>]+$/i.test(String(s || '').trim()); }

	// Should clipboard HTML be converted to markdown? Only when it carries real
	// structure (headings, lists, links, tables, ...). Code editors put styled
	// <span>s on the clipboard — keep their plain text.
	function shouldConvertHtml(html, types) {
		if (!html) return false;
		var list = types ? Array.prototype.slice.call(types) : [];
		for (var i = 0; i < list.length; i++) if (String(list[i]).indexOf('vscode') === 0) return false;
		return /<(?:(?:h[1-6]|ul|ol|li|table|blockquote|pre|strong|b|em|i|del|s|strike|img|code)(?:\s|>|\/)|a\s[^>]*href\s*=)/i.test(html);
	}

	var pure = {
		computeFences: computeFences, codeSpans: codeSpans, findImageRefs: findImageRefs, buildImageSource: buildImageSource,
		findLinkRefs: findLinkRefs, findTaskMarker: findTaskMarker, scanDoc: scanDoc, countWords: countWords,
		readingMinutes: readingMinutes, isTableRow: isTableRow, isDelimiterRow: isDelimiterRow, tableBlockAt: tableBlockAt,
		splitRow: splitRow, formatTable: formatTable, cellIndexAt: cellIndexAt, emptyRowFor: emptyRowFor,
		isSingleUrl: isSingleUrl, shouldConvertHtml: shouldConvertHtml, escapeAttr: escapeAttr, unescapeHtml: unescapeHtml,
	};

	// ---------------------------------------------------------------------
	// CodeMirror integration
	// ---------------------------------------------------------------------

	function createExtensions(C, hooks, opts) {
		hooks = hooks || {};
		opts = opts || {};
		var doc = root.document;
		var WidgetType = C.WidgetType;
		var Decoration = C.Decoration;
		var EditorView = C.EditorView;
		var exts = [];

		function el(tag, cls, text) {
			var e = doc.createElement(tag);
			if (cls) e.className = cls;
			if (text != null) e.textContent = text;
			return e;
		}
		function canEdit(view) {
			return !view.state.readOnly && view.contentDOM.getAttribute('contenteditable') !== 'false';
		}
		function touches(sel, from, to) {
			for (var i = 0; i < sel.ranges.length; i++) {
				var r = sel.ranges[i];
				if ((r.head >= from && r.head <= to) || (r.anchor >= from && r.anchor <= to)) return true;
			}
			return false;
		}

		// -- document model ---------------------------------------------------

		// Past this size the per-keystroke full-document scan is not worth it.
		var MAX_SCAN_CHARS = 2000000;

		function buildModel(text) {
			var model = scanDoc(text.length > MAX_SCAN_CHARS ? '' : text);
			var decos = [];
			if (opts.inlineWidgets) {
				model.images.forEach(function (row) {
					decos.push(Decoration.widget({ widget: new ImageRowWidget(row.refs), block: true, side: 1 }).range(row.to));
				});
			}
			model.imageDecos = Decoration.set(decos, true);
			return model;
		}
		var modelField = C.StateField.define({
			create: function (state) { return buildModel(state.doc.toString()); },
			update: function (value, tr) { return tr.docChanged ? buildModel(tr.newDoc.toString()) : value; },
			provide: function (f) { return EditorView.decorations.from(f, function (m) { return m.imageDecos; }); },
		});
		exts.push(modelField);

		// -- blob URL cache for resource images ------------------------------

		var urlCache = {};
		var URL_CACHE_MAX = 40;
		function acquireUrl(id) {
			var e = urlCache[id];
			if (!e) {
				e = urlCache[id] = { refs: 0, url: null, promise: null, last: 0 };
				if (hooks.fetchResourceBlob && root.URL && root.URL.createObjectURL) {
					e.promise = Promise.resolve(hooks.fetchResourceBlob(id)).then(function (blob) {
						e.url = root.URL.createObjectURL(blob);
						return e.url;
					});
				} else {
					e.promise = Promise.resolve('/resources/' + id);
				}
				e.promise.catch(function () { delete urlCache[id]; });
			}
			e.refs++;
			e.last = Date.now();
			return e.promise;
		}
		function releaseUrl(id) {
			var e = urlCache[id];
			if (e && e.refs > 0) e.refs--;
			var idle = Object.keys(urlCache).filter(function (k) { return urlCache[k].refs === 0 && urlCache[k].url; });
			if (idle.length <= URL_CACHE_MAX) return;
			idle.sort(function (a, b) { return urlCache[a].last - urlCache[b].last; });
			idle.slice(0, idle.length - URL_CACHE_MAX).forEach(function (k) {
				try { root.URL.revokeObjectURL(urlCache[k].url); } catch (_e) { /* ignore */ }
				delete urlCache[k];
			});
		}

		// Natural size of every image seen so far. A rebuilt widget (scrolled away
		// and back, or the same image used twice) reserves its final box while the
		// blob decodes, so the text below does not jump.
		var dimCache = {};

		// An image finishing its load changes the height of a block widget.
		// CodeMirror notices (ResizeObserver) but does NOT redraw its cursor /
		// selection layers for height changes inside widgets, so the caret would
		// stay painted at a stale y until the next interaction. Re-asserting the
		// current selection (batched to one per burst of loads, not undoable)
		// is the cheapest thing that makes the layers repaint.
		var relayoutPending = [];
		function relayout(view) {
			view.requestMeasure();
			if (relayoutPending.indexOf(view) >= 0) return;
			relayoutPending.push(view);
			setTimeout(function () {
				relayoutPending.splice(relayoutPending.indexOf(view), 1);
				try { view.dispatch({ selection: view.state.selection, addToHistory: false }); } catch (_e) { /* view destroyed meanwhile */ }
			}, 30);
		}

		// Find the doc line that currently holds image #idx with the given id for a
		// widget DOM node (its position may have shifted since it was created).
		function locateImage(view, dom, id, idx) {
			var pos;
			try { pos = view.posAtDOM(dom); } catch (_e) { return null; }
			var d = view.state.doc;
			pos = Math.max(0, Math.min(pos, d.length));
			var cands = [d.lineAt(pos).number];
			if (pos > 0) cands.push(d.lineAt(pos - 1).number);
			for (var i = 0; i < cands.length; i++) {
				var line = d.line(cands[i]);
				var refs = findImageRefs(line.text);
				if (refs[idx] && refs[idx].id === id) return { line: line, ref: refs[idx] };
			}
			return null;
		}

		// Download affordance shared by image previews and attachment chips; the
		// host decides what "download" means (action sheet on desktop / PWA,
		// direct download on mobile web) exactly like the rendered-mode button.
		function downloadButton(cls, title, id) {
			var b = el('button', cls);
			b.type = 'button';
			b.title = title;
			b.setAttribute('aria-label', title);
			b.setAttribute('contenteditable', 'false');
			b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
			b.addEventListener('dblclick', function (e) { e.stopPropagation(); });
			b.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (hooks.downloadResource) hooks.downloadResource(id, b);
			});
			return b;
		}

		// -- image preview widget (block, under the source line) --------------

		class ImageRowWidget extends WidgetType {
			constructor(refs) {
				super();
				this.refs = refs;
				this.key = JSON.stringify(refs.map(function (r) { return [r.id, r.width || 0, r.alt]; }));
			}
			eq(other) { return other.key === this.key; }
			get estimatedHeight() { return 120; }
			ignoreEvent() { return true; }
			toDOM(view) {
				var wrap = el('div', 'cm-jl-imgrow');
				this.refs.forEach(function (ref, idx) {
					var fig = el('div', 'cm-jl-img loading' + (ref.width ? '' : ' cm-jl-img-natural'));
					fig.setAttribute('data-id', ref.id);
					var img = doc.createElement('img');
					img.alt = ref.alt || '';
					img.draggable = false;
					if (ref.width) img.style.width = ref.width + 'px';
					var known = dimCache[ref.id];
					if (known) {
						var shownH = ref.width ? ref.width * known.h / known.w : Math.min(known.h, 360);
						var shownW = ref.width ? ref.width : (known.h > 360 ? known.w * 360 / known.h : known.w);
						fig.style.minWidth = Math.round(shownW) + 'px';
						fig.style.minHeight = Math.round(shownH) + 'px';
					}
					var handle = el('span', 'cm-jl-img-handle');
					handle.title = 'Drag to resize \u00b7 double-click to reset';
					var dl = downloadButton('cm-jl-img-dl', 'Download image', ref.id);
					fig.appendChild(img);
					fig.appendChild(handle);
					fig.appendChild(dl);
					var broken = function () {
						fig.className = 'cm-jl-img broken';
						fig.textContent = '\u26a0 Image unavailable';
						relayout(view);
					};
					img.addEventListener('load', function () {
						if (img.naturalWidth) dimCache[ref.id] = { w: img.naturalWidth, h: img.naturalHeight };
						fig.classList.remove('loading');
						fig.style.minWidth = fig.style.minHeight = '';
						relayout(view);
					});
					img.addEventListener('error', broken);
					acquireUrl(ref.id).then(function (url) { img.src = url; }).catch(broken);

					img.addEventListener('mousedown', function (e) {
						// Select the source reference so Delete removes the image.
						e.preventDefault();
						var loc = locateImage(view, wrap, ref.id, idx);
						if (loc) view.dispatch({ selection: { anchor: loc.line.from + loc.ref.from, head: loc.line.from + loc.ref.to } });
						view.focus();
					});
					img.addEventListener('dblclick', function (e) {
						e.preventDefault();
						if (hooks.openResource) hooks.openResource(ref.id);
					});

					var commit = function (width) {
						var loc = locateImage(view, wrap, ref.id, idx);
						if (!loc || !canEdit(view)) return;
						view.dispatch({ changes: { from: loc.line.from + loc.ref.from, to: loc.line.from + loc.ref.to, insert: buildImageSource(loc.ref, width) } });
					};
					handle.addEventListener('dblclick', function (e) {
						e.preventDefault();
						e.stopPropagation();
						commit(0);
					});
					handle.addEventListener('pointerdown', function (e) {
						if (!canEdit(view)) return;
						e.preventDefault();
						e.stopPropagation();
						var startX = e.clientX;
						var startW = img.getBoundingClientRect().width || img.naturalWidth || 200;
						var maxW = Math.max(80, (view.contentDOM.clientWidth || 800) - 24);
						var last = null;
						try { handle.setPointerCapture(e.pointerId); } catch (_e) { /* ignore */ }
						fig.classList.add('resizing');
						var move = function (ev) {
							last = Math.max(40, Math.min(maxW, Math.round(startW + (ev.clientX - startX))));
							img.style.width = last + 'px';
							img.style.maxHeight = 'none';
							fig.classList.remove('cm-jl-img-natural');
						};
						var up = function () {
							handle.removeEventListener('pointermove', move);
							handle.removeEventListener('pointerup', up);
							handle.removeEventListener('pointercancel', up);
							fig.classList.remove('resizing');
							if (last != null && Math.abs(last - startW) >= 2) commit(last);
						};
						handle.addEventListener('pointermove', move);
						handle.addEventListener('pointerup', up);
						handle.addEventListener('pointercancel', up);
					});
					wrap.appendChild(fig);
				});
				return wrap;
			}
			destroy() {
				this.refs.forEach(function (r) { releaseUrl(r.id); });
			}
		}

		// -- attachment / note-link chip --------------------------------------

		var kindCache = {};
		function resolveKind(id) {
			if (kindCache[id]) return Promise.resolve(kindCache[id]);
			if (!hooks.resolveLinkInfo) return Promise.resolve('unknown');
			return Promise.resolve(hooks.resolveLinkInfo(id)).then(function (info) {
				var k = (info && info.kind) || 'unknown';
				if (k !== 'unknown') kindCache[id] = k;
				return k;
			}, function () { return 'unknown'; });
		}

		class ChipWidget extends WidgetType {
			constructor(text, id) { super(); this.text = text; this.id = id; }
			eq(o) { return o.id === this.id && o.text === this.text; }
			ignoreEvent() { return true; }
			toDOM() {
				var id = this.id;
				var chip = el('span', 'cm-jl-chip');
				chip.setAttribute('data-id', id);
				chip.setAttribute('data-kind', kindCache[id] || 'unknown');
				chip.appendChild(el('span', 'cm-jl-chip-icon'));
				chip.appendChild(el('span', 'cm-jl-chip-label', this.text || id));
				// Shown only once the target resolves to an attachment (CSS on data-kind).
				chip.appendChild(downloadButton('cm-jl-chip-dl', 'Download attachment', id));
				if (!kindCache[id]) resolveKind(id).then(function (k) { chip.setAttribute('data-kind', k); });
				chip.addEventListener('mousedown', function (e) { e.preventDefault(); });
				chip.addEventListener('click', function (e) {
					e.preventDefault();
					resolveKind(id).then(function (k) {
						if (k === 'note' && hooks.openNote) hooks.openNote(id);
						else if (hooks.openResource) hooks.openResource(id);
					});
				});
				return chip;
			}
		}

		// -- task checkbox ----------------------------------------------------

		class CheckboxWidget extends WidgetType {
			constructor(checked) { super(); this.checked = checked; }
			eq(o) { return o.checked === this.checked; }
			ignoreEvent() { return true; }
			toDOM(view) {
				var box = el('span', 'cm-jl-check' + (this.checked ? ' checked' : ''));
				box.setAttribute('role', 'checkbox');
				box.setAttribute('aria-checked', this.checked ? 'true' : 'false');
				var toggle = function (e) {
					e.preventDefault();
					e.stopPropagation();
					if (!canEdit(view)) return;
					var pos;
					try { pos = view.posAtDOM(box); } catch (_e) { return; }
					var cur = view.state.doc.sliceString(pos, pos + 3);
					var m = /^\[([ xX])\]$/.exec(cur);
					if (!m) return;
					view.dispatch({ changes: { from: pos, to: pos + 3, insert: m[1] === ' ' ? '[x]' : '[ ]' } });
				};
				box.addEventListener('mousedown', toggle);
				return box;
			}
		}

		// -- code block copy button -------------------------------------------

		class CopyWidget extends WidgetType {
			eq() { return true; }
			ignoreEvent() { return true; }
			toDOM(view) {
				var btn = el('button', 'cm-jl-copy', 'Copy');
				btn.type = 'button';
				btn.title = 'Copy code';
				btn.setAttribute('contenteditable', 'false');
				btn.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
				btn.addEventListener('click', function (e) {
					e.preventDefault();
					e.stopPropagation();
					var pos;
					try { pos = view.posAtDOM(btn); } catch (_e) { return; }
					var code = fenceTextAt(view.state.doc, view.state.doc.lineAt(pos).number);
					if (code == null) return;
					var done = function (ok) {
						btn.textContent = ok === false ? 'Failed' : 'Copied';
						setTimeout(function () { btn.textContent = 'Copy'; }, 1200);
					};
					if (hooks.copyText) hooks.copyText(code, done);
				});
				return btn;
			}
		}
		// Code between the fence that opens on `lineNo` and its closing fence.
		function fenceTextAt(d, lineNo) {
			var open = d.line(lineNo).text;
			var m = /^[ \t]*(`{3,}|~{3,})/.exec(open);
			if (!m) return null;
			var ch = m[1].charAt(0);
			var closeRe = new RegExp('^[ \\t]*' + (ch === '`' ? '`' : '~') + '{' + m[1].length + ',}[ \\t]*$');
			var out = [];
			for (var n = lineNo + 1; n <= d.lines; n++) {
				var t = d.line(n).text;
				if (closeRe.test(t)) break;
				out.push(t);
			}
			return out.join('\n');
		}

		// -- decoration plugin: chips, checkboxes, code blocks, live preview ---

		function inRanges(ranges, from, to) {
			for (var i = 0; i < ranges.length; i++) if (to >= ranges[i].from && from <= ranges[i].to) return true;
			return false;
		}

		function buildInline(view) {
			var state = view.state;
			var model = state.field(modelField);
			var sel = state.selection;
			var focused = view.hasFocus;
			var vis = view.visibleRanges;
			var decos = [];
			var d = state.doc;

			function reveal(from, to) { return focused && touches(sel, from, to); }

			if (opts.inlineWidgets) {
				model.links.forEach(function (l) {
					if (!inRanges(vis, l.from, l.to) || reveal(l.from, l.to)) return;
					decos.push(Decoration.replace({ widget: new ChipWidget(l.text, l.id) }).range(l.from, l.to));
				});
				model.tasks.forEach(function (t) {
					if (!inRanges(vis, t.from, t.lineEnd)) return;
					if (!reveal(t.from, t.to)) decos.push(Decoration.replace({ widget: new CheckboxWidget(t.checked) }).range(t.from, t.to));
					if (t.checked && t.lineEnd > t.to) decos.push(Decoration.mark({ class: 'cm-jl-task-done' }).range(t.to, t.lineEnd));
				});
				model.fences.forEach(function (f) {
					var startLine = f.start + 1;
					var endLine = Math.min(f.end + 1, d.lines);
					var fenceFrom = d.line(startLine).from;
					if (!inRanges(vis, fenceFrom, d.line(endLine).to)) return;
					vis.forEach(function (r) {
						var n0 = Math.max(startLine, d.lineAt(r.from).number);
						var n1 = Math.min(endLine, d.lineAt(r.to).number);
						for (var n = n0; n <= n1; n++) {
							var cls = 'cm-jl-codeline' + (n === startLine ? ' cm-jl-codeline-first' : '') + (n === f.end + 1 ? ' cm-jl-codeline-last' : '');
							decos.push(Decoration.line({ class: cls }).range(d.line(n).from));
						}
					});
					if (inRanges(vis, fenceFrom, d.line(startLine).to)) {
						decos.push(Decoration.widget({ widget: new CopyWidget(), side: 1 }).range(d.line(startLine).to));
					}
				});
			}

			if (opts.livePreview) {
				var hide = function (from, to) { if (to > from) decos.push(Decoration.replace({}).range(from, to)); };
				var tree = C.syntaxTree(state);
				var skipLinks = !!opts.inlineWidgets;
				vis.forEach(function (r) {
					tree.iterate({
						from: r.from, to: r.to,
						enter: function (node) {
							var name = node.name;
							var m = /^ATXHeading([1-6])$/.exec(name);
							if (m) {
								var line = d.lineAt(node.from);
								if (reveal(line.from, line.to)) return;
								var mark = node.node.getChild('HeaderMark');
								if (mark) {
									var end = mark.to;
									if (d.sliceString(end, end + 1) === ' ') end++;
									hide(mark.from, end);
								}
								return;
							}
							if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough' || name === 'InlineCode') {
								if (reveal(node.from, node.to)) return;
								var markName = name === 'Strikethrough' ? 'StrikethroughMark' : (name === 'InlineCode' ? 'CodeMark' : 'EmphasisMark');
								node.node.getChildren(markName).forEach(function (mk) { hide(mk.from, mk.to); });
								return;
							}
							if (name === 'Link') {
								if (reveal(node.from, node.to)) return;
								var url = node.node.getChild('URL');
								var marks = node.node.getChildren('LinkMark');
								if (!url || marks.length < 4) return;
								if (skipLinks && d.sliceString(url.from, url.from + 2) === ':/') return; // chip handles it
								hide(node.from, marks[0].to);
								hide(marks[1].from, node.to);
							}
						},
					});
				});
			}
			return Decoration.set(decos, true);
		}

		var inlinePlugin = C.ViewPlugin.fromClass(class {
			constructor(view) { this.decorations = buildInline(view); }
			update(u) {
				if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged ||
					C.syntaxTree(u.startState) !== C.syntaxTree(u.state)) {
					this.decorations = buildInline(u.view);
				}
			}
		}, { decorations: function (v) { return v.decorations; } });
		if (opts.inlineWidgets || opts.livePreview) exts.push(inlinePlugin);

		// -- hover info for internal links -----------------------------------

		exts.push(C.hoverTooltip(function (view, pos) {
			var line = view.state.doc.lineAt(pos);
			var off = pos - line.from;
			var links = findLinkRefs(line.text);
			var hit = null;
			for (var i = 0; i < links.length; i++) if (off >= links[i].from && off <= links[i].to) { hit = links[i]; break; }
			if (!hit) return null;
			return {
				pos: line.from + hit.from,
				end: line.from + hit.to,
				above: true,
				create: function () {
					var dom = el('div', 'cm-jl-tip', 'Loading\u2026');
					var p = hooks.resolveLinkInfo ? Promise.resolve(hooks.resolveLinkInfo(hit.id)) : Promise.resolve({ kind: 'unknown' });
					p.then(function (info) {
						dom.textContent = '';
						if (info && info.kind === 'note') {
							dom.appendChild(el('div', 'cm-jl-tip-title', '\ud83d\udcc4 ' + (info.title || 'Untitled')));
							dom.appendChild(el('div', 'cm-jl-tip-sub', 'Note link'));
						} else if (info && info.kind === 'resource') {
							dom.appendChild(el('div', 'cm-jl-tip-title', '\ud83d\udcce ' + (info.filename || hit.text)));
							dom.appendChild(el('div', 'cm-jl-tip-sub', (info.mime || 'Attachment') + ' \u00b7 click to open, \u2b07 to download'));
						} else {
							dom.appendChild(el('div', 'cm-jl-tip-title', hit.text || hit.id));
							dom.appendChild(el('div', 'cm-jl-tip-sub', 'Link target not found'));
						}
					}, function () { dom.textContent = hit.text; });
					return { dom: dom };
				},
			};
		}, { hoverTime: 350 }));

		// -- paste: HTML -> markdown, URL over selection -> link ----------------

		var plainPaste = false;
		exts.push(EditorView.domEventHandlers({
			// Dropped FILES are uploaded by the host app (a listener on the
			// content element). CodeMirror's own drop handler would also read any
			// text-like file (.txt, .svg, .json, ...) and paste its contents into
			// the note, duplicating the upload. Claim file drops so it never runs.
			drop: function (e) {
				var files = e.dataTransfer && e.dataTransfer.files;
				return !!(files && files.length);
			},
			keydown: function (e) {
				plainPaste = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'v' || e.key === 'V');
				return false;
			},
			paste: function (e, view) {
				var cd = e.clipboardData || (root.clipboardData);
				var asPlain = plainPaste;
				plainPaste = false;
				if (!cd || asPlain || !canEdit(view)) return false;
				var text = '';
				var html = '';
				try { text = cd.getData('text/plain') || ''; html = cd.getData('text/html') || ''; } catch (_e) { return false; }
				var state = view.state;
				var main = state.selection.main;
				var model = state.field(modelField);
				var lineNo = state.doc.lineAt(main.head).number - 1;
				if (model.inFence[lineNo]) return false; // raw paste inside code blocks

				// 1. URL pasted over a selection -> [selection](url)
				if (!main.empty && state.selection.ranges.length === 1 && isSingleUrl(text)) {
					var selected = state.sliceDoc(main.from, main.to);
					if (selected.indexOf('\n') < 0) {
						var label = selected.replace(/([\[\]])/g, '\\$1');
						var md = '[' + label + '](' + text.trim() + ')';
						view.dispatch({ changes: { from: main.from, to: main.to, insert: md }, selection: { anchor: main.from + md.length }, userEvent: 'input.paste', scrollIntoView: true });
						return true;
					}
				}

				// 2. rich HTML (web page, Word, Docs...) -> markdown
				if (html && hooks.htmlToMarkdown && shouldConvertHtml(html, cd.types)) {
					var converted = '';
					try { converted = hooks.htmlToMarkdown(html) || ''; } catch (_e) { converted = ''; }
					converted = converted.replace(/\r\n/g, '\n');
					if (converted.trim() && converted.trim() !== text.trim()) {
						view.dispatch({ changes: { from: main.from, to: main.to, insert: converted }, selection: { anchor: main.from + converted.length }, userEvent: 'input.paste', scrollIntoView: true });
						return true;
					}
				}
				return false;
			},
		}));

		// -- table helper -----------------------------------------------------

		function tableContext(view) {
			var state = view.state;
			var sel = state.selection.main;
			var d = state.doc;
			var line = d.lineAt(sel.head);
			if (!sel.empty && d.lineAt(sel.anchor).number !== line.number) return null;
			var model = state.field(modelField);
			var block = tableBlockAt(function (i) { return d.line(i + 1).text; }, d.lines, line.number - 1, model.inFence);
			if (!block) return null;
			var rows = [];
			for (var i = block.start; i <= block.end; i++) rows.push(d.line(i + 1).text);
			return { sel: sel, line: line, block: block, rows: rows, from: d.line(block.start + 1).from, to: d.line(block.end + 1).to, row: line.number - 1 - block.start };
		}
		function applyTable(view, ctx, rows, targetRow, targetCol) {
			var res = formatTable(rows);
			var text = res.lines.join('\n');
			var offset = 0;
			for (var i = 0; i < targetRow; i++) offset += res.lines[i].length + 1;
			var cell = res.cells[targetRow][Math.min(targetCol, res.ncols - 1)];
			var caret = ctx.from + offset + cell.end;
			var spec = { selection: { anchor: caret }, scrollIntoView: true, userEvent: 'input' };
			if (text !== view.state.sliceDoc(ctx.from, ctx.to)) spec.changes = { from: ctx.from, to: ctx.to, insert: text };
			view.dispatch(spec);
			return true;
		}
		function tableTab(view, dir) {
			var ctx = tableContext(view);
			if (!ctx || !canEdit(view)) return false;
			var rows = ctx.rows.slice();
			var ncols = formatTable(rows).ncols;
			var r = ctx.row;
			var c = r === 1 ? 0 : cellIndexAt(ctx.line.text, ctx.sel.head - ctx.line.from);
			if (c >= ncols) c = ncols - 1;
			var lastRow = rows.length - 1;
			var tr;
			var tc;
			if (dir > 0) {
				if (r === 1) { tr = 2; tc = 0; }
				else if (c + 1 < ncols) { tr = r; tc = c + 1; }
				else { tr = r + 1; tc = 0; }
				if (tr === 1) tr = 2;
				if (tr > lastRow) { rows.push(emptyRowFor(ncols)); tr = rows.length - 1; tc = 0; }
			} else {
				if (r === 1) { tr = 0; tc = ncols - 1; }
				else if (c > 0) { tr = r; tc = c - 1; }
				else { tr = r - 1; tc = ncols - 1; if (tr === 1) tr = 0; }
				if (tr < 0) { tr = 0; tc = 0; }
			}
			return applyTable(view, ctx, rows, tr, tc);
		}
		exts.push(C.Prec.high(C.keymap.of([
			{ key: 'Tab', run: function (v) { return tableTab(v, 1); } },
			{ key: 'Shift-Tab', run: function (v) { return tableTab(v, -1); } },
		])));
		// Deliberately NO Enter handling: people type pipe tables row by row, and
		// turning Enter into "insert a formatted row" corrupts what they type next.

		// -- folding -----------------------------------------------------------

		if (opts.folding) {
			exts.push(C.codeFolding({
				placeholderDOM: function (view, onclick) {
					var s = el('span', 'cm-jl-fold-placeholder', '\u2026');
					s.title = 'Unfold';
					s.addEventListener('click', onclick);
					return s;
				},
			}));
			exts.push(C.foldGutter({
				markerDOM: function (open) {
					var s = el('span', 'cm-jl-fold-marker ' + (open ? 'open' : 'closed'), open ? '\u25be' : '\u25b8');
					s.title = open ? 'Fold' : 'Unfold';
					return s;
				},
			}));
			exts.push(C.keymap.of(C.foldKeymap));
		}

		// -- status bar + outline ---------------------------------------------

		if (opts.statusBar) {
			exts.push(C.showPanel.of(function (view) {
				var dom = el('div', 'cm-jl-status');
				var stat = el('span', 'cm-jl-stat');
				var btn = el('button', 'cm-jl-outline-btn', '\u2630 Outline');
				btn.type = 'button';
				btn.title = 'Jump to heading';
				var pop = el('div', 'cm-jl-outline');
				pop.hidden = true;
				dom.appendChild(stat);
				dom.appendChild(btn);
				dom.appendChild(pop);
				var timer = null;
				var lastDoc = null;
				var lastWords = 0;
				function refresh() {
					timer = null;
					var st = view.state;
					if (lastDoc !== st.doc) { lastWords = countWords(st.doc.toString()); lastDoc = st.doc; }
					var parts = [lastWords + (lastWords === 1 ? ' word' : ' words')];
					if (lastWords > 0) parts.push('~' + readingMinutes(lastWords) + ' min read');
					var m = st.selection.main;
					if (!m.empty) parts.push(countWords(st.sliceDoc(m.from, m.to)) + ' selected');
					else {
						var ln = st.doc.lineAt(m.head);
						parts.push('Ln ' + ln.number + ', Col ' + (m.head - ln.from + 1));
					}
					stat.textContent = parts.join(' \u00b7 ');
				}
				function schedule() { if (timer == null) timer = setTimeout(refresh, 120); }
				function closePop() { pop.hidden = true; }
				function openPop() {
					pop.textContent = '';
					var heads = view.state.field(modelField).headings;
					if (!heads.length) pop.appendChild(el('div', 'cm-jl-outline-empty', 'No headings'));
					var minLevel = heads.reduce(function (a, h) { return Math.min(a, h.level); }, 6);
					heads.forEach(function (h) {
						var item = el('button', 'cm-jl-outline-item', h.text || '(empty)');
						item.type = 'button';
						item.style.paddingLeft = (10 + (h.level - minLevel) * 14) + 'px';
						item.addEventListener('mousedown', function (e) { e.preventDefault(); });
						item.addEventListener('click', function () {
							var pos = Math.min(h.from, view.state.doc.length);
							view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 }) });
							closePop();
							view.focus();
						});
						pop.appendChild(item);
					});
					pop.hidden = false;
				}
				btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
				btn.addEventListener('click', function () { if (pop.hidden) openPop(); else closePop(); });
				var outside = function (e) { if (!pop.hidden && !dom.contains(e.target)) closePop(); };
				doc.addEventListener('mousedown', outside, true);
				refresh();
				return {
					dom: dom,
					top: false,
					update: function (u) {
						if (u.docChanged || u.selectionSet) schedule();
						if (u.docChanged) closePop();
					},
					destroy: function () { if (timer != null) clearTimeout(timer); doc.removeEventListener('mousedown', outside, true); },
				};
			}));
		}

		return exts;
	}

	var api = { createExtensions: createExtensions, pure: pure };
	for (var k in pure) if (Object.prototype.hasOwnProperty.call(pure, k)) api[k] = pure[k];
	root.JoplockMd = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
