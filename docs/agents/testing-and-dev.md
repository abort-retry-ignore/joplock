# Testing and the dev stack

> Read this before: running or writing tests (unit, Playwright), rebuilding the dev stack, or when a code change does not show up.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

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

- Mobile UX reference, only if you have the Joplin monorepo checked out next to this repo: `~/dev/joplin/packages/app-mobile/`
- Use it for interaction ideas and behavior parity targets, not as a copy-paste implementation source
- Joplock must still fit the SSR + htmx sidecar architecture

## Debugging: If a code change does not appear in the app

- Rebuild with `./scripts/rebuild-dev.sh`
- Do not rely on `docker compose ... restart joplock` after source edits
- If still stale, inspect the built container logs and confirm the right compose stack is running

## Tests
- `tests/*.test.js` — unit/integration tests (`node:test`; several suites extract real functions out of `public/app.js` and run them under a JSDOM harness)
- Run: `npm test` (i.e. `node --test tests/*.test.js`)
- Real Joplin client compatibility (opt-in, needs the dev stack): `npm run setup:joplin-cli` once, then `npm run test:joplin` (`integration-tests/*.test.js`)
- `playwright-tests/*.spec.js` — browser E2E against a live dev stack; run with `npm run test:ui`

## Configuration, compose files and built bundles

Facts that are not obvious from the repo layout:

- **Configuration is inline environment variables in the compose files** (they are commented); there is no committed `.env.example`, and `.env` is git-ignored. The variables themselves are read in `server.js` and the services; do not copy a list of them into docs.
- `docker-compose.dev.yml` is the per-developer dev stack (Postgres + Joplin Server + Joplock from source). It is **git-ignored**; if it is missing, recreate it from `docker-compose.example-full-build.yml`. `./scripts/rebuild-dev.sh` and `npm run docker:up:dev` use it. Do not use the sidecar-only `docker-compose.yml` for development.
- **Bundles are built, never hand-edited:** `cm-build/` -> `public/codemirror.min.js` (`npm run build:cm`; the markdown extras need extra CodeMirror symbols exported from `cm-build/index.js`), `hljs-build/` -> `public/hljs.min.js` (`npm run build:hljs`), `prism-build/` -> `public/prism.min.js` (`npm run build:prism`). `public/tinymce/` is the TinyMCE 8 npm package copied in. `public/html-docx.js` is the legacy client-side DOCX path. `public/reference.docx` is the pandoc reference document for DOCX styling (regenerate with `scripts/build-reference-docx.sh`).
- Icons and splash images are generated: `npm run generate:pwa-assets` (see `docs/agents/pwa-mobile.md`).
