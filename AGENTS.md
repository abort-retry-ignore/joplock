# Agents

Joplock is a standalone web client for a stock, unmodified Joplin Server: Node (no framework), server-rendered HTML with htmx fragment swaps, and one large client file (`public/app.js`). It reads the shared Postgres directly and writes through Joplin Server's own API, so the same account keeps working from Joplin desktop, mobile and CLI.

This file is loaded on every task, so it is short on purpose. It gives the rules and says where the **reasons** live. It does not say where code lives: use the code index below (it cannot go stale). The topic files in `docs/agents/` hold the hard-won "why" and "do not regress" rules. **Read the one that matches what you are about to change, before you change it.**

## Before you touch ... read

| You are changing | Read first |
|---|---|
| the editor: CodeMirror/TinyMCE, mode switching, autosave, markdown round-trip, a phantom "Edited" | `docs/agents/editor.md` |
| any save path, vaults/encryption, note history/restore, anything reading the editor DOM across a note switch | `docs/agents/vaults-and-save-safety.md` |
| how notes/notebooks/resources are serialized or written (anything another Joplin client can see) | `docs/agents/joplin-fidelity.md` |
| the notebook tree, drag and drop, sort, pins, sharing, `user_items` | `docs/agents/notebooks-and-sharing.md` |
| upload, paste or drop of images/attachments | `docs/agents/editor-uploads.md` |
| `public/cm-extras.js` or the CodeMirror bundle | `docs/agents/editor-markdown-extras.md` |
| mobile layout, PWA, service worker, viewport/keyboard, static serving, anything iOS | `docs/agents/pwa-mobile.md` |
| text expander, AI autocomplete, `/ask` | `docs/agents/ai-expander-ask.md` |
| settings, themes, admin, backup/recovery, MFA, debug logging | `docs/agents/settings-and-admin.md` |
| server shape, htmx/fragment conventions, routes, data model, or you are unsure where something belongs | `docs/agents/architecture.md` |
| tests, Playwright, the dev stack, "my change does not show up" | `docs/agents/testing-and-dev.md` |

## Rules that always apply

1. Do not modify Joplin Server source for Joplock features unless explicitly approved.
2. The server is authoritative and the browser is ephemeral: no browser-local authoritative storage, and logout must clear client-visible state (shared machines).
3. Stay sync-compatible with normal Joplin clients. A Joplock write changes **only what the user edited** (`docs/agents/joplin-fidelity.md`).
4. Keep the sidecar API app-oriented; do not expose the raw sync/storage model to the frontend.
5. Keep changes minimal. Fix the cause, not the symptom, and add a test that fails without the fix. When you fix mobile, check desktop (and the reverse): they share the editor fragment.

## Workflow

- `npm test` before every commit (CI runs it on Node 20; this machine may run a newer Node).
- **Pushing to `master` publishes the Docker image**: GitHub Actions runs the tests, then builds and pushes `ghcr.io/abort-retry-ignore/joplock:latest`. Do not commit to `master` or push unless the user asks.
- Source edits need `./scripts/rebuild-dev.sh` (the image copies `app/`, `public/` and `server.js` at build time; a container restart is not enough). Browser tests (`npm run test:ui`) need that dev stack and `JOPLOCK_ADMIN_*` in the environment; see `docs/agents/testing-and-dev.md`.
- `plans/` is gitignored local history, **not documentation**; `plans/README.md` lists what is stale. Trust the code and these docs over any plan.
- Asset versions and the service worker cache name are computed (`app/assetVersion.js`): never hand-edit or "bump" them.
- After large changes run `graft build` so the code index matches.

## Traps that have each broken real data or a real phone

One line each; the topic file has the detail.

- **Inline `onclick="foo()"` only sees `window.foo`.** A function works in a unit test and is "not defined" in the browser unless `public/app.js` assigns it to `window` (`tests/inlineHandlersExposed.test.js`).
- **Never write one note's text into another.** Debounced saves, async fetches and TinyMCE are shared across note switches; every save path has an identity guard (`vaults-and-save-safety.md`).
- **The markdown <-> TinyMCE round trip must be idempotent**, or notes show a phantom "Edited" on open and get re-saved (`editor.md`).
- **Do not decode `items.content` for every item in SQL**: it also holds binary resources and one attachment aborts the statement (`notebooks-and-sharing.md`).
- **iOS home-screen apps**: never set `apple-mobile-web-app-status-bar-style: black-translucent`; never guess a keyboard from `innerHeight - visualViewport.height`; decide mobile vs desktop from the physical screen, never the window height (`pwa-mobile.md`). Chromium cannot reproduce any of this: measure on a device with `/diag`.
- **DOM ids and classes are a contract with inline JS and tests.** Rename them deliberately.
- **Floating menus need an opaque background and edge clamping**; pure `:hover` styles go inside `@media (hover: hover)` (`architecture.md`, `pwa-mobile.md`).

## Code index

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
