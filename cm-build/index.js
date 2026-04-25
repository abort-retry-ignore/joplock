// CM6 bundle entry point — exports everything on window.CM
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { keymap, placeholder, drawSelection, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, HighlightStyle, StreamLanguage } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap, highlightSelectionMatches, openSearchPanel, SearchQuery, setSearchQuery } from "@codemirror/search";

// Language parsers
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { sql } from "@codemirror/lang-sql";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";

// Language description imports for codeLanguages mapping
import { LanguageDescription } from "@codemirror/language";

window.CM = {
  // Core (same as before)
  EditorView,
  EditorState,
  markdown,
  markdownLanguage,
  keymap,
  placeholder,
  drawSelection,
  highlightActiveLine,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  SearchQuery,
  setSearchQuery,
  tags,
  HighlightStyle,

  // Language parsers (new)
  javascript,
  html,
  css,
  json,
  sql,
  python,
  xml,
  go,
  cpp,
  yaml,
  shell,
  StreamLanguage,
  LanguageDescription,
};
