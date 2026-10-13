# Settings, themes, admin and ops

> Read this before: adding a setting or theme, changing the settings page, admin/backup/recovery, MFA, or debug logging.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

## Storage

- Settings are stored per-user in `joplock_settings.settings` as JSONB
- `app/settingsService.js` owns defaults and normalization
- Unknown or invalid values should normalize back to safe defaults

## What persists a setting

A setting only persists if it is (a) defaulted/normalized in `app/settingsService.js` and
(b) listed in the `allowedKeys` array in `app/routes/api.js` (or handled by a `/admin/*` route
for admin settings). Adding a key to only one of the two silently does nothing.

The list of settings and their defaults is `defaultSettings` / `normalizeSettings` in `app/settingsService.js`; it is not copied here.

`noteMonospace` is not a separate UI switch: it is derived from `noteFontFamily === 'mono'`
(via the `note-body-monospace` class on `<body>`).

## Debug Logging (runtime-toggleable)

- `appSettings.debugLogging` is tri-state (`normalizeTristate()` in `app/settingsService.js`): `null` = inherit env `DEBUG`; `true`/`false` = explicit admin override persisted in DB.
- `app/createServer.js` keeps `effectiveDebug` in memory; `refreshDebugLogging()` re-reads the DB on startup and after an admin save. `isDebug()` is read dynamically by the request logger and passed into ctx; `_joplockConfig.debug` and the settings-page inline `DEBUG` flag both reflect the effective state.
- Toggled via the "Enable debug logging" checkbox in Settings → Admin → Login Security. Applied immediately, no restart. `DEBUG` env in the compose files is only the startup default.

## The settings page is a full page, not a modal

- `/settings` is a standalone SSR page (full navigation away from the app), not an htmx fragment or modal. It has its own inline `<script>` and does NOT load `app.js`.
- Esc dismisses it (returns to `/`) via `<body onkeydown="...">` — an HTML attribute so it fires before any JS and can't be killed by a script error. It flashes the page background briefly as visual confirmation. Do not move this back into an `addEventListener` inside the IIFE; that proved unreliable (IIFE errors / event-propagation quirks swallowed Esc).
- Settings auto-save, so Esc has no unsaved-text concern.

## Adding a new setting

1. Add default + normalization in `app/settingsService.js`
2. Allow the key in the `allowedKeys` array of `PUT /api/web/settings` in `app/routes/api.js` (or in the matching `/admin/*` route for admin-only settings)
3. Add the UI in `settingsPage()` in `app/templates/settings.js`
4. If needed, inject the normalized setting into `layoutPage()` / `_joplockConfig` in `app/templates/pages.js` for `public/app.js`
5. Nothing to bump: the asset version and service worker cache name are computed from the shipped files (`app/assetVersion.js`)
6. Rebuild with `./scripts/rebuild-dev.sh`

## Adding or editing a theme

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

5. **Service worker / asset version** — nothing to do: `app/assetVersion.js` hashes the shipped files, so new theme CSS changes the version, the `?v=` URLs and the worker's cache name automatically. Add the theme's `--theme-color` in its CSS block (`app/themeColors.js` reads it for the page head; `tests/themeColors.test.js` fails if a selectable theme lacks one).

6. Rebuild with `./scripts/rebuild-dev.sh`.

No changes are needed in `pages.js`, `app.js`, or `settings.js`: those all read `themeOptions` or apply `theme-${settings.theme}` dynamically.

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


### Backup / restore

- `app/backupService.js` shells out to `pg_dump`/`pg_restore` for the **entire shared database** (Joplin's and Joplock's tables together), writing `<name>.dump` files under `JOPLOCK_BACKUP_DIR` with path-containment checks. Compression is `JOPLOCK_BACKUP_COMPRESSION` (default `zstd:19`) or `JOPLOCK_BACKUP_COMPRESSION_LEVEL` (default `9`).
- A restore **replaces the whole database**, Joplin data included. `README.md` documents the operational order (stop/quiesce Joplin Server, stop sync clients).
- Backups are only durable if `JOPLOCK_BACKUP_DIR` is on persistent storage.

### Break-glass recovery

- `JOPLOCK_RECOVERY_ENABLED=true` + `JOPLOCK_RECOVERY_PASSWORD` expose `/recovery` (`app/routes/recovery.js`, `app/recoveryService.js`): its own login, its own short-lived session (`JOPLOCK_RECOVERY_SESSION_TTL_MINUTES`, default 30), and backup/restore without normal Joplin auth. It is for backup/restore only, not note editing.
- Recovery is separate from MFA: it does not consult `joplock_settings.totp_seed`.

### Login rate limiting

- `app/auth/rateLimitService.js` is an in-memory, per-credential-attempt limiter; the ceiling is the admin `authRateLimitAttempts` setting (default 20 per 15 minutes). It is not persisted — a Joplock restart clears the counters.
