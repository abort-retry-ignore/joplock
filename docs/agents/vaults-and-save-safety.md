# Vaults, encryption and save safety

> Read this before: touching vaults/encryption, ANY autosave or save path, note history/restore, or code that reads the editor DOM during a note switch. These guards each exist because a real note was overwritten.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

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
  2. **Ciphertext required inside vaults**: saving to a vault folder always requires an encrypted body. Same-folder saves are covered; sync-proxy writes are covered **only for cookie-authenticated (browser) traffic, not stock Joplin clients** (see "Known issues found with the real client" (`docs/agents/joplin-fidelity.md`)). `enforceExistingVault=true` (sync-proxy only) extends this to prevent external Joplin clients from stripping ciphertext by re-parenting.
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

## Debugging

### If vault behavior misbehaves

- Check whether the folder is marked with `isVault`
- Check whether the note is marked with `inVault` / `isEncrypted` / `vaultId`
- Check `toggleVaultLock()`, `unlockNote()`, `_completeUnlock()`, and `flushSave()` in `public/app.js`
- Check whether the hidden editor shells still exist in locked editor HTML
