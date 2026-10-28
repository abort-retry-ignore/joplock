# Third-party notices

Joplock itself is licensed under the GNU Affero General Public License v3.0 or later
(see `LICENSE`). It ships the third-party components below, each under its own license.
The browser bundles in `public/` are minified, which strips the original license banners,
so their notices are recorded here. All of these licenses are compatible with the AGPL.

## Bundled into `public/` (served to the browser)

| Component | Version | License | Shipped as |
|---|---|---|---|
| TinyMCE | 8.6.0 | GPL-2.0-or-later (used here under GPL-3.0, which is compatible with AGPL-3.0) | `public/tinymce/` (copied from the `tinymce` npm package; its `license.md` applies) |
| CodeMirror 6 (`@codemirror/*`, `@lezer/*`) | 6.x | MIT | `public/codemirror.min.js` (built from `cm-build/`) |
| highlight.js | 11.11.1 | BSD-3-Clause | `public/hljs.min.js` (built from `hljs-build/`) |
| Prism | 1.30.0 | MIT | `public/prism.min.js` (built from `prism-build/`) |
| htmx | 2.0.4 | 0BSD | `public/htmx.min.js` |
| Turndown | 7.x | MIT | `public/turndown.min.js`, and a modified copy in `vendor/turndown-lib/` |
| html-docx-js | 0.3.1 | MIT | `public/html-docx.js` (bundles the Node.js `buffer` module for browsers, MIT) |
| Cascadia Mono | | SIL Open Font License 1.1 | `public/fonts/CascadiaMono-*.woff2` |

## Server-side npm dependencies

Installed from npm into the Docker image together with their own license files:
`tinymce` (GPL-2.0-or-later), `markdown-it` (MIT), `pg` (MIT), `bcryptjs` (BSD-3-Clause),
`qr-image` (MIT), `html-entities` (MIT), `@adobe/css-tools` (MIT),
`@mixmark-io/domino` (BSD-2-Clause).

## License texts

- MIT, BSD-2-Clause, BSD-3-Clause, 0BSD: each component's copyright notice and license are
  in its upstream repository and npm package; the MIT/BSD terms require keeping the notice,
  which this file and the shipped `node_modules/*/LICENSE` files do.
- SIL Open Font License 1.1: https://openfontlicense.org
- GPL-2.0-or-later (TinyMCE): https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

When you add a bundled library, add it here and check that its license is AGPL-compatible
(`tests/license.test.js` checks the shipped files are listed).
