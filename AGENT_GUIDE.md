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
- **Code blocks**: Full-screen code modal with a CM6 editor and language picker. Highlighting differs by mode: preview/markdown modes use highlight.js (`hljs`); rendered mode (TinyMCE) uses the native `codesample` plugin (PrismJS `.token` spans). Rendered mode points TinyMCE's codesample plugin at full `window.Prism` bundle (`public/prism.min.js`) so every language offered by modal has grammar support. Prism token colors are injected into the TinyMCE iframe via `content_style` in `_tinyMCEContentFontStyle()` (the oxide dark content skin ships no `.token` CSS). `codemirror.min.js` and `prism.min.js` are loaded on page before TinyMCE/app.js.
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

## Sharing Ownership Model

- One authoritative tree owned by sharer (`owner_id` never transferred).
- Recipients gain access via Joplin `user_items` + accepted `share_users` (auto-accept on invite).
- `share_users.can_write` controls whether recipients can edit shared notes (default `1` — editable). Only the owner can move, delete, or stop-share.
- Move into a shared notebook sets `share_id`; move out clears it and drops recipient access to that item.
- Revoke/stop sharing removes recipient access; owner keeps folders/notes in place.
- Recipients can leave a shared notebook via the share dialog ("Leave notebook" button) → removes their `share_users` row + `user_items` entries.
- Only the share owner sees invite/remove/stop controls in the share dialog. Recipients see only their own access status and the Leave button.

### Shared-note guard layers

- **Route layer** (`app/routes/fragments.js`, `app/routes/api.js`): `resolveItemShareAccess` → `assertCanWrite`/`assertOwnerForDestructive` on create/update/delete/restore/move. `canWrite` respects `share_users.can_write` for recipients. Owner-only for move/delete regardless of `can_write`. Recipient creates in shared folder blocked with 403.
- **Proxy layer** (`app/proxy/shareProxyGuard.js`): inspects PUT and DELETE sync-proxy requests. PUT checks `resolveItemShareAccess` → `canWrite`. DELETE is owner-only. Inherits `noteIdFromItemPath`/`bufferRequest` from vault proxy guard.
- **Editor UI** (`app/templates/fragments.js`, `public/app.js`): `editorFragment` accepts `canWrite` param from route handler (queries `share_users.can_write`). When `canWrite=false` renders read-only banner, disables folder select, hides delete button, sets `contenteditable="false"` on title. When `canWrite=true` the editor is fully interactive.
- **Share-id propagation** (`app/items/shareAccess.js`): `deriveShareFieldsForMove` sets/clears `shareId`/`isShared` on move. `ensureShareIdsOnNotebook` writes `share_id` directly to items DB content JSON. `createNote`/`updateNote` serialize these fields into Joplin note metadata.
- **Share dialog API** (`app/routes/shares.js`): uses Joplin Server's `/api/shares/:id/users` endpoints (not deprecated `/api/share_users`). PATCH/ACCEPT/REJECT/DELETE operations use DB-only writes since Joplin Server's newer API doesn't support mutations on individual share_users. `can_write` column managed via direct `share_users` table updates.

### File map

| Layer | File |
|-------|------|
| Access helpers | `app/items/shareAccess.js` |
| Share API routes | `app/routes/shares.js` |
| Proxy write guard | `app/proxy/shareProxyGuard.js` |
| Fragment write gates | `app/routes/fragments.js` |
| API write gates | `app/routes/api.js` |
| Share dialog template | `app/templates/shares.js` |
| Share dialog client | `public/app.js` (openShareDialog, inviteToShare, toggleShareWrite, leaveShareNotebook, etc.) |
| Read-only editor | `app/templates/fragments.js` (editorFragment) |
| Unit tests | `tests/shareAccess.test.js`, `tests/shareProxyGuard.test.js`, `tests/shareWriteGuards.test.js` |
| Playwright tests | `playwright-tests/share-modal.spec.js`, `playwright-tests/share-access.spec.js`, `playwright-tests/share-revoke-move.spec.js` |

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

### Encrypted-save identity guard (do not remove)

Encrypted-note autosave is debounced 2s. A hard-won bug was that the timer callback captured the outgoing note's `form`/`noteId`/`vaultId`, but read plaintext from the live DOM (`getTA()`). If the user switched notes during the debounce, plaintext of note B was encrypted with note A's vault key and PUT to note A's URL, silently overwriting A's ciphertext with an encryption of B's body. On next unlock, note A "decrypted" to note B's plaintext.

Client (`public/app.js`) rules:

- The encrypted `scheduleSave` override and `buildFlushRequest` MUST read `ta` from the captured form (`form.querySelector('textarea[name="body"], textarea.editor-body')`), never from `getTA()`.
- Every encrypted-save path calls `_encryptedSaveIdentityOk(form, expectedNoteId, expectedVaultId)` before hashing, before encrypting, after every `await`, and inside `_triggerEncryptedSave`. Identity checks compare captured `noteId`/`vaultId` against `_formNoteId(form)`, `form.dataset.vaultId`, `form.dataset.encrypted`, `form.isConnected`, `activeEditorForm()`, and `_activeEditorNoteId()`. Abort with a log line if any mismatch.
- `encryptForVault(plaintext, vaultId, key, salt, noteId)` embeds `noteId` in the ciphertext blob. Every call passes it.
- `htmx:beforeSwap` for `#editor-panel` / `#mobile-editor-body` cancels `_saveTimer` and `_saveTitleTimer` so stale timers can't fire against a fresh note (defence-in-depth alongside the identity guard).

Server (`app/routes/_helpers.js`) rules:

- `assertVaultNoteBodyEncrypted(vaultService, userId, existingParentId, targetParentId, body, noteId, opts)` parses the ciphertext blob and rejects the write when `meta.vault` mismatches the target folder's vault, or `meta.noteId` (if present) mismatches the target note.
- **Vault boundary enforcement** (three layers):
  1. **ParentId immutability / no conflict copies**: if a note currently lives in a vault folder, the server rejects any PUT that changes its `parentId` (400: `Vault notes cannot be moved to a different folder`). Vault notes cannot change folder — the folder select is disabled client-side and the server enforces this on every write path. Conflict `createCopy` is also rejected for vault notes: ciphertext is bound to source note id, while copying unlocked DOM content would make a plaintext duplicate.
  2. **Ciphertext required inside vaults**: saving to a vault folder always requires an encrypted body. Same-folder saves and sync-proxy writes are both covered. `enforceExistingVault=true` (sync-proxy only) extends this to prevent external Joplin clients from stripping ciphertext by re-parenting.
  3. **Metadata integrity**: encrypted blobs carry `vault` (folder id) and `noteId` (bound target); both are validated against the destination to prevent cross-vault or cross-note ciphertext smuggling.
- **Client-side**: the folder select (`#editor-folder-select`) is rendered `disabled` for vault-protected notes and stays disabled after unlock — vault notes cannot change parent folder through the UI. The only reachable folder-change path is plain→vault (encrypt on move).
- Every note-write path passes the target `noteId`: `app/routes/api.js` (PUT), `app/routes/fragments.js` (autosave PUT), `app/routes/history.js` (restore), `app/proxy/vaultProxyGuard.js` (sync proxy).
- Legacy blobs without `noteId` still pass (backwards compatible); new writes are note-id-bound.

Tests must not regress this: an encrypted note's ciphertext blob's `noteId` field must equal the note id it is stored under; a write with a mismatched blob must be rejected with 400 (or 403 via the proxy guard).

### Plaintext save identity guard (do not remove)

Plaintext (non-encrypted) autosave has its own cross-note contamination race, fixed after a user report of "note B's body replaced by note A's content". Root cause: the persistent TinyMCE singleton is shared by all rich-mode notes, and several async `/fragments/preview` fetches wrote their result into it with no check that the active note was still the one the fetch was started for. A late preview response for note A landed while note B's form was active; the next TinyMCE→textarea sync copied A's markdown into B's `#note-body`, and the 2s autosave PUT it to `/fragments/editor/B`.

Client (`public/app.js`) rules:

- **Provenance stamps**: `_displayedNoteId` (note whose content the user last saw) and `_tinymceContentNoteId` (note whose rendered HTML TinyMCE last loaded) are stamped by `initEditorPanel` and `_setTinyMCEContent(html, noteId)`; `htmx:beforeSwap` for the editor containers clears both. Empty stamps are permissive (defence-in-depth only), non-empty mismatching stamps are hard blocks.
- **Guard**: `_plaintextSaveIdentityOk(form)` must pass before any plaintext body PUT: form connected, `hx-put` note id === `data-note-id` === `_displayedNoteId`, form is `activeEditorForm()`, and — in rich mode with the TinyMCE host visible — `_tinymceContentNoteId` matches too. It is enforced in `scheduleSave`, `scheduleSaveTitle`, `buildFlushRequest`, and an `htmx:configRequest` choke point that blocks *any* `hx-put=/fragments/editor/…` request (manual, conflict-button, or `joplock:save`-triggered) fired from a non-active form. The choke point skips `dataset.encrypted==='1'` forms (those are covered by the encrypted guard above).
- **Async fetch discipline**: every `/fragments/preview` fetch that writes into the shared editor (`setEditorMode('rich')`, `refreshTinyMCEForActiveNote`) captures the note id before the request and discards the response if the note, mode, or active form changed mid-flight. `tinyMCESyncToTA` and `_lazyTinyMCESyncBeforeSave` refuse to copy TinyMCE content into a textarea whose note doesn't match `_tinymceContentNoteId`.
- **Other guarded paths**: `_completeUnlock` aborts if the unlocked note is no longer the active note; late `htmx:afterRequest` save responses from detached/replaced forms don't stamp `snapshotHash` (would mark a switched-to note as "Saved" while dropping its pending edits); `flushSave` success only updates save state when the flushed form is still active.
- **flushSave baseUpdatedTime sync (do not remove)**: `flushSave` saves via a raw `fetch()` whose OOB-carrying response body is discarded — unlike the htmx autosave path, nothing would refresh the form's hidden `baseUpdatedTime`. A flush save advances the server clock while the form keeps the old base, so the NEXT autosave PUT trips the server conflict guard and the user sees "A newer version of this note exists on the server" after merely switching tabs/views (visibilitychange → flushSave). Fix: the editor PUT sets an `X-Note-Updated-Time` response header (mirror of the `#editor-sync-state` OOB), and flushSave reads it to refresh the form's `baseUpdatedTime`. flushSave also detects the `X-Note-Conflict` header and surfaces the conflict fragment + banner instead of wrongly marking the editor "Saved".
- **Mobile shell conflict participation (do not remove)**: `mobileEditorFragment` re-adds `#editor-sync-state` (with `baseUpdatedTime`) after the titlebar-stripping transform. Without it, mobile saves carry no base → the server skips the conflict check (silent last-write-wins) and `checkNoteFreshness` early-returns (base 0) → the desktop↔mobile switch never detects concurrent changes.
- **Shell-scoped banner**: both shells render `#remote-update-bar` with duplicate ids; `showRemoteUpdateBanner`/`dismissRemoteUpdateBanner` resolve the bar via `queryActiveEditor('#remote-update-bar')` first — `getElementById` alone returns the desktop shell's bar, which is `display:none` in the mobile shell (banner invisible exactly when mobile users need it).

Tests: `tests/saveIdentityGuard.test.js` locks the guard wiring, the flushSave header handling, and the shell-scoped banner; `tests/createServer.test.js` asserts the `X-Note-Updated-Time` header; `tests/templates.test.js` asserts the mobile sync-state; `tests/tinymceOnEditSync.test.js` has a provenance test for the sync refusal.

### Note-history restore

- `POST /fragments/history/:noteId/restore/:snapshotId` returns `editorFragment` **inline** (target = `#editor-panel` / `#mobile-editor-body`) with `#autosave-status` and `#nav-panel` as OOB swaps. Do not go back to swapping only `#autosave-status` with an OOB editor-panel — the editor-swap lifecycle (`htmx:afterSwap` destroy CM6, `htmx:afterSettle` reinit) only runs when the request target is the editor container, and without it the restored body doesn't appear until a page refresh.
- The client `restoreHistorySnapshot()` cancels `_saveTimer` / `_saveTitleTimer` and clears `_savedHash` before firing the request so a stale autosave from pre-restore edits can't overwrite the restored body.

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
- `public/prism.min.js` — Prism bundle for rendered-mode TinyMCE code-block highlighting (built from `prism-build/`)
- `public/styles.css`
- `public/service-worker.js`
- `public/manifest.webmanifest`

### Bundle Build Sources
- `cm-build/` — CM6 bundle source → `public/codemirror.min.js`. Build from repo root with `npm run build:cm` (or `cd cm-build && npm install && npm run build`).
- `hljs-build/` — highlight.js bundle source → `public/hljs.min.js`. Build with `npm run build:hljs` (or `cd hljs-build && npm install && npm run build`).
- `prism-build/` — Prism bundle source → `public/prism.min.js`. Build with `npm run build:prism` (or `cd prism-build && npm install && npm run build`).

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
- **Dropped/pasted attachments (image AND document) are padded with a blank line before and after** so a single attachment stays easy to delete even when several are stacked. This padding is *only* about spacing around the inserted resource — it does not change how surrounding typed text is handled.
  - Markdown mode (CM6): `_uploadFileToCM()` inserts `<pad>` + ref + `\n\n`, where `<pad>` is `''` at the very start of the doc, `\n` if the char before the cursor is already a newline, else `\n\n`. Both images and documents get this. (Plain source blank line; no `md-blank-line` marker needed because the user edits raw text here.)
  - Rendered mode (TinyMCE): `_tinyMCEBlockAttachmentHtml(editor,inner)` wraps the image/link in its own `<p>` and adds a `<p class="md-blank-line"><br></p>` (the renderer's canonical deletable blank line — see `injectBlankLineBlocks`) before and after, for both images and documents. **Smart**: it skips the leading and/or trailing marker when the caret block is already empty or already adjacent to an existing blank-line paragraph (via `editor.selection.getNode()`), falling back to adding both when the selection API is unavailable (unit tests).
  - Round-trip safety (rendered mode): `md-blank-line` paragraphs are pre-normalized in `tinymceToMarkdown()` and matched by the `blankLine`/`emptyP` Turndown rules → `\x00BL\x00` sentinel → `\n\n\n` (one extra newline = one blank line that re-renders as an `md-blank-line` `<p>`). Do NOT switch these separators to bare `<div><br></div>` or plain empty `<p></p>` — those get merged/dropped around block-level images and swallow the spacing after a few round-trips.
  - `_buildMarkdownInsert()` (used by the upload-modal picker's textarea/CM targets) is unchanged — it still adds a single `\n` on each side as needed. It is deliberately NOT part of the blank-line padding change.
  - Coverage: `tests/cm6MarkdownMode.test.js` (CM padding for image + document; TinyMCE `_tinyMCEBlockAttachmentHtml` markers + smart skip), `tests/previewRoundTrip.test.js` (blank line between stacked image/image, image/doc, doc/image survives render⇄markdown), `tests/appRuntime.test.js` (mode-switch round-trip, no mangling).
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
- **Blank-line markers between blocks are `<p class="md-blank-line"><br></p>`, NOT bare `<div><br></div>`.** `injectBlankLineBlocks()` (`app/markdownRenderer.js`) emits extra blank lines as empty paragraphs because TinyMCE's schema preserves empty `<p>` natively; a bare `<div><br></div>` got normalised/merged/dropped around block-level images, which swallowed spacing between images after a few markdown⇄render round-trips. The Turndown `blankLine` rule (`public/app.js`, and the preview-path copy in `tests/previewRoundTrip.test.js`) matches `P|DIV.md-blank-line`; in `getTurndown()` both `blankLine` and `emptyP` emit the same `\x00BL\x00` sentinel so precedence is moot. **Two TinyMCE quirks made image spacing collapse anyway (both fixed):** (1) **TinyMCE strips the `<br>`** from the marker on `setContent`, leaving an empty `<p class="md-blank-line"></p>` that Turndown drops — so `tinymceToMarkdown()` pre-normalises a **blank** `md-blank-line` paragraph (empty, whitespace/`&nbsp;`-only, or just `<br>`) to the `❤BR❤` sentinel shape before Turndown. **This normalisation MUST stay conditional.** A marker is a real, focusable paragraph in the iframe, so clicking the gap between two blocks puts the caret inside it and typing puts the new text there; rewriting markers unconditionally (the old "empty or not" behaviour) replaced that text with the sentinel and **silently destroyed it** — type a line after a checklist, leave the note, come back, gone. When a marker holds real content, leave the paragraph verbatim: with text present neither the `blankLine` nor the `emptyP` rule matches, so it converts as an ordinary paragraph. Coverage: `tests/appRuntime.test.js` "keeps text typed INTO a blank-line marker (data-loss regression)" + "still collapses a genuinely blank blank-line marker". (2) **Sized/raw-HTML images** (Turndown emits `<img … width=… />` for resized images) are markdown-it *HTML blocks* rendered OUTSIDE any `<p>`; a loose block `<img>` next to markers gets absorbed into an adjacent paragraph by TinyMCE, so `postProcess()` wraps any line that is a lone `<img>` in its own `<p>`. Regression coverage: `tests/appRuntime.test.js` "image spacing …", "sized … survive 6 mode switches", "br-stripped … marker".
- The code modal is outside the fragment-swapped editor so it survives swaps; it uses CM6 (`_initCodeModalCM`) which requires `window.CM` (now loaded).
- Both markdown mode (CM6) AND rendered mode (TinyMCE) open this same custom full-screen CM6 code modal (`openCodeModal`/`submitCode`) for *editing* the code text/language, NOT TinyMCE's built-in `codesample` dialog. The toolbar uses a custom `jop_code` button; clicking an existing `<pre>` in rendered mode routes through `tinyMCEInsertCodeBlock()` → `openCodeModal()`. On submit in rendered mode, `submitCode()` (TinyMCE branch, `_codeTinyMCE`/`_codeTinyMCEBookmark`) inserts `<pre class="language-x">code</pre>` via `ed.insertContent()` — the `codesample` plugin's `SetContent` handler then highlights it with Prism. Do NOT reintroduce hljs highlighting of rendered-mode blocks (`highlightTinyMCECodeBlocks` was removed); Prism owns rendered-mode coloring. Do not reintroduce `ed.execCommand('mceCodeSample')` (that opens the built-in dialog).
- On htmx editor-panel swap, `_cmView` is destroyed in `htmx:afterSwap` and re-mounted by `initEditorPanel()` (via `mountMarkdownEditor`) on `htmx:afterSettle` when the note opens in markdown mode. Keep that destroy/remount ordering intact.
- `#tinymce-host` is `position:fixed` and repositioned via `positionTinyMCEHost()`; if it looks detached, check that function and the `#tinymce-slot` rect, not CSS alone.
- **Turndown expels "flanking" whitespace, and it gets that wrong next to atomic children.** `flankingWhitespace()` derives an element's edge whitespace from `node.textContent`, which skips `<img>`/`<br>` (they contribute no text). For `<a><img/>&nbsp;Label</a>` it reports *leading* whitespace even though the whitespace is interior to the produced markdown (`![alt](:/id) Label`), so `replacementForNode()`'s `content.trim()` cannot remove it — yet it is still prepended. The space was therefore **duplicated on every round-trip and grew one character per note open**, corrupting the stored body. `tinymceToMarkdown()` hides such whitespace behind a sentinel (`_protectInlineLeadingSpace` → `_restoreProtectedSpace`) that **encodes the character code**: these runs are frequently NBSP, and restoring a generic `' '` would itself change the body and keep the note permanently dirty. Do not "simplify" that sentinel back to a plain space, and do not narrow its character class to `[ \t]` — Turndown's `edgeWhitespace` uses `\s`, which matches NBSP.
- **Soft breaks inside a blockquote must re-apply the `>` prefix.** `> b\n> c` is ONE quoted paragraph with a soft break, so the renderer emits `<blockquote><p>b<br>c</p></blockquote>`. The `❤BR❤` sentinel is restored to `\n` *after* Turndown has prefixed the lines it emitted, so a naive global `split/join` produced `> b\nc` — the second line escaping the blockquote entirely (real content corruption plus a permanent dirty-on-open diff). The restore is line-aware and carries the leading `>` run across the break; keep it that way. Bare `> ` lines also get their insignificant trailing space stripped.

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

### `/ask` Slash Command

- A line starting with `/ask <question>` (must be at column 0, non-empty question after the space/tab) fires a direct Q&A request when Enter is pressed with the caret at the end of that line. Works in both CM6 and TinyMCE.
- Detection: `detectAskCommand(lineText)` in `public/app.js`. Trigger wiring: the `Enter` binding in the CM6 `keymap.of([...])` inside `initCM()`, and an `e.key==='Enter'` check at the top of the TinyMCE `editor.on('keydown', ...)` handler (same handler that wires `Ctrl/Cmd-Space`).
- Flow: `/ask …` line/block is replaced with a `⏳ Asking…` placeholder immediately, `requestAskCompletion(question, context, profileId)` calls `POST /api/web/ai/ask`, and the placeholder is swapped for the answer (`handleAskInCM`/`handleAskInTinyMCE`). Empty/failed responses restore the original `/ask …` text. There is no accept/dismiss popup for `/ask` — Ctrl+Z is the reject path.
- **TinyMCE soft-line detection**: TinyMCE runs with `newline_behavior:'linebreak'`, so pressing Enter inside a paragraph inserts `<br>` rather than starting a new `<p>`. The `/ask` handler therefore looks for the "soft line" between the last `<br>` (or block start) and the caret — not the whole block's text. Firefox `Range.toString()` does NOT emit `\n` for `<br>` (Chromium/WebKit do), so the handler walks the DOM manually collecting text and resetting on each `<br>`. Answer replacement is limited to that soft-line range (`isSoftLine` branch in `handleAskInTinyMCE`) so earlier soft-lines in the same `<p>` are preserved.
- Identity guard: both handlers capture `activeEditorForm()` + `_formNoteId(form)` before firing the request and re-check them (plus placeholder presence) before writing the answer, so a note switch during the request drops the result instead of writing into the wrong note.
- Disabled entirely inside vault/encrypted notes via `askDisabledForActiveNote()` (checks `form.dataset.encrypted` / `form.dataset.vaultId`) — plaintext context must never be sent to a third-party AI provider from an encrypted note. When the user types `/ask …` and hits Enter in a vault note, `_notifyAskDisabledInVault()` shows a one-shot per-note alert explaining the reason (previously Enter silently fell through to a newline, which looked like a bug).
- Server endpoint `POST /api/web/ai/ask` (`app/routes/api.js`, next to `/api/web/ai/prose-complete`) uses a direct-answer system prompt (not the continuation/style-inference prompt used by prose autocomplete), caps `context` at 4000 chars, and uses `max_tokens: 512`. Shares `getActiveProfileFromSettings`/profile resolution with prose autocomplete; no new settings.
- Coverage: `tests/askCommand.test.js` (client detection + CM6 handler flow), `tests/createServer.test.js` (endpoint request/response, profile selection, error forwarding).



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

### Adding or editing a theme

Themes are CSS-only. Each theme is a class on `<body>` that sets a shared set of CSS custom properties.

**Files to touch:**

1. **`public/styles.css`** — Add/edit a `.theme-<slug>` block that defines the same set of custom properties used by every other theme.
   - Minimum properties that must be defined: `--bg`, `--theme-color`, `--bg-side`, `--bg-list`, `--bg-editor`, `--bg-hover`, `--bg-active`, `--text`, `--text-dim`, `--text-muted`, `--text-heading`, `--accent`, `--border`, `--border-focus`, `--danger`, `--toolbar-bg`, `--scrollbar`, `--statusbar-bg`, and `color-scheme` (`light` or `dark`).
   - Keep numbers and hover/active states neutral unless the theme intentionally uses color.
   - The markdown toolbar and the TinyMCE toolbar both share `color-mix(in srgb, var(--accent) 10%, var(--bg))`. Setting a sensible `--accent` and `--bg` is enough; no extra toolbar work needed.

2. **`app/settingsService.js`** — Add the theme slug to the `validThemes` array at the top of the file.

3. **`app/templates/shared.js`** — Add `[<slug>, <displayName>]` to `themeOptions` so it appears in the status bar picker and the settings page.

4. **`tests/settingsService.test.js`** — Add an assertion that `normalizeSettings({ theme: '<slug>' }).theme` is preserved and not normalized back to the default.

5. **`public/service-worker.js`** — Bump `CACHE_NAME` (e.g., `joplock-shell-vN-...`) whenever theme CSS changes. The PWA can cache old `styles.css` aggressively, and the cache-name change forces browsers to fetch the new stylesheet.

6. Rebuild with `./scripts/rebuild-dev.sh`.

No changes are needed in `pages.js`, `app.js`, or `settings.js`: those all read `themeOptions` or apply `theme-${settings.theme}` dynamically.

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
- a blank line after an ATX heading is collapsed by `_applyHeadingSpacing()`
- encrypted/vault note wrappers strip HTML comments — irrelevant in practice, since locked notes never load plaintext into TinyMCE

## Verification

- Run tests: `npm test`
- Build image: `npm run docker:build`
- Sidecar-only compose: `npm run docker:up`
- Full example compose: `npm run docker:up:full`

### Playwright credentials

- Tests NEVER hardcode credentials. `playwright-tests/helpers.js` resolves the admin account from the environment in this order: `PLAYWRIGHT_ADMIN_EMAIL` → `PLAYWRIGHT_EMAIL` → `JOPLOCK_ADMIN_EMAIL` (and the `*_PASSWORD` equivalents). The dev container sets `JOPLOCK_ADMIN_*`, so the useful tests work against it out of the box.
- `login()` calls `requireCredentials()` and fails loudly if none are set. Admin-only specs (`resource-lifecycle`, `auth-rate-limit`) use `hasAdminCredentials()` to `test.skip` when unset. `helpers.js` exports `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`hasAdminCredentials` so specs share one source of truth.

### Playwright data cleanup (do not leave notes/notebooks/resources behind)

- **Tests must not leave data in the shared Joplin DB.** Every spec that creates notebooks/notes/resources must clean them up.
- Use `teardownTestData(page, { folders, folderPrefixes, titlePrefixes, noteIds })` from `helpers.js` in a `finally` block. It permanently removes the matching notes (trash + purge via `DELETE /fragments/notes/:id` twice), deletes the folders, empties trash, and cleans orphaned resources. It is best-effort (never throws), so it is safe in `finally` even after a failed assertion.
  - Prefer `{ folders: [folder] }` — purges every note inside the notebook *then* deletes the notebook. (Plain `deleteNotebook()` is NOT enough on its own: the app moves a deleted notebook's notes to **General** rather than removing them, so they leak.)
  - For notes created outside a dedicated notebook (e.g. mobile "New note" in **All Notes**), capture the id with `getActiveNoteId(page)` and pass `{ noteIds: [id] }`.
- A suite-wide safety net runs automatically: `playwright.config.js` `globalTeardown` (`playwright-tests/global-teardown.js`) logs in once after the whole run and purges any leftover test-prefixed folders/notes + orphaned resources (folder name prefixes like `pw-`, `dnd-`, `esc-`, `search-`, `upload-`, `res-lifecycle-`, and known test note-title prefixes). Keep those prefix lists in sync when you add new test naming.
- Cleanup relies on `GET /api/web/notes/headers` returning `parentId` (added for this), `DELETE /api/web/folders/:id`, `DELETE /fragments/notes/:id` (trash then purge), `POST /fragments/trash/empty`, and `POST /admin/orphaned-resources/cleanup`.
- Verify a change doesn't leak by running a data-creating spec twice and confirming the DB item counts are identical before/after (they must be stable, i.e. zero accumulation).

### Playwright screenshots

- Screenshots are captured on every test run (pass or fail) under `test-results/`, named `{testTitle}-{project}-{browser}-{retry}.png`. Configured via `use.screenshot: 'on'` in `playwright.config.js`.
- Videos are still `retain-on-failure`, traces `on-first-retry`, and `test-results/` is already git-ignored.

### Playwright share tests

Share tests require the admin account and two browser contexts (owner + recipient). The shared reader user is created automatically by `ensureShareTestUsers()` via the admin API.

```
# All share tests (requires live dev stack)
npx playwright test playwright-tests/share-*.spec.js --project=desktop

# Individual specs
npx playwright test playwright-tests/share-modal.spec.js --project=desktop
npx playwright test playwright-tests/share-access.spec.js --project=desktop
npx playwright test playwright-tests/share-revoke-move.spec.js --project=desktop
```

Env vars (same credential chain as other Playwright tests via `JOPLOCK_ADMIN_*`):
```
JOPLOCK_ADMIN_EMAIL="admin@example.com" JOPLOCK_ADMIN_PASSWORD="..." npx playwright test ...
```

Multi-user fixtures use `test.extend` with per-test `ownerPage`/`readerPage` (separate browser pages). All tests are `desktop`-only and skip on mobile (right-click context menu). Dialogs are auto-accepted by `acceptDialogs()` in `beforeEach`.

Test data uses `slug('share-...')` prefixes and is cleaned via `teardownTestData` per test. The global teardown also purges `share-*` prefixed folders (add `'share-'` to the prefix list in `global-teardown.js` if missing).


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

- **Vault simplification — notes cannot leave vaults or create conflict copies**: removed `confirmMoveOutOfVault` mechanism. Vault notes now have immutable `parentId` — the server rejects any PUT that changes a vault note's folder. The folder select is `disabled` for vault notes and stays disabled after unlock. The folder-change handler reduces to a single branch: plain→vault (encrypt on move). Conflict copies of vault notes are blocked entirely because ciphertext is note-id-bound. All vault→plain and vault→vault move paths are removed (previously guarded by confirm dialogs and the now-deleted `confirmMoveOutOfVault` flag).
- **Vault chrome refresh on folder change**: `_syncEditorVaultChrome(noteId, inVault, unlocked)` in `public/app.js` injects/removes the lock-toggle button in `.editor-titlebar` when moving into/out of a vault. Called from `_doEncryptNoteInVault` (plain → vault).
- **/ask user-visible reason in vault notes**: typing `/ask …` and pressing Enter in a vault note previously fell through silently to a newline, which looked broken. Now `_notifyAskDisabledInVault()` fires a one-shot alert per note explaining that `/ask` is disabled to protect vault plaintext from third-party AI providers. Guard logic (`askDisabledForActiveNote()`) unchanged; only the UX around the "disabled" case changed.

- **Plaintext save identity guard (cross-note contamination)**: fixed the reported "note B's body replaced by note A's content" bug. Unguarded async `/fragments/preview` fetches (`setEditorMode('rich')`, `refreshTinyMCEForActiveNote`) could land after a note switch and load note A's rendered HTML into the persistent TinyMCE over note B's form; the next TinyMCE→textarea sync + 2s autosave PUT A's content to note B's URL. Fix: `_displayedNoteId`/`_tinymceContentNoteId` provenance stamps, `_plaintextSaveIdentityOk(form)` enforced in `scheduleSave`/`scheduleSaveTitle`/`buildFlushRequest` + an `htmx:configRequest` choke point blocking any editor PUT from a non-active form, fetch-response discard on note/mode change, provenance checks in `tinyMCESyncToTA`/`_lazyTinyMCESyncBeforeSave`, `_completeUnlock` active-note check, and stale-response `snapshotHash` guards. See "Plaintext save identity guard" section above.
- **Spurious "newer version" conflict banner after view/tab switches**: fixed a second cross-note-adjacent save bug. `flushSave` (tab-away, nav-click, mobile-back, resize-flip) saved via raw `fetch()` and discarded the response, leaving the form's hidden `baseUpdatedTime` stale while the server clock advanced; the next autosave then sent the stale base and tripped the conflict guard → "A newer version of this note exists on the server" + Overwrite/Create-copy, even though the user's own flush was the only writer. Fix: `X-Note-Updated-Time` response header on the editor PUT, consumed by flushSave; flushSave also honors `X-Note-Conflict` (surfaces the conflict UI instead of falsely stamping "Saved"); mobile editor fragment keeps `#editor-sync-state` so mobile saves/freshness participate in conflict detection; remote-update banner resolves the ACTIVE shell's bar (was invisible in mobile). See "Plaintext save identity guard" section, "flushSave baseUpdatedTime sync".
- **Vault encrypted-save identity guard**: fixed a race where a debounced 2s encrypted autosave for note A could fire after the user switched to note B, encrypting B's plaintext with A's vault key and writing it to A. Fix: read plaintext from the captured form (not `getTA()`), verify form/note/vault identity before every encrypt/PUT step, bind ciphertext to a specific `noteId` in the blob, and server-side verify `meta.vault` + `meta.noteId` in `assertVaultNoteBodyEncrypted`. Timers are also cancelled on editor-panel `htmx:beforeSwap` as defence-in-depth. See "Encrypted-save identity guard" section above.
- **Immediate history-restore refresh**: `POST /fragments/history/:noteId/restore/:snapshotId` now returns `editorFragment` inline (target = editor container) with autosave-status + nav as OOB swaps. The client cancels pending autosave and clears `_savedHash` before firing, so the restored body appears immediately without a page refresh and can't be clobbered by a stale timer.

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
- **TinyMCE autosave sync fast/debug split**: `onEdit` fast path (default) only calls `markEdited()`+`scheduleSave()`; `_lazyTinyMCESyncBeforeSave()` runs once before `formHash()` in `scheduleSave`/`scheduleSaveTitle`/`_activeEditorIsDirty`. Debug path (`appSettings.debugLogging`) keeps per-event sync + logs. Wired `ExecCommand`+`SetContent` so blocks-dropdown / `insertContent` mutations sync. `BeforeExecCommand` FormatBlock handler: BR-split (case A), partial-selection 3-way `<p>` split (case B), heading clamp for demote path (case C). `flushSave` hash-unchanged branch now sets `Saved` (unblocks `nav-folder-add` "+" deadlock). Coverage: `tests/tinymceOnEditSync.test.js`, `tests/formatBlockPartialSelection.test.js`, `tests/shellModeAndReadonly.test.js`.
- **Shell-mode cache + editor readonly**: `isMobileShellMode()` cached in `_mobileShellCached` via `_computeMobileShell()` (pass `true` to recompute; exposed on `window`); `handleViewportResize` flushes dirty and reloads page on shell flip. `_tinymceReadonlyDefault()` and `_tinyMCEToolbarSpec()` (`jop_edit` pencil) read the cached value. `_applyFormReadonly()` locks title contenteditable, folder select, toolbar buttons/inputs, and CM6 contentDOM; CSS `.editor-readonly` in `public/styles.css` gives the visual affordance. SW cache bumped to `joplock-shell-v49-20260714readonly`.

## Key Conventions

- `plans/` is gitignored — do not commit plan files
- Do not push to remote unless the user explicitly asks
- Run `npm test` before every commit
