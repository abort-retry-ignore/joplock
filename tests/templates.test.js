const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { autosaveConflictFragment, editorFragment, layoutPage, loggedOutPage, navigationFragment, renderMarkdown, settingsPage, stripMarkdownForTitle } = require('../app/templates');

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
	const html = navigationFragment([
		{ id: '__all_notes__', title: 'All Notes', parentId: '', isVirtualAllNotes: true },
		{ id: 'f1', title: 'Folder 1', parentId: '' },
	], [
		{ id: 'n1', title: 'Note 1', parentId: 'f1', deletedTime: 0 },
	], '__all_notes__', 'n1', '', '__all_notes__');
	assert.ok(html.includes('All Notes'));
	assert.ok(html.includes('note-item-__all_notes__-n1'));
	assert.ok(html.includes('hx-get="/fragments/editor/n1?currentFolderId=__all_notes__"'));
	assert.ok(!html.includes('openFolderContextMenu(event,\'__all_notes__\''));
	assert.ok(!html.includes('hx-vals=\'{&quot;parentId&quot;:&quot;__all_notes__&quot;}\''));
});

test('navigationFragment only marks the selected note in the clicked context as active', () => {
	const html = navigationFragment([
		{ id: '__all_notes__', title: 'All Notes', parentId: '', isVirtualAllNotes: true },
		{ id: 'f1', title: 'Folder 1', parentId: '' },
	], [
		{ id: 'n1', title: 'Note 1', parentId: 'f1', deletedTime: 0 },
	], '__all_notes__', 'n1', '', '__all_notes__');
	assert.ok(html.includes('id="note-item-__all_notes__-n1" class="notelist-item active"'));
	assert.ok(html.includes('id="note-item-f1-n1" class="notelist-item"'));
	assert.ok(!html.includes('id="note-item-f1-n1" class="notelist-item active"'));
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
	assert.ok(html.includes('function confirmLogout(event){'));
	assert.ok(html.includes('Your notes and other server data remain on the server.'));
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
	assert.ok(html.includes('Enable auto-logout after inactivity'));
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
	const navHtml = navigationFragment([{ id: 'f1', title: 'Folder 1', parentId: '' }], [{ id: 'n1', title: '# **Hello**', parentId: 'f1', deletedTime: 0 }], 'f1', 'n1');
	const editorHtml = editorFragment({ id: 'n1', title: '# **Hello**', body: 'Body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(navHtml.includes('>Hello<'));
	assert.ok(!navHtml.includes('<strong>Hello</strong>'));
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
		mobileEditorContent: '<form id="note-editor-form"><textarea id="note-body">Body</textarea></form>',
		mobileStartup: { folderId: '__all_notes__', folderTitle: 'All Notes', noteId: 'n1', noteTitle: 'Hello' },
	});
	assert.ok(html.includes('var _mobileStartup={"folderId":"__all_notes__","folderTitle":"All Notes","noteId":"n1","noteTitle":"Hello"};'));
	assert.ok(html.includes('function activeEditorForm(){if(isMobileShellMode()){'));
	assert.ok(html.includes('function queryActiveEditor(selector){var form=activeEditorForm();'));
	assert.ok(html.includes('function mobileResumeTarget(){'));
	assert.ok(html.includes('<div class="mobile-screen-body mobile-editor-body" id="mobile-editor-body">'));
	assert.ok(html.includes('<form id="note-editor-form"><textarea id="note-body">Body</textarea></form>'));
	assert.ok(html.includes('showMobileScreen(\'editor\',\'forward\')'));
	assert.ok(!html.includes('htmx.ajax(\'GET\',\'/fragments/editor/\'+encodeURIComponent(_mobileNoteId)+\'?currentFolderId=\'+encodeURIComponent(_mobileFolderId),{target:\'#mobile-editor-body\',swap:\'innerHTML\'})'));
	assert.ok(!html.includes('function getTA(){return document.getElementById(\'note-body\')}'));
});

test('logged out layout does not show global auth code field', () => {
	const html = layoutPage({ user: null, loginError: '' });
	assert.ok(!html.includes('Global auth code'));
});

test('logged in layout preserves plain square brackets on preview round trip', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('function htmlToMarkdown(el){'));
	assert.ok(html.includes('var root=el.cloneNode(true);'));
	assert.ok(html.includes("root.querySelectorAll('.pre-copy-btn').forEach(function(btn){btn.remove()})"));
	assert.ok(html.includes('getTurndown().turndown(root.innerHTML)'));
	assert.ok(html.includes('$1'));
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
	assert.ok(html.includes('function syncEditorModeButtons(){'));
	assert.ok(html.includes('mdBtn.classList.toggle(\'active\',mode===\'markdown\')'));
	assert.ok(html.includes('pvBtn.classList.toggle(\'active\',mode===\'preview\')'));
	assert.ok(html.includes('var _previewDirty=false;'));
	assert.ok(html.includes('if(pv.contentEditable===\'true\'&&_previewDirty){syncPV()}'));
	assert.ok(!html.includes('clean-md-toggle'));
	assert.ok(html.includes('function transformPVBlock(tagName,defaultText)'));
	assert.ok(html.includes('document.execCommand(\'insertOrderedList\',false,null)'));
	assert.ok(html.includes('if(p===\'> \'&&transformPVBlock(\'blockquote\',\'Quote\'))return'));
	assert.ok(html.includes('var fenced=String.fromCharCode(10)+String.fromCharCode(96,96,96)+String.fromCharCode(10)'));
	assert.ok(html.includes('if(a===fenced&&b===fenced&&transformPVBlock(\'pre\',\'code\'))return'));
	assert.ok(html.includes('var inlineCode=String.fromCharCode(96)'));
	assert.ok(html.includes('if(a===inlineCode&&b===inlineCode){document.execCommand(\'insertHTML\',false,\'<code spellcheck="false">\'+(window.getSelection().toString()||\'code\')+\'</code>\')'));
	assert.ok(html.includes('function formatStamp(kind){'));
	assert.ok(html.includes('var _dateFmt='));
	assert.ok(html.includes('var _datetimeFmt='));
	assert.ok(html.includes('fmt.replace(\'YYYY\''));
	assert.ok(html.includes('function insertStamp(kind){insertTxt(formatStamp(kind))}'));
	assert.ok(html.includes('var pre=el&&el.closest?el.closest(\'pre\'):null'));
	assert.ok(html.includes('if(pre&&pv.contains(pre)){e.preventDefault();'));
	assert.ok(html.includes('if(insertPVText(\'\\n\'))syncPV();return}'));
});

test('logged in layout emits inline script that parses', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '<div></div>' });
	const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
	assert.ok(match);
	assert.doesNotThrow(() => new vm.Script(match[1]));
	assert.ok(match[1].includes('function openFolderContextMenu(event,id,title)'));
	assert.ok(match[1].includes('function submitFolderEdit(event)'));
	assert.ok(match[1].includes('window.open(href,\'_blank\',\'noopener\')'));
	assert.ok(match[1].includes('document.execCommand(\'insertHTML\',false,\'<a href="/resources/'));
	assert.ok(match[1].includes('function confirmLogout(event){'));
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
