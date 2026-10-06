// CM6 bundle entry point — exports everything on window.CM
import { EditorView, Decoration, WidgetType, ViewPlugin, hoverTooltip, showPanel, GutterMarker } from "@codemirror/view";
import { EditorState, StateField, StateEffect, RangeSetBuilder, Prec, Compartment, EditorSelection } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { keymap, placeholder, drawSelection, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, HighlightStyle, StreamLanguage, syntaxTree, foldGutter, codeFolding, foldKeymap, foldService, foldEffect, unfoldEffect, foldedRanges, foldable, foldAll, unfoldAll } from "@codemirror/language";
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

// Autocomplete support
import { autocompletion, startCompletion } from "@codemirror/autocomplete";

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

  // Autocomplete support
  autocompletion,
  startCompletion,

  // Rich markdown-mode extensions (public/cm-extras.js): decorations/widgets,
  // state fields, panels, tooltips and folding.
  Decoration,
  WidgetType,
  ViewPlugin,
  hoverTooltip,
  showPanel,
  GutterMarker,
  StateField,
  StateEffect,
  RangeSetBuilder,
  Prec,
  Compartment,
  EditorSelection,
  syntaxTree,
  foldGutter,
  codeFolding,
  foldKeymap,
  foldService,
  foldEffect,
  unfoldEffect,
  foldedRanges,
  foldable,
  foldAll,
  unfoldAll,
};
