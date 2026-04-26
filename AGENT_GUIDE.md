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
- **Client**: SSR HTML + htmx fragment swaps
- **Editor**: CodeMirror 6 for markdown editing, contenteditable rendered markdown preview mode
- **Code blocks**: Full-screen code modal with CM6 editor and language picker; highlight.js for preview mode syntax highlighting
- **Autosave**: htmx delayed PUT after typing pause (deferred while modals are open)
- **Markdown**: server-side `renderMarkdown()`, client-side Turndown `htmlToMarkdown()`
- **Auth**: reuses Joplin Server `sessionId` cookie
- **DB access**: reads direct from shared Postgres; writes go through stock Joplin Server API

### Runtime Shape

- Initial page load is full SSR HTML from `layoutPage()` in `app/templates.js`
- After load, most interactions are fragment-driven via htmx
- The browser is intentionally thin: most state is DOM state, form state, or small client-only UI state in inline JS
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

- `templates.js` returns raw HTML strings, not JSX/templates/components
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
- `app/createServer.js` — all HTTP routes, SSR, preview, upload, resources, auth pages

### Templates / UI
- `app/templates.js` — SSR HTML, inline client JS, markdown rendering, editor mode logic

Important subareas inside `templates.js`:
- `settingsPage()` — Settings UI and simple client save helpers
- `editorFragment()` — shared editor DOM used by desktop and mobile
- `layoutPage()` — logged-in app shell, inline client JS, mobile shell, autosave/editor wiring
- `renderMarkdown()` — server-side markdown-to-HTML for preview/render mode
- mobile fragments and shell logic — folder-first mobile UI, note list, search, editor screen stack

### Auth
- `app/auth/cookies.js` — cookie parsing
- `app/auth/sessionService.js` — shared DB session lookup
- `app/auth/mfaService.js` — env-driven TOTP verification and otpauth/QR generation

### Data
- `app/items/itemService.js` — DB reads for folders, notes, search, resources
- `app/items/itemWriteService.js` — note/folder/resource serialization and upstream writes
- `app/settingsService.js` — Joplock-owned settings table access

### How Reads vs Writes Work

- Reads come from the shared Postgres DB for speed and to match the current server state
- Writes do not write directly to Joplin tables; they go through stock Joplin Server APIs
- That split is intentional: Joplock can stay lightweight while preserving compatibility with normal Joplin clients
- If behavior looks inconsistent after a write, inspect both the sidecar request path and the upstream Joplin API call path

### Static Assets
- `public/htmx.min.js`
- `public/codemirror.min.js` — CM6 bundle with 11 language parsers (built from `cm-build/`)
- `public/hljs.min.js` — highlight.js bundle for preview mode code highlighting (built from `hljs-build/`)
- `public/styles.css`
- `public/service-worker.js`
- `public/manifest.webmanifest`

### Bundle Build Sources
- `cm-build/` — CM6 bundle source (`npm install && npm run build` → `public/codemirror.min.js`)
- `hljs-build/` — highlight.js bundle source (`npm install && npm run build` → `public/hljs.min.js`)

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

### Two modes

- **Markdown mode**: CodeMirror 6 is visible, textarea is sync target
- **Rendered mode**: contenteditable preview is visible, Turndown converts edited HTML back to markdown

### Source of truth during editing

- The hidden textarea `#note-body` is the form field used for saves
- In markdown mode, CodeMirror changes sync into `#note-body`
- In rendered mode, preview DOM changes sync back into markdown via `htmlToMarkdown()`
- The title is mirrored between `.editor-title`, hidden title input, and mobile title header when applicable

### Save lifecycle

- `markEdited()` updates UI state to `Edited`
- `scheduleSave()` triggers delayed autosave for body/form changes
- `scheduleSaveTitle()` is a shorter timer for title changes
- `htmx:afterRequest` on the editor save path transitions UI state back to `Saved`
- Offline/request failure paths set status to `Offline`

### Important fragility points

- DOM IDs and class names are part of the editor contract with inline JS
- Preview HTML must remain convertible back to markdown with acceptable fidelity
- Checkbox, code block, and blank-line handling are easy to regress
- The code modal is outside the fragment-swapped editor so it survives swaps

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

### Mobile editor behavior

- Mobile hides the desktop title bar and uses the mobile header instead
- Mobile header mirrors note title and save state
- Mode buttons should remain visible and clearly indicate the active mode
- Toolbar visibility should be keyed to being inside the mobile editor container, not only screen width
- Newly-created empty mobile notes may be discarded on back if still blank/untitled

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
- `dateFormat`
- `datetimeFormat`
- `liveSearch`
- `autoLogout`
- `autoLogoutMinutes`

### Adding a new setting

1. Add default + normalization in `app/settingsService.js`
2. Allow the key in `/api/web/settings` in `app/createServer.js`
3. Add the UI in `settingsPage()` in `app/templates.js`
4. If needed, inject the normalized setting into `layoutPage()` client JS
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
- Inline JS in `templates.js` is fragile; validate escaping-heavy changes carefully
- The code modal lives in `loggedInLayout`, not inside `navigationFragment` or `editorFragment`, so it survives htmx OOB swaps
- Be careful with checkbox text handling, `\n`, regex escaping, and DOM-to-markdown round trips
- Keep standalone repo paths/docs/scripts correct; avoid reintroducing monorepo assumptions
- Prefer changing existing inline helpers over introducing a new abstraction unless there is clear reuse
- When fixing mobile behavior, verify desktop is unchanged
- When fixing desktop editor behavior, verify mobile still works because both use the same editor fragment
- Be cautious with `htmx:afterRequest` assumptions; in htmx 2.x, response headers are often more reliable than old event-property assumptions

## Debugging Guidance

### If a code change does not appear in the app

- Rebuild with `./scripts/rebuild-dev.sh`
- Do not rely on `docker compose ... restart joplock` after source edits
- If still stale, inspect the built container logs and confirm the right compose stack is running

### If mobile note creation/opening misbehaves

- Check whether the server response includes the expected mobile header such as `X-Mobile-Note-Id`
- Check the `htmx:afterRequest` handler that consumes that header
- Compare new-note path vs existing-note path

### If toolbar/mode behavior is inconsistent

- Verify whether the current editor is actually inside `#mobile-editor-body`
- Check `syncEditorModeButtons()` and `setEditorMode()`
- Check whether the note was initialized with the expected `noteOpenMode`

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

## Key Conventions

- `plans/` is gitignored — do not commit plan files
- Do not push to remote unless the user explicitly asks
- Run `npm test` before every commit
