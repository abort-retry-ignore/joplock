# Architecture and conventions

> Read this before: changing how the server, htmx fragments, routes or the data model fit together, or when you are unsure where something belongs. Also holds the small cross-cutting contracts that have each broken before.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

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
- **Code blocks**: Full-screen code modal with a CM6 editor and language picker. Highlighting differs by mode: **markdown mode (CM6)** uses CM6's own `syntaxHighlighting(joplockHighlight)` with the language parsers bundled from `cm-build/`; **rendered mode (TinyMCE)** uses the native `codesample` plugin (PrismJS `.token` spans). highlight.js (`public/hljs.min.js`) is loaded on the page but is only reachable from the dead `#note-preview` path — it highlights nothing live (see the dead-code note below). Rendered mode points TinyMCE's codesample plugin at full `window.Prism` bundle (`public/prism.min.js`) so every language offered by modal has grammar support. Prism token colors are injected into the TinyMCE iframe via `content_style` in `_tinyMCEContentFontStyle()` (the oxide dark content skin ships no `.token` CSS). `codemirror.min.js` and `prism.min.js` are loaded on page before TinyMCE/app.js.
- **Autosave**: htmx delayed PUT after typing pause (deferred while modals are open)
- **Markdown**: server-side `renderMarkdown()`, client-side Turndown `htmlToMarkdown()`
- **Auth**: reuses Joplin Server `sessionId` cookie
- **DB access**: reads direct from shared Postgres; writes go through stock Joplin Server API
- **Exports**: `POST /api/export/{docx,pdf,html}` in `app/routes/api.js` — DOCX and PDF are rendered server-side with `pandoc` (PDF via `weasyprint` plus pandoc's print CSS), HTML is a single self-contained file with inlined theme CSS, base64 images and base64 attachment links. `public/html-docx.js` is the legacy client-side DOCX path.
  - Exports work in BOTH editor modes. Rendered mode posts TinyMCE HTML (`format:'html'`); markdown mode posts the markdown (`format:'markdown'`, via `_exportSource()`) and all three endpoints render it with `renderMarkdown()` before the shared strip-links / inline-images pipeline, so images and attachments come out the same in either mode. DOCX with no `format` keeps the legacy pandoc-native markdown input. Pinned by `tests/exportMarkdownMode.test.js` (pandoc stubbed) and the real-container download test in `playwright-tests/md-extras.spec.js`.
- **Ops surface**: admin user management (`/admin/users`), `pg_dump` backup/restore (`/admin/backups`, `/admin/restore`), break-glass recovery mode (`/recovery`), and login rate limiting — all served by the same sidecar process.
- **Script load order** (`app/templates/pages.js`): `htmx` → `turndown` → `codemirror` → `cm-extras` → `prism` → `tinymce` → `hljs` → `html-docx` → inline config → `app.js` (`defer`). `viewport.js` sits between the inline config and `app.js` (it reads `_joplockConfig.debug`). Every local script and stylesheet carries `?v=<asset version>` (`app/assetVersion.js`, computed from the shipped files; `tests/pwaHead.test.js` enforces it), which is what lets the server serve them immutable.

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

- `app/templates/*.js` returns raw HTML strings, not JSX/templates/components
- htmx targets are mostly `#nav-panel`, `#notelist-panel`, `#editor-panel`, and mobile-specific targets like `#mobile-editor-body`
- Out-of-band swaps are used sparingly; note metadata is one example
- Client logic often relies on stable IDs, so be careful renaming DOM IDs used by inline JS

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
- note history snapshots (`joplock_history`)
- per-user + admin settings and TOTP seeds (`joplock_settings`)
- vault metadata (`joplock_vaults`) and its own session mirror (`joplock_sessions`)
- admin user management, DB backup/restore, break-glass recovery
- note export (DOCX/PDF/HTML) and the AI provider proxy
- PWA shell/assets

Does not own:
- canonical note/folder/resource persistence rules
- sync protocol semantics
- auth/session source of truth — Joplin's `sessions` table is authoritative; `joplock_sessions` only mirrors `last_seen` for logout/heartbeat
- offline-first storage

### Sidecar Tables (four, no Joplin FKs)

Joplock owns exactly four tables in the shared database; every cross-reference is
an application-level pointer, never an SQL foreign key:

| Table | Purpose |
|---|---|
| `joplock_sessions` | `session_id` → `last_seen` mirror of Joplin sessions (logout/heartbeat only) |
| `joplock_settings` | per-user settings JSONB, `updated_time`, `totp_seed`; `user_id = '__app__'` is the admin row |
| `joplock_vaults` | `user_id` + `folder_id` (unique) with `salt` and `verify` |
| `joplock_history` | note snapshots: `note_id`, `user_id`, `title`, `body`, `body_hash`, `saved_time`, indexed by `joplock_history_note_time` |

Physical schema reference: `docs/joplock-db-schema.html`. Keep it in sync when a
column changes — tables are created lazily with `CREATE TABLE IF NOT EXISTS` in
the service that owns them (e.g. `app/settingsService.js` also carries the
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS totp_seed` migration).

### How Reads vs Writes Work

- Reads come from the shared Postgres DB for speed and to match the current server state
- Writes do not write directly to Joplin tables; they go through stock Joplin Server APIs
- That split is intentional: Joplock can stay lightweight while preserving compatibility with normal Joplin clients
- If behavior looks inconsistent after a write, inspect both the sidecar request path and the upstream Joplin API call path

## Design Decisions

### Separate repo
Joplock lives outside Joplin monorepo. Keep standalone build, test, docs, Docker flow working without Joplin source tree.

### Shared Postgres database
Joplock reads same Postgres database as Joplin Server. No data duplication. Writes still go through Joplin Server API for compatibility and validation.

### Configurable open mode
Notes can open in rendered mode or markdown mode based on the per-user `noteOpenMode` setting (default **markdown**). The stored value may be `preview` (the pre-TinyMCE name, still accepted and preserved by `normalizeSettings`), but note the vocabulary mismatch: `preferredEditorMode()` returns only `'markdown'` or `'rich'`, and `_editorMode` is never `'preview'`. So `noteOpenMode: 'preview'` means "open rendered", and any `_editorMode === 'preview'` branch is dead. Desktop and mobile both respect the same setting. `initEditorPanel` / `_completeUnlock` must call `preferredEditorMode()` (live `_joplockConfig.noteOpenMode`). Do not let `_tinymceReadonlyDefault()` / mobile-shell read-only force rendered mode — that override made Settings → "Open notes in: Markdown" a no-op on tablet/narrow windows. Mobile read-only still applies, but only when the note actually opens in rendered mode. `_joplockConfig` is inlined in `<head>` *before* `app.js`.

### Shared editor fragment
Desktop and mobile do not have separate editor implementations. Both use the same `editorFragment()` and client editor logic; mobile wraps it in a mobile-specific shell and screen navigation layer.

### Mobile-first navigation without SPA rewrite
Mobile uses a folders screen, notes screen, and editor screen implemented in SSR + htmx + inline JS. Do not introduce a client router or framework state layer to solve mobile flow problems.

## Routes and response contracts

`app/createServer.js` assembles the server and delegates to the handlers in
`app/routes/*.js`, each of which exports a `handle(url, request, response, ctx)`
returning `true` when it consumed the request (`app/routes/api.js` additionally
exports the export handlers and CSS/URL helpers for tests).

Routes are not listed here (grep `handle(` in `app/routes/`, or ask the code index); the contracts below are what is not obvious from them.

A few contracts worth remembering:

- The editor autosave `PUT /fragments/editor/:id` also sets the
  `X-Note-Updated-Time` / `X-Note-Conflict` response headers the client relies on
  (see "Plaintext save identity guard" (`docs/agents/vaults-and-save-safety.md`)).
- Mobile note creation is driven by response headers such as `X-Mobile-Note-Id`,
  consumed in `htmx:afterRequest`.
- History restore returns `editorFragment` **inline** (target = the editor
  container) with OOB swaps, not just the status bar.

If a UI action appears broken, check:
1. Which endpoint it hits
2. Which htmx target it swaps
3. Which client event handler expects to run after swap/request
4. Whether the response includes headers or OOB fragments the client depends on

## Coding Guidance

- Keep changes minimal
- Preserve sidecar/frontend boundary
- `public/app.js` is DOM-contract fragile; validate escaping-heavy changes and stable IDs carefully
- **Floating menus must be opaque and stay on screen.** `--bg-elevated` is a ~2% tint in most themes, so it is a *panel lift*, never a popup background: put popups on a solid colour (`--bg-side` / `--bg-editor`; the notebook context menu layers the tint over `--bg-side`). A `position:fixed` popup also cannot be scrolled to, so place it with `positionFolderContextMenu()`-style clamping instead of raw pointer coordinates, or items near the window edge become unreachable. Guarded by `tests/popupBackgrounds.test.js` and `playwright-tests/folder-context-menu.spec.js`.
- **Inline handlers only see what `public/app.js` assigns to `window`.** A template `onclick="foo()"` needs `window.foo=foo;`; a function that works in a unit test can still be "not defined" in the browser. `tests/inlineHandlersExposed.test.js` scans every inline handler the templates emit and fails if a called function is not exposed
- The code modal lives in `loggedInLayout`, not inside `navigationFragment` or `editorFragment`, so it survives htmx OOB swaps
- Be careful with checkbox text handling, `\n`, regex escaping, and DOM-to-markdown round trips
- Keep standalone repo paths/docs/scripts correct; avoid reintroducing monorepo assumptions
- Prefer changing existing inline helpers over introducing a new abstraction unless there is clear reuse
- When fixing mobile behavior, verify desktop is unchanged
- When fixing desktop editor behavior, verify mobile still works because both use the same editor fragment
- Be cautious with `htmx:afterRequest` assumptions; in htmx 2.x, response headers are often more reliable than old event-property assumptions
- If changing vault behavior, verify desktop + mobile, locked + unlocked, existing note + newly-created note, and refresh/restart behavior

## Debugging: If startup/resume behavior is wrong

- Check the `/` render path in `app/createServer.js`
- Check `resumeLastNote`, `lastNoteId`, and `lastNoteFolderId`
- Refresh/restart must not reopen encrypted notes or notes inside vault notebooks

## Small Contracts That Are Easy To Regress

Behaviours that are documented nowhere else and have each broken before (verified against the code; the larger contracts have their own sections above).

- **Vault chrome follows the folder.** `_syncEditorVaultChrome(noteId, inVault, unlocked)` (`public/app.js`) injects/removes the lock-toggle button in `.editor-titlebar` when a note is moved into a vault (called from `_doEncryptNoteInVault`). Vault notes cannot be moved out (see Vault / Encryption Model in `docs/agents/vaults-and-save-safety.md`).
- **Live search keeps what you typed.** The sidebar search value is saved around the htmx swap (`_navSearchSavedValue`, captured at `htmx:beforeSwap`) so characters typed while a request is in flight are not lost.
- **Search and note lists are paginated.** Desktop and mobile lists end in a "Load more" button (`.notelist-load-more`), not infinite scroll; search is backed by the `pg_trgm` index `ensureIndexes()` creates.
- **TinyMCE autosave sync has a fast path and a debug path.** By default `onEdit` only calls `markEdited()` + `scheduleSave()`, and `_lazyTinyMCESyncBeforeSave()` runs once before `formHash()` in `scheduleSave` / `scheduleSaveTitle` / `_activeEditorIsDirty`; with admin debug logging on, every event syncs and logs. `ExecCommand` + `SetContent` are wired so the blocks dropdown and `insertContent` mutations still sync. `flushSave`'s hash-unchanged branch sets `Saved` (without that a phantom `Edited` blocked the sidebar's notebook "+" button).
- **Read-only is one function.** `_applyFormReadonly()` locks the title contenteditable, folder select, toolbar buttons/inputs and the CM6 `contentDOM`; `.editor-readonly` in `styles.css` is the visual. On the mobile shell a note that opens in rendered mode is read-only until the pencil (`jop_edit`) is tapped; `_tinymceReadonlyDefault()` and `_tinyMCEToolbarSpec()` read the cached `isMobileShellMode()`.
- **The mobile editor body shows an inline spinner** (`.mobile-loading-note`) while a note loads. A `position: fixed` overlay does not work there (it ends up under the shell's fixed layers).
- **`renderMarkdown()` strips `hx-*` attributes** from user HTML so a note cannot inject htmx behaviour.
