# Notebooks, nesting and sharing

> Read this before: touching the notebook tree (nesting, drag and drop, sort, pins), notebook create/move/delete rules, or anything about sharing / `user_items`.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

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

### Drag and drop (desktop)

Drag a notebook onto another to nest it; drop it on the **"Drop here to move to the top level"** strip (only shown while dragging a *nested* notebook) to un-nest it. Hovering a closed notebook that has sub-notebooks for 700 ms opens it so deeper targets are reachable.

- The template decides who takes part: `navigationFragment` puts `draggable="true" data-dnd="1"` on the row of ordinary notebooks only (not All Notes, Trash, vaults or Joplin-encrypted notebooks). The script reads those attributes; the **server re-validates every move** (`PUT /fragments/folders/:id`), and a refusal is shown with `alert()` (e.g. "Stop sharing this notebook before moving it into another notebook").
- Handlers (`navDragStart/Over/Leave/Drop/End`, `navDropAllowed`, `navMoveFolder` in `public/app.js`) are **delegated on `document`**, so they survive htmx re-renders. `dragenter` and `dragover` share one handler. `dragleave` must be judged by position when `relatedTarget` is null (Chromium fires it, with a null target, when the pointer crosses a row's own child elements); clearing the highlight on every `dragleave` made it flicker off. Visual changes happen a tick after `dragstart` because changing layout synchronously there cancels the drag in some browsers.
- Desktop only: touch has no HTML5 drag-and-drop, mobile uses the "Move notebook..." sheet. Real-mouse coverage: `playwright-tests/nested-folders.spec.js` ("drag and drop"); pure rules and lifecycle: `tests/nestedFoldersUi.test.js`.

### Notebook order (A-Z / most recently updated)

Per-user setting `folderSort` (`alpha` default | `recent`; Settings -> Appearance, plus a quick switch in the sidebar header `#nav-sort-btn` and the mobile folders header `#mobile-sort-btn`, both calling `toggleFolderSort()`; `<body data-folder-sort>` picks which label shows).

- **What "recent" means** (`sortFoldersByRecent` in `app/items/folderTree.js`, data from `itemService.folderActivityByUserId`): a notebook's rank is the newest note activity **anywhere in its subtree** (so a parent rises with its busiest child, like Joplin's own "updated date" notebook sort), using the note's `user_updated_time` (falls back to the row time) and the notebook's creation time when nothing is in it. Trashed and conflict notes do not count. Because `user_updated_time` only moves on a real title/body edit (see Joplin Field Fidelity in `docs/agents/joplin-fidelity.md`), **moving or trashing a note does not reorder notebooks**.
- **Parents always show.** The order is applied to the FLAT list before the tree is built, so reordering can never separate a notebook from its parent; siblings simply sort by their own rolled-up recency, ties keep alphabetical order.
- **Where it applies:** the sidebar (`navData` -> `orderFoldersForUser`) and the mobile folders screen. **Pickers are always alphabetical** (editor notebook `<select>`, move / new-notebook dialogs): `sortFoldersByRecent` tags each folder with `alphaRank` and `inAlphabeticalOrder()` restores it, so the database's collation is never re-derived. The activity query only runs for users who chose "recent".
- Switching order re-renders the nav via `/fragments/nav`; lazily loaded note lists now receive the open note's id (`navLoadFolderNotes`) so it stays highlighted.
- Tests: `tests/folderTree.test.js` (ordering), `tests/folderSort.test.js` (SQL, setting, routes, pickers), `playwright-tests/folder-sort.spec.js`.

### Pinned notebooks

Pin a notebook to the top of the list: **Pin to top / Unpin from top** in the desktop context menu (`#folder-ctx-pin`) and the mobile long-press sheet (`#mobile-folder-ctx-pin`); a pin icon marks pinned rows (`.nav-pin-icon`, `.mobile-pin-icon`, `data-pinned="1"`).

- **Joplock-only, per user.** Stored as `pinnedFolders` in `joplock_settings` (max 100 ids, distinct); changed only through `PUT` / `DELETE /api/web/pinned-folders/:id`. **Nothing is written to the Joplin notebook** (Joplin has no pin concept), so Joplin apps are unaffected, other users do not see your pins, and a recipient can pin a notebook that was shared with them. Pinning a notebook that does not exist is a 404; a successful pin also forgets pins of notebooks that no longer exist (stale ids are otherwise ignored on render). Guarded by a byte-for-byte check of the Joplin item in `playwright-tests/folder-pin.spec.js` and a "no Joplin write" unit test.
- **Ordering** (`applyPinnedFirst` in `app/items/folderTree.js`, applied in `orderFoldersForUser` after the A-Z / recent order): pinned notebooks come first among their siblings; among themselves they follow the active order. **Pinning a nested notebook pulls its ancestors up** (rank 1 = "contains a pinned notebook") so it stays near the top and is still drawn under its parents; ancestors are not themselves marked pinned. Like every ordering here it runs on the FLAT list, so a notebook can never be separated from its parent.
- **Pickers ignore pins** (editor notebook select, move / new-notebook dialogs): `applyPinnedFirst` keeps/assigns `alphaRank` so `inAlphabeticalOrder()` restores the alphabetical order.
- Tests: `tests/folderTree.test.js` (rules), `tests/folderPin.test.js` (setting, endpoints, routes, pickers, client helpers), `playwright-tests/folder-pin.spec.js`.

### Mobile contract

- The folders screen is an **inline expandable tree** (not drill-down), so `mobileBack` and the 3-screen stack are untouched. Rows carry `data-folder-id/-parent-id/-depth` and `--m-depth`; rows below the top level render `hidden` and `mobileApplyFolderTree()` reveals them from `localStorage['joplock-mobile-folders']` (sub-notebooks shown; separate from the desktop key). `.mobile-folder-row[hidden]` needs its own CSS rule because `display:flex` beats the UA `[hidden]`.
- The chevron (`.mobile-folder-toggle`) is its own tap target and stops propagation; the row tap still calls `mobilePushNotes(id,title)`. **Keep the `mobilePushNotes("id","title")` onclick format**: `wireFolderRowLongPress` parses it. The chevron gutter is only rendered when something is nested.
- Long-press sheet gained "New sub-notebook" and "Move notebook…". The note-move sheet (`mobileCtxMove`) reuses the editor `<select>`'s option text, so the tree indentation carries over.
- Both expansion keys are cleared on logout (`pages.js`).

### Rules enforced server side (`folderOps`)

- **Structure:** not into itself or a descendant (mirrors Joplin's `canNestUnder`). Same-parent move is a no-op.
- **Delete = promote.** Sub-notebooks move up to the deleted notebook's parent; its notes move to that parent (top level: the existing top-level "General", created if missing). Deleting never deletes notes or sub-notebooks. (Old behaviour moved every note to General and orphaned sub-notebooks.)
- **Vaults are top-level leaves.** Cannot contain notebooks, cannot be moved, cannot be created nested (`POST /api/web/vaults` refuses a nested notebook or one with children), cannot end up in a share. The new-notebook modal disables the parent picker when "vault" is ticked. `vaultProxyGuard` also rejects a notebook PUT whose parent is a vault, **but see "Sync-proxy guards do not apply to stock Joplin clients" in `docs/agents/joplin-fidelity.md`: that guard is currently inert for real clients.**
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
