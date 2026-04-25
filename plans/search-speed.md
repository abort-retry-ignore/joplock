# Plan: Speed Up Note Search

## Problem

`searchNotes` runs `ILIKE '%query%'` on the entire `content` bytea blob via `convert_from(content, 'UTF8')`. For 2k+ notes this means:

1. Every row's binary content is decoded on every search
2. The full JSON string is scanned — including JSON keys, resource IDs, metadata
3. No index can accelerate the `ILIKE` on the raw blob
4. Attachments/resources are matched via embedded JSON fields (undesirable)

## Constraints

- No Joplin Server modifications (AGENT_GUIDE.md)
- No changes to the `items` table schema (owned by Joplin Server)
- Writes continue through Joplin Server API
- Must stay compatible with Joplin desktop/mobile/CLI clients

## Changes

### 1. Targeted field search — DONE

Replace the current `ILIKE` on the full JSON blob with extraction of `title` and `body` fields only:

```sql
-- Before
AND convert_from(content, 'UTF8') ILIKE $3

-- After
AND (
    convert_from(content, 'UTF8')::json->>'title' ILIKE $3
    OR convert_from(content, 'UTF8')::json->>'body' ILIKE $3
)
```

This fixes two problems at once:
- Stops matching on JSON structure, resource IDs, and metadata fields
- Never searches attachment content (only note title and body text)

No database changes required — purely a query change in application code, taking effect immediately at query time.

### 2. pg_trgm GIN indexes — not implemented

Postgres requires all functions in an expression index to be marked `IMMUTABLE`. `convert_from(bytea, text)` is not immutable, so expression indexes on `convert_from(content, 'UTF8')::json->>'title'` fail at creation time with:

> functions in index expression must be marked IMMUTABLE

Workarounds (immutable wrapper functions, generated columns) would require touching the shared `items` table schema more invasively. Given the query fix alone eliminates the main source of waste (full-blob scan, attachment matching), the index was dropped from scope.

### 3. Live search setting — DONE

Add a user setting `liveSearch` (boolean, default `false`) that switches the search input from submit-on-enter to search-on-every-keystroke (≥3 chars, 300ms debounce via htmx).

- Default off — preserves existing behavior for all users
- When enabled, `hx-trigger` changes from `keyup[key==='Enter']` to `input changed delay:300ms` with a minimum length guard
- Controlled via a checkbox in Settings → Appearance, saved via the existing `PUT /api/web/settings` mechanism
- Setting stored in `joplock_settings` JSONB — no schema change needed

## Files changed

| File | Change |
|---|---|
| `app/items/itemService.js` | Update `searchNotes` SQL to search `->>'title'` and `->>'body'` only |
| `app/settingsService.js` | Add `liveSearch` to defaults, normalizer |
| `app/templates.js` | Add `liveSearch` checkbox to Settings → Appearance; pass setting to `noteListFragment`; conditional `hx-trigger` on search input |
