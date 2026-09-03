// Prism bundle for TinyMCE rendered-mode code blocks.
// TinyMCE's codesample plugin ships a small Prism with only a handful of
// grammars. Setting `codesample_global_prismjs: true` makes the plugin use
// `window.Prism` instead, so we bundle the full set of languages the code
// modal offers and expose it here. The codesample plugin temporarily swaps
// `window.Prism` while it loads and restores the previous value afterwards,
// so loading this before TinyMCE init is what makes the note view highlight
// the same languages the CM6 modal does.
import Prism from 'prismjs/components/prism-core';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-basic';

// Only highlight on demand (the codesample plugin calls highlightElement).
Prism.manual = true;

window.Prism = Prism;
