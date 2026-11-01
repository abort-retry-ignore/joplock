# Public demo and demo mode

> Read this before: changing demo mode (`app/demoMode.js`), the login page or settings routes in a way that could let a demo visitor change the shared account, the default-admin guard (`app/defaultAdminGuard.js`), the seed scripts, or anything under `deploy/demo/`.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

## What the demo is

`https://joplock.bazooda.com`, deployed from `deploy/demo/` (human guide: `deploy/demo/README.md`). One shared account, published login **demo / demo**, wiped every 30 minutes by restoring a snapshot. Visitors are anonymous and untrusted, and they see each other's edits until the next reset.

## Demo mode contract (`JOPLOCK_DEMO_MODE=true`)

- **Login mapping.** Only the published login (`JOPLOCK_DEMO_LOGIN` / `JOPLOCK_DEMO_LOGIN_PASSWORD`) signs in; Joplock swaps it for the real account (`JOPLOCK_DEMO_ACCOUNT_EMAIL` / `_PASSWORD`, a long secret) before calling Joplin Server. Every other login is refused *before* it reaches Joplin Server, so the default admin or a guessed account cannot be tried through the demo. The real credentials are not a way in either.
- **Refusals live in one choke point** in `createServer` (`demoRefusal()`), before any route runs: account changes (password, profile/email, two-factor, session timeout: a visitor could lock everyone else out), AI (provider URLs are user-set, so the server would fetch arbitrary addresses, e.g. the cloud metadata service; and keys typed in would be shown to the next visitor), and sharing. Settings routes redirect with a message, APIs return 403. Add new account-changing routes to `demoRefusal()`, never to the UI only. The settings page also marks those tabs `inert`, which is cosmetic.
- `PUT /api/web/settings` drops `DEMO_BLOCKED_SETTINGS` (AI keys/profiles) in demo mode; other preferences (theme etc.) are allowed and shared until the reset.
- Uploads are capped at `JOPLOCK_DEMO_MAX_UPLOAD_MB` (Caddy also caps request bodies).
- `ensureDemoAccount()` runs at startup: creates the account if missing and puts its password, enabled flag and non-admin role back. Every reset restarts Joplock, so a password changed by any other route does not survive.
- An invalid demo configuration is fatal at startup: a half-configured public demo must not run.
- The countdown ("resets in N min") is computed in the browser from the wall clock: resets happen every `JOPLOCK_DEMO_RESET_MINUTES` from the epoch. The systemd timer (`OnCalendar=*:00,30 UTC`) must stay aligned with it.

Coverage: `tests/demoMode.test.js` (config, mapping, every refusal through the real server, upload cap, account repair).

## Default admin guard (all deployments, not just the demo)

Joplin Server creates `admin@localhost` with the password `admin` and expects it to be changed. If it is not, anyone who can reach Joplin Server, or Joplock's login (which signs in through it), becomes a Joplin admin and can reset every user's password. `lockDefaultJoplinAdmin()` locks that one account (random password, disabled, sessions removed) **only while its password is literally `admin`**, at startup and every 10 minutes (Joplin creates it after Joplock may have looked). Opt out with `JOPLOCK_LOCK_DEFAULT_ADMIN=false`. Note: Joplin Server still issues a session to a *disabled* account at login (Joplock then rejects it on every request), so the password change, not the flag, is what makes it safe.

## The deployment (`deploy/demo/`)

- Only Caddy is published. Joplin Server has no port and Joplock runs with an empty `JOPLIN_PUBLIC_BASE_PATH` (no `/joplin` proxy), so Joplin's own login page and API are unreachable. `/joplin/...` paths hit Joplock's own catch-all (login redirect).
- `build-golden.sh` builds the snapshot on a fresh database at every deploy (images may change the schema) and **refuses to save it if any admin account is enabled**. `reset.sh` restores it, waits for Joplin Server (over HTTP), Joplock, and a real demo login, and ends visitors' sessions.
- Joplin Server answers only requests whose `Host` matches `APP_BASE_URL`; probes from inside the network must send it (see `server_up` in `deploy/demo/app/lib.sh`). A plain `127.0.0.1` request gets a 404 "Invalid origin".
- The seed signs in with the demo login, so the build waits until the demo account exists first: failed retries would count against the login rate limit.
- Stopping containers uses `-t 2`: the database is replaced next, and the default 10-second graceful stop doubled the reset time.
- Caddy replaces a client-sent `X-Forwarded-For` (it trusts no upstream proxy), so Joplock's per-IP login rate limit sees real client addresses. Behind proxies that *append* to that header the first entry is client-controlled (known issue, not specific to the demo).
- Host hardening lives in `deploy/demo/terraform/`: no IAM role, IMDSv2 with hop limit 1 (containers cannot reach instance metadata), SSH from `admin_cidrs` only.

## Seed content

`scripts/seed-demo.mjs` (and `scripts/seed-showcase.mjs` for dev screenshots) share `scripts/lib/`. Every body starts with `# <title>` and the scripts derive the title from it (`titleOf`), because the editor takes the title from the first line (see `editor.md`). Checklist items stay plain text (rendered mode does not yet format inline markdown inside `- [ ]` items); `tests/seedContent.test.js` enforces it. The server-side seed has no image library, so the banner is pre-rendered in `deploy/demo/app/seed/` (regenerate with `node scripts/seed-showcase.mjs --preview-banner …`). Joplock's starter "AI Features" note is deleted (AI is off in the demo).

The demo also has a **demo-vault** vault (published password `demo`, with one note explaining vaults), a "top 10 features" note in the pinned **Examples** notebook, and the account set to the light theme with notes opening rendered (`DEMO_SETTINGS`; Joplock's own defaults are earth and Markdown). The features note states facts the code can change (the theme count, 50 history versions): `tests/seedVault.test.js` ties them to `app/settingsService.js` and `app/historyService.js`. A vault's text is encrypted in the *browser* and the server never sees a password, so `scripts/lib/seed-vault.mjs` redoes the browser's crypto in Node (`public/app.js`: `deriveKey`, `buildVaultVerify`, `encryptForVault`). `tests/seedVault.test.js` pins every constant to `app.js`, so a format change there fails the test instead of shipping a vault nobody can unlock. Joplock refuses plaintext in a vault and a note's id exists only after it is created, so each vault note is created holding an empty ciphertext and then rewritten with ciphertext bound to its id: the text is never stored in the clear. `deploy/demo/deploy.sh` copies the seed's modules by name: a new `scripts/lib/` import must be added there (the test checks it), or the golden build fails on the demo host.
