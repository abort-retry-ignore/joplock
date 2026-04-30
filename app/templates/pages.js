// Full-page HTML responses: layoutPage, loggedOutPage, mfaPage
'use strict';

const {
	escapeHtml,
	appleSplashLinks,
	themeOptions,
	passwordField,
} = require('./shared');

const { noteMetaFragment } = require('./fragments');

// layoutPage: the main app shell (or login page when user is null)
const layoutPage = (options = {}) => {
	const { user, navContent, editorContent, loginError, debug = false, mobileStartup = null, mobileEditorContent = '' } = options;
	const settings = options.settings || {};
	const loggedIn = !!user;

	if (!loggedIn) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
	<meta name="theme-color" content="#0b0b0b" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Joplock" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	${appleSplashLinks}
	<link rel="stylesheet" href="/styles.css?v=20260426c" />
	<title>Joplock</title>
</head>
<body class="theme-dark-grey${settings.noteMonospace ? ' note-body-monospace' : ''}" style="--font-size-note:${escapeHtml(settings.noteFontSize || 15)}px;--font-size-note-mobile:${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}px;--font-size-code:${escapeHtml(settings.codeFontSize || 12)}px;">
	<script>
	(function(){
		var keys=['joplock-theme','joplock-nav-collapsed','joplock-nav-folders'];
		try{keys.forEach(function(k){localStorage.removeItem(k)})}catch(e){}
		// Clear any stale vault keys: a fresh login session must never inherit cached vault keys.
		try{var toRemove=[];for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);if(k&&k.startsWith('joplock-vault-key-'))toRemove.push(k)}toRemove.forEach(function(k){sessionStorage.removeItem(k)})}catch(e){}
	})();
	</script>
	<div class="login-page">
		<div class="login-card">
			<h1 class="login-title">Joplock</h1>
			<p class="login-sub">Sign in with your Joplin Server credentials.</p>
			<form class="login-form" method="POST" action="/login">
				<input type="email" name="email" placeholder="Email" class="login-input" required autofocus />
				<div class="login-password-wrap">
					${passwordField('password', { id: 'login-password', placeholder: 'Password' })}
				</div>
				<div class="login-error" id="login-error">${loginError ? escapeHtml(loginError) : ''}</div>
				<button type="submit" class="btn btn-primary login-btn">Login</button>
			</form>
		</div>
	</div>
</body>
</html>`;
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
	<meta name="theme-color" content="#08110b" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Joplock" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	${appleSplashLinks}
	<link rel="stylesheet" href="/styles.css?v=20260430c" />
	<script src="/htmx.min.js"></script>
	<script src="/turndown.min.js"></script>
	<script src="/codemirror.min.js"></script>
	<script src="/hljs.min.js"></script>
	<script src="/app.js?v=20260430c" defer></script>
	<title>Joplock</title>
</head>
<body class="app-shell theme-${escapeHtml(settings.theme || 'matrix')}${settings.noteMonospace ? ' note-body-monospace' : ''}${settings.uiMode === 'mobile' ? ' force-mobile' : ''}${settings.uiMode === 'desktop' ? ' force-desktop' : ''}" style="--font-size-note:${escapeHtml(settings.noteFontSize || 15)}px;--font-size-note-mobile:${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}px;--font-size-code:${escapeHtml(settings.codeFontSize || 12)}px;">
	<div id="note-loading-overlay" aria-hidden="true">
		<div class="note-loading-ring"></div>
		<div class="note-loading-label">Loading note…</div>
	</div>
	<div class="app">
		<div class="mobile-nav-backdrop" id="mobile-nav-backdrop" onclick="closeNav()"></div>
		<button type="button" class="nav-reopen-btn" id="nav-reopen-btn" title="Show notebooks and notes" onclick="toggleNav()">&#9776;</button>
		<div class="col-nav" id="nav-panel">
			${navContent || '<div class="empty-hint">No notebooks yet</div>'}
		</div>
		<div class="col-editor" id="editor-panel">
			${editorContent || '<div class="editor-empty">Select a note</div>'}
		</div>
	</div>
	<!-- Mobile app: 3-screen stack, only visible on mobile -->
	<div id="mobile-app" class="mobile-app" aria-hidden="true">
		<div class="mobile-screen" id="mobile-folders-screen">
			<div class="mobile-header" id="mobile-folders-header">
				<span class="mobile-header-title">Notes</span>
				<button class="mobile-header-btn" onclick="mobileSearchOpen()" title="Search">&#128269;</button>
				<a href="/settings" class="mobile-header-btn" title="Settings">&#9881;</a>
				<a href="/logout" class="mobile-header-btn" title="Logout" onclick="return confirmLogout(event)">&#8618;</a>
			</div>
			<div class="mobile-header mobile-search-header" id="mobile-search-header" style="display:none">
				<button class="mobile-header-btn mobile-back-btn" onclick="mobileSearchClose()" title="Cancel">&#10005;</button>
				<input class="mobile-search-input" id="mobile-search-input" type="text" placeholder="Search notes..." autocomplete="off"
					oninput="mobileSearchQuery(this.value)" />
			</div>
			<div class="mobile-screen-body" id="mobile-folders-body">
				<div class="empty-hint">Loading...</div>
			</div>
		</div>
		<div class="mobile-screen mobile-screen-right" id="mobile-notes-screen">
			<div class="mobile-header">
				<button class="mobile-header-btn mobile-back-btn" onclick="mobilePopScreen()" title="Back">&#8249;</button>
				<span class="mobile-header-title" id="mobile-notes-title">Notes</span>
				<button class="mobile-header-btn" onclick="mobileNewNote()" title="New note">+</button>
			</div>
			<div class="mobile-screen-body" id="mobile-notes-body"></div>
		</div>
		<div class="mobile-screen mobile-screen-right" id="mobile-editor-screen">
			<div class="mobile-header" id="mobile-editor-header">
				<button class="mobile-header-btn mobile-back-btn" id="mobile-editor-back" onclick="mobileEditorBack()" title="Back">&#8249;</button>
				<span class="mobile-header-title mobile-editor-title-editable" id="mobile-editor-title" contenteditable="true" spellcheck="false" data-placeholder="Note title" oninput="mobileTitleInput()" onblur="mobileSyncTitleAndSave()"></span>
				<span class="mobile-editor-status" id="mobile-editor-status"></span>
				<button class="mobile-header-btn mobile-editor-search-btn" id="mobile-editor-search-open" onclick="mobileEditorSearchOpen()" title="Find in note">&#128269;</button>
				<button class="mobile-header-btn mobile-mode-toggle" id="mobile-md-toggle" onclick="setEditorMode('markdown')" title="Markdown">MD</button>
				<button class="mobile-header-btn mobile-mode-toggle" id="mobile-preview-toggle" onclick="setEditorMode('preview')" title="Rendered">&#128065;</button>
				<button class="mobile-header-btn" id="mobile-editor-menu-btn" onclick="mobileEditorMenuOpen()" title="Note actions">&#9776;</button>
			</div>
			<div class="mobile-header mobile-editor-search-header" id="mobile-editor-search-header" style="display:none">
				<button class="mobile-header-btn mobile-back-btn" onclick="mobileEditorSearchClose()" title="Close find">&#10005;</button>
				<input class="mobile-search-input mobile-editor-search-input" id="mobile-editor-search-input" type="text" placeholder="Find in note..." autocomplete="off" oninput="mobileEditorSearchQuery(this.value)" />
				<span class="mobile-search-nav-counter" id="mobile-search-nav-counter" hidden></span>
				<button type="button" class="mobile-header-btn mobile-search-nav-btn" id="mobile-search-prev-btn" title="Previous match" onclick="searchNavStep(-1)" hidden>&#8593;</button>
				<button type="button" class="mobile-header-btn mobile-search-nav-btn" id="mobile-search-next-btn" title="Next match" onclick="searchNavStep(1)" hidden>&#8595;</button>
			</div>
			<div class="mobile-screen-body mobile-editor-body" id="mobile-editor-body">
				${mobileEditorContent || '<div class="editor-empty">Select a note</div>'}
			</div>
		</div>
	</div>
	<button class="mobile-fab" id="mobile-fab" onclick="mobileFabOpen()" title="Add new">+</button>
	<div class="mobile-fab-menu-backdrop" id="mobile-fab-menu-backdrop" style="display:none" onclick="mobileFabClose()"></div>
	<div class="mobile-fab-menu" id="mobile-fab-menu" style="display:none">
		<button class="mobile-fab-menu-btn" onclick="mobileFabNewNote()">&#128221; New note</button>
		<button class="mobile-fab-menu-btn" onclick="mobileFabNewFolder()">&#128193; New notebook</button>
		<button class="mobile-fab-menu-btn mobile-fab-menu-cancel" onclick="mobileFabClose()">Cancel</button>
	</div>
	<!-- Mobile context menu (long-press on note row) -->
	<div class="mobile-ctx-backdrop" id="mobile-ctx-backdrop" style="display:none" onclick="mobileCtxClose()"></div>
	<div class="mobile-ctx-sheet" id="mobile-ctx-sheet" style="display:none">
		<div class="mobile-ctx-title" id="mobile-ctx-title"></div>
		<div class="mobile-ctx-meta" id="mobile-ctx-meta" style="display:none"></div>
		<button class="mobile-ctx-btn" id="mobile-ctx-move">&#128193; Move note</button>
		<button class="mobile-ctx-btn" id="mobile-ctx-delete">&#128465; Delete note</button>
		<button class="mobile-ctx-btn mobile-ctx-btn-cancel" onclick="mobileCtxClose()">Cancel</button>
	</div>
	<!-- Mobile folder context menu (long-press on folder row) -->
	<div class="mobile-ctx-backdrop" id="mobile-folder-ctx-backdrop" style="display:none" onclick="mobileFolderCtxClose()"></div>
	<div class="mobile-ctx-sheet" id="mobile-folder-ctx-sheet" style="display:none">
		<div class="mobile-ctx-title" id="mobile-folder-ctx-title"></div>
		<button class="mobile-ctx-btn" id="mobile-folder-ctx-rename">&#9998; Rename notebook</button>
		<button class="mobile-ctx-btn" id="mobile-folder-ctx-delete">&#128465; Delete notebook</button>
		<button class="mobile-ctx-btn mobile-ctx-btn-cancel" onclick="mobileFolderCtxClose()">Cancel</button>
	</div>
	<div class="mobile-ctx-backdrop" id="mobile-folder-picker-backdrop" style="display:none" onclick="mobileFolderPickerClose()"></div>
	<div class="mobile-ctx-sheet mobile-folder-picker-sheet" id="mobile-folder-picker-sheet" style="display:none">
		<div class="mobile-ctx-title" id="mobile-folder-picker-title">Move note</div>
		<div class="mobile-folder-picker-list" id="mobile-folder-picker-list"></div>
		<button class="mobile-ctx-btn mobile-ctx-btn-cancel" onclick="mobileFolderPickerClose()">Cancel</button>
	</div>
	<!-- Vault modal (unlock or create vault) -->
	<div class="folder-modal-backdrop" id="vault-modal-backdrop" hidden onclick="closeVaultModal()"></div>
	<div class="folder-modal lock-modal" id="vault-modal" hidden>
		<form class="folder-modal-card" id="vault-modal-form" onsubmit="submitVaultModal(event)">
			<h3 class="folder-modal-title" id="vault-modal-title">Unlock Vault</h3>
			<p class="lock-modal-warning" id="vault-modal-warning">\u26A0\uFE0F This password cannot be changed. If forgotten, encrypted notes cannot be recovered.</p>
			<input type="password" id="vault-modal-password" class="login-input" placeholder="Vault password" required autocomplete="off" />
			<div id="vault-modal-confirm-wrap" style="display:none">
				<input type="password" id="vault-modal-confirm" class="login-input" placeholder="Confirm password" autocomplete="off" />
			</div>
			<div class="lock-modal-error" id="vault-modal-error"></div>
			<div class="folder-modal-actions">
				<button type="button" class="btn btn-sm btn-secondary" onclick="closeVaultModal()">Cancel</button>
				<button type="submit" class="btn btn-sm btn-primary">OK</button>
			</div>
		</form>
	</div>
	<!-- New notebook modal (with optional vault checkbox) -->
	<div class="folder-modal-backdrop" id="new-folder-modal-backdrop" hidden onclick="closeNewFolderModal()"></div>
	<div class="folder-modal lock-modal" id="new-folder-modal" hidden>
		<form class="folder-modal-card" id="new-folder-modal-form" onsubmit="submitNewFolderModal(event)">
			<h3 class="folder-modal-title">New Notebook</h3>
			<label class="lock-modal-checkbox" style="margin-top:0.75rem">
				<input type="checkbox" id="new-folder-is-vault" onchange="toggleNewFolderVault(this.checked)" /> Make this a vault (encrypted notebook)
			</label>
			<input type="text" id="new-folder-title" class="login-input" placeholder="Notebook name" required autocomplete="off" />
			<div id="new-vault-fields" style="display:none">
				<p class="lock-modal-warning" style="margin-top:0.5rem">\u26A0\uFE0F This password cannot be changed. If forgotten, encrypted notes cannot be recovered.</p>
				<input type="password" id="new-vault-password" class="login-input" placeholder="Vault password" autocomplete="off" />
				<input type="password" id="new-vault-confirm" class="login-input" placeholder="Confirm password" autocomplete="off" />
			</div>
			<div class="lock-modal-error" id="new-vault-error"></div>
			<div class="folder-modal-actions">
				<button type="button" class="btn btn-sm btn-secondary" onclick="closeNewFolderModal()">Cancel</button>
				<button type="submit" class="btn btn-sm btn-primary">Create</button>
			</div>
		</form>
	</div>
	<div class="app-statusbar">
		<a href="/settings" class="btn btn-icon status-settings-link" title="Settings">&#9881;</a>
		<span class="status-user">${escapeHtml(user.fullName || user.email)}</span>
		${noteMetaFragment({ createdTime: 0, updatedTime: 0 }, 'status-note-meta')}
		<span class="status-spacer"></span>
		<select class="theme-picker" onchange="setTheme(this.value)">
			${themeOptions.map(function(t){return '<option value="'+t[0]+'"'+((settings.theme||'matrix')===t[0]?' selected':'')+'>'+t[1]+'</option>'}).join('')}
		</select>
		<a href="/logout" class="btn btn-sm btn-secondary logout-link" onclick="return confirmLogout(event)">Logout</a>
	</div>
	<div class="code-modal-panel" id="code-modal" hidden>
		<form class="code-modal-inner" id="code-edit-form" onsubmit="submitCode(event)">
			<div class="code-modal-header">
				<h3 class="code-modal-title" id="code-modal-title">Insert code block</h3>
				<select id="code-lang" class="login-input code-lang-select">
					<option value="">Plain text</option>
					<option value="bash">Bash</option>
					<option value="c">C</option>
					<option value="cpp">C++</option>
					<option value="css">CSS</option>
					<option value="go">Go</option>
					<option value="html">HTML</option>
					<option value="javascript">JavaScript</option>
					<option value="json">JSON</option>
					<option value="python">Python</option>
					<option value="sql">SQL</option>
					<option value="typescript">TypeScript</option>
					<option value="xml">XML</option>
					<option value="yaml">YAML</option>
				</select>
			</div>
			<div id="code-input" class="code-input"></div>
			<div class="code-modal-actions">
				<button type="button" class="btn btn-sm btn-secondary" onclick="closeCodeModal()">Cancel</button>
				<button type="submit" class="btn btn-sm btn-primary" id="code-modal-submit">Insert</button>
			</div>
		</form>
	</div>
	<script>
	window._joplockConfig={
		debug:${debug ? 'true' : 'false'},
		noteOpenMode:${JSON.stringify(settings.noteOpenMode || 'preview')},
		mobileStartup:${JSON.stringify(mobileStartup || null)},
		theme:${JSON.stringify(settings.theme || 'matrix')},
		dateFormat:${JSON.stringify(String(settings.dateFormat || 'MMM-DD-YY'))},
		datetimeFormat:${JSON.stringify(String(settings.datetimeFormat || 'YYYY-MM-DD HH:mm'))},
		liveSearch:${settings.liveSearch ? 'true' : 'false'},
		confirmTrash:${settings.confirmTrash !== false ? 'true' : 'false'},
		encryptionAutoLockMinutes:${JSON.stringify(settings.encryptionAutoLockMinutes || 5)},
		uiMode:${JSON.stringify(settings.uiMode || 'auto')}
	};
	</script>
</body>
</html>`;
};

const loggedOutPage = () => `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
	<meta name="theme-color" content="#08110b" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Joplock" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	${appleSplashLinks}
	<link rel="stylesheet" href="/styles.css" />
	<title>Logging out...</title>
</head>
<body class="theme-dark-grey">
	<div class="login-page logout-page">
		<div class="login-card logout-card">
			<h1 class="login-title">Logging out</h1>
			<p class="login-sub">Clearing local data and ending this session.</p>
			<div class="logout-progress" id="logout-progress">
				<button type="button" class="logout-step" data-step="session" onclick="toggleLogoutDetail('session')">End server session</button>
				<div class="logout-detail" id="logout-detail-session">Invalidate the current Joplock session and ask the upstream Joplin Server to end its session too.</div>
				<button type="button" class="logout-step" data-step="storage" onclick="toggleLogoutDetail('storage')">Clear local storage</button>
				<div class="logout-detail" id="logout-detail-storage">Remove local preferences like theme, panel state, folder expansion state, and markdown cleaning preference.</div>
				<button type="button" class="logout-step" data-step="done" onclick="toggleLogoutDetail('done')">Cleanup complete</button>
				<div class="logout-detail" id="logout-detail-done">All client-side cleanup steps have finished. Use the button below to return to the login screen.</div>
			</div>
			<a href="/login?loggedOut=1" class="btn btn-primary login-btn logout-login-link" id="logout-login-link" style="display:none">Go to login</a>
		</div>
	</div>
	<script>
	(function(){
		var status=document.getElementById('logout-progress');
		var loginLink=document.getElementById('logout-login-link');
		function mark(step,state){var el=status&&status.querySelector('[data-step="'+step+'"]');if(!el)return;el.className='logout-step '+state;if(state==='done'&&!el.querySelector('.logout-step-check')){var check=document.createElement('span');check.className='logout-step-check';check.textContent='\u2713';el.appendChild(check)}}
		window.toggleLogoutDetail=function(step){var el=document.getElementById('logout-detail-'+step);if(!el)return;el.classList.toggle('open')}
		async function run(){
			mark('session','done');
			var keys=['joplock-theme','joplock-nav-collapsed','joplock-nav-folders','joplock-clean-md','joplock-settings-tab'];
			try{keys.forEach(function(k){localStorage.removeItem(k)})}catch(e){}
			// Clear vault keys from sessionStorage so re-login requires re-entering vault passwords
			try{var toRemove=[];for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);if(k&&k.startsWith('joplock-vault-key-'))toRemove.push(k)}toRemove.forEach(function(k){sessionStorage.removeItem(k)})}catch(e){}
			mark('storage','done');
			mark('done','done');
			if(loginLink)loginLink.style.display='inline-flex';
		}
		run().catch(function(){if(loginLink)loginLink.style.display='inline-flex'});
	})();
	</script>
</body>
</html>`;

// MFA verification page (two-step login)
const mfaPage = (options = {}) => {
	const { error = '' } = options;
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
	<meta name="theme-color" content="#0b0b0b" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="stylesheet" href="/styles.css" />
	<title>Verify Identity - Joplock</title>
</head>
<body class="theme-dark-grey">
	<div class="login-page">
		<div class="login-card">
			<h1 class="login-title">Two-Factor Authentication</h1>
			<p class="login-sub">Enter the 6-digit code from your authenticator app.</p>
			<form class="login-form" method="POST" action="/login/mfa">
				<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" class="login-input" required pattern="[0-9]{6}" autofocus />
				<div class="login-error">${error ? escapeHtml(error) : ''}</div>
				<button type="submit" class="btn btn-primary login-btn">Verify</button>
			</form>
			<p class="login-sub" style="margin-top:16px"><a href="/login">Back to login</a></p>
		</div>
	</div>
</body>
</html>`;
};

module.exports = { layoutPage, loggedOutPage, mfaPage };
