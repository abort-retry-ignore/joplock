# Joplin field fidelity

> Read this before: writing or serializing notes, notebooks or resources, or anything another Joplin client can see. A Joplock write must change only what the user edited.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

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
