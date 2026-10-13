# Markdown-mode extras (`public/cm-extras.js`)

> Read this before: changing inline image previews, chips, task checkboxes, folding, tables, paste-as-markdown or the CodeMirror bundle.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

## Markdown-mode extras (`public/cm-extras.js`)

`initCM()` spreads `_cmExtraExtensions(C)` (try/catch-guarded: a failure must never stop the editor mounting) into the CM6 extension list. The extras need extra symbols from the bundle (`Decoration`, `WidgetType`, `StateField`, `ViewPlugin`, `showPanel`, `hoverTooltip`, fold APIs, `syntaxTree`, `Prec`, ...) — they are exported from `cm-build/index.js`; **if you add an extra that needs another CM symbol, export it there and rebuild with `npm run build:cm`**.

User settings (Settings → Markdown editor; `app/settingsService.js`, whitelisted in `app/routes/api.js`, exposed through `_joplockConfig` in `pages.js`, read in `app.js` as `_mdInlineWidgets` / `_mdLivePreview` / `_mdStatusBar` / `_mdFolding`):

- `mdInlineWidgets` (default ON): image previews, attachment/note-link chips, task checkboxes, code-block background + Copy button.
- `mdLivePreview` (default OFF): hide `#`, `**`, `*`, `~~`, backticks and `[](url)` marks except on the heading line / inside the construct the caret touches. Only when the editor has focus.
- `mdStatusBar` (default ON, **desktop shell only**: never created in the mobile shell): bottom `showPanel` with word count, reading time, Ln/Col (or selection word count) and an Outline popup.
- `mdFolding` (default ON): fold gutter (headings, lists, fenced code) — the theme hides `.cm-gutters` entirely when OFF.
- Always on: paste-as-markdown, URL-over-selection → link, table helper, hover info on `:/id` links, and the file-drop claim below.

How it fits together (details that bit us — keep them):

- One `StateField` (`modelField`) holds `scanDoc(doc)` output (images, links, tasks, headings, fences; nothing inside fenced code is ever scanned) and provides the **block** image widgets (block decorations cannot come from a `ViewPlugin`). A `ViewPlugin` builds the inline decorations (chips, checkboxes, code lines, live-preview hides) for `view.visibleRanges` only. Docs over ~2 MB skip scanning.
- Image rows are block widgets *under* the `![](:/id)` / `<img src=":/id">` line; the source line stays visible and editable. Previews load through `hooks.fetchResourceBlob` into a refcounted blob-URL cache because `/resources/:id` is `Cache-Control: no-store`. Click selects the source reference (Delete removes the image); double-click opens the lightbox.
- **Resize writes `<img src=":/id" alt=".." width="N" />`** — byte-identical to the Turndown `joplinImg` rule and understood by `renderMarkdown()`, so rendered mode honours the width and round-trips it. Double-clicking the handle resets to plain `![](:/id)`. Widget positions go stale as text above changes, so `locateImage()` re-finds the line from `view.posAtDOM()` before every edit.
- Resize/checkbox edits are ignored when the editor is read-only (`canEdit()` checks `contenteditable="false"`, which is what `_applyFormReadonly` sets).
- **CM6 does not repaint its cursor/selection layers when a block widget changes height** (image finishing its load). `relayout()` re-asserts the selection (`addToHistory:false`) after each load; `requestMeasure()` alone leaves the caret painted at a stale y.
- **CodeMirror's built-in drop handler reads dropped text-like files (.txt, .svg, .json, ...) and inserts their contents.** The app's own listener uploads them, so the extras claim file drops with a `domEventHandlers({drop})` returning `true` (handlers from extensions run before the built-in). Without it a dropped text file is both pasted AND uploaded.
- Paste: the app's capture-phase `paste` listener (`initCM`) uploads image/file clipboard items; the extras' `paste` handler converts rich HTML via `hooks.htmlToMarkdown` = `_pasteHtmlToMarkdown()` (the shared Turndown instance) only when the HTML has real structure (`shouldConvertHtml`), never inside fenced code, never for VS Code clipboards, never on Ctrl/Cmd+Shift+V. (`lang-markdown` also wraps URL-over-selection natively; the extras' version just guarantees it and escapes brackets.)
- Download: image previews get a top-right ⬇ button and attachment chips an inline ⬇ (shown once the target resolves to a resource). Both call `hooks.downloadResource` = `downloadResource()`, so behaviour matches rendered mode (action sheet with View/Save on desktop/PWA, direct download on mobile web). The buttons stop propagation so they neither open the lightbox nor select the image source.
- Chips replace `[text](:/id)`; the kind (note vs attachment) is resolved lazily via `_resolveInternalLink()` (note headers cache, then `HEAD /resources/:id`). Notes open through the note-list row (`_openNoteById()`), attachments through `_openResourceLightbox()`. Rendered mode still treats every `:/id` link as an attachment — note-link navigation exists only in markdown mode.
- Table helper (`Prec.high` keymap): Tab/Shift-Tab align the whole pipe table and move between cells (Tab at the last cell appends a row). Tables inside fences are ignored. **Do not bind Enter**: people type pipe tables row by row, and an "Enter adds a formatted row" handler corrupts what they type next (it broke `table-regression.spec.js`).
- No regex lookbehind anywhere in `cm-extras.js` (a parse-time SyntaxError on iOS < 16.4 would take the whole file down) — pinned by a test.
- Coverage: `tests/cmExtras.test.js` (pure helpers + real CM6 in jsdom), `playwright-tests/md-extras.spec.js` (real browser: preview/resize/round-trip, chips + hover, checkboxes, tables, paste, status bar/outline/folding, Copy button, live preview).
