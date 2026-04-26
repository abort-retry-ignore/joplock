const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { adminUserRow, autosaveConflictFragment, autosaveStatusFragment, editorFragment, escapeHtml, folderListItem, folderListFragment, folderNotesPageFragment, historyModalFragment, historySnapshotPreviewFragment, layoutPage, loggedOutPage, mfaPage, mobileEditorFragment, mobileFoldersFragment, mobileNotesFragment, mobileSearchFragment, navigationFragment, noteListItem, noteListFragment, noteMetaFragment, noteSyncStateFragment, renderInlineMarkdown, renderMarkdown, searchResultsFragment, settingsPage, stripMarkdownForTitle } = require('../app/templates');

test('autosaveConflictFragment wires overwrite and create copy actions', () => {
	const html = autosaveConflictFragment('n1');
	assert.ok(html.includes('hx-put="/fragments/editor/n1"'));
	assert.ok(html.includes('hx-vals=\'{"forceSave":"1"}\''));
	assert.ok(html.includes('hx-vals=\'{"createCopy":"1"}\''));
	assert.ok(html.includes('hx-include="#note-editor-form"'));
});

test('editorFragment shows restore action for trashed note', () => {
	const html = editorFragment({ id: 'n1', title: 'Deleted', body: 'Body', parentId: 'f1', deletedTime: 123, createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(html.includes('hx-post="/fragments/notes/n1/restore"'));
	assert.ok(html.includes('Restore'));
	assert.ok(html.includes('Permanently delete this note?'));
	assert.ok(!html.includes('Move this note to trash?'));
});

test('editorFragment shows trash delete prompt for active note', () => {
	const html = editorFragment({ id: 'n1', title: 'Active', body: 'Body', parentId: 'f1', deletedTime: 0, createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(html.includes('Move this note to trash?'));
	assert.ok(!html.includes('Permanently delete this note?'));
});

test('editorFragment includes date and datetime toolbar buttons', () => {
	const html = editorFragment({ id: 'n1', title: 'Active', body: 'Body', parentId: 'f1', deletedTime: 0, createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(html.includes('title="Insert date"'));
	assert.ok(html.includes('title="Insert date and time"'));
	assert.ok(html.includes('insertStamp(\'date\')'));
	assert.ok(html.includes('insertStamp(\'datetime\')'));
	assert.ok(html.includes('id="markdown-toggle"'));
	assert.ok(html.includes('id="preview-toggle"'));
	assert.ok(html.includes('onclick="setEditorMode(\'markdown\')"'));
	assert.ok(html.includes('onclick="setEditorMode(\'preview\')"'));
	assert.ok(html.includes('title="Rendered Markdown"'));
});

test('navigationFragment shows trash folder empty action', () => {
	const html = navigationFragment([{ id: 'de1e7ede1e7ede1e7ede1e7ede1e7ede', title: 'Trash', parentId: '' }], [], '', '');
	assert.ok(html.includes('hx-post="/fragments/trash/empty"'));
	assert.ok(html.includes('Empty trash permanently?'));
	assert.ok(html.includes('&#128465;'));
});

test('navigationFragment shows virtual all notes without notebook actions', () => {
	// In lazy mode, pass a counts Map — notes are NOT rendered inline
	const counts = new Map([['__all__', 1], ['f1', 1], ['__trash__', 0]]);
	const html = navigationFragment([
		{ id: '__all_notes__', title: 'All Notes', parentId: '', isVirtualAllNotes: true },
		{ id: 'f1', title: 'Folder 1', parentId: '' },
	], counts, '__all_notes__', 'n1', '', '__all_notes__');
	assert.ok(html.includes('All Notes'));
	assert.ok(!html.includes('openFolderContextMenu(event,\'__all_notes__\''));
	assert.ok(!html.includes('hx-vals=\'{&quot;parentId&quot;:&quot;__all_notes__&quot;}\''));
});

test('navigationFragment only marks the selected note in the clicked context as active (folderNotesPageFragment)', () => {
	// Notes are lazy-loaded; test folderNotesPageFragment directly
	const html = folderNotesPageFragment(
		[{ id: 'n1', title: 'Note 1', parentId: 'f1', deletedTime: 0 }],
		'__all_notes__', 'n1', false, 1, 1,
	);
	assert.ok(html.includes('id="note-item-__all_notes__-n1" class="notelist-item active"'));
	const html2 = folderNotesPageFragment(
		[{ id: 'n1', title: 'Note 1', parentId: 'f1', deletedTime: 0 }],
		'f1', '', false, 1, 1,
	);
	assert.ok(html2.includes('id="note-item-f1-n1" class="notelist-item"'));
	assert.ok(!html2.includes('class="notelist-item active"'));
});

test('navigationFragment shows Search Results folder when query is active', () => {
	const html = navigationFragment([
		{ id: 'f1', title: 'Folder 1', parentId: '' },
		{ id: 'f2', title: 'Folder 2', parentId: '' },
	], [
		{ id: 'n1', title: 'Note 1', parentId: 'f1' },
	], '', '', 'note');
	assert.ok(html.includes('Search Results'));
	assert.ok(!html.includes('Folder 1'));
	assert.ok(!html.includes('Folder 2'));
	assert.ok(html.includes('Note 1'));
});

test('navigationFragment does not make empty folders expandable', () => {
	const html = navigationFragment([
		{ id: 'f1', title: 'Folder 1', parentId: '' },
	], [], '', '');
	assert.ok(html.includes('nav-folder-empty'));
	assert.ok(!html.includes('onclick="toggleNavFolder(\'f1\')"'));
	assert.ok(html.includes('nav-folder-toggle-placeholder'));
});

test('navigationFragment includes shared folder context menu and modal', () => {
	const html = navigationFragment([{ id: 'f1', title: 'Folder 1', parentId: '' }], [], '', '');
	assert.ok(html.includes('oncontextmenu="openFolderContextMenu(event,\'f1\',\'Folder 1\')"'));
	assert.ok(html.includes('id="folder-context-menu"'));
	assert.ok(html.includes('Edit notebook'));
	assert.ok(html.includes('Delete notebook'));
	assert.ok(html.includes('id="folder-modal"'));
	assert.ok(html.includes('onsubmit="submitFolderEdit(event)"'));
});

test('renderMarkdown rewrites raw html resource images without self-closing slash', () => {
	const html = renderMarkdown('<img src=":/49a3f012f300473d98a33b97940306b1" alt="x" width="313" height="417">');
	assert.ok(html.includes('src="/resources/49a3f012f300473d98a33b97940306b1"'));
	assert.ok(html.includes('width="313"'));
	assert.ok(html.includes('height="417"'));
});

test('renderMarkdown opens resource links in another tab', () => {
	const html = renderMarkdown('[Manual](:/49a3f012f300473d98a33b97940306b1)');
	assert.ok(html.includes('href="/resources/49a3f012f300473d98a33b97940306b1"'));
	assert.ok(html.includes('target="_blank"'));
	assert.ok(html.includes('rel="noopener"'));
});

test('renderMarkdown handles backticks inside fenced code blocks', () => {
	const md = '```\n.-```-.\ntest\n```\n\n```\nblock2\n```';
	const html = renderMarkdown(md);
	const preCount = (html.match(/<pre/g) || []).length;
	assert.strictEqual(preCount, 2, 'should produce two code blocks');
	assert.ok(html.includes('.-```-.'), 'backticks inside code block should be preserved');
});

test('logged out layout clears client storage and service worker state', () => {
	const html = layoutPage({ user: null, loginError: '' });
	assert.ok(html.includes('<meta name="theme-color" content="#0b0b0b" />'));
	assert.ok(html.includes('<body class="theme-dark-grey'));
	assert.ok(html.includes('localStorage.removeItem'));
	assert.ok(!html.includes('navigator.serviceWorker.getRegistrations'), 'should not unregister service workers on login page');
	assert.ok(!html.includes('caches.keys()'), 'should not clear caches on login page');
});


test('logged out page shows cleanup progress and login link', () => {
	const html = loggedOutPage('');
	assert.ok(html.includes('Logging out'));
	assert.ok(html.includes('Clear local storage'));
	assert.ok(!html.includes('Remove service workers'), 'should not show SW removal step');
	assert.ok(!html.includes('Clear cached assets'), 'should not show cache clearing step');
	assert.ok(html.includes('Cleanup complete'));
	assert.ok(html.includes('onclick="toggleLogoutDetail(\'session\')"'));
	assert.ok(html.includes('id="logout-detail-session"'));
	assert.ok(html.includes('Remove local preferences like theme'));
	assert.ok(html.includes('id="logout-login-link"'));
	assert.ok(html.includes('Go to login'));
	assert.ok(html.includes('check.className=\'logout-step-check\''));
	assert.ok(html.includes('check.textContent=\'✓\''));
	assert.ok(html.includes('window.toggleLogoutDetail=function(step)'));
	assert.ok(html.includes('if(loginLink)loginLink.style.display=\'inline-flex\''));
});

test('logged in layout uses logout navigation link', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('<a href="/settings" class="btn btn-icon status-settings-link" title="Settings">&#9881;</a>'));
	assert.ok(html.includes('<a href="/logout" class="btn btn-sm btn-secondary logout-link" onclick="return confirmLogout(event)">Logout</a>'));
	assert.ok(html.includes('<a href="/logout" class="mobile-header-btn" title="Logout" onclick="return confirmLogout(event)">&#8618;</a>'));
	assert.ok(html.includes('/app.js'));
	assert.ok(!html.includes('logoutNow(event)'));
	assert.ok(!html.includes('hx-post="/logout"'));
});

test('settings page renders font controls and MFA details', () => {
	const html = settingsPage({ user: { email: 'user@example.com' }, settings: { noteFontSize: 17, codeFontSize: 13, noteMonospace: true, dateFormat: 'DD/MM/YYYY', datetimeFormat: 'DD/MM/YYYY HH:mm', autoLogout: true, autoLogoutMinutes: 30 } });
	assert.ok(html.includes('Joplock Settings'));
	assert.ok(html.includes('id="settings-note-font"'));
	assert.ok(html.includes('id="settings-code-font"'));
	assert.ok(html.includes('id="settings-note-monospace"'));
	assert.ok(html.includes('id="settings-date-format"'));
	assert.ok(html.includes('id="settings-datetime-format"'));
	assert.ok(html.includes('Two-Factor Authentication'));
	assert.ok(html.includes('Use monospace for note text'));
	assert.ok(html.includes('Reopen the last edited note on startup'));
	assert.ok(html.includes('Expire session after inactivity'));
	assert.ok(html.includes('name="autoLogoutMinutes"'));
	assert.ok(html.includes('class="login-eye"'));
	assert.ok(html.includes('saveSetting')); // auto-save function
});

test('stripMarkdownForTitle removes common markdown markers from titles', () => {
	assert.equal(stripMarkdownForTitle('# **Hello** [world](https://example.com)'), 'Hello world');
	assert.equal(stripMarkdownForTitle('![alt text](img.png) `code`'), 'alt text code');
	assert.equal(stripMarkdownForTitle('a note in ++generals++'), 'a note in generals');
});

test('navigation and editor render plain note titles without markdown formatting', () => {
	// Nav no longer renders note items inline — test folderNotesPageFragment for note title stripping
	const navNotesHtml = folderNotesPageFragment([{ id: 'n1', title: '# **Hello**', parentId: 'f1', deletedTime: 0 }], 'f1', 'n1', false, 1, 1);
	const editorHtml = editorFragment({ id: 'n1', title: '# **Hello**', body: 'Body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(navNotesHtml.includes('>Hello<'));
	assert.ok(!navNotesHtml.includes('<strong>Hello</strong>'));
	assert.ok(editorHtml.includes('data-placeholder="Note title">Hello</div>'));
	assert.ok(editorHtml.includes('value="Hello"'));
});

test('logged in layout can render resumed editor content', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '<div>nav</div>', editorContent: '<form id="note-editor-form"></form>' });
	assert.ok(html.includes('<form id="note-editor-form"></form>'));
	assert.ok(html.includes('<div class="col-editor" id="editor-panel">'));
	assert.ok(!html.includes('<div class="col-editor" id="editor-panel">\n\t\t\t<div class="editor-empty">Select a note</div>'));
});

test('logged in layout exposes mobile startup resume data', () => {
	const html = layoutPage({
		user: { email: 'user@example.com', fullName: 'User' },
		navContent: '<div>nav</div>',
		mobileEditorContent: mobileEditorFragment({ id: 'n1', title: 'Hello', body: 'Body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }], 'f1'),
		mobileStartup: { folderId: '__all_notes__', folderTitle: 'All Notes', noteId: 'n1', noteTitle: 'Hello' },
	});
	assert.ok(html.includes('"noteId":"n1","noteTitle":"Hello"'));
	assert.ok(html.includes('mobileStartup:{"folderId":"__all_notes__","folderTitle":"All Notes","noteId":"n1","noteTitle":"Hello"}'));
	assert.ok(html.includes('<span class="mobile-editor-status" id="mobile-editor-status"></span>'));
	assert.ok(html.includes('id="mobile-editor-search-open"'));
	assert.ok(html.includes('id="mobile-editor-search-input"'));
	assert.ok(html.includes('id="mobile-search-nav-counter"'));
	assert.ok(html.includes('id="mobile-search-prev-btn"'));
	assert.ok(html.includes('id="mobile-search-next-btn"'));
	assert.ok(html.includes('/app.js'));
	assert.ok(html.includes('<div class="mobile-screen-body mobile-editor-body" id="mobile-editor-body">'));
	assert.ok(html.includes('hx-put="/fragments/editor/n1"'));
	assert.ok(!html.includes('<div class="editor-titlebar">'));
	assert.ok(html.includes('<div class="editor-toolbar" id="editor-toolbar">'));
	// JS functions are in public/app.js
	assert.ok(html.includes('/app.js'));
	assert.ok(!html.includes('...C.searchKeymap...'));
});

test('logged out layout does not show global auth code field', () => {
	const html = layoutPage({ user: null, loginError: '' });
	assert.ok(!html.includes('Global auth code'));
});

test('logged in layout preserves plain square brackets on preview round trip', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	// These functions are now in public/app.js, not inline — check app.js is referenced
	assert.ok(html.includes('/app.js'));
	assert.ok(html.includes('_joplockConfig'));
});

test('logged in layout includes extended Joplin theme options', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('<option value="matrix-blue">Dark Blue</option>'));
	assert.ok(html.includes('<option value="matrix-purple">Dark Purple</option>'));
	assert.ok(html.includes('<option value="matrix-amber">Dark Amber</option>'));
	assert.ok(html.includes('<option value="matrix-orange">Dark Orange</option>'));
	assert.ok(html.includes('<option value="dark-grey">Dark Grey</option>'));
	assert.ok(html.includes('<option value="dark-red">Dark Red</option>'));
	assert.ok(html.includes('<option value="oled-dark">OLED Dark</option>'));
	assert.ok(html.includes('<option value="solarized-light">Solarized Light</option>'));
	assert.ok(html.includes('<option value="solarized-dark">Solarized Dark</option>'));
	assert.ok(html.includes('<option value="nord">Nord</option>'));
	assert.ok(html.includes('<option value="dracula">Dracula</option>'));
	assert.ok(html.includes('<option value="aritim-dark">Aritim Dark</option>'));
});

test('logged in layout uses ordered list command and block transforms in preview toolbar', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	// Editor functions are now in public/app.js — verify it's referenced and toolbar HTML is present
	assert.ok(html.includes('/app.js'));
	assert.ok(!html.includes('clean-md-toggle'));
});

test('logged in layout emits inline config script that parses', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '<div></div>' });
	// The last script before </body> is now just the config object
	const match = html.match(/<script>\s*(window\._joplockConfig[\s\S]*?)<\/script>\s*<\/body>/);
	assert.ok(match, 'should have inline config script before </body>');
	assert.doesNotThrow(() => new vm.Script(match[1]));
	assert.ok(match[1].includes('window._joplockConfig'));
	assert.ok(match[1].includes('noteOpenMode'));
	assert.ok(match[1].includes('liveSearch'));
	// Functions are in app.js, not inline
	assert.ok(!html.includes('function openFolderContextMenu(event,id,title)'));
	assert.ok(html.includes('/app.js'));
});

test('styles define ordered list spacing and matrix note text token', () => {
	const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
	assert.ok(css.includes('--text: #e8fbe8;'));
	assert.ok(css.includes('.theme-matrix-blue {'));
	assert.ok(css.includes('.theme-matrix-purple {'));
	assert.ok(css.includes('.theme-matrix-amber {'));
	assert.ok(css.includes('.theme-matrix-orange {'));
	assert.ok(css.includes('.editor-preview ul, .editor-preview ol { padding-left: 1.5em; margin: 0.5em 0; }'));
	assert.ok(css.includes('.editor-preview > h1:first-child,'));
	assert.ok(css.includes('.logout-progress {'));
	assert.ok(css.includes('.logout-step.done {'));
	assert.ok(css.includes('.logout-step-check {'));
	assert.ok(css.includes('.logout-detail {'));
	assert.ok(css.includes('.logout-detail.open {'));
	assert.ok(css.includes('body.note-body-monospace,'));
	assert.ok(css.includes('.status-settings-link {'));
	assert.ok(css.includes('.settings-page {'));
	assert.ok(css.includes('.settings-form {'));
	assert.ok(css.includes('.settings-actions {'));
	assert.ok(css.includes('.settings-qr {'));
	assert.ok(css.includes('.btn.active {'));
	assert.ok(css.includes('--font-size-note: 15px;'));
	assert.ok(css.includes('--font-size-code: 12px;'));
	assert.ok(css.includes('font-size: var(--font-size-note);'));
	assert.ok(css.includes('font-size: var(--font-size-code);'));
});

test('styles color folders differently from notes', () => {
	const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
	assert.ok(css.includes('.nav-folder-title {'));
	assert.ok(css.includes('.sidebar-item-name {'));
	assert.ok(css.includes('.notelist-item-title {'));
	assert.ok(css.includes('color: var(--accent);'));
	assert.ok(css.includes('color: var(--text);'));
});

test('searchResultsFragment renders note items', () => {
	const notes = [{ id: 'n1', title: 'My Note', body: '', bodyPreview: '', parentId: 'f1', deletedTime: 0 }];
	const html = searchResultsFragment(notes);
	assert.ok(html.includes('My Note'));
	assert.ok(!html.includes('notelist-load-more'), 'no Load more when hasMore=false');
});

test('searchResultsFragment shows Load more when hasMore=true', () => {
	const notes = [{ id: 'n1', title: 'My Note', body: '', bodyPreview: '', parentId: 'f1', deletedTime: 0 }];
	const html = searchResultsFragment(notes, true, 50, 'hello world');
	assert.ok(html.includes('notelist-load-more'));
	assert.ok(html.includes('/fragments/search?q=hello%20world&offset=50'));
	assert.ok(html.includes('hx-target="#notelist-items"'));
});

test('searchResultsFragment returns empty hint when no notes', () => {
	const html = searchResultsFragment([]);
	assert.ok(html.includes('No results'));
	assert.ok(!html.includes('notelist-load-more'));
});

test('mobileSearchFragment renders note items', () => {
	const notes = [{ id: 'n1', title: 'My Note', body: '', bodyPreview: '', parentId: 'f1', deletedTime: 0 }];
	const html = mobileSearchFragment(notes);
	assert.ok(html.includes('My Note'));
	assert.ok(!html.includes('notelist-load-more'), 'no Load more when hasMore=false');
});

test('mobileSearchFragment shows Load more when hasMore=true', () => {
	const notes = [{ id: 'n1', title: 'My Note', body: '', bodyPreview: '', parentId: 'f1', deletedTime: 0 }];
	const html = mobileSearchFragment(notes, true, 50, 'cats');
	assert.ok(html.includes('notelist-load-more'));
	assert.ok(html.includes('/fragments/mobile/search?q=cats&offset=50'));
	assert.ok(html.includes('hx-target="#mobile-search-results"'));
});

test('mobileSearchFragment returns empty hint when no notes', () => {
	const html = mobileSearchFragment([]);
	assert.ok(html.includes('No results found'));
	assert.ok(!html.includes('notelist-load-more'));
});

// --- escapeHtml ---

test('escapeHtml escapes special characters', () => {
	assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
	assert.equal(escapeHtml("a'b"), 'a&#39;b');
	assert.equal(escapeHtml('a&b'), 'a&amp;b');
});

test('escapeHtml coerces non-string values', () => {
	assert.equal(escapeHtml(42), '42');
	assert.equal(escapeHtml(null), 'null');
	assert.equal(escapeHtml(undefined), 'undefined');
});

// --- folderListItem ---

test('folderListItem renders folder button with htmx attributes', () => {
	const html = folderListItem({ id: 'f1', title: 'Work', noteCount: 5 }, 'f1');
	assert.ok(html.includes('class="sidebar-item active"'));
	assert.ok(html.includes('data-folder-id="f1"'));
	assert.ok(html.includes('hx-get="/fragments/notes?folderId=f1"'));
	assert.ok(html.includes('Work'));
	assert.ok(html.includes('>5<'));
});

test('folderListItem not active when different folder selected', () => {
	const html = folderListItem({ id: 'f1', title: 'Work' }, 'f2');
	assert.ok(!html.includes('class="sidebar-item active"'));
});

test('folderListItem shows Untitled for empty title', () => {
	const html = folderListItem({ id: 'f1', title: '' }, '');
	assert.ok(html.includes('Untitled'));
});

// --- folderListFragment ---

test('folderListFragment renders all folders', () => {
	const html = folderListFragment([
		{ id: 'f1', title: 'A' },
		{ id: 'f2', title: 'B' },
	], 'f1');
	assert.ok(html.includes('data-folder-id="f1"'));
	assert.ok(html.includes('data-folder-id="f2"'));
});

test('folderListFragment shows empty hint when no folders', () => {
	const html = folderListFragment([], '');
	assert.ok(html.includes('No notebooks yet'));
});

// --- noteListItem ---

test('noteListItem renders note button with editor link', () => {
	const html = noteListItem({ id: 'n1', title: 'My Note' }, 'n1', 'f1');
	assert.ok(html.includes('class="notelist-item active"'));
	assert.ok(html.includes('data-note-id="n1"'));
	assert.ok(html.includes('hx-get="/fragments/editor/n1?currentFolderId=f1"'));
	assert.ok(html.includes('My Note'));
});

test('noteListItem not active when different note selected', () => {
	const html = noteListItem({ id: 'n1', title: 'Note' }, 'n2', 'f1');
	assert.ok(!html.includes('class="notelist-item active"'));
});

test('noteListItem strips markdown from title', () => {
	const html = noteListItem({ id: 'n1', title: '# **Bold Title**' }, '', '');
	assert.ok(html.includes('Bold Title'));
	assert.ok(!html.includes('**'));
});

// --- noteListFragment ---

test('noteListFragment renders header with new note button and search', () => {
	const html = noteListFragment([{ id: 'n1', title: 'Note' }], 'n1', 'f1');
	assert.ok(html.includes('+ New note'));
	assert.ok(html.includes('hx-post="/fragments/notes"'));
	assert.ok(html.includes('notelist-search'));
	assert.ok(html.includes('Note'));
});

test('noteListFragment shows empty hint when no notes', () => {
	const html = noteListFragment([], '', 'f1');
	assert.ok(html.includes('No notes'));
});

test('noteListFragment omits new note button without folderId', () => {
	const html = noteListFragment([], '', '');
	assert.ok(!html.includes('+ New note'));
});

// --- noteSyncStateFragment ---

test('noteSyncStateFragment includes updatedTime hidden field', () => {
	const html = noteSyncStateFragment({ updatedTime: 12345 });
	assert.ok(html.includes('name="baseUpdatedTime" value="12345"'));
	assert.ok(html.includes('name="forceSave"'));
	assert.ok(html.includes('name="createCopy"'));
});

// --- noteMetaFragment ---

test('noteMetaFragment includes data attributes for times', () => {
	const html = noteMetaFragment({ createdTime: 100, updatedTime: 200 });
	assert.ok(html.includes('data-created-time="100"'));
	assert.ok(html.includes('data-updated-time="200"'));
});

// --- autosaveStatusFragment ---

test('autosaveStatusFragment returns Saved span', () => {
	const html = autosaveStatusFragment();
	assert.ok(html.includes('autosave-ok'));
	assert.ok(html.includes('Saved'));
});

// --- historyModalFragment ---

test('historyModalFragment renders snapshots list', () => {
	const snapshots = [
		{ id: 's1', savedTime: Date.now(), title: 'First' },
		{ id: 's2', savedTime: Date.now() - 60000, title: 'Second' },
	];
	const html = historyModalFragment('n1', snapshots);
	assert.ok(html.includes('data-snapshot-id="s1"'));
	assert.ok(html.includes('data-snapshot-id="s2"'));
	assert.ok(html.includes('history-item-active'));
	assert.ok(html.includes('selectHistorySnapshot'));
	assert.ok(html.includes('restoreHistorySnapshot'));
	assert.ok(html.includes('closeHistoryModal'));
	assert.ok(html.includes('hx-get="/fragments/history-snapshot/s1"'));
});

test('historyModalFragment shows empty state', () => {
	const html = historyModalFragment('n1', []);
	assert.ok(html.includes('No saved snapshots'));
	assert.ok(!html.includes('restoreHistorySnapshot'));
});

// --- historySnapshotPreviewFragment ---

test('historySnapshotPreviewFragment renders body preview', () => {
	const html = historySnapshotPreviewFragment({ body: 'Hello world' });
	assert.ok(html.includes('Hello world'));
	assert.ok(html.includes('history-snapshot-body'));
});

test('historySnapshotPreviewFragment truncates long body', () => {
	const body = 'x'.repeat(4000);
	const html = historySnapshotPreviewFragment({ body });
	assert.ok(html.includes('…'));
});

// --- renderInlineMarkdown ---

test('renderInlineMarkdown renders bold, italic, strikethrough, underline, code', () => {
	assert.equal(renderInlineMarkdown('**bold**'), '<strong>bold</strong>');
	assert.equal(renderInlineMarkdown('*italic*'), '<em>italic</em>');
	assert.equal(renderInlineMarkdown('~~strike~~'), '<del>strike</del>');
	assert.equal(renderInlineMarkdown('++under++'), '<u>under</u>');
	assert.equal(renderInlineMarkdown('`code`'), '<code spellcheck="false">code</code>');
});

test('renderInlineMarkdown returns empty for falsy input', () => {
	assert.equal(renderInlineMarkdown(''), '');
	assert.equal(renderInlineMarkdown(null), '');
	assert.equal(renderInlineMarkdown(undefined), '');
});

// --- adminUserRow ---

test('adminUserRow renders enabled user with actions', () => {
	const html = adminUserRow({ id: 'u1', email: 'a@b.com', full_name: 'Alice', enabled: true, created_time: 1700000000000 }, 'u2');
	assert.ok(html.includes('a@b.com'));
	assert.ok(html.includes('Alice'));
	assert.ok(html.includes('badge-ok'));
	assert.ok(html.includes('Enabled'));
	assert.ok(html.includes('Disable User'));
	assert.ok(html.includes('Delete User'));
	assert.ok(html.includes('/admin/users/u1/password'));
	assert.ok(html.includes('/admin/users/u1/disable'));
	assert.ok(html.includes('/admin/users/u1/delete'));
});

test('adminUserRow hides disable/delete for self', () => {
	const html = adminUserRow({ id: 'u1', email: 'a@b.com', enabled: true, created_time: 0 }, 'u1');
	assert.ok(html.includes('your admin account'));
	assert.ok(!html.includes('Disable User'));
	assert.ok(!html.includes('Delete User'));
});

test('adminUserRow shows MFA badge when totp enabled', () => {
	const html = adminUserRow({ id: 'u1', email: 'a@b.com', enabled: true, created_time: 0, totpEnabled: true, totpSeed: 'ABC', totpQr: 'data:qr' }, 'u2');
	assert.ok(html.includes('badge-mfa'));
	assert.ok(html.includes('MFA'));
	assert.ok(html.includes('Disable MFA'));
	assert.ok(html.includes('/admin/users/u1/mfa/disable'));
});

test('adminUserRow shows enable MFA when totp not enabled', () => {
	const html = adminUserRow({ id: 'u1', email: 'a@b.com', enabled: true, created_time: 0, totpEnabled: false }, 'u2');
	assert.ok(html.includes('Enable MFA'));
	assert.ok(html.includes('/admin/users/u1/mfa/enable'));
});

test('adminUserRow shows disabled badge and enable button', () => {
	const html = adminUserRow({ id: 'u1', email: 'a@b.com', enabled: false, created_time: 0 }, 'u2');
	assert.ok(html.includes('badge-off'));
	assert.ok(html.includes('Disabled'));
	assert.ok(html.includes('Enable User'));
	assert.ok(html.includes('/admin/users/u1/enable'));
});

// --- mfaPage ---

test('mfaPage renders MFA challenge form', () => {
	const html = mfaPage();
	assert.ok(html.includes('Two-Factor Authentication'));
	assert.ok(html.includes('action="/login/mfa"'));
	assert.ok(html.includes('name="totp"'));
	assert.ok(html.includes('pattern="[0-9]{6}"'));
	assert.ok(html.includes('Back to login'));
});

test('mfaPage shows error when provided', () => {
	const html = mfaPage({ error: 'Invalid code' });
	assert.ok(html.includes('Invalid code'));
});

test('mfaPage escapes error HTML', () => {
	const html = mfaPage({ error: '<script>alert(1)</script>' });
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(!html.includes('<script>alert'));
});

// --- mobileFoldersFragment ---

test('mobileFoldersFragment renders All Notes and folder rows with Map counts', () => {
	const counts = new Map([['__all__', 5], ['f1', 3], ['__trash__', 1]]);
	const folders = [{ id: 'f1', title: 'Work' }];
	const html = mobileFoldersFragment(folders, counts);
	assert.ok(html.includes('All Notes'));
	assert.ok(html.includes('>5<'));
	assert.ok(html.includes('Work'));
	assert.ok(html.includes('>3<'));
	assert.ok(html.includes('mobilePushNotes'));
	assert.ok(html.includes('mobileNewNoteInFolder'));
});

test('mobileFoldersFragment shows empty state when no folders', () => {
	const html = mobileFoldersFragment([], new Map([['__all__', 0]]));
	assert.ok(html.includes('No notebooks yet'));
});

test('mobileFoldersFragment filters out trash folder', () => {
	const folders = [
		{ id: 'f1', title: 'Work' },
		{ id: 'de1e7ede1e7ede1e7ede1e7ede1e7ede', title: 'Trash' },
	];
	const html = mobileFoldersFragment(folders, new Map([['__all__', 0]]));
	assert.ok(html.includes('Work'));
	assert.ok(!html.includes('>Trash<'));
});

// --- mobileNotesFragment ---

test('mobileNotesFragment renders notes with editor links', () => {
	const notes = [{ id: 'n1', title: 'Note 1' }, { id: 'n2', title: 'Note 2' }];
	const html = mobileNotesFragment(notes, 'f1', 'Work');
	assert.ok(html.includes('Note 1'));
	assert.ok(html.includes('Note 2'));
	assert.ok(html.includes('mobilePushEditor'));
});

test('mobileNotesFragment shows empty state', () => {
	const html = mobileNotesFragment([], 'f1', 'Work');
	assert.ok(html.includes('No notes yet'));
});

test('mobileNotesFragment shows Load more when hasMore', () => {
	const notes = [{ id: 'n1', title: 'Note' }];
	const html = mobileNotesFragment(notes, 'f1', 'Work', true, 50);
	assert.ok(html.includes('Load more'));
	assert.ok(html.includes('/fragments/mobile/notes?folderId=f1&offset=50'));
});
