# PWA and mobile platform

> Read this before: touching the mobile layout or its screens, the viewport / soft keyboard, the service worker, static serving, iOS behaviour, or `/diag`. iOS findings here come from a real device, not an emulator.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

## PWA & Mobile Platform

Everything about being an installed phone app lives here: which layout a device gets, how the iOS home-screen viewport and soft keyboard behave, what is cached, and how to measure it. **iOS behaviour here was found on a real iPhone Air home-screen install, not in an emulator**: Chromium cannot reproduce the iOS soft keyboard scrolling the document, the status-bar viewport bug, display cutouts or the home indicator. Before changing shell, viewport or keyboard layout, measure on a device with `/diag` (below) and compare numbers, not impressions. The app is an installable PWA with no offline notes: the only thing available offline is a static "you're offline" page.

### Which shell (mobile vs desktop)
`isMobileShellMode()` (`_computeMobileShell`, `public/app.js`) is true for uiMode `mobile`, or in `auto` when the window is <=768px wide, **or** the device is a phone: `(pointer: coarse)` and a physical screen whose short side is <=500 CSS px (`_isPhoneScreen`). The second clause keeps a phone in landscape (812-956px wide) on the mobile shell; it used to get the desktop layout in ~390px of height and rotating reloaded the page (a shell flip reloads). The CSS mirror is the media query `(max-width: 768px), (pointer: coarse) and (max-device-width: 500px), (pointer: coarse) and (max-device-height: 500px)` on the four former `max-width: 768px` blocks in `styles.css`; iOS reports `device-width` as the portrait width in both orientations and Android rotates it, hence both. **Never use the window height** to decide: a soft keyboard shrinks the window (on iOS home-screen apps `innerHeight` shrinks with it), which would flip an iPad to the phone layout and reload the page while typing. Tablets (screen short side >=600) and mouse-driven windows keep the width rule only. The mobile shell is inset by `env(safe-area-inset-left/right)` (landscape notch / Dynamic Island), and `@media (max-height: 500px)` tightens the title bar and toolbar; in landscape with the keyboard up the editor's title bar (`#mobile-editor-header` only, never the search header) steps aside. Covered by `tests/landscapeShell.test.js` and `playwright-tests/mobile-landscape.spec.js` (the iPad case sets the physical screen apart from the window through CDP, because `page.setViewportSize` shrinks the emulated screen too). Mobile/tablet editor behavior should be reasoned about by editor container context, not just viewport width.

### iOS home-screen status bar (do NOT use black-translucent)
Pages must not set `apple-mobile-web-app-status-bar-style` (leave it absent, as herdr-web-ui does). With `black-translucent`, an iOS standalone app sizes `innerHeight`/`100dvh`/`100svh` as *screen height minus the top safe-area inset*, anchored at the top, while `100lvh`/`100vh` still report the full screen. The shell then ends that many points above the bottom edge (a dead band painted in the page background) and every `position: fixed; bottom: …` element (FAB, bottom sheets, backdrops) floats too high. Measured on an iPhone Air: screen 812, `innerHeight` 751, top inset 61. Absent meta = content starts below the status bar, bottom edge lands on the hardware, safe-area-top is 0. iOS bakes the value in at install time, so after changing it the icon must be removed and re-added. `tests/pwaHead.test.js` guards this, that every `apple-touch-startup-image` file exists and matches its media query, and that each `100vh` has a `100dvh` fallback (WebKit reports `100vh`/`100lvh` overflowing in default-style standalone installs). Newer iPhones need their own splash entry in `app/templates/shared.js` + `scripts/generatePwaAssets.mjs` (iPhone Air 420×912 @3x, 16/17 Pro 402×874 @3x are included).

### Soft keyboard / viewport (`public/viewport.js`)

Loaded in `<head>` after the inline config and before `app.js`. On a touch device it decides whether a soft keyboard is up (`keyboardVisible`: a typing element is focused, or the keyboard was already up, AND the visual viewport has lost more than 20% of the largest unobstructed height seen; pinch zoom and non-touch never count) and then: sets `html[data-keyboard]` plus `--app-height` / `--app-top`, which `styles.css` applies to `.mobile-app` only in that state (outside it the shell is `inset:0` exactly as before); and, while the mobile shell is showing, puts any document scroll back to (0,0). Reason: iOS scrolls the document to reveal the caret (measured on an iPhone Air home-screen app: `scrollY` 268-342px even with `body{position:fixed}`), which carries the header and the markdown toolbar off the top of the screen; sizing the shell to the visible area and pinning the scroll leaves nothing to scroll. It fires `joplock:viewport` on `document`; `positionTinyMCEHost` uses `#mobile-app`'s bottom (not an `innerHeight` guess) and re-anchors on that event. Never reintroduce `innerHeight - visualViewport.height` keyboard guesses (an iOS home-screen app shrinks `innerHeight` with the keyboard). Kill switch on a device: `localStorage['joplock-viewport'] = 'off'`. With the admin debug flag on it posts `viewport.kb` events (keyboard state, visual viewport, scroll, how often it had to pin, header/toolbar positions on screen) to `/api/web/client-log`; read them with `node scripts/diag-reports.js --event viewport.kb` (flags `HDR-OFF`, `TB-OFF`, `TB-HIDDEN`, `PANNED`, `NOT-PINNED`). `./scripts/rebuild-dev.sh` archives device reports into `.diag-archive/` before recreating the container (a recreate wipes its logs). `/diag?shell=vv` runs this same module. Covered by `tests/viewport.test.js` (pure logic, real iPhone numbers) and `playwright-tests/mobile-toolbar-keyboard.spec.js`.

### Zoom, touch and hover CSS
One `viewportMeta` constant (`app/templates/shared.js`) is used by every page: `width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content`. Zoom is allowed (WCAG 1.4.4; `user-scalable=no` also blocks pinch zoom on Android; iOS Safari ignores it anyway). Double-tap zoom on controls is off through `touch-action: manipulation`, and `public/viewport.js` does not pin the page scroll while the user is pinch-zoomed (`shouldPin`). `interactive-widget=resizes-content` only affects Android Chrome. The end of `styles.css` has the touch block (`@media (hover: none) and (pointer: coarse)`: no text-size inflation, tap flash, selection or callout on controls; selection stays on fields and `.cm-content`) and a `prefers-reduced-motion` block (the loading ring keeps turning). Pure `:hover` feedback rules must live inside `@media (hover: hover)`: iOS emulates hover on tap and leaves it stuck (a tapped toolbar button stayed highlighted). Reveal-on-hover affordances that mix `:hover` with another state have `(hover: none)` fallbacks and are exempt. `tests/touchCss.test.js` lints this. `/diag` can reproduce the old meta (`?zoom=0`, `?iw=0`) for comparison.

### Static asset serving (`serveFile` in `app/routes/_helpers.js`)
Compressible text assets (.js .css .json .svg .html .webmanifest, 1 KB to 4 MB) are served brotli/gzip, negotiated from `Accept-Encoding` (q-values respected), with `Vary: Accept-Encoding` and a content-hash `ETag` per encoding (a stale copy revalidates with a 304, not a re-download). Brotli (level 11) and gzip are computed once, asynchronously, and cached in memory per file+mtime; `warmStaticCache(publicDir)` does the root-level files at startup so the first visitor does not wait. A URL carrying `?v=<asset version>` is `immutable` for a year (every script and stylesheet in the app head carries it; `tests/pwaHead.test.js` enforces that); other files are `max-age=300` plus ETag; `service-worker.js` and the manifest are `no-cache`; html is `no-store`; images and fonts stream with a weak validator. Measured on the dev stack: shipped JS+CSS 2.5 MB raw → 0.77 MB (gzip) / 0.67 MB (brotli); cold relaunch with an expired cache on a slow 4G link 7.8s → 2.6s. The reverse proxy in front (Nginx Proxy Manager defaults) does not compress JS/CSS, so this must stay in the app. Covered by `tests/staticServing.test.js`. HTML responses are gzipped separately by `makeSendHtml`.

### Service worker policy (`public/service-worker.js`)
Deliberately small. Navigations go to the network; if that fails the worker serves the static `/offline.html` (inline styles, a Try again button that checks `/health` and reloads, auto-retry on the `online` event). Versioned `.js`/`.css` URLs (`?v=<asset version>`, immutable by construction) are cache-first in a cache named `joplock-shell-<asset version>`; any other Joplock cache is deleted on activate, other apps' caches are left alone. Nothing else is intercepted: **no HTML page, API response, fragment, note or attachment is ever cached** (shared-browser safety; the app has no offline notes). The install step precaches only `/offline.html` and an icon. It used to precache bare URLs that the `?v=` requests never matched (so assets were stored twice) and never cached `app.js`/TinyMCE. Covered by `tests/serviceWorker.test.js` (the real file in a sandbox) and `playwright-tests/pwa-offline.spec.js` (real browser: cached assets, offline launch, recovery). Not done: an in-app "new version, reload" prompt; the new worker takes over immediately (`skipWaiting` + `claim`).

### Device diagnostics (`/diag`)

Debug-mode-only page (`app/routes/diag.js`, `app/templates/diag.js`) for measuring viewport, safe-area and soft-keyboard behaviour on a real phone. Linked from Settings → About when debug logging is on. It mocks the mobile shell (header, iframe + input + textarea like the real editors, bottom bar) and posts flat snapshots to `/api/web/client-log`, which land in the container log as `[joplock client] diag.viewport {…}`. Read them with `node scripts/diag-reports.js [--since 30m] [--event diag.viewport|viewport.kb] [--rid <id>] [--json]` (one compact line per report, flags `HDR-OFF` / `BAR-HID` / `BAR-GAP` / `NO-SAFE`). Variants: `?shell=current` (the plain fixed-inset shell, i.e. what iOS does with no help), `?shell=vv` (loads `public/viewport.js`, the production module: shell height follows `visualViewport` while the keyboard is up, page scroll pinned). The viewport meta defaults to the app's own (`viewportMeta`); `?iw=0` drops `interactive-widget=resizes-content` and `?zoom=0` blocks zoom (the old meta) for comparison. Report field names must not match the client-log key filter (`text|body|content|password|key|secret|token`); `tests/diagPage.test.js` enforces that. Use it before changing shell/keyboard layout so the change is compared against real-device numbers, not Chromium emulation (which cannot reproduce the iOS keyboard or notch).

## Mobile UI Model

### Shell structure

- `#mobile-folders-screen`
- `#mobile-notes-screen`
- `#mobile-editor-screen`

These screens are shown/hidden by inline JS in `layoutPage()` using class changes, not route changes.

### Mobile navigation behavior

- Folder-first flow: folders -> notes -> editor (the folders screen is an inline expandable tree for nested notebooks; see Nested Notebooks in `docs/agents/notebooks-and-sharing.md`)
- Search has its own mobile header state
- Mobile note creation uses dedicated fragment endpoints and server headers to drive the next UI step
- The floating action button is only a mobile affordance; desktop should stay unaffected
- FAB visibility should follow screen state directly (`folders` / `notes` visible, `editor` hidden), not only htmx swap side effects
- In markdown mode the mobile formatting toolbar (`#editor-toolbar`) is permanent: `setMobileToolbarVisible(false)` is ignored there (only a locked vault hides it). Callers ask to hide it when the viewport handler thinks the keyboard went away, which is wrong on iOS home-screen apps (`innerHeight` shrinks with the visual viewport, so an open keyboard looks closed), and from the rich editor's blur handler after a switch to markdown. Do not reintroduce `innerHeight - visualViewport.height` keyboard guesses; see `/diag` for real-device numbers. Covered by `tests/mobileToolbarVisibility.test.js` and `playwright-tests/mobile-toolbar-keyboard.spec.js`.
- The markdown editor's word-count / heading-outline bar (`.cm-jl-status`, `mdStatusBar` setting) is desktop-only: `_cmExtraExtensions` passes `statusBar: _mdStatusBar && !isMobileShellMode()`, so it is never created in the mobile shell (it costs a row under the editor and recounts words on every keystroke). The Outline jump-to-heading popup lives in that bar, so it is not available on mobile either. Covered by `tests/mobileStatusBar.test.js` and `playwright-tests/md-extras.spec.js`.
- `#mobile-folders-body` / `#mobile-notes-body` carry `padding-bottom: calc(96px + env(safe-area-inset-bottom))` so the last row (or the notes list's "Load more" button) scrolls clear of the FAB (56px + 20px offset) and the home indicator. Scope it to those two ids: `#mobile-editor-body` shares `.mobile-screen-body` and must not get it. Covered by `playwright-tests/mobile-list-clearance.spec.js`.
- Mobile folder rows can include a vault lock button and it must stay inline with the row actions

### Mobile editor behavior

- Mobile hides the desktop title bar and uses the mobile header instead
- Mobile header mirrors note title and save state
- Mode buttons should remain visible and clearly indicate the active mode
- Toolbar visibility should be keyed to being inside the mobile editor container, not only screen width
- Newly-created empty mobile notes may be discarded on back if still blank/untitled
- Locked mobile notes should not reveal plaintext/editor surfaces until unlock

### Tablet expectations

- A tablet window wider than 768px gets the **desktop** shell (see "Which shell"); only a narrow window (<=768px) or a phone-sized touch screen gets the mobile shell
- Existing note open path and new note open path should behave the same with respect to default open mode, toolbar visibility, and title/save-state UI
- When debugging tablet issues, compare the exact htmx target and after-settle path used by new-note vs existing-note opens

## Debugging

### If mobile note creation/opening misbehaves

- Check whether the server response includes the expected mobile header such as `X-Mobile-Note-Id`
- Check the `htmx:afterRequest` handler that consumes that header
- Compare new-note path vs existing-note path
- Check whether the note is in a vault and whether the editor was initialized in locked vs unlocked state
