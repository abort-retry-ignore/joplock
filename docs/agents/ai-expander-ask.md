# Text expander, AI autocomplete and /ask

> Read this before: changing text expansion, AI provider profiles, prose autocomplete or the `/ask` slash command.
> This file records *why* and *what not to regress*. It deliberately does not say where code lives (ask the code index, or grep): maps go stale, reasons do not.

## Expander / AI Autocomplete

- Expander entries live in per-user `textExpanders` settings and are configured in Settings -> Expander.
- Expander triggers are always on; there is no global autocomplete enable/disable toggle.
- Trigger strings are normalized in `app/settingsService.js`, must be non-empty, deduplicated, and are capped at 15 characters.
- Expander entry shape is `{ id, trigger, action, profileId, text }`.
- `action: 'text'` replaces the trigger with `text`; empty text entries are discarded during normalization.
- `action: 'ai'` removes the trigger and launches prose autocomplete. `profileId` selects an AI profile, or falls back to the active profile when blank.
- AI autocomplete triggers are not configured in the AI tab. The AI tab owns provider profiles and sentence count; the Expander tab owns trigger strings.
- Legacy manual suffix triggers (`double-q`, `triple-space`, `ellipsis`) and robot toggle UI were removed. Do not reintroduce `proseAutocompleteManualTrigger`, `proseAutocompleteManualTriggerOptions`, or `autocompleteEnabled`.
- `Ctrl-Space` / `Mod-Space` remains a keyboard shortcut path for manual prose completion, separate from Expander suffix triggers.
- Note-link autocomplete (`[[...`) remains separate from AI prose autocomplete.

## AI Provider Profiles

- AI provider profiles live in `aiProfiles` and are normalized in `app/settingsService.js`.
- Profiles are user-defined; `defaultAiProfiles` is intentionally empty.
- Each profile can specify provider, API URL/model, API key, temperature, and active state.
- Legacy `openRouterApiKey` / `openRouterModel` are still migrated into an OpenRouter profile for backward compatibility.
- `/api/web/ai/prose-complete` accepts optional `profileId` and falls back to the active profile or first keyed profile.
- Autocomplete provider requests include `reasoning: { enabled: false }` in the chat completion payload.
- Server-side completion post-processing strips repeated prompt prefixes/suffixes, collapses adjacent repeated phrases, limits sentence count, and reports empty-completion diagnostics with `emptyReason`.
- Empty completion reasons are `provider-empty`, `provider-repeated-existing-text`, and `trimmed-no-complete-sentence`.

## `/ask` Slash Command

- A line starting with `/ask <question>` (must be at column 0, non-empty question after the space/tab) fires a direct Q&A request when Enter is pressed with the caret at the end of that line. Works in both CM6 and TinyMCE.
- Detection: `detectAskCommand(lineText)` in `public/app.js`. Trigger wiring: the `Enter` binding in the CM6 `keymap.of([...])` inside `initCM()`, and an `e.key==='Enter'` check at the top of the TinyMCE `editor.on('keydown', ...)` handler (same handler that wires `Ctrl/Cmd-Space`).
- Flow: `/ask …` line/block is replaced with a `⏳ Asking…` placeholder immediately, `requestAskCompletion(question, context, profileId)` calls `POST /api/web/ai/ask`, and the placeholder is swapped for the answer (`handleAskInCM`/`handleAskInTinyMCE`). Empty/failed responses restore the original `/ask …` text. There is no accept/dismiss popup for `/ask` — Ctrl+Z is the reject path.
- **TinyMCE soft-line detection**: TinyMCE runs with `newline_behavior:'linebreak'`, so pressing Enter inside a paragraph inserts `<br>` rather than starting a new `<p>`. The `/ask` handler therefore looks for the "soft line" between the last `<br>` (or block start) and the caret — not the whole block's text. Firefox `Range.toString()` does NOT emit `\n` for `<br>` (Chromium/WebKit do), so the handler walks the DOM manually collecting text and resetting on each `<br>`. Answer replacement is limited to that soft-line range (`isSoftLine` branch in `handleAskInTinyMCE`) so earlier soft-lines in the same `<p>` are preserved.
- Identity guard: both handlers capture `activeEditorForm()` + `_formNoteId(form)` before firing the request and re-check them (plus placeholder presence) before writing the answer, so a note switch during the request drops the result instead of writing into the wrong note.
- Disabled entirely inside vault/encrypted notes via `askDisabledForActiveNote()` (checks `form.dataset.encrypted` / `form.dataset.vaultId`) — plaintext context must never be sent to a third-party AI provider from an encrypted note. When the user types `/ask …` and hits Enter in a vault note, `_notifyAskDisabledInVault()` shows a one-shot per-note alert explaining the reason (previously Enter silently fell through to a newline, which looked like a bug).
- Server endpoint `POST /api/web/ai/ask` (`app/routes/api.js`, next to `/api/web/ai/prose-complete`) uses a direct-answer system prompt (not the continuation/style-inference prompt used by prose autocomplete), caps `context` at 4000 chars, and uses `max_tokens: 512`. Shares `getActiveProfileFromSettings`/profile resolution with prose autocomplete; no new settings.
- Coverage: `tests/askCommand.test.js` (client detection + CM6 handler flow), `tests/createServer.test.js` (endpoint request/response, profile selection, error forwarding).



- Expander runtime (`_feedRingBuffer`, `consumePendingTextExpansion`, `runTextExpanderAction`) is in `public/app.js`. Its wiring points are `beforeinput`/`input` listeners inside `initCM()` (source `'cm'`), the old contenteditable-preview activation code (source `'preview'`, now dead), and TinyMCE's `editor.on('keyup')` (rendered mode).
- **Markdown mode (CM6) expander is live** (`initCM()` is invoked for real). **Rendered mode (TinyMCE) expander is live for BOTH text and AI triggers**: text triggers via `maybeExpandTextFromTinyMCE()`/`replaceTinyMCETextExpansion()`; AI triggers via `removeTinyMCETriggerForAction()` + `requestTinyMCEProseCompletion()` (prompt from `getTextBeforeCaretTinyMCE()`, insertion via `insertProseCompletionTinyMCE()`). `Ctrl/Cmd-Space` manual AI completion is wired on `editor.on('keydown')` inside TinyMCE too. The `'preview'` contenteditable path is dead (TinyMCE replaced that host). Coverage: `tests/expanderRuntime.test.js` (runtime) + `playwright-tests/ai-rendered.spec.js` (live provider E2E, skips without creds/AI profile).
- CodeMirror-mode expansion should inspect the current document suffix rather than relying only on raw DOM input events.
- (Historical, if re-wired to TinyMCE's iframe body) triggers can split typed text across text nodes, especially on iOS Safari. Prefer robust text-position/range logic.
- The input ring buffer is only for detecting Expander suffix triggers; keep per-keystroke logging minimal.
- Client diagnostic logging goes through `POST /api/web/client-log`; it redacts sensitive fields matching text/body/content/password/key/secret/token.
- If iPhone behavior differs from desktop, use Docker-visible client logs and remember stale service worker/cache can hide client JS changes.
