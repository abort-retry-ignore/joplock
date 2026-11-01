'use strict';

// The notes a new account finds in its "Examples" notebook (created at first sign-in).
// Joplock's editor takes a note's title from its first line of text, so every body starts with
// "# <title>" and the title is derived from that line: a title that differs from the first line would be
// replaced by it at the first edit (tests/starterContent.test.js).

const titleFromBody = body => `${body || ''}`.split('\n').find(line => line.trim()).replace(/^#+\s*/, '').trim();

const bodies = [
	`# Start Here

Welcome to Joplock. This notebook is here so a fresh install has something to open and edit right away.

## What Joplock is

- Open source: [abort-retry-ignore/joplock](https://github.com/abort-retry-ignore/joplock)
- Thin web UI for Joplin Server
- Mobile friendly and installable as PWA
- Light on memory and system resources
- Sync is automatic and usually near instant

## Security and logout

- Browser stays thin and untrusted
- Notes and attachments are not cached for offline use
- Logout clears client-visible state and cached shell data as much as browser allows

## Editing notes

- Click this note to open it.
- Use the toolbar for headings, bold, lists, links, code, and clear formatting.
- Switch between Markdown and Preview mode with the editor buttons.
- Preview mode is editable too.

## Saving changes

- Joplock autosaves after you stop typing for a moment.
- The status near the editor shows when a note is edited, saved, or offline.

## Creating notes and notebooks

- Use **+ Notebook** to create a new notebook.
- Use the **+** button on a notebook row to create a note inside it.
- Search from the left panel to find notes quickly.

## Admin and users

- If this deployment defines \`JOPLOCK_ADMIN_EMAIL\` and \`JOPLOCK_ADMIN_PASSWORD\`, that user gets the Admin tab in Settings.
- The Admin tab can create users and enable or disable MFA for users.

## MFA

- Each user manages their own MFA in **Settings -> Security**.
- Admins can also manage MFA for users from the Admin tab.
- If \`IGNORE_ADMIN_MFA=true\`, the configured deployment admin can sign in without MFA.

## Markdown examples

- **Bold**
- *Italic*
- \`Inline code\`
- [Link to Joplin](https://joplinapp.org)
- [ ] Checkbox item

\`\`\`
Code block example
\`\`\`
`,
	`# AI Features

Joplock can call an AI provider (OpenRouter, or any OpenAI-compatible API) to help you write. All AI features are opt-in and configured per user.

## Setup

- Open **Settings -> AI**.
- Create a provider profile with your API URL, model, and API key.
- Mark one profile **Active**.
- No AI features work until at least one profile is configured and active.

## Prose autocomplete

- **Ctrl-Space** (or **Cmd-Space** on Mac) inside a note asks the active AI profile to continue your text based on the surrounding context.
- Works in both Markdown and Preview (rendered) mode.
- A popup shows the suggestion; **Enter** or **Tab** accepts, **Esc** or any other key dismisses.

## Expander triggers

- Configure short trigger strings in **Settings -> Expander**.
- Two kinds:
  - **Text**: expands the trigger into a static snippet.
  - **AI**: removes the trigger and runs a prose completion, optionally with a specific AI profile.
- Type the trigger anywhere in a note and it fires automatically.

## /ask slash command

- On a line by itself, type \`/ask <your question>\` and press **Enter**.
- The line is replaced with a \`⏳ Asking…\` placeholder while the AI answers.
- The answer replaces the placeholder inline. There is no popup — press **Ctrl+Z** to reject.
- Example: \`/ask what is the capital of Turkey?\`

## Vault / encrypted notes

- All AI features are **disabled inside vault/encrypted notes**.
- Plaintext content is never sent to a third-party AI provider from an encrypted note.

## Privacy note

- Prose autocomplete and \`/ask\` send the surrounding note context (capped) to whichever provider you configured. Only use providers you trust with your data.
`,
];

const starterNotes = () => bodies.map(body => ({ title: titleFromBody(body), body }));

module.exports = { starterNotes, titleFromBody };
