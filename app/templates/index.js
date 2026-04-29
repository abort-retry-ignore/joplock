// Central re-export: everything from app/templates/ submodules
'use strict';

const shared = require('./shared');
const fragments = require('./fragments');
const settings = require('./settings');
const pages = require('./pages');
const mobile = require('./mobile');

module.exports = {
	// shared
	escapeHtml: shared.escapeHtml,
	stripMarkdownForTitle: shared.stripMarkdownForTitle,
	renderInlineMarkdown: shared.renderInlineMarkdown,
	renderMarkdown: shared.renderMarkdown,
	passwordField: shared.passwordField,

	// fragments
	noteDomId: fragments.noteDomId,
	folderListItem: fragments.folderListItem,
	folderListFragment: fragments.folderListFragment,
	noteListItem: fragments.noteListItem,
	noteListFragment: fragments.noteListFragment,
	noteSyncStateFragment: fragments.noteSyncStateFragment,
	noteMetaText: fragments.noteMetaText,
	noteMetaFragment: fragments.noteMetaFragment,
	autosaveConflictFragment: fragments.autosaveConflictFragment,
	fmtHistoryTime: fragments.fmtHistoryTime,
	historyModalFragment: fragments.historyModalFragment,
	historySnapshotPreviewFragment: fragments.historySnapshotPreviewFragment,
	folderNotesPageFragment: fragments.folderNotesPageFragment,
	navigationFragment: fragments.navigationFragment,
	realNotebookOptions: fragments.realNotebookOptions,
	editorFragment: fragments.editorFragment,
	mobileEditorFragment: fragments.mobileEditorFragment,
	autosaveStatusFragment: fragments.autosaveStatusFragment,
	searchResultsFragment: fragments.searchResultsFragment,
	folderSelectOob: fragments.folderSelectOob,

	// settings page
	adminUserRow: settings.adminUserRow,
	settingsPage: settings.settingsPage,

	// full pages
	layoutPage: pages.layoutPage,
	loggedOutPage: pages.loggedOutPage,
	mfaPage: pages.mfaPage,

	// mobile fragments
	mobileFoldersFragment: mobile.mobileFoldersFragment,
	mobileNotesFragment: mobile.mobileNotesFragment,
	mobileSearchFragment: mobile.mobileSearchFragment,
};
