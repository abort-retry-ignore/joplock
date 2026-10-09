# Joplock Agent Guide

<!-- cSpell:disable -->

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
- **Code blocks**: Full-screen code modal with a CM6 editor and language picker. Highlighting differs by mode: **markdown mode (CM6)** uses CM6's own `syntaxHighlighting(joplockHighlight)` with the language parsers bundled from `cm-build/`; **rendered mode (TinyMCE)** uses the native `codesample` plugin (PrismJS `.token` spans). highlight.js (`public/hljs.min.js`) is loaded on the page but is only reachable from the dead `#note-preview` path — it highlights nothing live (see the dead-code note below). Rendered mode points TinyMCE's codesample plugin at full `window.Prism` bundle (`public/prism.min.js`) so every language offered by modal has grammar support. Prism token colors are injected into the TinyMCE iframe via `content_style` in `_tinyMCEContentFontStyle()` (the oxide dark content skin ships no `.token` CSS). `codemirror.min.js` and `prism.min.js` are loaded on page before TinyMCE/app.js.
- **Autosave**: htmx delayed PUT after typing pause (deferred while modals are open)
- **Markdown**: server-side `renderMarkdown()`, client-side Turndown `htmlToMarkdown()`
- **Auth**: reuses Joplin Server `sessionId` cookie
- **DB access**: reads direct from shared Postgres; writes go through stock Joplin Server API
- **Exports**: `POST /api/export/{docx,pdf,html}` in `app/routes/api.js` — DOCX and PDF are rendered server-side with `pandoc` (PDF via `weasyprint` plus pandoc's print CSS), HTML is a single self-contained file with inlined theme CSS, base64 images and base64 attachment links. `public/html-docx.js` is the legacy client-side DOCX path.
  - Exports work in BOTH editor modes. Rendered mode posts TinyMCE HTML (`format:'html'`); markdown mode posts the markdown (`format:'markdown'`, via `_exportSource()`) and all three endpoints render it with `renderMarkdown()` before the shared strip-links / inline-images pipeline, so images and attachments come out the same in either mode. DOCX with no `format` keeps the legacy pandoc-native markdown input. Pinned by `tests/exportMarkdownMode.test.js` (pandoc stubbed) and the real-container download test in `playwright-tests/md-extras.spec.js`.
- **Ops surface**: admin user management (`/admin/users`), `pg_dump` backup/restore (`/admin/backups`, `/admin/restore`), break-glass recovery mode (`/recovery`), and login rate limiting — all served by the same sidecar process.
- **Script load order** (`app/templates/pages.js`): `htmx` → `turndown` → `codemirror` → `cm-extras` → `prism` → `tinymce` → `hljs` → `html-docx` → inline config → `app.js` (`defer`). `app.js`, `codemirror.min.js` and `cm-extras.js` are cache-busted with `ASSET_VERSION`.

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
- **Vault notebooks cannot be shared**: `POST /api/web/shares` rejects them with 400 `Vault notebooks cannot be shared` (`app/routes/shares.js`).
- `share_users.can_write` controls whether recipients can edit shared notes (default `1` — editable). Only the owner can move, delete, or stop-share.
- Move into a shared notebook sets `share_id`; move out clears it and drops recipient access to that item.
- Revoke/stop sharing removes recipient access; owner keeps folders/notes in place.
- Recipients can leave a shared notebook via the share dialog ("Leave notebook" button) → removes their `share_users` row + `user_items` entries.
- Only the share owner sees invite/remove/stop controls in the share dialog. Recipients see only their own access status and the Leave button.

### Shared-note guard layers

- **Route layer** (`app/routes/fragments.js`, `app/routes/api.js`): `resolveItemShareAccess` → `assertCanWrite`/`assertOwnerForDestructive` on create/update/delete/restore/move. `canWrite` respects `share_users.can_write` for recipients. Owner-only for move/delete regardless of `can_write`. Recipient creates in shared folder blocked with 403.
- **Proxy layer** (`app/proxy/shareProxyGuard.js`): inspects PUT and DELETE sync-proxy requests. PUT checks `resolveItemShareAccess` → `canWrite`. DELETE is owner-only. Inherits `noteIdFromItemPath`/`bufferRequest` from vault proxy guard.
- **Editor UI** (`app/templates/fragments.js`, `public/app.js`): `editorFragment` accepts `canWrite` param from route handler (queries `share_users.can_write`). When `canWrite=false` renders read-only banner, disables folder select, hides delete button, sets `contenteditable="false"` on title. When `canWrite=true` the editor is fully interactive.
- **Share-id propagation** (`app/items/shareAccess.js` for the field derivation, `app/routes/shares.js` for the write): `deriveShareFieldsForMove(targetFolder)` returns `{ shareId, isShared }` from the target folder, so a move sets/clears `share_id`. `ensureShareIdsOnNotebook()` writes `share_id` directly to the items DB content JSON. `createNote`/`updateNote` serialize these fields into Joplin note metadata.
- **Share dialog API** (`app/routes/shares.js`): uses Joplin Server's `/api/shares/:id/users` endpoints (not deprecated `/api/share_users`). PATCH/ACCEPT/REJECT/DELETE operations use DB-only writes since Joplin Server's newer API doesn't support mutations on individual share_users. `can_write` column managed via direct `share_users` table updates. The module also exports helpers reused elsewhere: `autoAcceptShareUser`, `populateUserItems`, `ensureShareIdsOnNotebook`, `STATUS_ACCEPTED`/`STATUS_WAITING`.
- **Never decode `items.content` for every item in share SQL** (`app/routes/shares.js`): `items` also holds binary resource blobs (`jop_type 0`, every uploaded image/PDF). `convert_from(content,'UTF8')` raises on them and aborts the whole statement — and the routes swallow DB errors, so invites silently stopped fanning out `user_items` (shared notebook never appeared) and revoke/stop-sharing silently left access behind as soon as the owner had one attachment. Read `share_id` only through `shareIdOf()` (a `CASE WHEN jop_type IN (1, 2)` guard; SQL gives no AND/OR evaluation-order guarantee). Pinned by `tests/sharesBinaryItems.test.js`.

### File map

| Layer | File |
|-------|------|
| Access helpers | `app/items/shareAccess.js` |
| Share dialog API routes | `app/routes/shares.js` |
| Proxy write guard | `app/proxy/shareProxyGuard.js` |
| Fragment write gates | `app/routes/fragments.js` |
| API write gates | `app/routes/api.js` |
| Share dialog template | `app/templates/shares.js` |
| Share dialog client | `public/app.js` (openShareDialog, inviteToShare, toggleShareWrite, leaveShareNotebook, etc.) |
| Read-only editor | `app/templates/fragments.js` (editorFragment) |
| Unit tests | `tests/shareAccess.test.js`, `tests/shareProxyGuard.test.js`, `tests/shareWriteGuards.test.js` |
| Playwright tests | `playwright-tests/share-modal.spec.js`, `playwright-tests/share-access.spec.js`, `playwright-tests/share-revoke-move.spec.js` |

## Nested Notebooks

Joplin notebooks nest via the folder's `parent_id`. Joplock renders, creates, moves and deletes them on desktop and mobile. There is **no schema change** and no sidecar table: the tree is just `jop_parent_id` on the shared `items` rows, so Joplin desktop/mobile/CLI see exactly the same hierarchy.

### Where the logic lives

| Concern | File |
|---|---|
| Pure tree helpers (build/flatten/descendants/ancestors/roll-up counts/`canNestUnder`/option labels) | `app/items/folderTree.js` |
| Create / move / delete / share-eligibility rules, shared by fragment + JSON routes | `app/items/folderOps.js` (`ctx.folderOps`, built in `createServer.js`) |
| Subtree share stamping, recipient grant/revoke | `app/routes/shares.js` (`collectSubtreeItems`, `setShareOnItems`, `createShareSync`) |
| Sync-proxy guard (no notebooks under a vault) | `app/proxy/vaultProxyGuard.js` (`enforceFolderWrite`) |
| Desktop tree markup | `navigationFragment` in `app/templates/fragments.js` |
| Mobile tree markup | `mobileFoldersFragment` in `app/templates/mobile.js` |
| Pickers | `notebookOptionsHtml` (editor select), `folderPickerOptions` + `GET /fragments/folder-options` (move / new-notebook modals) |
| Tests | `tests/folderTree.test.js`, `tests/folderOps.test.js`, `tests/folderRoutes.test.js`, `tests/nestedFoldersUi.test.js`, `playwright-tests/nested-folders.spec.js`, `playwright-tests/nested-share.spec.js` |

### Tree semantics (keep them)

- **Siblings keep input order.** `foldersByUserId` already orders by case-folded title; `folderTree` never re-sorts, so flat lists and the virtual "All Notes"/"Trash" rows come out unchanged.
- **Defensive like Joplin's `buildTree`:** a folder whose parent is not visible (not shared with this user, deleted) is shown at the top level; a parent cycle never loops (first folder of the cycle in list order becomes a root); depth is capped at `MAX_DEPTH`. Every folder always appears.
- **Counts:** the nav and mobile list show **rolled-up** counts (a collapsed parent is honest). `counts` from `folderNoteCountsByUserId` stays the **direct** count and still drives note pagination (`/fragments/folder-notes`), `data-note-count`, and "does this notebook have notes to fetch". Selecting a parent lists only its own notes; "All Notes" is the aggregate.
- Sub-notebooks sort/render **before** the notebook's own notes.

### Desktop DOM contract (easy to break)

```
.nav-folder[data-folder-id][data-parent-id][data-depth][style=--nav-depth:N]
  > .nav-folder-row
  > .nav-folder-children        (only when it has sub-notebooks; contains more .nav-folder)
  > .nav-folder-notes[data-folder-id]   (this notebook's OWN notes, lazy loaded)
```

- **Never** use `el.querySelector('.nav-folder-notes…')` or descendant CSS (`.nav-folder.collapsed .x`) on a notebook: sub-notebooks are inside it and would match first / leak collapse state. Use `navFolderNotesDiv(el)` (direct child) and the child combinator in CSS (`.nav-folder.collapsed > .nav-folder-notes`).
- **Multi-expand, no accordion.** Any number of notebooks can be open. Opening one also opens the notebooks above it (`toggleNavFolder`). `initNavPanel` trusts saved state; with no saved state the selected notebook **and its ancestors** open. Notes are lazy-loaded only for notebooks that are open **and visible** (`navFolderVisible`); expanding a parent loads already-open descendants (`navLoadOpenDescendants`). A notebook with 0 direct notes never requests a notes page.
- Saved state is `localStorage['joplock-nav-folders']` (notes-list open).

### Mobile contract

- The folders screen is an **inline expandable tree** (not drill-down), so `mobileBack` and the 3-screen stack are untouched. Rows carry `data-folder-id/-parent-id/-depth` and `--m-depth`; rows below the top level render `hidden` and `mobileApplyFolderTree()` reveals them from `localStorage['joplock-mobile-folders']` (sub-notebooks shown; separate from the desktop key). `.mobile-folder-row[hidden]` needs its own CSS rule because `display:flex` beats the UA `[hidden]`.
- The chevron (`.mobile-folder-toggle`) is its own tap target and stops propagation; the row tap still calls `mobilePushNotes(id,title)`. **Keep the `mobilePushNotes("id","title")` onclick format**: `wireFolderRowLongPress` parses it. The chevron gutter is only rendered when something is nested.
- Long-press sheet gained "New sub-notebook" and "Move notebook…". The note-move sheet (`mobileCtxMove`) reuses the editor `<select>`'s option text, so the tree indentation carries over.
- Both expansion keys are cleared on logout (`pages.js`).

### Rules enforced server side (`folderOps`)

- **Structure:** not into itself or a descendant (mirrors Joplin's `canNestUnder`). Same-parent move is a no-op.
- **Delete = promote.** Sub-notebooks move up to the deleted notebook's parent; its notes move to that parent (top level: the existing top-level "General", created if missing). Deleting never deletes notes or sub-notebooks. (Old behaviour moved every note to General and orphaned sub-notebooks.)
- **Vaults are top-level leaves.** Cannot contain notebooks, cannot be moved, cannot be created nested (`POST /api/web/vaults` refuses a nested notebook or one with children), cannot end up in a share. The new-notebook modal disables the parent picker when "vault" is ticked. `vaultProxyGuard` also rejects a notebook PUT whose parent is a vault, **but see "Sync-proxy guards do not apply to stock Joplin clients" below: that guard is currently inert for real clients.**
- **Sharing:**
  - Only the owner creates/moves/deletes inside a share (recipients get 403).
  - A **share root stays top level** (Joplin's rule): moving one under anything is refused ("Stop sharing…"); sharing a nested notebook **lifts it to the top level first** (`prepareForShare`; the share dialog says so); a notebook already inside a share cannot be shared again; a subtree containing a vault cannot be shared.
  - `ensureShareIdsOnNotebook` now stamps the **whole subtree** (every sub-notebook and the notes directly in each), writing `share_id`/`is_shared` into the item JSON **and** the `jop_share_id` column (falls back to JSON only if a server lacks the column). Creating a sub-notebook in a share inherits it; moving a subtree into/out of a share re-stamps it and grants/revokes recipient `user_items` (`createShareSync.setSubtreeShare`).
  - **Subtree share changes go through the API.** `createShareSync.setSubtreeShare` re-saves every notebook and note of the subtree with the new share fields (`itemWriteService`, lossless thanks to pass-through) so Joplin Server emits change events. Silent database writes are invisible to stock clients: a subtree moved **out** of a share used to stay in the recipient's Joplin app. Items the API cannot rewrite (Joplin-encrypted) get the database sweep only. Verified with a real client recipient in `integration-tests/joplin-sharing.test.js`.
  - **Stopping a share clears the dead `share_id` from the owner's whole tree** (notebook, sub-notebooks, notes; JSON and `jop_share_id`), like Joplin's own `unshareFolder`. Left in place, Joplin Server answers any later write of those items with `share not found` (422 — the note could no longer be edited or trashed) and **silently refuses to delete a root folder that still carries a share id** (returns 200, does nothing). Pinned by `playwright-tests/nested-share.spec.js` step 6.
  - Recipient access keeps the existing Joplock convention: `user_items.item_id` holds the **`jop_id`** (Joplin Server's own fan-out uses `items.id`, which `itemAccessExpression` does not read).
- `updateFolder` now preserves `created_time`, `user_created_time`, `icon` and `master_key_id` (a rename/move used to reset them).

### Endpoints

- `PUT /fragments/folders/:id` and `PUT /api/web/folders/:id` accept `title` and/or `parentId` (`''` = top level; both in one write). `POST /fragments/folders` and `POST /api/web/folders` accept `parentId`. `DELETE` promotes.
- `GET /fragments/folder-options?exclude=<id>&selected=<id>` → `<option>`s in tree order; the excluded subtree, vaults and foreign shares are `disabled`.
- `GET /fragments/nav?folderId=<id>&withSelect=1` highlights/opens a notebook and refreshes the open note's notebook `<select>` (used after a move).

### Known pre-existing sharing gaps (not caused by nesting; not fixed here)

Verified live while building this: a **note created in a shared notebook after the share** is not visible to a Joplock recipient, and a **note moved out of a share stays visible** to the recipient (the note write paths never call grant/revoke; only folder operations do). Fixing means calling `createShareSync.setItemsShare` from the note create/move paths.

## Joplin Field Fidelity (do not regress)

Joplock shares one account with stock Joplin clients, so **a Joplock write must change only what the user edited**. Originally `serializeNote`/`serializeFolder` rebuilt every item from hard-coded values: a single body edit turned a to-do into a plain note, wiped author/source URL/location, flipped an HTML note to markdown, reset `order` and overwrote `source_application`. Measured with the real Joplin CLI synced through Joplock's proxy, then fixed.

### How it works

- **Pass-through serializer** (`app/items/joplinItem.js`): reproduces Joplin's `serialize` / `serialize_format` (canonical key order, ISO times, `\n` escaping, no empty body block). Values come from the item's **stored fields** and only the fields Joplock owns are overridden.
- **Items carry their stored fields.** `mapNoteRow` / `mapFolderRow` attach `fields` (the parsed `items.content` JSON). Every write path passes `existing`, so `serializeNote({ fields: existing.fields, ... })` writes everything else back untouched, including fields Joplock has never heard of (`is_locked`, `extracted_resource_ids`, `user_data`, `application_data`, ...). Defaults (`order = now`, zero geo strings, `markup_language 1`, `source_application net.cozic.joplock-web`) apply **only to brand-new items**; edited items keep their original `source_application`.
- **Joplock-owned fields:** title, body, parent, deleted time, `is_shared`/`share_id`, `updated_time` (always now, sync needs it). `user_updated_time` moves **only on a real title/body edit**; move, trash, restore and share changes preserve it (Joplin's `moveToFolder` semantics).
- **`fields` is internal.** `publicItem()` / `publicItems()` (`routes/_helpers.js`) strip it from JSON API responses. Keep using them on any new endpoint that returns a note or notebook.
- **The server only stores fields its own Joplin library knows** (it drops the rest on upload and when serving), so "unknown to Joplock" fields that can persist are ones a current Joplin writes. Joplin clients themselves also drop unknown fields on read.
- **Share id lives in a column.** Joplin Server moves `share_id` out of the item JSON into `items.jop_share_id` on the first API save. Always read it via `shareIdOfRow()` (column first, JSON fallback) / `shareIdOf()` in SQL. Reading only the JSON made a shared note look unshared after its first edit, so the *second* Joplock edit wrote `share_id: ''` and silently took the note away from every recipient.

### Items Joplock must treat carefully

| Item | Behaviour |
|---|---|
| `markup_language = 2` (HTML note) | Shown **rendered and read-only** (`app/htmlNoteRenderer.js`, allowlist sanitizer on untrusted HTML + TinyMCE's own sanitizing). Form is `data-html-note="1"`: no markdown/rendered switch, no toolbar, title not editable, `tinyMCESyncToTA` is a no-op. The server refuses any body change (403) but still allows move/trash/restore. Never convert it to markdown. |
| Joplin end-to-end encrypted (`jop_encryption_applied = 1`) | **Locked placeholder only.** `e2ee: true`, title/body blanked, no editor form at all. `updateNote`/`updateFolder` throw 403 (`assertNotE2ee`); a live one cannot be hard-deleted; a notebook holding any cannot be deleted (409, checked **before** any write so a delete never half-completes). |
| `is_conflict = 1` (conflict copy) | **Hidden** from lists, counts, headers and search (`conflictFilterSql`), like Joplin's "Conflicts" notebook. Stays untouched, and travels with its notebook when that is deleted (`includeConflicts`). |
| Attachments | `serializeResource` writes Joplin 3.x's OCR fields; `ocr_driver_id` is `1` (Joplin's default; `0` is a legacy quirk). |

### Real-client integration tests (opt-in)

`npm run setup:joplin-cli` installs the real Joplin terminal client under `~/.cache` (not in the repo). `npm run test:joplin` (dev stack up, admin env vars set) drives it headless through Joplock's `/joplin` proxy using a dedicated `compat-client@joplock.test` account (`integration-tests/joplin/harness.js`): `joplin-fidelity`, `joplin-guards`, `joplin-nested`, `joplin-sharing`. They create items in the client, sync, edit/move/trash in Joplock, sync back and compare **field by field** from the client's own SQLite. Raw uploads authenticate with `X-API-AUTH`, like a real client. Joplin Server applies share changes on a 10 s task, so the sharing tests wait ~13 s per step. One test is a tracked `todo` (below).

### Known issues found with the real client (not fixed)

- **Sync-proxy guards do not apply to stock Joplin clients.** `vaultProxyGuard` and `shareProxyGuard` identify the user with `authenticatedUser()`, which reads only Joplock's `sessionId` **cookie**. Joplin apps authenticate with an `X-API-AUTH` header and send no cookie, so both guards "stream through". Verified: a real client wrote a **plaintext note into a vault notebook and created a notebook under a vault**, and nothing stopped it. The vault/share/"no notebook under a vault" proxy protections described elsewhere in this guide therefore only hold for browser-origin traffic. Making them live needs `authenticatedUser` to accept `X-API-AUTH` **and** a fix for a second bug: when a request does authenticate, both guards call `bufferRequest()` on the same stream, so the second read never completes and the request hangs (seen as a hung cookie-authenticated PUT to `/joplin/...`). Behaviour will change for existing clients (403s on vault writes), so treat it as its own change.
- **Collaborator content is invisible to the share owner in Joplock.** Access checks use Joplock's own `user_items` rows keyed by `jop_id`; Joplin Server keys them by `items.id`. A note a collaborator creates in a Joplin app never shows for the owner in Joplock (it does in the owner's Joplin apps). Tracked as the `todo` test in `joplin-sharing.test.js`. Fixing it means changing the access model together with Joplock's own removal paths (otherwise removed users keep access).
- Notes created in a share after sharing do not reach a **Joplock** recipient, and a note moved out of a share stays visible to a Joplock recipient (the note write paths never grant/revoke Joplock's `jop_id` rows; only folder operations do). Stock-client recipients are handled correctly by the server.

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
- Unlocking a vault note with markdown as the preferred open mode must seed CM6 from the decrypted `plaintext` argument. Do not call `setEditorMode('markdown')` on unlock: that path `tinyMCESyncToTA()`s leftover/empty TinyMCE content over the just-decrypted body (locked notes skip editor init, so TinyMCE never held this note). `tinyMCESyncToTA()` must also refuse to write when `#tinymce-host` is not visible.
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
  2. **Ciphertext required inside vaults**: saving to a vault folder always requires an encrypted body. Same-folder saves are covered; sync-proxy writes are covered **only for cookie-authenticated (browser) traffic, not stock Joplin clients** (see "Known issues found with the real client"). `enforceExistingVault=true` (sync-proxy only) extends this to prevent external Joplin clients from stripping ciphertext by re-parenting.
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
- **flushSave must fetch with `keepalive: true` (do not remove)**: the flush usually fires from `visibilitychange` while the document is being torn down (tab close, note switch via navigation). A plain `fetch()` is aborted mid-flight, Chromium sends a truncated request whose `Cookie` header never reaches the server → 401, and the pending title/body edits are silently lost. `keepalive` lets the request outlive the document. Pinned by `tests/saveIdentityGuard.test.js`.
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

## File Map

### Entry / Server
- `server.js` — entry point, env wiring, service construction (pool, settings, items, history, admin, vault, backup, recovery, rate limit), server startup
- `app/env.js` — `normalizeEnvValue()`; strips matching surrounding quotes from env values (compose files are hand-edited, so `'...'` and `"..."` are tolerated)
- `app/createServer.js` — server assembly, shared context, full-page `/` render, static serving, `effectiveDebug`/`refreshDebugLogging()`

### Route Handlers
- `app/routes/fragments.js` — desktop/shared fragment routes
- `app/routes/mobile.js` — mobile folder/note/search routes
- `app/routes/api.js` — JSON API endpoints
- `app/routes/shares.js` — share dialog API (invite/accept/reject/remove, `can_write`, leave)
- `app/routes/recovery.js` — break-glass `/recovery` page, login, backups, restore
- `app/routes/_helpers.js` — shared route helpers: `parseBody`, `authenticatedUser`, `assertVaultNoteBodyEncrypted` (vault boundary enforcement)
- `app/routes/auth.js`, `app/routes/settings.js`, `app/routes/admin.js`, `app/routes/history.js`, `app/routes/resources.js`

### Templates / UI
- `app/templates.js` — thin re-export wrapper for `app/templates/` (kept for old require paths)
- `app/templates/index.js` — central template re-export
- `app/templates/pages.js` — full-page layout/login/MFA shells, `<body>` shell classes, `_joplockConfig` inlining, script order
- `app/templates/fragments.js` — nav, editor, search, history, OOB fragments
- `app/templates/mobile.js` — mobile folder/note/search fragments
- `app/templates/shares.js` — share dialog template
- `app/templates/shared.js` — escaping, markdown rendering, title normalization, `themeOptions`
- `app/templates/settings.js` — settings/admin page sections

### Markdown / Rendering
- `app/markdownRenderer.js` — server-side `renderMarkdown()`: markdown-it + Joplin resource rewriting, `hx-*` attribute stripping (htmx-injection guard), and the `md-blank-line` / `md-checkbox` class injection the rendered editor depends on

### Client Runtime
- `public/app.js` — shared client logic for editor, autosave, vault flows, mobile screen stack, search, and modals
- `public/html-docx.js` — client-side HTML→DOCX converter (legacy export path; loaded before `app.js`)

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
- `app/auth/rateLimitService.js` — in-memory login rate limiting, capped by the admin `authRateLimitAttempts` setting

### Data
- `app/items/itemService.js` — DB reads for folders, notes, search, resources (+ `ensureIndexes()`)
- `app/items/itemWriteService.js` — note/folder/resource serialization and upstream writes
- `app/items/shareAccess.js` — share ownership / `can_write` resolution shared by the fragment, API, and proxy guards
- `app/items/folderTree.js` — pure nested-notebook tree helpers; `app/items/folderOps.js` — create/move/delete/share-eligibility rules (see Nested Notebooks)
- `app/settingsService.js` — Joplock-owned settings table access (user settings, `__app__` admin row, TOTP seeds)
- `app/historyService.js` — note history snapshots in `joplock_history` (ring buffer per note)
- `app/vaultService.js` — vault metadata CRUD in `joplock_vaults`
- `app/adminService.js` — admin user CRUD against Joplin Server's users API + `ensureAdminUser()` bootstrap
- `app/backupService.js` — `pg_dump`/`pg_restore` of the whole shared database, with backup-path containment checks
- `app/recoveryService.js` — break-glass recovery sessions for `/recovery`
- `app/proxy/vaultProxyGuard.js`, `app/proxy/shareProxyGuard.js` — write guards applied to Joplin sync-proxy traffic

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

### Static Assets
- `public/htmx.min.js`
- `public/codemirror.min.js` — CM6 bundle with 11 language parsers (markdown base + javascript/typescript, html, css, json, sql, python, xml, go, yaml, shell; built from `cm-build/`, `npm run build:cm`); loaded on the page before `app.js`. Powers markdown mode (`initCM`) and the code-block modal (`_initCodeModalCM`).
- `public/cm-extras.js` — markdown-mode (CM6) extras: inline image previews with drag-resize, attachment/note-link chips, clickable task checkboxes, code-block Copy button, live-preview marker hiding, status bar + outline, folding, table helper, paste-as-markdown, link hover info. Exposes `window.JoplockMd` (and `module.exports` for tests); pure helpers are unit-tested in plain Node. See "Markdown-mode extras" under Editor Model. Listed in the service worker's `STATIC_ASSETS` (network-first, cache fallback) so the offline shell keeps the extras.
- `public/tinymce/` — TinyMCE 8 (npm dep, see root `package.json`), loaded as `/tinymce/tinymce.min.js`; this is the live rendered-mode editor
- `public/turndown.min.js` — HTML→Markdown conversion, used by `tinymceToMarkdown()`
- `public/hljs.min.js` — highlight.js bundle (built from `hljs-build/`). Loaded on the page, but only the dead `#note-preview` path calls it; markdown mode highlights via CM6, rendered mode via Prism. Safe to keep loading, safe to drop with the PV cleanup.
- `public/prism.min.js` — Prism bundle for rendered-mode TinyMCE code-block highlighting (built from `prism-build/`)
- `public/html-docx.js` — legacy client-side HTML→DOCX converter
- `public/reference.docx` — pandoc reference document for DOCX export styling (regenerate with `scripts/build-reference-docx.sh`; referenced from `app/routes/api.js`)
- `public/styles.css`
- `public/service-worker.js` — shell-only cache. `CACHE_NAME` at the top of the file is the `joplock-shell-vN-<label>` string and must be bumped whenever shipped CSS/JS changes
- `public/manifest.webmanifest` + `public/icons`, `public/apple-splash` — PWA assets (regenerate with `npm run generate:pwa-assets`)

### Bundle Build Sources
- `cm-build/` — CM6 bundle source → `public/codemirror.min.js`. Build from repo root with `npm run build:cm` (or `cd cm-build && npm install && npm run build`).
- `hljs-build/` — highlight.js bundle source → `public/hljs.min.js`. Build with `npm run build:hljs` (or `cd hljs-build && npm install && npm run build`).
- `prism-build/` — Prism bundle source → `public/prism.min.js`. Build with `npm run build:prism` (or `cd prism-build && npm install && npm run build`).

### Tests
- `tests/*.test.js` — unit/integration tests (`node:test`; several suites extract real functions out of `public/app.js` and run them under a JSDOM harness)
- Run: `npm test` (i.e. `node --test tests/*.test.js`)
- Real Joplin client compatibility (opt-in, needs the dev stack): `npm run setup:joplin-cli` once, then `npm run test:joplin` (`integration-tests/*.test.js`)
- `playwright-tests/*.spec.js` — browser E2E against a live dev stack; run with `npm run test:ui`

### Deployment
- `Dockerfile` — the image copies `app/`, `public/`, and `server.js` at build time, so source edits need a rebuild, not a container restart
- `docker-compose.yml` — sidecar-only example (pre-built `ghcr.io/abort-retry-ignore/joplock:latest`)
- `docker-compose.example-full.yml` — Postgres + Joplin Server + Joplock, pre-built image
- `docker-compose.example-full-build.yml` — same stack, but builds Joplock from source (`build:` instead of `image:`)
- `docker-compose.dev.yml` — local dev stack (Postgres + Joplin Server + Joplock from source). **Git-ignored**: it is the per-developer compose file used by `./scripts/rebuild-dev.sh` and `npm run docker:up:dev`, so recreate it from `docker-compose.example-full-build.yml` if it is missing
- `.env` is git-ignored and optional — configuration is set as inline env vars in the compose file. There is no committed `.env.example`

Environment variables (all optional unless noted; set them inline in the compose file):

| Var | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `3001` / `0.0.0.0` | |
| `POSTGRES_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_DATABASE` | `127.0.0.1` / `5432` / `joplin` / `joplin` / `joplin` | shared Joplin DB; also used by `pg_dump` for backups |
| `JOPLIN_SERVER_ORIGIN` | `http://server:22300` | upstream Joplin Server that all writes go through |
| `JOPLIN_PUBLIC_BASE_PATH` | *(empty)* | path prefix Joplock proxies Joplin sync under |
| `JOPLOCK_PUBLIC_BASE_URL` | `http://localhost:$PORT` | used to derive `JOPLIN_SERVER_PUBLIC_URL` |
| `JOPLIN_SERVER_PUBLIC_URL` | derived | must match Joplin's `APP_BASE_URL` |
| `JOPLOCK_ADMIN_EMAIL` / `JOPLOCK_ADMIN_PASSWORD` | *(empty)* | when set, `adminService.ensureAdminUser()` bootstraps the admin at startup |
| `IGNORE_ADMIN_MFA` | `false` | skips MFA for the admin account only |
| `JOPLOCK_SESSION_COOKIE_MAX_AGE_SECONDS` | `31536000` | |
| `DEBUG` | `false` | startup default only; the admin `debugLogging` setting overrides it at runtime |
| `JOPLOCK_BACKUP_DIR` | *(empty)* | enables server-side DB backups; must be persistent storage |
| `JOPLOCK_BACKUP_COMPRESSION` / `JOPLOCK_BACKUP_COMPRESSION_LEVEL` | `zstd:19` / `9` | the compression string wins over the level |
| `JOPLOCK_RECOVERY_ENABLED` / `JOPLOCK_RECOVERY_PASSWORD` / `JOPLOCK_RECOVERY_SESSION_TTL_MINUTES` | `false` / *(empty)* / `30` | break-glass `/recovery` |
| `JOPLOCK_VERSION` | `version.txt`, then `package.json` | shown in the UI; written by the Docker build |

## MFA Notes

- MFA is per-user, managed via Settings → Security → Two-Factor Authentication.
- Each user's TOTP seed is stored in `joplock_settings.totp_seed` in the shared Postgres DB.
- No global/shared TOTP seed. The old `JOPLOCK_TOTP_SEED` / `JOPLOCK_TOTP_ISSUER` env vars are removed.
- `IGNORE_ADMIN_MFA=true` skips the per-user MFA check at login for the docker-defined admin account (`JOPLOCK_ADMIN_EMAIL`). Other users are unaffected.
- Admin can force-enable/disable MFA for any user via the Admin tab (no code required).

## Admin & Ops Surface

### Who is "admin"

- Admin is **not** a role grant inside Joplock. `isJoplockAdmin()` in `app/createServer.js` returns true only for the single account whose email equals `JOPLOCK_ADMIN_EMAIL` **and** whose Joplin `users.is_admin` flag is set (`app/auth/sessionService.js`). If `JOPLOCK_ADMIN_EMAIL` is unset, `adminService` is `null` and there is no admin at all — so the Admin tab and the `/admin/*` routes disappear entirely.
- Only that account sees the Admin tab on `/settings`; `appSettings` (the `__app__` row) is read only for admins (`app/routes/settings.js`).
- `server.js` calls `adminService.ensureAdminUser()` (best-effort, non-blocking) so the account exists in Joplin with the configured password on startup.

### Settings tabs

`/settings` tabs: Appearance, AI, Expander, Profile, Security, About, plus Admin when the user is the Joplock admin. Relevant sub-areas:

- **Appearance** — theme, note/mobile/code/markdown font sizes, note font family, newline behavior, open mode, resume-last-note, date/datetime formats, live search, active-line highlight, UI mode.
- **AI** — provider profiles + sentence count; **Expander** — text/AI trigger strings. See "Expander / AI Autocomplete" above.
- **Profile** — display name / email. **Security** — note-encryption auto-lock, confirm-before-trash, change password, MFA setup/verify/disable, session timeout. **About** — Joplock / Joplin versions.
- **Admin** — Login Security (`authRateLimitAttempts`, `maxUploadMb`, `debugLogging`), Create New User, Users (status/actions), Orphaned Resources (+ cleanup), Database Compression, Notes/Attachments usage, Backup & Restore.

`noteMonospace` is not a separate UI switch: it is derived from `noteFontFamily === 'mono'`
(via the `note-body-monospace` class on `<body>`).

### Backup / restore

- `app/backupService.js` shells out to `pg_dump`/`pg_restore` for the **entire shared database** (Joplin's and Joplock's tables together), writing `<name>.dump` files under `JOPLOCK_BACKUP_DIR` with path-containment checks. Compression is `JOPLOCK_BACKUP_COMPRESSION` (default `zstd:19`) or `JOPLOCK_BACKUP_COMPRESSION_LEVEL` (default `9`).
- A restore **replaces the whole database**, Joplin data included. `README.md` documents the operational order (stop/quiesce Joplin Server, stop sync clients).
- Backups are only durable if `JOPLOCK_BACKUP_DIR` is on persistent storage.

### Break-glass recovery

- `JOPLOCK_RECOVERY_ENABLED=true` + `JOPLOCK_RECOVERY_PASSWORD` expose `/recovery` (`app/routes/recovery.js`, `app/recoveryService.js`): its own login, its own short-lived session (`JOPLOCK_RECOVERY_SESSION_TTL_MINUTES`, default 30), and backup/restore without normal Joplin auth. It is for backup/restore only, not note editing.
- Recovery is separate from MFA: it does not consult `joplock_settings.totp_seed`.

### Login rate limiting

- `app/auth/rateLimitService.js` is an in-memory, per-credential-attempt limiter; the ceiling is the admin `authRateLimitAttempts` setting (default 20 per 15 minutes). It is not persisted — a Joplock restart clears the counters.

## Design Decisions

### Separate repo
Joplock lives outside Joplin monorepo. Keep standalone build, test, docs, Docker flow working without Joplin source tree.

### Shared Postgres database
Joplock reads same Postgres database as Joplin Server. No data duplication. Writes still go through Joplin Server API for compatibility and validation.

### Configurable open mode
Notes can open in rendered mode or markdown mode based on the per-user `noteOpenMode` setting (default **markdown**). The stored value may be `preview` (the pre-TinyMCE name, still accepted and preserved by `normalizeSettings`), but note the vocabulary mismatch: `preferredEditorMode()` returns only `'markdown'` or `'rich'`, and `_editorMode` is never `'preview'`. So `noteOpenMode: 'preview'` means "open rendered", and any `_editorMode === 'preview'` branch is dead. Desktop and mobile both respect the same setting. `initEditorPanel` / `_completeUnlock` must call `preferredEditorMode()` (live `_joplockConfig.noteOpenMode`). Do not let `_tinymceReadonlyDefault()` / mobile-shell read-only force rendered mode — that override made Settings → "Open notes in: Markdown" a no-op on tablet/narrow windows. Mobile read-only still applies, but only when the note actually opens in rendered mode. `_joplockConfig` is inlined in `<head>` *before* `app.js`.

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
- **Dead `getPV()` / `#note-preview` contenteditable code** still exists in `public/app.js` (superseded by TinyMCE). `getPV()` returns null (the element is never rendered by any template), so every `if(pv){...}` branch in the formatting helpers (`wrapSel`, `insertPfx`, `clearFormat`, `openCodeModal`, `submitCode`, `syncPV`, `replacePVTextExpansion`, etc.) is dead and always falls through to the CM/textarea branch. Harmless. NOT removed because it is threaded through ~30 functions and ripping it out risks regressing the live CM path; do it as a dedicated, well-tested cleanup pass, not a drive-by.
- **Image download buttons live in the TinyMCE body, not the dead PV path.** `initResourceImageDownloadButtons`/`activatePV` are legacy-only (PV never renders). The restored button is `initTinyMCEImageDownloadButtons(editor)`, called from `_setTinyMCEContent`'s post-load hook next to `initTinyMCECodeCopyButtons`. Serialization contract (same as the code-copy button): the button is `textContent=''` + `data-mce-bogus="all"` (label via CSS `::after` in `_tinyMCEContentFontStyle()`), so `getContent()` drops it — it can never reach saved markdown, HTML/DOCX/PDF exports. Only the positioning wrap `<span class="preview-img-download-wrap">` survives `getContent()`; `_stripTinymceDownloadChrome()` unwraps it in `tinyMCEContent()` and `tinymceToMarkdown()` so every serialization boundary sees the pre-injection DOM (keeps round-trip hashes stable — no phantom edits). Because the anchor can now sit inside the iframe, `_positionResourceActions` resolves anchor rects via `_anchorRectInHostDoc()` (iframe-viewport rect offset by the iframe element's rect). Coverage: `tests/tinymceImageDownload.test.js`.
- **`highlightTinyMCECodeBlocks()` is unreferenced dead code.** It was the hljs pass over the TinyMCE body before Prism/`codesample` took over; every call site was removed but the function is still defined (`public/app.js`). It is the only hljs consumer besides the dead PV path, so removing it (with `highlightCodeBlocks()`) is a safe, self-contained slice of the PV cleanup.

### Markdown-mode extras (`public/cm-extras.js`)

`initCM()` spreads `_cmExtraExtensions(C)` (try/catch-guarded: a failure must never stop the editor mounting) into the CM6 extension list. The extras need extra symbols from the bundle (`Decoration`, `WidgetType`, `StateField`, `ViewPlugin`, `showPanel`, `hoverTooltip`, fold APIs, `syntaxTree`, `Prec`, ...) — they are exported from `cm-build/index.js`; **if you add an extra that needs another CM symbol, export it there and rebuild with `npm run build:cm`**.

User settings (Settings → Markdown editor; `app/settingsService.js`, whitelisted in `app/routes/api.js`, exposed through `_joplockConfig` in `pages.js`, read in `app.js` as `_mdInlineWidgets` / `_mdLivePreview` / `_mdStatusBar` / `_mdFolding`):

- `mdInlineWidgets` (default ON): image previews, attachment/note-link chips, task checkboxes, code-block background + Copy button.
- `mdLivePreview` (default OFF): hide `#`, `**`, `*`, `~~`, backticks and `[](url)` marks except on the heading line / inside the construct the caret touches. Only when the editor has focus.
- `mdStatusBar` (default ON): bottom `showPanel` with word count, reading time, Ln/Col (or selection word count) and an Outline popup.
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

- The upload modal (`openUploadModal()` → `uploadModalFiles()` → `insertUploadedFiles()`) is the primary picker/drag-drop path; it uploads to `/fragments/upload` and inserts into the live TinyMCE document when in rich mode (or the CM6/textarea target when not). On success (all files upload, no errors) the modal auto-dismisses; if any file errors it stays open showing per-file errors.
- Drag-and-drop directly onto TinyMCE works via `_uploadFileToTinyMCE()` (inserts `<img data-resource-id>` / `<a data-resource-id>` into the live editor). Markdown-mode drops route through `_uploadFileToCM()` (inserts `![](:/id)` at the CM cursor).
- **The upload-modal/picker insert must go through the live editor in rich mode** (it used to fall through to the hidden textarea, which lost the insert). `_captureUploadInsertTarget()` now returns `{ mode: 'tinymce', rng }` when rich mode is active, the TinyMCE host is visible, and the editor is not read-only; `_insertUploadedMarkdown()` then routes to `_insertResourceIntoTinyMCEFromMarkdown(markdown, rng)`, which re-inserts a saved caret range, builds the same `<img>`/`<a>` HTML as the drop path, and inserts it through `_tinyMCEBlockAttachmentHtml()` (so blank-line padding is identical). Read-only editors (mobile rendered mode) still fall through to the textarea/CM branches.
- **Programmatic rich-mode inserts must call `_endTinyMCEPostLoadWindow()` first** (`_uploadFileToTinyMCE`, `insertUploadedFiles`, `_insertResourceIntoTinyMCEFromMarkdown`). An insert is a real edit, not load echo: it clears `_tinymcePostLoad`/`_tinymcePostLoadUntil` and sets `_tinymceUserTypedSinceLoad`. Without this, `onEdit` classifies the insert's own events as round-trip echo, the post-load reconcile re-baselines `_savedHash` to the inserted content, and the debounced save then sees "hash unchanged" — the upload never reaches the server.
- **Dropped/pasted attachments (image AND document) are padded with a blank line before and after** so a single attachment stays easy to delete even when several are stacked. This padding is *only* about spacing around the inserted resource — it does not change how surrounding typed text is handled.
  - Markdown mode (CM6): `_uploadFileToCM()` inserts `<pad>` + ref + `\n\n`, where `<pad>` is `''` at the very start of the doc, `\n` if the char before the cursor is already a newline, else `\n\n`. Both images and documents get this. (Plain source blank line; no `md-blank-line` marker needed because the user edits raw text here.)
  - Rendered mode (TinyMCE): `_tinyMCEBlockAttachmentHtml(editor,inner)` wraps the image/link in its own `<p>` and adds a `<p class="md-blank-line"><br></p>` (the renderer's canonical deletable blank line — see `injectBlankLineBlocks`) before and after, for both images and documents. **Smart**: it skips the leading and/or trailing marker when the caret block is already empty or already adjacent to an existing blank-line paragraph (via `editor.selection.getNode()`), falling back to adding both when the selection API is unavailable (unit tests).
  - Round-trip safety (rendered mode): `md-blank-line` paragraphs are pre-normalized in `tinymceToMarkdown()` and matched by the `blankLine`/`emptyP` Turndown rules → `\x00BL\x00` sentinel → `\n\n\n` (one extra newline = one blank line that re-renders as an `md-blank-line` `<p>`). Do NOT switch these separators to bare `<div><br></div>` or plain empty `<p></p>` — those get merged/dropped around block-level images and swallow the spacing after a few round-trips.
  - `_buildMarkdownInsert()` (used by the upload-modal picker's textarea/CM targets) is unchanged — it still adds a single `\n` on each side as needed. It is deliberately NOT part of the blank-line padding change.
  - Coverage: `tests/cm6MarkdownMode.test.js` (CM padding for image + document; TinyMCE `_tinyMCEBlockAttachmentHtml` markers + smart skip), `tests/previewRoundTrip.test.js` (blank line between stacked image/image, image/doc, doc/image survives render⇄markdown), `tests/appRuntime.test.js` (mode-switch round-trip, no mangling).
- Markdown-mode clipboard paste: `initCM()` registers a CAPTURE-phase `paste` listener on `_cmView.dom` that uploads image/file clipboard items via `_uploadFileToCM()` (`_clipboardFilesToUpload()` decides: non-image files always, images unless the clipboard is a text+HTML rich copy such as a spreadsheet). It must be capture-phase on the editor root: CM6's own paste handler only reads `text/plain` and, for an image-only clipboard, would *replace the selection with an empty string*.
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
- Both markdown mode (CM6) AND rendered mode (TinyMCE) open this same custom full-screen CM6 code modal (`openCodeModal`/`submitCode`) for *editing* the code text/language, NOT TinyMCE's built-in `codesample` dialog. The toolbar uses a custom `jop_code` button; clicking an existing `<pre>` in rendered mode routes through `tinyMCEInsertCodeBlock()` → `openCodeModal()`. On submit in rendered mode, `submitCode()` (TinyMCE branch, `_codeTinyMCE`/`_codeTinyMCEBookmark`) inserts `<pre class="language-x">code</pre>` via `ed.insertContent()` — the `codesample` plugin's `SetContent` handler then highlights it with Prism. Do NOT reintroduce hljs highlighting of rendered-mode blocks; Prism owns rendered-mode coloring. `highlightTinyMCECodeBlocks()` (the old hljs pass over the TinyMCE body) has **no call sites left** — the function body is dead, not deleted, so grep hits are misleading. Do not reintroduce `ed.execCommand('mceCodeSample')` (that opens the built-in dialog).
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

- Folder-first flow: folders -> notes -> editor (the folders screen is an inline expandable tree for nested notebooks; see Nested Notebooks)
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

Per-user (`joplock_settings.settings` JSONB; allowlist for `PUT /api/web/settings` lives in `app/routes/api.js` as `allowedKeys`):

- `theme` — one of `validThemes` in `app/settingsService.js` (21 slugs); display names come from `themeOptions` in `app/templates/shared.js`
- `noteFontSize`, `mobileNoteFontSize`, `codeFontSize`, `markdownFontSize` — note, mobile note, code block, and markdown-editor font sizes
- `noteFontFamily` — `sans` | `mono` | `serif` | `rounded` | `humanist`
- `noteMonospace` — boolean, forces the monospace note body
- `newlineBehavior` — `linebreak` (default) | `invert`; rendered into `<body data-newline-behavior>` and consumed by TinyMCE's `newline_behavior`
- `noteOpenMode` — `markdown` (default) | `preview`
- `resumeLastNote`, `lastNoteId`, `lastNoteFolderId` — last-opened note resumption
- `dateFormat`, `datetimeFormat`
- `uiMode` — `auto` (default) | `mobile` | `desktop`; `auto` picks the mobile shell at/below the shell breakpoint, the explicit values add `force-mobile`/`force-desktop` to `<body>`
- `liveSearch`, `highlightActiveLine` (CM6 caret-line highlight), `confirmTrash`
- `autoLogout`, `autoLogoutMinutes`
- `encryptionAutoLockMinutes`
- `aiProfiles`, `proseAutocompleteSentenceCount`
- `textExpanders`
- `openRouterApiKey`, `openRouterModel` — legacy keys, still migrated into an OpenRouter profile

Admin-only (`user_id = '__app__'` row, normalized by `normalizeAppSettings`):

- `maxUploadMb` — max upload size in MB (default 200, clamp 1–2000)
- `authRateLimitAttempts` — login attempts per window (default 20, clamp 1–1000)
- `debugLogging` (tri-state) — `null` inherits env `DEBUG`; `true`/`false` overrides at runtime

A setting only persists if it is (a) defaulted/normalized in `app/settingsService.js` and
(b) listed in the `allowedKeys` array in `app/routes/api.js` (or handled by a `/admin/*` route
for admin settings). Adding a key to only one of the two silently does nothing.

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
2. Allow the key in the `allowedKeys` array of `PUT /api/web/settings` in `app/routes/api.js` (or in the matching `/admin/*` route for admin-only settings)
3. Add the UI in `settingsPage()` in `app/templates/settings.js`
4. If needed, inject the normalized setting into `layoutPage()` / `_joplockConfig` in `app/templates/pages.js` for `public/app.js`
5. Bump `CACHE_NAME` in `public/service-worker.js` if the change adds or changes shipped client JS/CSS
6. Rebuild with `./scripts/rebuild-dev.sh`

### Adding or editing a theme

Themes are CSS-only. Each theme is a class on `<body>` that sets a shared set of CSS custom properties.

**Files to touch:**

1. **`public/styles.css`** — Add/edit a `.theme-<slug>` block that defines the same set of custom properties used by every other theme.
   - Minimum properties that must be defined: `--bg`, `--theme-color`, `--bg-side`, `--bg-list`, `--bg-editor`, `--bg-elevated`, `--bg-input`, `--bg-hover`, `--bg-active`, `--overlay`, `--shadow`, `--text`, `--text-dim`, `--text-muted`, `--text-heading`, `--text-on-accent`, `--accent`, `--border`, `--border-focus`, `--danger`, `--toolbar-bg`, `--scrollbar`, `--statusbar-bg`, and `color-scheme` (`light` or `dark`).
   - `--bg-elevated` in particular is not optional: it is forwarded into the TinyMCE iframe by `_syncTinyMCEThemeVars()` and backs the image-download button background. A theme missing it renders that button transparent.
   - Keep numbers and hover/active states neutral unless the theme intentionally uses color.
   - The markdown toolbar and the TinyMCE toolbar both share `color-mix(in srgb, var(--accent) 10%, var(--bg))`. Setting a sensible `--accent` and `--bg` is enough; no extra toolbar work needed.

2. **`app/settingsService.js`** — Add the theme slug to the `validThemes` array at the top of the file (it is the allowlist that keeps a persisted slug from being normalized back to the default).

3. **`app/templates/shared.js`** — Add `[<slug>, <displayName>]` to `themeOptions` so it appears in the status bar picker and the settings page.

4. **`tests/settingsService.test.js`** — Add an assertion that `normalizeSettings({ theme: '<slug>' }).theme` is preserved and not normalized back to the default.

5. **`public/service-worker.js`** — Bump `CACHE_NAME` (e.g., `joplock-shell-vN-...`) whenever theme CSS changes. The PWA can cache old `styles.css` aggressively, and the cache-name change forces browsers to fetch the new stylesheet.

6. Rebuild with `./scripts/rebuild-dev.sh`.

No changes are needed in `pages.js`, `app.js`, or `settings.js`: those all read `themeOptions` or apply `theme-${settings.theme}` dynamically.

## Route Notes

`app/createServer.js` assembles the server and delegates to the handlers in
`app/routes/*.js`, each of which exports a `handle(url, request, response, ctx)`
returning `true` when it consumed the request (`app/routes/api.js` additionally
exports the export handlers and CSS/URL helpers for tests). Route ownership by
file:

| File | Routes |
|---|---|
| `app/routes/auth.js` | `/login`, `/login/mfa`, `/logout`, `/heartbeat` |
| `app/routes/settings.js` | `/settings` (full page), `/settings/profile`, `/settings/password`, `/settings/security`, `/settings/mfa/{setup,verify,disable,cancel}` |
| `app/routes/admin.js` | `/admin`, `/admin/users`, `/admin/status`, `/admin/security`, `/admin/backups`, `/admin/restore`, `/admin/db-compression`, `/admin/orphaned-resources{,/ids,/cleanup}` |
| `app/routes/recovery.js` | `/recovery`, `/recovery/login`, `/recovery/logout`, `/recovery/status`, `/recovery/backups`, `/recovery/restore` |
| `app/routes/fragments.js` | `/fragments/nav`, `/fragments/folder-options`, `/fragments/folders` (POST) and `/fragments/folders/:id` (PUT title/parentId, DELETE promotes), `/fragments/folder-notes`, `/fragments/notes` (POST), `/fragments/notes/:id` (DELETE), `/fragments/notes/:id/restore`, `/fragments/editor/:id` (GET fragment, **PUT autosave**), `/fragments/preview`, `/fragments/search`, `/fragments/trash/empty`, `/fragments/shares/inbox`, `/fragments/shares/:id` |
| `app/routes/mobile.js` | `/fragments/mobile/folders`, `/fragments/mobile/notes`, `/fragments/mobile/notes/new`, `/fragments/mobile/search` |
| `app/routes/history.js` | `/fragments/history/:noteId`, `/fragments/history-snapshot/:id`, `/fragments/history/:noteId/restore/:snapshotId` |
| `app/routes/resources.js` | `/resources/:id` (GET/HEAD serve, DELETE), `/fragments/upload` |
| `app/routes/shares.js` | `/api/web/shares` (GET/POST), `/api/web/shares/:id` (GET/DELETE), `/api/web/shares/:id/invites` (GET/POST), `/api/web/shares/:id/leave` (POST), `/api/web/shares/invites/:id` (PATCH/DELETE), accept/reject actions, `/api/web/users/search` |
| `app/routes/api.js` | `/api/web/{client-log,settings,theme,me,folders (+ PUT /:id move/rename),notes,vaults,ai/*}`, `/api/export/{docx,pdf,html}` |

A few contracts worth remembering:

- The editor autosave `PUT /fragments/editor/:id` also sets the
  `X-Note-Updated-Time` / `X-Note-Conflict` response headers the client relies on
  (see "Plaintext save identity guard").
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
- encrypted/vault note wrappers strip HTML comments — irrelevant in practice, since locked notes never load plaintext into TinyMCE

Heading-gap blank lines around ATX headings are no longer lossy: `tinymceToMarkdown(html, prevMd)` keeps Turndown's natural spacing and only falls back to the authored markdown (`prevMd`, what `#note-body` already held for the note) when the fresh conversion differs from it purely in heading-gap shape — collapsing both with `_applyHeadingSpacing()` yields the same text. Authored blank lines around headings survive the switch; untouched compact notes don't gain a phantom "Edited"/save; a real edit always wins (and one-time re-spaces a compact heading note). Do not reintroduce the unconditional `headingGapRe`/`headingLeadRe` collapse in `tinymceToMarkdown()` — it ate blank lines the user typed around headings (reported: add a blank line under a heading in markdown mode, switch to rendered and back, it was gone, and the collapsed body was saved). `_applyHeadingSpacing()` remains for the authored-gap comparator and the legacy preview path (`htmlToMarkdown`). Coverage: `tests/appRuntime.test.js` heading-gap round-trip tests + `playwright-tests/heading-gap-roundtrip.spec.js`.

## Verification

- Run tests: `npm test`
- Browser E2E: `npm run test:ui` (needs a live dev stack + admin env vars, see below)
- Build image: `npm run docker:build`
- Sidecar-only compose: `npm run docker:up`
- Full example compose: `npm run docker:up:full`
- Full example compose built from source: `npm run docker:up:build` (uses `docker-compose.example-full-build.yml`)
- Dev stack: `npm run docker:up:dev` / `./scripts/rebuild-dev.sh` (see "Development Stack")
- Rebuild PWA assets: `npm run generate:pwa-assets`

### Playwright credentials

- Tests NEVER hardcode credentials. `playwright-tests/helpers.js` resolves the admin account from the environment in this order: `PLAYWRIGHT_ADMIN_EMAIL` → `PLAYWRIGHT_EMAIL` → `JOPLOCK_ADMIN_EMAIL` (and the `*_PASSWORD` equivalents). The dev container sets `JOPLOCK_ADMIN_*`, so the useful tests work against it out of the box.
- `login()` calls `requireCredentials()` and fails loudly if none are set. Admin-only specs (`resource-lifecycle`, `auth-rate-limit`) use `hasAdminCredentials()` to `test.skip` when unset. `helpers.js` exports `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`hasAdminCredentials` so specs share one source of truth.

### Playwright helper robustness (do not simplify these away)

The shared helpers absorb races in the app's two-phase htmx settling, not test flakiness:

- `setNoteBody()` clicks whichever markdown toggle is **visible** (`#editor-panel #markdown-toggle:visible`, `#mobile-editor-body #markdown-toggle:visible`, `#mobile-md-toggle:visible`). The mobile shell hides the editor fragment's own MD toggle and shows the header `#mobile-md-toggle` from `pages.js`; a locator that does not filter on `:visible` can click a hidden element and silently inject into a textarea TinyMCE then overwrites.
- `setNoteTitle()` waits for the note-creation swaps to land, then sets the title and **verifies it stuck**, retrying up to 8 times. The creation response re-renders the editor with server state (`Untitled note`) after the form first appears, wiping an early title injection.
- `deleteNotebook()` waits for the `#nav-panel` swap to settle and retries the delete while a stale/duplicated folder row is still present.
- Specs must not depend on a user's editor settings: `md-extras.spec.js` pins the markdown-editor settings in `beforeAll` and restores the account's real values in `afterAll`; other specs read the CodeMirror *document* (`getCM().state.doc`), not `.cm-content` text, because "hide formatting marks" removes `## ` from the DOM of lines the caret is not on. Specs whose flow needs a native `confirm()` (e.g. `deleteNotebook()`) must call `acceptDialogs(page)`; the two-account share specs are desktop-only.
- When adding a helper, prefer a shared one in `helpers.js` over a per-spec local; delete helpers only after confirming no spec imports them.

### Playwright data cleanup (do not leave notes/notebooks/resources behind)

- **Tests must not leave data in the shared Joplin DB.** Every spec that creates notebooks/notes/resources must clean them up.
- Use `teardownTestData(page, { folders, folderPrefixes, titlePrefixes, noteIds })` from `helpers.js` in a `finally` block. It permanently removes the matching notes (trash + purge via `DELETE /fragments/notes/:id` twice), deletes the folders, empties trash, and cleans orphaned resources. It is best-effort (never throws), so it is safe in `finally` even after a failed assertion.
  - Prefer `{ folders: [folder] }` — purges every note inside the notebook *then* deletes the notebook. (Plain `deleteNotebook()` is NOT enough on its own: deleting a notebook never deletes its notes — they move to the parent notebook, or **General** at the top level — so they leak.)
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

- **Joplin field fidelity + compatibility harness**: pass-through serializer, stored `fields` on every item, HTML notes rendered read-only, Joplin-E2EE items as locked placeholders, conflict copies hidden, share id read from `jop_share_id`, OCR fields on uploads; opt-in real-client tests (`npm run test:joplin`). Also fixed along the way: **restoring a note from the trash returned 404 for every trashed note** (the ownership lookup ignored trashed notes), and **editing a shared note twice in Joplock silently unshared it**. See "Joplin Field Fidelity".
- **Nested notebooks**: Joplin's `parent_id` hierarchy now renders as a tree on desktop (multi-expand, rolled-up counts, ancestors open) and mobile (inline expandable tree), with create-under-parent, move (tree picker), delete-promotes, whole-subtree sharing, and vaults as top-level leaves. `app/items/folderTree.js` + `app/items/folderOps.js`. `updateFolder` also stopped resetting `created_time`/`icon`.
- **Rich-mode uploads now insert through the live editor**: uploading from the modal or the older `#file-upload` picker in rendered mode used to target the hidden `#note-body` textarea, which TinyMCE's own lazy sync overwrote before the debounced save fired — the attachment silently vanished. `_captureUploadInsertTarget()` now captures a TinyMCE caret range (`{mode:'tinymce', rng}`) when the host is visible and the editor is not read-only, and `_insertResourceIntoTinyMCEFromMarkdown()` rebuilds the `<img>`/`<a>` from the saved `![](:/id)` markdown, inserts it with the same `_tinyMCEBlockAttachmentHtml()` padding as drag-drop, and syncs `#note-body` immediately. All three rich-mode insert paths call `_endTinyMCEPostLoadWindow()` so the insert is treated as a real edit instead of post-load echo (otherwise the reconcile re-baselines the hash and the save sees "unchanged"). Read-only (mobile rendered) keeps the textarea/CM fallback. See "Upload behavior" above.
- **flushSave uses `keepalive: true`**: the unload-time flush (visibilitychange, tab close, note-switch navigation) was being aborted mid-flight — Chromium sent a truncated request with no `Cookie` header (401) and the pending edits were lost. Pinned by `tests/saveIdentityGuard.test.js`.
- **Image download buttons restored in rendered mode**: `initTinyMCEImageDownloadButtons()` injects them into the TinyMCE body (the old `#note-preview` host is dead), with `data-mce-bogus="all"` + `_stripTinymceDownloadChrome()` keeping them out of saved markdown and every export, and `_anchorRectInHostDoc()` translating iframe rects for the resource-action sheet. Coverage: `tests/tinymceImageDownload.test.js`.
- **Heading-gap blank lines survive a rendered round-trip**: `tinymceToMarkdown(html, prevMd)` no longer unconditionally collapses blank lines around ATX headings; it only prefers the authored markdown when the fresh conversion differs purely in heading-gap shape. Fixes "typed a blank line under a heading, switched to rendered and back, it was gone (and the collapsed body got saved)" without reintroducing phantom "Edited" on untouched compact notes. Coverage: `tests/appRuntime.test.js` + `playwright-tests/heading-gap-roundtrip.spec.js`.
- **Playwright helper hardening**: `setNoteBody()` clicks the visible markdown toggle (`#mobile-md-toggle` in the mobile shell), `setNoteTitle()` verifies the title sticks across the creation re-render (8 retries), `deleteNotebook()` retries through a mid-swap duplicated nav row. See "Playwright helper robustness" above.
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
