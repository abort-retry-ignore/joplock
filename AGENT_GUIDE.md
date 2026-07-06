# Joplock Agent Guide

<!-- cSpell:disable -->

## General Prompt

Respond like smart caveman. Cut all filler, keep technical substance.

-   Drop articles (a, an, the), filler (just, really, basically, actually).
-   Drop pleasantries (sure, certainly, happy to).
-   No hedging. Fragments fine. Short synonyms.
-   Technical terms stay exact. Code blocks unchanged.
-   Pattern: [thing] .[action] .[reason]. [next step]

## Purpose

This repo owns Joplock, standalone thin-client sidecar web UI for stock Joplin Server.

Use this guide when working in this repository.

## Product Direction

- Joplin Server stays unmodified
- Joplock stays separate project and separate repo
- Reuses existing Joplin Server auth/session/user model through sidecar logic
- Keeps compatibility with desktop/mobile/CLI clients on same server and same DB
- Browser stays thin and untrusted
- Shared-browser safety matters: logout should clear client-visible state/cache as much as platform allows
- Installable PWA shell, no offline notes/editing
- Uses same Postgres database as Joplin Server, no separate app DB

## Architecture Overview

### Stack

- **Server**: Node.js HTTP server, no framework
- **Client**: SSR HTML + htmx fragment swaps + shared browser logic in `public/app.js`
- **Editor**: Dual-mode. Markdown mode = CodeMirror 6 (mounted into `#cm-host`); rendered mode = TinyMCE 8. The `#note-body` textarea is the hidden form/sync target for both.
- **Code blocks**: Full-screen code modal with a CM6 editor and language picker. Highlighting differs by mode: preview/markdown modes use highlight.js (`hljs`); rendered mode (TinyMCE) uses the native `codesample` plugin (PrismJS `.token` spans). Prism token colors are injected into the TinyMCE iframe via `content_style` in `_tinyMCEContentFontStyle()` (the oxide dark content skin ships no `.token` CSS). `codemirror.min.js` is loaded on the page (before `app.js`), so `window.CM` is available for both the markdown editor and the code modal.
- **Autosave**: htmx delayed PUT after typing pause (deferred while modals are open)
- **Markdown**: server-side `renderMarkdown()`, client-side Turndown `htmlToMarkdown()`
- **Auth**: reuses Joplin Server `sessionId` cookie
- **DB access**: reads direct from shared Postgres; writes go through stock Joplin Server API

### Runtime Shape

- Initial page load is full SSR HTML from `layoutPage()` in `app/templates/pages.js`
- After load, most interactions are fragment-driven via htmx
- The browser is intentionally thin: most state is DOM state, form state, or small client-only UI state in `public/app.js`
- There is no frontend router and no SPA store
- Desktop and mobile share the same server routes and most of the same editor code; mobile is a different screen shell around the same editor fragment

### Request Flow

1. Browser hits Joplock
2. Joplock validates `sessionId` against Joplin session/user tables
3. Fragment endpoints return HTML chunks; htmx swaps DOM
4. Writes serialize note/folder/resource and send upstream to stock Joplin Server API

### Main UI Flow

1. `GET /` renders the full shell
2. Navigation / notes / editor content is loaded from fragment endpoints
3. Selecting a folder swaps the notes list or nav tree fragment
4. Selecting a note swaps in `editorFragment()`
5. Autosave sends `PUT /fragments/editor/:id` with the current form state
6. Preview rendering uses `POST /fragments/preview`

### Fragment Conventions

- `app/templates/**/*.js` returns raw HTML strings, not JSX/templates/components
- htmx targets are mostly `#nav-panel`, `#notelist-panel`, `#editor-panel`, and mobile-specific targets like `#mobile-editor-body`
- Out-of-band swaps are used sparingly; note metadata is one example
- Client logic often relies on stable IDs, so be careful renaming DOM IDs used by inline JS

## Core Rules

1. Do not modify Joplin Server source for Joplock features unless explicitly approved.
2. Server authoritative. Browser ephemeral.
3. Preserve sync compatibility with normal Joplin clients.
4. Do not build browser-local authoritative storage.
5. Keep sidecar API app-oriented. Do not expose raw sync/storage model to frontend.
6. Treat logout as client cleanup event on shared machines.

## Vault / Encryption Model

- Vaults are notebooks/folders with metadata stored in `joplock_vaults`
- Titles stay plaintext
- Notebook names stay plaintext
- Note body ciphertext is stored in normal Joplin note bodies using Joplock markers for compatibility
- Browser crypto stays client-side only; server never receives vault passwords
- A note inside a vault notebook must be treated as protected even if its stored body is still plaintext during transition states
- Locked vault notes render the lock overlay plus hidden editor shells; do not remove the hidden editor DOM because unlock logic depends on it
- Clicking a vault lock while unlocked should lock immediately and close the open note if it belongs to that vault
- Startup/refresh must never auto-resume an encrypted note or a note inside a vault notebook

## Service Responsibilities

### Stock Joplin Server

Owns:
- login/session/auth source of truth
- sync endpoints
- canonical storage rules
- existing user/session tables

### Joplock

Owns:
- thin-client UI
- sidecar API endpoints
- session validation against shared DB
- markdown rendering and editor behavior
- resource upload/serving
- app-specific settings in `joplock_settings`
- PWA shell/assets

Does not own:
- canonical note/folder/resource persistence rules
- sync protocol semantics
- auth/session source of truth
- offline-first storage

## File Map

### Entry / Server
- `server.js` — entry point, env wiring, server startup
- `app/createServer.js` — server assembly, shared context, full-page `/` render, static serving

### Route Handlers
- `app/routes/fragments.js` — desktop/shared fragment routes
- `app/routes/mobile.js` — mobile folder/note/search routes
- `app/routes/api.js` — JSON API endpoints
- `app/routes/auth.js`, `app/routes/settings.js`, `app/routes/admin.js`, `app/routes/history.js`, `app/routes/resources.js`

### Templates / UI
- `app/templates/index.js` — central template re-export
- `app/templates/pages.js` — full-page layout/login/MFA shells
- `app/templates/fragments.js` — nav, editor, search, history, OOB fragments
- `app/templates/mobile.js` — mobile folder/note/search fragments
- `app/templates/shared.js` — escaping, markdown rendering, title normalization
- `app/templates/settings.js` — settings/admin page sections

### Client Runtime
- `public/app.js` — shared client logic for editor, autosave, vault flows, mobile screen stack, search, and modals

Important subareas:
- `settingsPage()` — Settings UI and simple client save helpers
- `editorFragment()` — shared editor DOM used by desktop and mobile
- `layoutPage()` — logged-in app shell and mobile shell container
- `renderMarkdown()` — server-side markdown-to-HTML for preview/render mode
- `public/app.js` mobile helpers — folder-first mobile UI, note list, search, editor screen stack

### Auth
- `app/auth/cookies.js` — cookie parsing
- `app/auth/sessionService.js` — shared DB session lookup
- `app/auth/mfaService.js` — env-driven TOTP verification and otpauth/QR generation

### Data
- `app/items/itemService.js` — DB reads for folders, notes, search, resources
- `app/items/itemWriteService.js` — note/folder/resource serialization and upstream writes
- `app/settingsService.js` — Joplock-owned settings table access
- `app/vaultService.js` — vault metadata CRUD in `joplock_vaults`

### How Reads vs Writes Work

- Reads come from the shared Postgres DB for speed and to match the current server state
- Writes do not write directly to Joplin tables; they go through stock Joplin Server APIs
- That split is intentional: Joplock can stay lightweight while preserving compatibility with normal Joplin clients
- If behavior looks inconsistent after a write, inspect both the sidecar request path and the upstream Joplin API call path

### Static Assets
- `public/htmx.min.js`
- `public/codemirror.min.js` — CM6 bundle with 11 language parsers (built from `cm-build/`, `npm run build:cm`); loaded on the page before `app.js`. Powers markdown mode (`initCM`) and the code-block modal (`_initCodeModalCM`).
- `public/tinymce/` — TinyMCE 8 (npm dep, see root `package.json`), loaded as `/tinymce/tinymce.min.js`; this is the live rendered-mode editor
- `public/turndown.min.js` — HTML→Markdown conversion, used by `tinymceToMarkdown()`
- `public/hljs.min.js` — highlight.js bundle for preview mode code highlighting (built from `hljs-build/`)
- `public/styles.css`
- `public/service-worker.js`
- `public/manifest.webmanifest`

### Bundle Build Sources
- `cm-build/` — CM6 bundle source → `public/codemirror.min.js`. Build from repo root with `npm run build:cm` (or `cd cm-build && npm install && npm run build`).
- `hljs-build/` — highlight.js bundle source → `public/hljs.min.js`. Build with `npm run build:hljs` (or `cd hljs-build && npm install && npm run build`).

### Tests
- `tests/*.test.js`
- Run: `node --test tests/**/*.test.js`

### Deployment
- `Dockerfile`
- `docker-compose.yml` — sidecar-only example
- `docker-compose.example-full.yml` — Postgres + Joplin Server + Joplock example
- `.env.example`

## MFA Notes

- MFA is per-user, managed via Settings → Security → Two-Factor Authentication.
- Each user's TOTP seed is stored in `joplock_settings.totp_seed` in the shared Postgres DB.
- No global/shared TOTP seed. The old `JOPLOCK_TOTP_SEED` / `JOPLOCK_TOTP_ISSUER` env vars are removed.
- `IGNORE_ADMIN_MFA=true` skips the per-user MFA check at login for the docker-defined admin account (`JOPLOCK_ADMIN_EMAIL`). Other users are unaffected.
- Admin can force-enable/disable MFA for any user via the Admin tab (no code required).

## Design Decisions

### Separate repo
Joplock lives outside Joplin monorepo. Keep standalone build, test, docs, Docker flow working without Joplin source tree.

### Shared Postgres database
Joplock reads same Postgres database as Joplin Server. No data duplication. Writes still go through Joplin Server API for compatibility and validation.

### Configurable open mode
Notes can open in rendered mode or markdown mode based on the per-user `noteOpenMode` setting. Desktop and mobile both respect the same setting.

### Shared editor fragment
Desktop and mobile do not have separate editor implementations. Both use the same `editorFragment()` and client editor logic; mobile wraps it in a mobile-specific shell and screen navigation layer.

### PWA shell
Cache shell/static assets only. Do not cache note/resource/API responses in ways that break shared-browser safety.

### Mobile-first navigation without SPA rewrite
Mobile uses a folders screen, notes screen, and editor screen implemented in SSR + htmx + inline JS. Do not introduce a client router or framework state layer to solve mobile flow problems.

### Tablet behavior
Tablet still uses the mobile shell in the current responsive design. Mobile/tablet editor behavior should be reasoned about by editor container context, not just viewport width.

## Editor Model

### Architecture (dual-mode: CM6 markdown + TinyMCE rendered)

The editor supports two modes, both backed by the hidden `<textarea id="note-body">` form field:

- **Rendered mode = TinyMCE 8.** Persistent singleton (`initPersistentTinyMCE()` in `public/app.js`) mounted on a hidden `<textarea id="tinymce-editor">` that lives outside `.app`/`#mobile-app` in `pages.js` so htmx swaps don't destroy it; a `position:fixed` `#tinymce-host` div is repositioned via `positionTinyMCEHost()` to sit over the `#tinymce-slot` placeholder in `editorFragment()`. TinyMCE content is converted back to markdown via `tinymceToMarkdown()` (Turndown) into `#note-body` on `input`/`change`.
- **Markdown mode = CodeMirror 6.** Mounted into `#cm-host` by `mountMarkdownEditor()` → `initCM()`, seeded from `#note-body`. CM6 edits sync into `#note-body` via `cmSyncToTA()` (called from initCM's update listener). `getCM()` returns the live `EditorView`; `cmSetVal()` replaces the CM document.
- `codemirror.min.js` is loaded on the page before `app.js` (built from `cm-build/`, `npm run build:cm`), so `window.CM` is available for both the markdown editor and the code-block modal.

Historical note: this replaced an earlier half-finished migration where markdown mode was a bare textarea and CM6 was dead code (`getCM` undefined, no `#cm-host`, `codemirror.min.js` not loaded). If you see references to that broken state elsewhere, they are stale.

Text-expander is now wired for BOTH modes:
- **Markdown mode (CM6)**: `maybeExpandTextFromCM()` on `initCM()` contentDOM input listeners (text + AI triggers).
- **Rendered mode (TinyMCE)**: `maybeExpandTextFromTinyMCE()` on `editor.on('keyup')`; inspects the caret text node suffix in the iframe and replaces the trigger via `replaceTinyMCETextExpansion()` (multi-line → `<br>`, then `tinyMCESyncToTA()`). Both `action:'text'` AND `action:'ai'` triggers now fire in rendered mode: AI triggers call `removeTinyMCETriggerForAction()` then `requestTinyMCEProseCompletion()` (builds a prompt from the iframe caret via `getTextBeforeCaretTinyMCE()`, calls `requestProseCompletion()`). The completion is offered in the SAME `note-autocomplete-popup` used by markdown mode — kind `'tinymce-prose'`, accept with Enter/Tab inserts via `insertProseCompletionTinyMCE()` (DOM text nodes, restores a caret bookmark first), Esc discards. `Ctrl/Cmd-Space` inside the iframe is wired on `editor.on('keydown')` (the global `document` keydown can't see iframe keystrokes) and also shows the popup. Popup keys are forwarded from the iframe keydown via `handleRenderPopupKey()` because iframe key events never reach the outer-document listener; popup coords come from `tinyMCECaretCoords()` (iframe caret rect offset by the iframe element rect).

Follow-up (still not done, out of scope):
- **Dead `getPV()` / `#note-preview` contenteditable code** still exists in `public/app.js` (superseded by TinyMCE). `getPV()` returns null (element never rendered), so every `if(pv){...}` branch in the formatting helpers (`wrapSel`, `insertPfx`, `clearFormat`, `openCodeModal`, `submitCode`, `syncPV`, `replacePVTextExpansion`, etc.) is dead and always falls through to the CM/textarea branch. Harmless. NOT removed because it is threaded through ~30 functions and ripping it out risks regressing the live CM path; do it as a dedicated, well-tested cleanup pass, not a drive-by.

### Two modes

- **Markdown mode**: CodeMirror 6 mounted in `#cm-host` is the visible editor; `#note-body` is the hidden sync target. If the CM6 bundle fails to load, `mountMarkdownEditor()` falls back to showing the raw textarea.
- **Rendered mode**: TinyMCE (persistent instance, positioned over `#tinymce-slot`) is visible; `tinymceToMarkdown()` converts edited HTML back to markdown on `input`/`change`.

### Source of truth during editing

- The hidden textarea `#note-body` is the form field used for saves.
- In markdown mode, CM6 changes sync into `#note-body` via `cmSyncToTA()`.
- In rendered mode, TinyMCE's `getContent()` is converted via `tinymceToMarkdown()` into `#note-body`.
- Switching modes: markdown→rich calls `cmSyncToTA()` then POSTs the markdown to `/fragments/preview` and loads the rendered HTML into TinyMCE; rich→markdown calls `tinyMCESyncToTA()` then mounts CM6 from the textarea. There is no client-side markdown→TinyMCE-HTML converter — that direction round-trips through the server.
- File/image uploads should alter markdown first, then refresh rendered preview from markdown; do not treat preview-only DOM insertion as authoritative state.
- The title is mirrored between `.editor-title`, hidden title input, and mobile title header when applicable.

### Save lifecycle

- `markEdited()` updates UI state to `Edited`
- `scheduleSave()` triggers delayed autosave for body/form changes
- `scheduleSaveTitle()` is a shorter timer for title changes
- If `scheduleSave()` or `scheduleSaveTitle()` sees the same form hash as `_savedHash`, the visible save state should return to `Saved`, not remain `Edited`
- `flushSave()` is the forced-save path used before leaving a dirty note; it must also handle vault-note encryption before navigation proceeds
- `htmx:afterRequest` on the editor save path transitions UI state back to `Saved`
- Offline/request failure paths set status to `Offline`

### Upload behavior

- The upload modal (`openUploadModal()` → `uploadModalFiles()` → `insertUploadedFiles()`) is the primary picker/drag-drop path; it uploads to `/fragments/upload` and inserts into the live TinyMCE document (or the textarea/CM target when not in rich mode). On success (all files upload, no errors) the modal auto-dismisses; if any file errors it stays open showing per-file errors.
- Drag-and-drop directly onto TinyMCE works via `_uploadFileToTinyMCE()` (inserts `<img data-resource-id>` / `<a data-resource-id>` into the live editor). Markdown-mode drops route through `_uploadFileToCM()` (inserts `![](:/id)` at the CM cursor).
- **Dropped images always get a trailing blank line.** `_uploadFileToTinyMCE()` inserts the image as `<p><img></p><p></p>` (the empty `<p>` serialises to a blank markdown line via the `emptyP` Turndown rule); `_uploadFileToCM()` appends `\n\n` after the image reference. This keeps the caret on a fresh empty line so typed text is never glued to the image. Non-image files do NOT get the extra blank line. Covered by `tests/cm6MarkdownMode.test.js` (insertion contract) + `tests/appRuntime.test.js` (mode-switch round-trip, no mangling).
- Clipboard paste: images are uploaded by TinyMCE's built-in pipeline (`paste_data_images:true` + `automatic_uploads:true` + `images_upload_handler`); non-image clipboard files are handled by an explicit `editor.on('paste', ...)` handler that routes through `_uploadFileToTinyMCE()`.
- The Image/Media dialogs' Browse button is wired via `file_picker_callback` to `/fragments/upload`, returning a `/resources/<id>` URL.
- All upload paths produce `src="/resources/<id>"` / `href="/resources/<id>"`, which `tinymceToMarkdown()` (the `joplinImg`/`joplinLink` Turndown rules) converts to Joplin `![](:/id)` / `[](:/id)` on save. `data-resource-id` is added by drop/paste/upload-modal paths but is not required for the round-trip (matching is by `src`/`href`).
- `uploadFiles()`/`handleFilePicker()` (the older `#file-upload` input path) still exist and batch multi-file selections; image-only uploads must not promote the image filename into the note title.

### Upload size limit

- `appSettings.maxUploadMb` (admin setting, default 200, clamped 1–2000) caps upload size. Joplin Server's formidable `maxFileSize` is a hard 200MB ceiling — exceeding it produced opaque 500s after buffering; the limit prevents that.
- Server: `app/routes/resources.js` `resolveMaxUploadBytes()` does a fast 413 via `Content-Length` pre-check (before buffering) plus a post-parse guard.
- Client: `_maxUploadBytes()` reads `_joplockConfig.maxUploadMb`; `_fileTooLarge()` guards every upload entry point (modal, drop, paste, picker) with a friendly message instead of a failed request.
- Admin field: Settings → Admin → Login Security, saved via `/admin/security`.

### Important fragility points

- DOM IDs and class names are part of the editor contract with inline JS (`#cm-host`, `#note-body`, `#tinymce-slot`, `#tinymce-host`, `#editor-toolbar`).
- Rendered-mode HTML (TinyMCE content) must remain convertible back to markdown with acceptable fidelity via `tinymceToMarkdown()`/Turndown.
- Checkbox, code block, and blank-line handling are easy to regress.
- **Blank-line markers between blocks are `<p class="md-blank-line"><br></p>`, NOT bare `<div><br></div>`.** `injectBlankLineBlocks()` (`app/markdownRenderer.js`) emits extra blank lines as empty paragraphs because TinyMCE's schema preserves empty `<p>` natively; a bare `<div><br></div>` got normalised/merged/dropped around block-level images, which swallowed spacing between images after a few markdown⇄render round-trips. The Turndown `blankLine` rule (`public/app.js`, and the preview-path copy in `tests/previewRoundTrip.test.js`) matches `P|DIV.md-blank-line`; in `getTurndown()` both `blankLine` and `emptyP` emit the same `\x00BL\x00` sentinel so precedence is moot. **Two TinyMCE quirks made image spacing collapse anyway (both fixed):** (1) **TinyMCE strips the `<br>`** from the marker on `setContent`, leaving an empty `<p class="md-blank-line"></p>` that Turndown drops — so `tinymceToMarkdown()` pre-normalises any `md-blank-line` paragraph (empty or not) to the `❤BR❤` sentinel shape before Turndown. (2) **Sized/raw-HTML images** (Turndown emits `<img … width=… />` for resized images) are markdown-it *HTML blocks* rendered OUTSIDE any `<p>`; a loose block `<img>` next to markers gets absorbed into an adjacent paragraph by TinyMCE, so `postProcess()` wraps any line that is a lone `<img>` in its own `<p>`. Regression coverage: `tests/appRuntime.test.js` "image spacing …", "sized … survive 6 mode switches", "br-stripped … marker".
- The code modal is outside the fragment-swapped editor so it survives swaps; it uses CM6 (`_initCodeModalCM`) which requires `window.CM` (now loaded).
- Both markdown mode (CM6) AND rendered mode (TinyMCE) open this same custom full-screen CM6 code modal (`openCodeModal`/`submitCode`) for *editing* the code text/language, NOT TinyMCE's built-in `codesample` dialog. The toolbar uses a custom `jop_code` button; clicking an existing `<pre>` in rendered mode routes through `tinyMCEInsertCodeBlock()` → `openCodeModal()`. On submit in rendered mode, `submitCode()` (TinyMCE branch, `_codeTinyMCE`/`_codeTinyMCEBookmark`) inserts `<pre class="language-x">code</pre>` via `ed.insertContent()` — the `codesample` plugin's `SetContent` handler then highlights it with Prism. Do NOT reintroduce hljs highlighting of rendered-mode blocks (`highlightTinyMCECodeBlocks` was removed); Prism owns rendered-mode coloring. Do not reintroduce `ed.execCommand('mceCodeSample')` (that opens the built-in dialog).
- On htmx editor-panel swap, `_cmView` is destroyed in `htmx:afterSwap` and re-mounted by `initEditorPanel()` (via `mountMarkdownEditor`) on `htmx:afterSettle` when the note opens in markdown mode. Keep that destroy/remount ordering intact.
- `#tinymce-host` is `position:fixed` and repositioned via `positionTinyMCEHost()`; if it looks detached, check that function and the `#tinymce-slot` rect, not CSS alone.

## Mobile UI Model

### Shell structure

- `#mobile-folders-screen`
- `#mobile-notes-screen`
- `#mobile-editor-screen`

These screens are shown/hidden by inline JS in `layoutPage()` using class changes, not route changes.

### Mobile navigation behavior

- Folder-first flow: folders -> notes -> editor
- Search has its own mobile header state
- Mobile note creation uses dedicated fragment endpoints and server headers to drive the next UI step
- The floating action button is only a mobile affordance; desktop should stay unaffected
- FAB visibility should follow screen state directly (`folders` / `notes` visible, `editor` hidden), not only htmx swap side effects
- Mobile folder rows can include a vault lock button and it must stay inline with the row actions

### Mobile editor behavior

- Mobile hides the desktop title bar and uses the mobile header instead
- Mobile header mirrors note title and save state
- Mode buttons should remain visible and clearly indicate the active mode
- Toolbar visibility should be keyed to being inside the mobile editor container, not only screen width
- Newly-created empty mobile notes may be discarded on back if still blank/untitled
- Locked mobile notes should not reveal plaintext/editor surfaces until unlock

### Tablet expectations

- Tablet is still in the mobile shell range
- Existing note open path and new note open path should behave the same with respect to default open mode, toolbar visibility, and title/save-state UI
- When debugging tablet issues, compare the exact htmx target and after-settle path used by new-note vs existing-note opens

## Settings Model

### Storage

- Settings are stored per-user in `joplock_settings.settings` as JSONB
- `app/settingsService.js` owns defaults and normalization
- Unknown or invalid values should normalize back to safe defaults

### Current notable settings

- `theme`
- `noteFontSize`
- `mobileNoteFontSize`
- `codeFontSize`
- `noteMonospace`
- `noteOpenMode`
- `resumeLastNote`
- `dateFormat`
- `datetimeFormat`
- `liveSearch`
- `confirmTrash`
- `autoLogout`
- `autoLogoutMinutes`
- `encryptionAutoLockMinutes`
- `aiProfiles`
- `proseAutocompleteSentenceCount`
- `textExpanders`
- `maxUploadMb` (admin) — max upload size in MB (default 200, clamp 1–2000)
- `debugLogging` (admin, tri-state) — `null` inherits env `DEBUG`; `true`/`false` overrides at runtime

### Expander / AI Autocomplete

- Expander entries live in per-user `textExpanders` settings and are configured in Settings -> Expander.
- Expander triggers are always on; there is no global autocomplete enable/disable toggle.
- Trigger strings are normalized in `app/settingsService.js`, must be non-empty, deduplicated, and are capped at 15 characters.
- Expander entry shape is `{ id, trigger, action, profileId, text }`.
- `action: 'text'` replaces the trigger with `text`; empty text entries are discarded during normalization.
- `action: 'ai'` removes the trigger and launches prose autocomplete. `profileId` selects an AI profile, or falls back to the active profile when blank.
- AI autocomplete triggers are not configured in the AI tab. The AI tab owns provider profiles and sentence count; the Expander tab owns trigger strings.
- Legacy manual suffix triggers (`double-q`, `triple-space`, `ellipsis`) and robot toggle UI were removed. Do not reintroduce `proseAutocompleteManualTrigger`, `proseAutocompleteManualTriggerOptions`, or `autocompleteEnabled`.
- `Ctrl-Space` / `Mod-Space` remains a keyboard shortcut path for manual prose completion, separate from Expander suffix triggers.
- Note-link autocomplete (`[[...`) remains separate from AI prose autocomplete.

### AI Provider Profiles

- AI provider profiles live in `aiProfiles` and are normalized in `app/settingsService.js`.
- Profiles are user-defined; `defaultAiProfiles` is intentionally empty.
- Each profile can specify provider, API URL/model, API key, temperature, and active state.
- Legacy `openRouterApiKey` / `openRouterModel` are still migrated into an OpenRouter profile for backward compatibility.
- `/api/web/ai/prose-complete` accepts optional `profileId` and falls back to the active profile or first keyed profile.
- Autocomplete provider requests include `reasoning: { enabled: false }` in the chat completion payload.
- Server-side completion post-processing strips repeated prompt prefixes/suffixes, collapses adjacent repeated phrases, limits sentence count, and reports empty-completion diagnostics with `emptyReason`.
- Empty completion reasons are `provider-empty`, `provider-repeated-existing-text`, and `trimmed-no-complete-sentence`.

### Expander Runtime Notes

- Expander runtime (`_feedRingBuffer`, `consumePendingTextExpansion`, `runTextExpanderAction`) is in `public/app.js`. Its wiring points are `beforeinput`/`input` listeners inside `initCM()` (source `'cm'`), the old contenteditable-preview activation code (source `'preview'`, now dead), and TinyMCE's `editor.on('keyup')` (rendered mode).
- **Markdown mode (CM6) expander is live** (`initCM()` is invoked for real). **Rendered mode (TinyMCE) expander is live for BOTH text and AI triggers**: text triggers via `maybeExpandTextFromTinyMCE()`/`replaceTinyMCETextExpansion()`; AI triggers via `removeTinyMCETriggerForAction()` + `requestTinyMCEProseCompletion()` (prompt from `getTextBeforeCaretTinyMCE()`, insertion via `insertProseCompletionTinyMCE()`). `Ctrl/Cmd-Space` manual AI completion is wired on `editor.on('keydown')` inside TinyMCE too. The `'preview'` contenteditable path is dead (TinyMCE replaced that host). Coverage: `tests/expanderRuntime.test.js` (runtime) + `playwright-tests/ai-rendered.spec.js` (live provider E2E, skips without creds/AI profile).
- CodeMirror-mode expansion should inspect the current document suffix rather than relying only on raw DOM input events.
- (Historical, if re-wired to TinyMCE's iframe body) triggers can split typed text across text nodes, especially on iOS Safari. Prefer robust text-position/range logic.
- The input ring buffer is only for detecting Expander suffix triggers; keep per-keystroke logging minimal.
- Client diagnostic logging goes through `POST /api/web/client-log`; it redacts sensitive fields matching text/body/content/password/key/secret/token.
- If iPhone behavior differs from desktop, use Docker-visible client logs and remember stale service worker/cache can hide client JS changes.

### Debug Logging (runtime-toggleable)

- `appSettings.debugLogging` is tri-state (`normalizeTristate()` in `app/settingsService.js`): `null` = inherit env `DEBUG`; `true`/`false` = explicit admin override persisted in DB.
- `app/createServer.js` keeps `effectiveDebug` in memory; `refreshDebugLogging()` re-reads the DB on startup and after an admin save. `isDebug()` is read dynamically by the request logger and passed into ctx; `_joplockConfig.debug` and the settings-page inline `DEBUG` flag both reflect the effective state.
- Toggled via the "Enable debug logging" checkbox in Settings → Admin → Login Security. Applied immediately, no restart. `DEBUG` env in the compose files is only the startup default.

### The settings page is a full page, not a modal

- `/settings` is a standalone SSR page (full navigation away from the app), not an htmx fragment or modal. It has its own inline `<script>` and does NOT load `app.js`.
- Esc dismisses it (returns to `/`) via `<body onkeydown="...">` — an HTML attribute so it fires before any JS and can't be killed by a script error. It flashes the page background briefly as visual confirmation. Do not move this back into an `addEventListener` inside the IIFE; that proved unreliable (IIFE errors / event-propagation quirks swallowed Esc).
- Settings auto-save, so Esc has no unsaved-text concern.

### Adding a new setting

1. Add default + normalization in `app/settingsService.js`
2. Allow the key in `/api/web/settings` in `app/createServer.js` (or `/admin/*` for admin-only settings)
3. Add the UI in `settingsPage()` in `app/templates/settings.js`
4. If needed, inject the normalized setting into `layoutPage()` / `public/app.js`
5. Rebuild with `./scripts/rebuild-dev.sh`

## Route Notes

Useful route groups in `app/createServer.js`:

- auth pages and login/logout
- full page render for `/`
- fragment routes for nav, notes, editor, preview
- mobile fragment routes for folders, notes, search, mobile note creation
- resource upload and resource serving
- settings save endpoints
- history endpoints

If a UI action appears broken, check:
1. Which endpoint it hits
2. Which htmx target it swaps
3. Which client event handler expects to run after swap/request
4. Whether the response includes headers or OOB fragments the client depends on

## Coding Guidance

- Keep changes minimal
- Preserve sidecar/frontend boundary
- `public/app.js` is DOM-contract fragile; validate escaping-heavy changes and stable IDs carefully
- The code modal lives in `loggedInLayout`, not inside `navigationFragment` or `editorFragment`, so it survives htmx OOB swaps
- Be careful with checkbox text handling, `\n`, regex escaping, and DOM-to-markdown round trips
- Keep standalone repo paths/docs/scripts correct; avoid reintroducing monorepo assumptions
- Prefer changing existing inline helpers over introducing a new abstraction unless there is clear reuse
- When fixing mobile behavior, verify desktop is unchanged
- When fixing desktop editor behavior, verify mobile still works because both use the same editor fragment
- Be cautious with `htmx:afterRequest` assumptions; in htmx 2.x, response headers are often more reliable than old event-property assumptions
- If changing vault behavior, verify desktop + mobile, locked + unlocked, existing note + newly-created note, and refresh/restart behavior

## Debugging Guidance

### If a code change does not appear in the app

- Rebuild with `./scripts/rebuild-dev.sh`
- Do not rely on `docker compose ... restart joplock` after source edits
- If still stale, inspect the built container logs and confirm the right compose stack is running

### If mobile note creation/opening misbehaves

- Check whether the server response includes the expected mobile header such as `X-Mobile-Note-Id`
- Check the `htmx:afterRequest` handler that consumes that header
- Compare new-note path vs existing-note path
- Check whether the note is in a vault and whether the editor was initialized in locked vs unlocked state

### If vault behavior misbehaves

- Check whether the folder is marked with `isVault`
- Check whether the note is marked with `inVault` / `isEncrypted` / `vaultId`
- Check `toggleVaultLock()`, `unlockNote()`, `_completeUnlock()`, and `flushSave()` in `public/app.js`
- Check whether the hidden editor shells still exist in locked editor HTML

### If startup/resume behavior is wrong

- Check the `/` render path in `app/createServer.js`
- Check `resumeLastNote`, `lastNoteId`, and `lastNoteFolderId`
- Refresh/restart must not reopen encrypted notes or notes inside vault notebooks

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

## Verification

- Run tests: `npm test`
- Build image: `npm run docker:build`
- Sidecar-only compose: `npm run docker:up`
- Full example compose: `npm run docker:up:full`

### Playwright credentials

- Tests NEVER hardcode credentials. `playwright-tests/helpers.js` resolves the admin account from the environment in this order: `PLAYWRIGHT_ADMIN_EMAIL` → `PLAYWRIGHT_EMAIL` → `JOPLOCK_ADMIN_EMAIL` (and the `*_PASSWORD` equivalents). The dev container sets `JOPLOCK_ADMIN_*`, so the useful tests work against it out of the box.
- `login()` calls `requireCredentials()` and fails loudly if none are set. Admin-only specs (`resource-lifecycle`, `auth-rate-limit`) use `hasAdminCredentials()` to `test.skip` when unset. `helpers.js` exports `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`hasAdminCredentials` so specs share one source of truth.

## Development Stack

Use the dev compose stack for all development work. It includes Postgres, Joplin Server, and Joplock together.

- Rebuild Joplock app container after code changes: `./scripts/rebuild-dev.sh`
- Start / restart full dev stack: `docker compose -f docker-compose.dev.yml up -d --build`
- Stop dev stack: `docker compose -f docker-compose.dev.yml down`

Do not use the sidecar-only `docker-compose.yml` for development.

Important:
- `docker compose ... restart joplock` is not enough after source edits because the Docker image copies `app/`, `public/`, and `server.js` at build time.
- For app code changes, use `./scripts/rebuild-dev.sh` from now on.

Recommended inner loop:

1. Edit source
2. Rebuild with `./scripts/rebuild-dev.sh`
3. Refresh the app
4. Check `docker compose -f docker-compose.dev.yml logs --tail=... joplock` if something looks wrong

## Reference Material

- Mobile UX reference: `~/dev/joplin/packages/app-mobile/`
- Use it for interaction ideas and behavior parity targets, not as a copy-paste implementation source
- Joplock must still fit the SSR + htmx sidecar architecture

## Current Baseline

- standalone repo at `abort-retry-ignore/joplock`
- tests passing in standalone repo
- Docker build passing in standalone repo
- full example compose verified with alternate free host ports
- CI: GitHub Actions builds and pushes image to `ghcr.io` on every push to `master`

## Recently Completed Work

- **Lazy nav loading**: folder note lists load on first expand, not on page load
- **Search pagination**: `pg_trgm` GIN index, paginated search results with Load More
- **Mobile pagination**: paginated note lists on mobile
- **Note flash fix**: eliminated redundant `/fragments/preview` fetch on note load
- **Search input fix**: value captured at `htmx:beforeSwap` so characters typed during in-flight request are not lost
- **Mobile spinner**: inline spinner in editor screen body instead of broken fixed overlay
- **Tablet-on-phone fix**: CSS/JS breakpoint raised from 481px to 600px
- **Gzip compression**: all HTML responses compressed via Node `zlib` when client sends `Accept-Encoding: gzip`
- **hx-* sanitization**: `renderMarkdown()` strips `hx-*` attributes from user HTML to prevent htmx injection
- **All Notes fix**: `/fragments/folder-notes` now normalizes `__all_notes__` → `__all__` so the virtual folder loads correctly
- **Service worker cache bump**: `v12` forces PWA to fetch fresh CSS/JS after update
- **Checkbox styling**: checked items show accent-colored bold icon via `.md-cb-icon` span; icon is styled independently from text using flexbox layout; turndown serializer, click-toggle handler, and new-checkbox inserter all updated to match
- **Multi-image uploads**: picker uploads now support multiple files, update markdown as the source of truth, preserve upload order in rendered mode, and refresh preview from markdown after each batch
- **CM6 markdown mode restored**: finished the TinyMCE migration. Markdown mode is CodeMirror 6 again (`#cm-host` + `initCM`/`getCM`/`cmSyncToTA`/`cmSetVal`/`mountMarkdownEditor`); `codemirror.min.js` reloaded before `app.js` (also fixes the code-block modal). Fixes the markdown-mode full-height bug (CM6 fills via CSS flex chain, no textarea fallback height gaps). Rendered mode (TinyMCE) inline uploads finished: clipboard paste (images via `paste_data_images`, non-image files via `editor.on('paste')`), `file_picker_callback` for the Image dialog. New tests in `tests/cm6MarkdownMode.test.js` (incl. loading the CM bundle and asserting `window.CM` exports).
- **Upload size limit + drag-into-note + auto-dismiss**: admin `maxUploadMb` setting (default 200, Joplin's hard ceiling) with a fast server-side 413 `Content-Length` pre-check and client-side guards on every upload path; direct drag-into-note (TinyMCE `editor.on('drop')` prevents base64 inlining; CM6 `contentDOM` drop inserts a markdown ref via `_uploadFileToCM()`); upload modal auto-dismisses on full success.
- **Runtime-toggleable debug logging**: tri-state `debugLogging` admin setting overrides env `DEBUG` live (no restart) via `effectiveDebug`/`refreshDebugLogging()`/`isDebug()` in `createServer.js`.
- **Settings-page Esc dismiss**: moved to `<body onkeydown>` (HTML attribute, survives script errors) with a brief background flash for confirmation.
- **Text-expander wired into TinyMCE**: `maybeExpandTextFromTinyMCE()`/`replaceTinyMCETextExpansion()` on `editor.on('keyup')` for text triggers in rendered mode.
- **AI prose completion wired into TinyMCE**: rendered-mode AI works for both the Ctrl/Cmd-Space shortcut (`editor.on('keydown')`) and AI-action Expander triggers. The completion is offered in the same accept/dismiss `note-autocomplete-popup` as markdown mode (kind `'tinymce-prose'`: Enter/Tab inserts, Esc discards); `handleRenderPopupKey()` is shared so iframe keydowns can drive it. `getTextBeforeCaretTinyMCE()` builds the prompt, `requestTinyMCEProseCompletion()` calls the provider + shows the popup, `insertProseCompletionTinyMCE()` inserts on accept as DOM text nodes (no HTML injection) then syncs to `#note-body`. Tests: `tests/expanderRuntime.test.js`; live E2E `playwright-tests/ai-rendered.spec.js`.
- **Dangling resource cleanup (dev DB)**: stripped 2 orphan `<img src=":/…">` tags left over from a mid-migration state where uploads weren't persisted, and removed the matching orphan `item_resources` rows. Zero dangling `:/id` refs remain.

## Key Conventions

- `plans/` is gitignored — do not commit plan files
- Do not push to remote unless the user explicitly asks
- Run `npm test` before every commit
