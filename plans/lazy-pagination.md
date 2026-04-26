# Lazy Folder Expansion + Paginated Note Loading

## Problem

Every page load fetches all 20k note headers from Postgres (parsing 20k JSON blobs via `convert_from::json->>'title'`), transfers all rows to Node, renders 20k `<button>` DOM elements into the nav panel. Logout is slow because the browser must tear down that massive DOM.

## Solution: Lazy folder expansion with paginated note loading

### Phase 1: Database Layer

#### 1.1 Add composite index

```sql
CREATE INDEX IF NOT EXISTS idx_items_owner_type_parent_updated
ON items (owner_id, jop_type, jop_parent_id, jop_updated_time DESC);
```

Speeds up per-folder paginated queries and count aggregations.

#### 1.2 New query: `folderNoteCountsByUserId(userId)`

Single query returns `{folderId: count}` without fetching any note rows.

```sql
SELECT jop_parent_id AS folder_id, COUNT(*) AS count
FROM items
WHERE owner_id = $1 AND jop_type = 1
  AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) = 0
GROUP BY jop_parent_id
```

Plus a separate count for trashed notes (deleted_time > 0).

Returns a Map: `{ folderId -> noteCount, __all__ -> totalNonTrashed, __trash__ -> totalTrashed }`.

**File:** `app/items/itemService.js`

#### 1.3 New query: `noteHeadersByFolder(userId, folderId, limit, offset)`

Paginated version of `noteHeadersByUserId`, scoped to one folder.

```sql
SELECT jop_id, jop_parent_id, jop_updated_time,
    COALESCE(convert_from(content, 'UTF8')::json->>'title', '') AS title,
    COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) AS deleted_time
FROM items
WHERE owner_id = $1 AND jop_type = 2
  AND jop_parent_id = $3
  AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) = 0
ORDER BY jop_updated_time DESC, created_time DESC
LIMIT $4 OFFSET $5
```

Special cases:
- `folderId = '__all__'` → no parent filter, exclude deleted
- `folderId = '__trash__'` → filter deleted_time > 0, no parent filter

Default: `limit=100, offset=0`.

**File:** `app/items/itemService.js`

---

### Phase 2: Server / Nav Refactor

#### 2.1 Refactor `navData()`

Currently fetches ALL note headers. Change to:

```js
const navData = async userId => {
    const [folders, counts] = await Promise.all([
        itemService.foldersByUserId(userId),
        itemService.folderNoteCountsByUserId(userId),
    ]);
    // Build folder list with counts, but NO note arrays
    const allFolders = [
        allNotesFolder(counts.get('__all__') || 0),
        ...folders,
        trashFolder(counts.get('__trash__') || 0),
    ];
    return { folders: allFolders, counts };
};
```

`allNotesFolder()` and `trashFolder()` change to accept a count number instead of a notes array.

**File:** `app/createServer.js:237-246`

#### 2.2 Update `navigationFragment()`

Currently receives full `notes` array and renders all note items inline. Change to:

- Receive `folders` and `counts` (Map of folderId → count)
- Each folder renders its count in the badge but `.nav-folder-notes` div starts **empty**
- No `noteListItem()` calls during initial render
- When `selectedNoteId` is set, the folder containing that note gets its first page pre-loaded server-side (so the active note is visible on page load)

**File:** `app/templates.js:181-258`

#### 2.3 New endpoint: `GET /fragments/folder-notes`

Query params: `folderId`, `offset` (default 0), `limit` (default 100), `selectedNoteId` (optional).

Response: HTML string of `noteListItem()` elements + optional "Load more" button.

```js
// Pseudo-code
const notes = await itemService.noteHeadersByFolder(user.id, folderId, limit, offset);
const totalCount = counts.get(folderId) || 0;
const hasMore = offset + notes.length < totalCount;
let html = notes.map(n => noteListItem(n, selectedNoteId, folderId)).join('');
if (hasMore) {
    html += loadMoreButton(folderId, offset + limit, selectedNoteId);
}
return html;
```

**File:** `app/createServer.js` (new route)

#### 2.4 "Load more" button template

```html
<button class="notelist-load-more"
    hx-get="/fragments/folder-notes?folderId=${folderId}&offset=${nextOffset}"
    hx-target="closest .nav-folder-notes"
    hx-swap="beforeend"
    hx-on::after-request="this.remove()">
    Load more (${remaining} notes)
</button>
```

Replaces itself on click; appends next batch before the new "Load more" button.

Actually: `hx-swap="outerHTML"` on the button itself is cleaner — response replaces the button with more items + a new button if still more exist.

**File:** `app/templates.js` (new small template)

---

### Phase 3: Client-Side Folder Expand

#### 3.1 Update `toggleNavFolder()`

Currently just toggles a CSS class to show/hide the `.nav-folder-notes` div (which already has all items).

Change to:
1. Toggle CSS class (show/hide) as before
2. On **first expand**, if `.nav-folder-notes` is empty (no `noteListItem` children), fire htmx request:
   ```js
   htmx.ajax('GET', '/fragments/folder-notes?folderId=' + folderId, {
       target: notesDiv, swap: 'innerHTML'
   });
   ```
3. Subsequent toggles just show/hide — no re-fetch
4. Mark folder div with `data-loaded="1"` after first fetch

**File:** `app/templates.js` (in the inline `toggleNavFolder` function)

---

### Phase 4: Targeted Updates (No Full Nav Reload)

#### 4.1 Note create

Currently: `hx-target="#nav-panel" hx-swap="innerHTML"` — reloads entire nav.

Change to: Server returns the new note's `noteListItem` HTML. Client prepends it to the active folder's `.nav-folder-notes` div and updates the count badge. Could use htmx OOB swaps or a small JS handler.

#### 4.2 Note save

Currently: Some saves reload nav. Change to: Only update the note's title in the existing DOM element if title changed. No nav reload needed.

#### 4.3 Note delete / move to trash

Remove the `<button>` from current folder's list, decrement count badge, increment trash count badge.

**Files:** `app/createServer.js` (response format changes), `app/templates.js` (htmx targets)

---

### Phase 5: Mobile

#### 5.1 Mobile note list pagination

Mobile uses `htmx.ajax('GET', '/fragments/mobile/notes?folderId='+folderId, ...)`.

Change mobile notes endpoint to use same `noteHeadersByFolder()` with LIMIT 100 + "Load more" button.

**File:** `app/createServer.js` (mobile notes fragment), `app/templates.js` (mobile templates)

---

### Phase 6: Search

#### 6.1 Search already has LIMIT 50

`searchNotes()` in `itemService.js:123` already limits to 50 results. No change needed.

#### 6.2 Nav search

Nav search (`/fragments/nav` with query param) currently calls `noteHeadersByUserId` for ALL notes, then filters client-side in the template. Change to use `searchNotes()` instead (already limited to 50).

**File:** `app/createServer.js` (nav fragment handler)

---

### Phase 7: Testing

- Run existing 129 tests, fix any breakage from API changes
- Manual test with 20k-note dev database:
  - Initial page load: should fetch ~10 folders + counts only
  - Expanding "All Notes": loads first 100 notes
  - "Load more" fetches next 100
  - Logout: instant (DOM is small)
  - Note create/delete: folder count updates without full reload
  - Search: fast (already limited to 50)

---

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Initial nav query | 20k rows, JSON parse each | ~10 folders + COUNT aggregate |
| Initial DOM nodes | ~20k buttons | ~10 folder rows |
| Expand folder | instant (already loaded) | ~100ms fetch, 100 items |
| Logout | slow (DOM teardown) | instant |
| Note create | full nav reload (20k) | prepend 1 item |
| Memory | all 20k note headers in DOM | ~100 at a time |

---

## Files to Modify

1. `app/items/itemService.js` — new queries, index creation
2. `app/createServer.js` — new endpoint, refactor navData, targeted swaps
3. `app/templates.js` — lazy navigationFragment, toggleNavFolder, load-more button, mobile
4. `tests/templates.test.js` — update tests for new signatures
5. Database — CREATE INDEX (via startup migration or script)
