# Lazy Folder Expansion + Paginated Note Loading + Search Pagination

## Problem

Every page load fetches all 20k note headers from Postgres (parsing 20k JSON blobs via `convert_from::json->>'title'`), transfers all rows to Node, renders 20k `<button>` DOM elements into the nav panel. Logout is slow because the browser must tear down that massive DOM. Search results are not paginated and body search uses ILIKE which does a full table scan.

## Implementation Status

### DONE (commit `fd468fe`)

- Phase 1: Database indexes and new queries
- Phase 2: Server / nav refactor (lazy folder loading)
- Phase 3: Client-side folder expand with htmx lazy loading
- Phase 5: Mobile pagination
- Tests: 129/129 passing

### TODO

- Phase 4: Targeted updates (avoid full nav reload on create/save/delete) — deferred
- Phase 6: Search pagination + pg_trgm trigram index

---

## Phase 1: Database Layer (DONE)

### 1.1 Composite index

```sql
CREATE INDEX IF NOT EXISTS idx_items_owner_type_parent_updated
ON items (owner_id, jop_type, jop_parent_id, jop_updated_time DESC);
```

Created on server startup via `ensureIndexes()` in `itemService.js`.

### 1.2 `folderNoteCountsByUserId(userId)` (DONE)

Two parallel COUNT queries. Returns `Map<string, number>` with folder IDs + `__all__` + `__trash__`.

### 1.3 `noteHeadersByFolder(userId, folderId, limit, offset)` (DONE)

Paginated per-folder query. Default LIMIT 100. Handles `__all__`, `__trash__`, and real folder IDs.

---

## Phase 2: Server / Nav Refactor (DONE)

### 2.1 `navData()` refactored

Fetches only `foldersByUserId` + `folderNoteCountsByUserId`. No note rows.

### 2.2 `navigationFragment()` refactored

Accepts `countsOrNotes` — a Map (lazy mode) or array (search results mode). In lazy mode, `.nav-folder-notes` divs start empty. In search mode, renders inline note items.

### 2.3 `GET /fragments/folder-notes` endpoint

Returns paginated `noteListItem` HTML + "Load more" button when `hasMore`.

### 2.4 `folderNotesPageFragment()` template

Renders note items + conditional "Load more" button (`hx-swap="beforeend"`, self-removing on click).

---

## Phase 3: Client-Side Folder Expand (DONE)

### 3.1 `toggleNavFolder()` updated

On first expand, fires `htmx.ajax('GET', '/fragments/folder-notes?folderId=...')` into the `.nav-folder-notes` div. Guards with `data-loaded` attribute.

### 3.2 `initNavPanel()` updated

Auto-triggers lazy load for folders expanded on page load (restored state, selected folder).

---

## Phase 4: Targeted Updates (DEFERRED)

Not yet implemented. Currently, note create/save/delete still reload the full nav panel (which is now cheap since it only has folder rows + counts). Can be optimized later if needed.

---

## Phase 5: Mobile (DONE)

- `mobileFoldersFragment` accepts counts Map
- `mobileNotesFragment` accepts `hasMore` + `nextOffset`, renders "Load more"
- `/fragments/mobile/notes` uses paginated `noteHeadersByFolder`

---

## Phase 6: Search Pagination + pg_trgm (TODO)

### 6.1 pg_trgm trigram index for body search

The `searchNotes()` query uses `ILIKE '%pattern%'` which forces a full table scan — no B-tree index can help with leading wildcards. At scale (100k+ notes), this becomes a bottleneck.

**Solution:** Enable PostgreSQL's `pg_trgm` extension and create a GIN trigram index on the extracted title+body text. Trigram indexes support `ILIKE` with leading `%` patterns.

Add to `ensureIndexes()`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_items_search_trgm
ON items
USING GIN (
    (
        COALESCE(convert_from(content, 'UTF8')::json->>'title', '') || ' ' ||
        COALESCE(convert_from(content, 'UTF8')::json->>'body', '')
    ) gin_trgm_ops
)
WHERE jop_type = 1;
```

**Notes:**
- Index covers raw title+body text; the regexp_replace stripping of base64/resource links stays at query time only
- `pg_trgm` is included in standard Postgres installs (no extra packages)
- GIN index build is O(n) but only runs once; subsequent inserts maintain incrementally

### 6.2 Paginate `searchNotes()`

Change signature: `searchNotes(userId, query, limit = 50, offset = 0)`

Add `LIMIT $4 OFFSET $5` parameters to the existing query.

**File:** `app/items/itemService.js`

### 6.3 Desktop notelist search (`/fragments/search`)

Currently: calls `searchNotes()` → `searchResultsFragment(notes)` — returns all 50 results at once.

Change to:
- Read `offset` query param (default 0)
- Call `searchNotes(auth.user.id, query, 50, offset)`
- Detect `hasMore = results.length === 50`
- Pass `hasMore`, `nextOffset`, `query` to template

**File:** `app/createServer.js`

### 6.4 Desktop nav search (`/fragments/nav?q=...`)

**No change** — stays capped at 50 results (LIMIT 50 default in `searchNotes`), no pagination. The sidebar nav search replaces the entire nav panel, making incremental pagination awkward. 50 results is sufficient for sidebar browsing.

### 6.5 Mobile search (`/fragments/mobile/search`)

Same pattern as desktop notelist search:
- Read `offset` query param
- Call `searchNotes(auth.user.id, query, 50, offset)`
- Pass `hasMore`, `nextOffset`, `query` to `mobileSearchFragment`

**File:** `app/createServer.js`

### 6.6 Template updates

**`searchResultsFragment(notes, hasMore, nextOffset, query)`**

Append "Load more" button when `hasMore`:

```html
<button class="notelist-load-more"
    hx-get="/fragments/search?q=${encodeURIComponent(query)}&offset=${nextOffset}"
    hx-target="#notelist-items"
    hx-swap="beforeend"
    hx-on::after-request="this.remove()">
    Load more results…
</button>
```

**`mobileSearchFragment(notes, hasMore, nextOffset, query)`**

Same pattern, targeting mobile results container.

**File:** `app/templates.js`

### 6.7 Test updates

- Update `searchNotes` mock signature in `createServer.test.js` to accept `limit`/`offset`
- Add assertions for "Load more" in search results when 50 results returned
- Test `searchResultsFragment` and `mobileSearchFragment` with `hasMore=true/false`

---

## Expected Impact

| Metric | Before (original) | After Phase 1-5 | After Phase 6 |
|--------|-------------------|-----------------|---------------|
| Initial nav query | 20k rows, JSON parse | ~10 folders + COUNT | same |
| Initial DOM nodes | ~20k buttons | ~10 folder rows | same |
| Expand folder | instant (pre-loaded) | ~100ms fetch, 100 items | same |
| Logout | slow (DOM teardown) | instant | same |
| Search (20k notes) | 50 results, full scan | same | trigram index, fast |
| Search (100k notes) | very slow full scan | same | trigram index, fast |
| Search pagination | no pagination, 50 cap | same | 50 per page, Load more |
| Memory | 20k note headers in DOM | ~100 at a time | same |

---

## Files Modified (Phase 1-5, DONE)

1. `app/items/itemService.js` — `ensureIndexes()`, `folderNoteCountsByUserId()`, `noteHeadersByFolder()`, exported constants
2. `app/createServer.js` — `navData()` refactored, `GET /fragments/folder-notes` endpoint, all `navigationFragment` calls updated, mobile endpoints paginated, `NOTE_PAGE_SIZE`/`VIRTUAL_*` imported
3. `app/templates.js` — `navigationFragment` lazy mode, `folderNotesPageFragment`, `toggleNavFolder` lazy load, `initNavPanel` lazy load, `mobileFoldersFragment` counts Map, `mobileNotesFragment` pagination
4. `server.js` — `ensureIndexes()` call on startup
5. `public/styles.css` — `.notelist-load-more` button styles
6. `tests/createServer.test.js` — added `folderNoteCountsByUserId`/`noteHeadersByFolder` to default mocks, updated assertions for lazy nav
7. `tests/templates.test.js` — updated `navigationFragment` tests for counts Map, added `folderNotesPageFragment` tests

## Files to Modify (Phase 6, TODO)

1. `app/items/itemService.js` — `ensureIndexes()` add pg_trgm + GIN index; `searchNotes()` add limit/offset params
2. `app/createServer.js` — `/fragments/search`, `/fragments/mobile/search` add offset handling
3. `app/templates.js` — `searchResultsFragment`, `mobileSearchFragment` add Load more button
4. `tests/createServer.test.js` — update search mock signatures
5. `tests/templates.test.js` — add search pagination tests
