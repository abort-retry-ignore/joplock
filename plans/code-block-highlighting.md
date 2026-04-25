# Code Block Syntax Highlighting + Language Picker Modal

## Overview
Add syntax highlighting for fenced code blocks inside the CM6 markdown editor, with a modal for inserting code blocks that lets the user pick a language.

## 1. Rebuild CM6 bundle with language parsers

**Install packages:**
- `@codemirror/lang-javascript`, `lang-html`, `lang-css`, `lang-json`, `lang-sql`, `lang-python`, `lang-xml`, `lang-go`, `lang-cpp`, `lang-yaml`
- `@codemirror/legacy-modes` (for shell via `StreamLanguage`)

**Bundle build:** Add all language constructors to `window.CM` exports. Rebuild `public/codemirror.min.js`.

**`initCM()` changes:** Pass a `codeLanguages` map to `markdown()` that maps info strings to parsers, including aliases:
- `js`, `javascript`, `jsx`, `ts`, `typescript`, `tsx` -> javascript
- `html` -> html
- `css` -> css
- `json` -> json
- `sql` -> sql
- `python`, `py` -> python
- `xml` -> xml
- `go`, `golang` -> go
- `c`, `cpp`, `c++` -> cpp
- `yaml`, `yml`, `dockerfile`, `docker-compose` -> yaml
- `bash`, `sh`, `shell`, `zsh` -> shell (via StreamLanguage)

## 2. Code block language picker modal

**Modal HTML** (following link modal pattern):
- `#code-modal-backdrop` + `#code-modal` with `.folder-modal` / `.folder-modal-card` classes
- `<select id="code-lang">` with options: Plain text, Bash, C, C++, CSS, Go, HTML, JavaScript, JSON, Python, SQL, TypeScript, XML, YAML
- `<textarea id="code-input">` for pasting/entering code (tall, monospace, takes over the edit area)
- Cancel + Insert buttons

**JS functions:**
- `openCodeModal()` -- if text selected (CM6 or preview), pre-populate textarea. Show modal. Focus textarea.
- `closeCodeModal()` -- hide modal + backdrop
- `submitCode(event)` -- read language + code, close modal, insert fenced code block:
  - Markdown mode: insert ` ```lang\ncode\n``` ` via CM6 dispatch (replacing selection if any)
  - Preview mode: insert `<pre><code class="language-XXX">escaped</code></pre>`

**Toolbar change:** `{ }` button onclick -> `openCodeModal()` instead of `wrapSel('\n```\n','\n```\n')`

## 3. CSS
- Code modal textarea: monospace font, near-full-width/height within modal card
- Modal card sized larger than link modal to "take over" the edit area

## 4. Service worker + tests
- Bump SW cache version
- Verify code block insertion works in both modes

## Decisions
- Explicit info strings only, no heuristic language detection
- No CSV (no official CM6 package)
- Dockerfile/docker-compose mapped to YAML highlighting
- Plain `<select>` dropdown (14 options, no need for search)
- Selected text pre-populates the code textarea in the modal
