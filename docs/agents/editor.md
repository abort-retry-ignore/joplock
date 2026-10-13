# Editor model

> Read this before: changing the editor (CodeMirror 6 markdown mode, TinyMCE rendered mode, mode switching, autosave, markdown round-trip) or debugging a phantom "Edited" state.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

## Architecture (dual-mode: CM6 markdown + TinyMCE rendered)

The editor supports two modes, both backed by the hidden `<textarea id="note-body">` form field:

- **Rendered mode = TinyMCE 8.** Persistent singleton (`initPersistentTinyMCE()` in `public/app.js`) mounted on a hidden `<textarea id="tinymce-editor">` that lives outside `.app`/`#mobile-app` in `pages.js` so htmx swaps don't destroy it; a `position:fixed` `#tinymce-host` div is repositioned via `positionTinyMCEHost()` to sit over the `#tinymce-slot` placeholder in `editorFragment()`. TinyMCE content is converted back to markdown via `tinymceToMarkdown()` (Turndown) into `#note-body` on `input`/`change`.
- **Markdown mode = CodeMirror 6.** Mounted into `#cm-host` by `mountMarkdownEditor()` → `initCM()`, seeded from `#note-body`. CM6 edits sync into `#note-body` via `cmSyncToTA()` (called from initCM's update listener). `getCM()` returns the live `EditorView`; `cmSetVal()` replaces the CM document.
- `codemirror.min.js` is loaded on the page before `app.js` (built from `cm-build/`, `npm run build:cm`), so `window.CM` is available for both the markdown editor and the code-block modal.

Text-expander is now wired for BOTH modes:
- **Markdown mode (CM6)**: `maybeExpandTextFromCM()` on `initCM()` contentDOM input listeners (text + AI triggers).
- **Rendered mode (TinyMCE)**: `maybeExpandTextFromTinyMCE()` on `editor.on('keyup')`; inspects the caret text node suffix in the iframe and replaces the trigger via `replaceTinyMCETextExpansion()` (multi-line → `<br>`, then `tinyMCESyncToTA()`). Both `action:'text'` AND `action:'ai'` triggers now fire in rendered mode: AI triggers call `removeTinyMCETriggerForAction()` then `requestTinyMCEProseCompletion()` (builds a prompt from the iframe caret via `getTextBeforeCaretTinyMCE()`, calls `requestProseCompletion()`). The completion is offered in the SAME `note-autocomplete-popup` used by markdown mode — kind `'tinymce-prose'`, accept with Enter/Tab inserts via `insertProseCompletionTinyMCE()` (DOM text nodes, restores a caret bookmark first), Esc discards. `Ctrl/Cmd-Space` inside the iframe is wired on `editor.on('keydown')` (the global `document` keydown can't see iframe keystrokes) and also shows the popup. Popup keys are forwarded from the iframe keydown via `handleRenderPopupKey()` because iframe key events never reach the outer-document listener; popup coords come from `tinyMCECaretCoords()` (iframe caret rect offset by the iframe element rect).

## Dead code and legacy paths (verified still present)
- **Dead `getPV()` / `#note-preview` contenteditable code** still exists in `public/app.js` (superseded by TinyMCE). `getPV()` returns null (the element is never rendered by any template), so every `if(pv){...}` branch in the formatting helpers (`wrapSel`, `insertPfx`, `clearFormat`, `openCodeModal`, `submitCode`, `syncPV`, `replacePVTextExpansion`, etc.) is dead and always falls through to the CM/textarea branch. Harmless. NOT removed because it is threaded through ~30 functions and ripping it out risks regressing the live CM path; do it as a dedicated, well-tested cleanup pass, not a drive-by.
- **Image download buttons live in the TinyMCE body, not the dead PV path.** `initResourceImageDownloadButtons`/`activatePV` are legacy-only (PV never renders). The restored button is `initTinyMCEImageDownloadButtons(editor)`, called from `_setTinyMCEContent`'s post-load hook next to `initTinyMCECodeCopyButtons`. Serialization contract (same as the code-copy button): the button is `textContent=''` + `data-mce-bogus="all"` (label via CSS `::after` in `_tinyMCEContentFontStyle()`), so `getContent()` drops it — it can never reach saved markdown, HTML/DOCX/PDF exports. Only the positioning wrap `<span class="preview-img-download-wrap">` survives `getContent()`; `_stripTinymceDownloadChrome()` unwraps it in `tinyMCEContent()` and `tinymceToMarkdown()` so every serialization boundary sees the pre-injection DOM (keeps round-trip hashes stable — no phantom edits). Because the anchor can now sit inside the iframe, `_positionResourceActions` resolves anchor rects via `_anchorRectInHostDoc()` (iframe-viewport rect offset by the iframe element's rect). Coverage: `tests/tinymceImageDownload.test.js`.
- **`highlightTinyMCECodeBlocks()` is unreferenced dead code.** It was the hljs pass over the TinyMCE body before Prism/`codesample` took over; every call site was removed but the function is still defined (`public/app.js`). It is the only hljs consumer besides the dead PV path, so removing it (with `highlightCodeBlocks()`) is a safe, self-contained slice of the PV cleanup.

## Two modes

- **Markdown mode**: CodeMirror 6 mounted in `#cm-host` is the visible editor; `#note-body` is the hidden sync target. If the CM6 bundle fails to load, `mountMarkdownEditor()` falls back to showing the raw textarea.
- **Rendered mode**: TinyMCE (persistent instance, positioned over `#tinymce-slot`) is visible; `tinymceToMarkdown()` converts edited HTML back to markdown on `input`/`change`.

## Source of truth during editing

- The hidden textarea `#note-body` is the form field used for saves.
- In markdown mode, CM6 changes sync into `#note-body` via `cmSyncToTA()`.
- In rendered mode, TinyMCE's `getContent()` is converted via `tinymceToMarkdown()` into `#note-body`.
- Switching modes: markdown→rich calls `cmSyncToTA()` then POSTs the markdown to `/fragments/preview` and loads the rendered HTML into TinyMCE; rich→markdown calls `tinyMCESyncToTA()` then mounts CM6 from the textarea. There is no client-side markdown→TinyMCE-HTML converter — that direction round-trips through the server.
- File/image uploads should alter markdown first, then refresh rendered preview from markdown; do not treat preview-only DOM insertion as authoritative state.
- The title is mirrored between `.editor-title`, hidden title input, and mobile title header when applicable.

## Save lifecycle

- `markEdited()` updates UI state to `Edited`
- `scheduleSave()` triggers delayed autosave for body/form changes
- `scheduleSaveTitle()` is a shorter timer for title changes
- If `scheduleSave()` or `scheduleSaveTitle()` sees the same form hash as `_savedHash`, the visible save state should return to `Saved`, not remain `Edited`
- `flushSave()` is the forced-save path used before leaving a dirty note; it must also handle vault-note encryption before navigation proceeds
- `htmx:afterRequest` on the editor save path transitions UI state back to `Saved`
- Offline/request failure paths set status to `Offline`

## Important fragility points

- DOM IDs and class names are part of the editor contract with inline JS (`#cm-host`, `#note-body`, `#tinymce-slot`, `#tinymce-host`, `#editor-toolbar`).
- Rendered-mode HTML (TinyMCE content) must remain convertible back to markdown with acceptable fidelity via `tinymceToMarkdown()`/Turndown.
- Checkbox, code block, and blank-line handling are easy to regress.
- **Blank-line markers between blocks are `<p class="md-blank-line"><br></p>`, NOT bare `<div><br></div>`.** `injectBlankLineBlocks()` (`app/markdownRenderer.js`) emits extra blank lines as empty paragraphs because TinyMCE's schema preserves empty `<p>` natively; a bare `<div><br></div>` got normalised/merged/dropped around block-level images, which swallowed spacing between images after a few markdown⇄render round-trips. The Turndown `blankLine` rule (`public/app.js`, and the preview-path copy in `tests/previewRoundTrip.test.js`) matches `P|DIV.md-blank-line`; in `getTurndown()` both `blankLine` and `emptyP` emit the same `\x00BL\x00` sentinel so precedence is moot. **Two TinyMCE quirks made image spacing collapse anyway (both fixed):** (1) **TinyMCE strips the `<br>`** from the marker on `setContent`, leaving an empty `<p class="md-blank-line"></p>` that Turndown drops — so `tinymceToMarkdown()` pre-normalises a **blank** `md-blank-line` paragraph (empty, whitespace/`&nbsp;`-only, or just `<br>`) to the `❤BR❤` sentinel shape before Turndown. **This normalisation MUST stay conditional.** A marker is a real, focusable paragraph in the iframe, so clicking the gap between two blocks puts the caret inside it and typing puts the new text there; rewriting markers unconditionally (the old "empty or not" behaviour) replaced that text with the sentinel and **silently destroyed it** — type a line after a checklist, leave the note, come back, gone. When a marker holds real content, leave the paragraph verbatim: with text present neither the `blankLine` nor the `emptyP` rule matches, so it converts as an ordinary paragraph. Coverage: `tests/appRuntime.test.js` "keeps text typed INTO a blank-line marker (data-loss regression)" + "still collapses a genuinely blank blank-line marker". (2) **Sized/raw-HTML images** (Turndown emits `<img … width=… />` for resized images) are markdown-it *HTML blocks* rendered OUTSIDE any `<p>`; a loose block `<img>` next to markers gets absorbed into an adjacent paragraph by TinyMCE, so `postProcess()` wraps any line that is a lone `<img>` in its own `<p>`. Regression coverage: `tests/appRuntime.test.js` "image spacing …", "sized … survive 6 mode switches", "br-stripped … marker".
- The code modal is outside the fragment-swapped editor so it survives swaps; it uses CM6 (`_initCodeModalCM`) which requires `window.CM` (now loaded).
- Both markdown mode (CM6) AND rendered mode (TinyMCE) open this same custom full-screen CM6 code modal (`openCodeModal`/`submitCode`) for *editing* the code text/language, NOT TinyMCE's built-in `codesample` dialog. The toolbar uses a custom `jop_code` button; clicking an existing `<pre>` in rendered mode routes through `tinyMCEInsertCodeBlock()` → `openCodeModal()`. On submit in rendered mode, `submitCode()` (TinyMCE branch, `_codeTinyMCE`/`_codeTinyMCEBookmark`) inserts `<pre class="language-x">code</pre>` via `ed.insertContent()` — the `codesample` plugin's `SetContent` handler then highlights it with Prism. Do NOT reintroduce hljs highlighting of rendered-mode blocks; Prism owns rendered-mode coloring. `highlightTinyMCECodeBlocks()` (the old hljs pass over the TinyMCE body) has **no call sites left** — the function body is dead, not deleted, so grep hits are misleading. Do not reintroduce `ed.execCommand('mceCodeSample')` (that opens the built-in dialog).
- On htmx editor-panel swap, `_cmView` is destroyed in `htmx:afterSwap` and re-mounted by `initEditorPanel()` (via `mountMarkdownEditor`) on `htmx:afterSettle` when the note opens in markdown mode. Keep that destroy/remount ordering intact.
- `#tinymce-host` is `position:fixed` and repositioned via `positionTinyMCEHost()`; if it looks detached, check that function and the `#tinymce-slot` rect, not CSS alone.
- **Turndown expels "flanking" whitespace, and it gets that wrong next to atomic children.** `flankingWhitespace()` derives an element's edge whitespace from `node.textContent`, which skips `<img>`/`<br>` (they contribute no text). For `<a><img/>&nbsp;Label</a>` it reports *leading* whitespace even though the whitespace is interior to the produced markdown (`![alt](:/id) Label`), so `replacementForNode()`'s `content.trim()` cannot remove it — yet it is still prepended. The space was therefore **duplicated on every round-trip and grew one character per note open**, corrupting the stored body. `tinymceToMarkdown()` hides such whitespace behind a sentinel (`_protectInlineLeadingSpace` → `_restoreProtectedSpace`) that **encodes the character code**: these runs are frequently NBSP, and restoring a generic `' '` would itself change the body and keep the note permanently dirty. Do not "simplify" that sentinel back to a plain space, and do not narrow its character class to `[ \t]` — Turndown's `edgeWhitespace` uses `\s`, which matches NBSP.
- **Soft breaks inside a blockquote must re-apply the `>` prefix.** `> b\n> c` is ONE quoted paragraph with a soft break, so the renderer emits `<blockquote><p>b<br>c</p></blockquote>`. The `❤BR❤` sentinel is restored to `\n` *after* Turndown has prefixed the lines it emitted, so a naive global `split/join` produced `> b\nc` — the second line escaping the blockquote entirely (real content corruption plus a permanent dirty-on-open diff). The restore is line-aware and carries the leading `>` run across the break; keep it that way. Bare `> ` lines also get their insignificant trailing space stripped.

## Debugging

### If toolbar/mode behavior is inconsistent

- Verify whether the current editor is actually inside `#mobile-editor-body`
- Check `syncEditorModeButtons()` and `setEditorMode()`
- Check whether the note was initialized with the expected `noteOpenMode`
- If switching modes marks the note `Edited`, confirm the current form hash differs from `_savedHash`; unchanged hashes should show `Saved`

### If title UI drifts

- Check `.editor-title`
- Check hidden input `.editor-title-hidden`
- Check `#mobile-editor-title`
- Check `autoTitle()` and `syncTitle()`

### If save-state UI drifts

- Check `setSaveState()`
- Check `#autosave-status`
- Check `#mobile-editor-status`
- Check htmx save success/failure handlers and upload progress handlers

### If a note shows "Edited" (or autosaves) immediately on open

`_savedHash` is snapshotted in `initEditorPanel()` from the **raw server body**, before CM6/TinyMCE has loaded. 820ms after `setContent`, the reconcile timer in `_setTinyMCEContent()` syncs the editor back to markdown and compares hashes. So **any** non-idempotent markdown⇄HTML round-trip looks like a user edit.

With `debugLogging` on, the reconcile prints exactly which side it took — this is the fastest way to triage:

| Log line | Meaning |
|---|---|
| `post-load reconcile: form clean, nothing to do` | Round-trip is idempotent. Save state is not the problem; look elsewhere. |
| `post-load reconcile: load normalisation only, re-baselining hash` | Round-trip is lossy but nobody typed. Hash is re-baselined: no `markEdited`, no save. Expected for notes with constructs HTML cannot represent. |
| `post-load reconcile: user typed during window, marking edited` | A real edit landed inside the 800ms quiet window and is being saved. Correct behaviour. |

If you see `user typed during window` when the note was untouched, the `_tinymceUserTypedSinceLoad` flag is being set spuriously — it must only be wired to `keydown`/`paste`/`cut`/`drop`. Never wire it to `input` or `SetContent`: `editor.setContent()` fires both, which reintroduces the phantom edit. Navigation-only keys (arrows, modifiers) must stay filtered out.

To find out *why* a note is non-idempotent, round-trip its stored body offline:
`renderMarkdown(body)` → `tinymceToMarkdown(html)` → diff against `body`. `tests/appRuntime.test.js` has the harness (`makeTurndownCtx()` + `runWithDeps()`) for running the real `public/app.js` functions under JSDOM.

Known-lossy constructs that are **by design** and will always re-baseline (do not "fix" them by adding markers):

- an indented ` ``` ` fence loses its indent (HTML cannot carry fence indentation)
- encrypted/vault note wrappers strip HTML comments — irrelevant in practice, since locked notes never load plaintext into TinyMCE

Heading-gap blank lines around ATX headings are no longer lossy: `tinymceToMarkdown(html, prevMd)` keeps Turndown's natural spacing and only falls back to the authored markdown (`prevMd`, what `#note-body` already held for the note) when the fresh conversion differs from it purely in heading-gap shape — collapsing both with `_applyHeadingSpacing()` yields the same text. Authored blank lines around headings survive the switch; untouched compact notes don't gain a phantom "Edited"/save; a real edit always wins (and one-time re-spaces a compact heading note). Do not reintroduce the unconditional `headingGapRe`/`headingLeadRe` collapse in `tinymceToMarkdown()` — it ate blank lines the user typed around headings (reported: add a blank line under a heading in markdown mode, switch to rendered and back, it was gone, and the collapsed body was saved). `_applyHeadingSpacing()` remains for the authored-gap comparator and the legacy preview path (`htmlToMarkdown`). Coverage: `tests/appRuntime.test.js` heading-gap round-trip tests + `playwright-tests/heading-gap-roundtrip.spec.js`.
