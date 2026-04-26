// SSR HTML templates for htmx-driven UI
// 3-column layout: folders | note list | editor (like Joplin desktop)

const { validDateFormats, validDatetimeFormats } = require('./settingsService');

const escapeHtml = value => `${value}`
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll('\'', '&#39;');

const appleSplashLinks = [
	['1320x2868.png', 'screen and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2868x1320.png', 'screen and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1290x2796.png', 'screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2796x1290.png', 'screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1179x2556.png', 'screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2556x1179.png', 'screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1170x2532.png', 'screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2532x1170.png', 'screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1125x2436.png', 'screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2436x1125.png', 'screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['1242x2688.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
	['2688x1242.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
	['828x1792.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['1792x828.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['1536x2048.png', 'screen and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2048x1536.png', 'screen and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['1668x2388.png', 'screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2388x1668.png', 'screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['1640x2360.png', 'screen and (device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2360x1640.png', 'screen and (device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
	['2048x2732.png', 'screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
	['2732x2048.png', 'screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
].map(([fileName, media]) => `<link rel="apple-touch-startup-image" href="/apple-splash/${fileName}" media="${media}" />`).join('\n\t');

const folderOutlineIcon = '<svg viewBox="0 0 24 24" class="folder-outline-icon" aria-hidden="true"><path d="M3.75 6.75h5.25l1.5 2h9.75v8.5A1.75 1.75 0 0 1 18.5 19H5.5a1.75 1.75 0 0 1-1.75-1.75v-8.75A1.75 1.75 0 0 1 5.5 6.75Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.75 8.75h16.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const allNotesIcon = '&#128196;';
const trashFolderId = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';
const themeOptions = [['matrix','Matrix'],['matrix-blue','Dark Blue'],['matrix-purple','Dark Purple'],['matrix-amber','Dark Amber'],['matrix-orange','Dark Orange'],['dark-grey','Dark Grey'],['dark-red','Dark Red'],['dark','Dark'],['light','Light'],['oled-dark','OLED Dark'],['solarized-light','Solarized Light'],['solarized-dark','Solarized Dark'],['nord','Nord'],['dracula','Dracula'],['aritim-dark','Aritim Dark']];

const stripMarkdownForTitle = value => {
	let text = `${value || ''}`.trim();
	while (text.startsWith('#')) text = text.slice(1).trimStart();
	text = text
		.replaceAll('**', '')
		.replaceAll('__', '')
		.replaceAll('++', '')
		.replaceAll('*', '')
		.replaceAll('_', '')
		.replaceAll('~~', '')
		.replaceAll('`', '');
	let output = '';
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (ch === '!' && text[i + 1] === '[') {
			const altEnd = text.indexOf(']', i + 2);
			const imgOpen = altEnd >= 0 ? text.indexOf('(', altEnd + 1) : -1;
			const imgClose = imgOpen >= 0 ? text.indexOf(')', imgOpen + 1) : -1;
			if (altEnd >= 0 && imgOpen === altEnd + 1 && imgClose >= 0) {
				output += text.slice(i + 2, altEnd);
				i = imgClose;
				continue;
			}
		}
		if (ch === '[') {
			const labelEnd = text.indexOf(']', i + 1);
			const linkOpen = labelEnd >= 0 ? text.indexOf('(', labelEnd + 1) : -1;
			const linkClose = linkOpen >= 0 ? text.indexOf(')', linkOpen + 1) : -1;
			if (labelEnd >= 0 && linkOpen === labelEnd + 1 && linkClose >= 0) {
				output += text.slice(i + 1, labelEnd);
				i = linkClose;
				continue;
			}
		}
		output += ch;
	}
	return output.trim();
};

const noteDomId = (noteId, contextFolderId = '') => {
	const safeContext = `${contextFolderId || 'root'}`.replace(/[^a-zA-Z0-9_-]/g, '-');
	return `note-item-${safeContext}-${noteId}`;
};

// Column 1: folder list item
const folderListItem = (folder, selectedFolderId) => {
	const active = folder.id === selectedFolderId ? ' active' : '';
	return `<button id="folder-item-${escapeHtml(folder.id)}" class="sidebar-item${active}" data-folder-id="${escapeHtml(folder.id)}"
		hx-get="/fragments/notes?folderId=${encodeURIComponent(folder.id)}"
		hx-target="#notelist-panel"
		hx-swap="innerHTML"
		hx-on::after-request="document.querySelectorAll('.sidebar-item').forEach(b=>b.classList.remove('active'));this.classList.add('active')">
		<span class="sidebar-item-icon">${folderOutlineIcon}</span>
		<span class="sidebar-item-name">${escapeHtml(folder.title || 'Untitled')}</span>
		<span class="sidebar-item-count">${folder.noteCount !== undefined ? folder.noteCount : ''}</span>
	</button>`;
};

// Column 1: full folder list
const folderListFragment = (folders, selectedFolderId) => {
	if (!folders.length) {
		return '<div class="empty-hint">No notebooks yet</div>';
	}
	return folders.map(f => folderListItem(f, selectedFolderId)).join('');
};

// Column 2: single note in the note list
const noteListItem = (note, selectedNoteId, contextFolderId = '', selectedContextFolderId = null) => {
	const active = note.id === selectedNoteId && (selectedContextFolderId === null || contextFolderId === selectedContextFolderId) ? ' active' : '';
	const editorPath = `/fragments/editor/${encodeURIComponent(note.id)}${contextFolderId ? `?currentFolderId=${encodeURIComponent(contextFolderId)}` : ''}`;
	return `<button id="${escapeHtml(noteDomId(note.id, contextFolderId))}" class="notelist-item${active}" data-note-id="${escapeHtml(note.id)}"
		hx-get="${editorPath}"
		hx-target="#editor-panel"
		hx-swap="innerHTML"
		hx-on::before-request="window._pendingNoteSearchTerm=this.closest('[data-folder-id=__search_results__]')?((document.getElementById('nav-search')||{}).value||''):''"
		hx-on::after-request="document.querySelectorAll('.notelist-item').forEach(b=>b.classList.remove('active'));this.classList.add('active');if(isMobileShellMode())closeNav()">
		<span class="notelist-item-title">${escapeHtml(stripMarkdownForTitle(note.title || 'Untitled') || 'Untitled')}</span>
	</button>`;
};

// Column 2: note list with header (new note button + search)
const noteListFragment = (notes, selectedNoteId, folderId) => {
	const header = `<div class="notelist-header">
		${folderId ? `<button class="btn btn-sm"
			hx-post="/fragments/notes"
			hx-vals='${escapeHtml(JSON.stringify({ parentId: folderId }))}'
			hx-target="#notelist-panel"
			hx-swap="innerHTML"
			hx-on::after-request="if(isMobileShellMode())closeNav()">+ New note</button>` : ''}
		<input type="text" class="notelist-search" placeholder="Search..."
			hx-get="/fragments/search"
			hx-trigger="keyup[key==='Enter'], input changed delay:300ms[(event.target.value.length>=3||event.target.value.length===0)&&window.joplockLiveSearch]"
			hx-target="#notelist-items"
			hx-swap="innerHTML"
			hx-include="this"
			name="q"
			${folderId ? `data-folder-id="${escapeHtml(folderId)}"` : ''} />
	</div>`;

	const items = notes.length
		? notes.map(n => noteListItem(n, selectedNoteId, folderId)).join('')
		: '<div class="empty-hint">No notes</div>';

	return `${header}<div class="notelist-items" id="notelist-items">${items}</div>`;
};

const noteSyncStateFragment = note => `<span id="editor-sync-state"><input type="hidden" name="baseUpdatedTime" value="${escapeHtml(note.updatedTime || 0)}" /><input type="hidden" name="forceSave" value="" /><input type="hidden" name="createCopy" value="" /></span>`;

const noteMetaFragment = note => `<span id="note-meta" class="note-meta" data-created-time="${escapeHtml(note.createdTime || 0)}" data-updated-time="${escapeHtml(note.updatedTime || 0)}"></span>`;

const autosaveConflictFragment = noteId => `<span class="autosave-conflict"><span class="autosave-error">Conflict</span><button type="button" class="btn btn-sm" hx-put="/fragments/editor/${encodeURIComponent(noteId)}" hx-include="#note-editor-form" hx-target="#autosave-status" hx-swap="innerHTML" hx-vals='{"forceSave":"1"}' hx-on:click="if(getPV())syncPV()">Overwrite</button><button type="button" class="btn btn-sm" hx-put="/fragments/editor/${encodeURIComponent(noteId)}" hx-include="#note-editor-form" hx-target="#autosave-status" hx-swap="innerHTML" hx-vals='{"createCopy":"1"}' hx-on:click="if(getPV())syncPV()">Create copy</button></span>`;

const fmtHistoryTime = ts => {
	const d = new Date(Number(ts));
	return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

const historyModalFragment = (noteId, snapshots) => {
	const list = snapshots.length === 0
		? '<div class="history-empty">No saved snapshots yet.</div>'
		: snapshots.map((s, i) => `<button type="button" class="history-item${i === 0 ? ' history-item-active' : ''}" data-snapshot-id="${escapeHtml(s.id)}" onclick="selectHistorySnapshot('${escapeHtml(s.id)}')">${escapeHtml(fmtHistoryTime(s.savedTime))}<span class="history-item-title">${escapeHtml((s.title || 'Untitled').slice(0, 40))}</span></button>`).join('');
	return `<div class="history-body">
		<div class="history-list" id="history-list">${list}</div>
		<div class="history-preview" id="history-preview">${snapshots.length > 0 ? `<div hx-get="/fragments/history-snapshot/${encodeURIComponent(snapshots[0].id)}" hx-trigger="load" hx-swap="outerHTML"></div>` : '<div class="history-empty">Select a snapshot to preview.</div>'}</div>
	</div>
	<div class="history-actions" id="history-actions">
		<span class="history-selected-label" id="history-selected-label">${snapshots.length > 0 ? escapeHtml(fmtHistoryTime(snapshots[0].savedTime)) : 'No snapshots'}</span>
		${snapshots.length > 0 ? `<button type="button" class="btn btn-sm" onclick="restoreHistorySnapshot('${escapeHtml(noteId)}')">Restore this version</button>` : ''}
		<button type="button" class="btn btn-sm btn-secondary" onclick="closeHistoryModal()">Close</button>
	</div>`;
};

const historySnapshotPreviewFragment = snapshot => {
	const body = (snapshot.body || '').replace(/&nbsp;/g, ' ');
	const preview = body.slice(0, 3000) + (body.length > 3000 ? '\n…' : '');
	return `<div class="history-snapshot-content"><pre class="history-snapshot-body">${escapeHtml(preview)}</pre></div>`;
};

// folderNotesPageFragment: renders a page of note items + optional "load more" button.
// Used by /fragments/folder-notes for lazy loading.
const folderNotesPageFragment = (notes, contextFolderId, selectedNoteId, hasMore, nextOffset, totalCount) => {
	const items = (notes || []).map(n => noteListItem(n, selectedNoteId, contextFolderId, null)).join('');
	if (!hasMore) return items || '<div class="empty-hint nav-empty">No notes</div>';
	const remaining = totalCount - nextOffset;
	const loadMoreBtn = `<button class="notelist-load-more"
		hx-get="/fragments/folder-notes?folderId=${encodeURIComponent(contextFolderId)}&offset=${nextOffset}&selectedNoteId=${encodeURIComponent(selectedNoteId || '')}"
		hx-target="closest .nav-folder-notes"
		hx-swap="beforeend"
		hx-on::after-request="this.remove()">Load ${Math.min(remaining, 100)} more&hellip;</button>`;
	return (items || '<div class="empty-hint nav-empty">No notes</div>') + loadMoreBtn;
};

const navigationFragment = (folders, countsOrNotes, selectedFolderId, selectedNoteId, query = '', selectedNoteContextFolderId = null) => {
	// countsOrNotes is either a Map (lazy mode: counts per folder) or an array (search results mode).
	const isSearchMode = Array.isArray(countsOrNotes);
	const searchNotesList = isSearchMode ? countsOrNotes : [];
	const counts = isSearchMode ? new Map() : (countsOrNotes || new Map());

	const hasQuery = !!`${query || ''}`.trim();

	const folderSections = (hasQuery && isSearchMode) ? (() => {
		const results = searchNotesList.filter(n => !n.deletedTime);
		const count = results.length;
		if (!count) return '<div class="empty-hint">No results</div>';
		return `<div class="nav-folder collapsed" data-folder-id="__search_results__" data-folder-title="Search Results" data-selected="1" data-all-notes="1">
			<div class="nav-folder-row" onclick="toggleNavFolder('__search_results__')">
				<button type="button" class="nav-folder-toggle" tabindex="-1">&#9656;</button>
				<span class="sidebar-item-icon">${allNotesIcon}</span>
				<span class="nav-folder-title">Search Results</span>
				<span class="sidebar-item-count">${count}</span>
			</div>
			<div class="nav-folder-notes">
				${results.map(n => noteListItem(n, selectedNoteId, '__search_results__', selectedNoteContextFolderId)).join('')}
			</div>
		</div>`;
	})() : (folders || []).map(folder => {
		const folderId = folder.id;
		// Map folder ID to the counts key used in folderNoteCountsByUserId
		const countKey = folder.isVirtualAllNotes ? '__all__' : (folderId === trashFolderId ? '__trash__' : folderId);
		const count = counts.get(countKey) || folder.noteCount || 0;
		const isOpen = folderId === selectedFolderId;
		const isExpandable = count > 0;
		const isTrash = folderId === trashFolderId;
		const isAllNotes = !!folder.isVirtualAllNotes;
		// For the selected folder that contains the open note, pre-populate is handled by JS on expand.
		// data-selected-note is used by toggleNavFolder to know what to highlight.
		return `<div class="nav-folder collapsed${isExpandable ? '' : ' nav-folder-empty'}" data-folder-id="${escapeHtml(folderId)}" data-folder-title="${escapeHtml(folder.title || 'Untitled')}" data-selected="${isOpen ? '1' : ''}" data-note-count="${count}"${isAllNotes ? ' data-all-notes="1"' : ''}>
			<div class="nav-folder-row"${isExpandable ? ` onclick="toggleNavFolder('${escapeHtml(folderId)}')"` : ''}${isAllNotes ? '' : ` oncontextmenu="openFolderContextMenu(event,'${escapeHtml(folderId)}','${escapeHtml(folder.title || 'Untitled')}')"`}>
				${isExpandable ? '<button type="button" class="nav-folder-toggle" tabindex="-1">&#9656;</button>' : '<span class="nav-folder-toggle nav-folder-toggle-placeholder"></span>'}
				<span class="sidebar-item-icon">${isTrash ? '&#128465;' : (isAllNotes ? allNotesIcon : folderOutlineIcon)}</span>
				<span class="nav-folder-title">${escapeHtml(folder.title || 'Untitled')}</span>
				<span class="sidebar-item-count">${count || ''}</span>
				${isTrash ? `<button type="button" class="btn-icon-sm nav-folder-add" title="Empty trash"
					hx-post="/fragments/trash/empty"
					hx-target="#nav-panel"
					hx-swap="innerHTML"
					hx-confirm="Empty trash permanently?"
					hx-on:click="event.stopPropagation()">&#10005;</button>` : (isAllNotes ? `<button type="button" class="btn-icon-sm nav-folder-add" title="New note in General"
					hx-post="/fragments/notes/in-general"
					hx-target="#nav-panel"
					hx-swap="innerHTML"
					hx-on:click="event.stopPropagation()">+</button>` : `<button type="button" class="btn-icon-sm nav-folder-add" title="New note"
					hx-post="/fragments/notes"
					hx-vals='${escapeHtml(JSON.stringify({ parentId: folderId }))}'
					hx-target="#nav-panel"
					hx-swap="innerHTML"
					hx-on:click="event.stopPropagation()">+</button>`)}
			</div>
			<div class="nav-folder-notes" data-folder-id="${escapeHtml(folderId)}">
			</div>
		</div>`;
	}).join('');

	return `<div class="nav-panel-header">
		<button type="button" class="nav-toggle-btn" title="Hide panel" onclick="toggleNav()">&#9776;</button>
		<form class="nav-search-form" onsubmit="event.preventDefault();var inp=document.getElementById('nav-search');htmx.trigger(inp,'search-submit')">
			<input type="text" class="notelist-search" id="nav-search" placeholder="Search..." value="${escapeHtml(query)}" name="q"
				hx-get="/fragments/nav"
				hx-trigger="search-submit"
				hx-target="#nav-panel"
				hx-swap="innerHTML"
				onkeydown="if(event.key==='Escape'){event.preventDefault();this.value='';htmx.trigger(this,'search-submit')}" />
			<button type="submit" class="btn-icon-sm nav-search-btn" title="Search">&#128269;</button>${hasQuery ? `<button type="button" class="btn-icon-sm nav-search-clear" title="Clear search" onclick="var inp=document.getElementById('nav-search');inp.value='';htmx.trigger(inp,'search-submit')">&#10005;</button>` : ''}
		</form>
		<button class="btn btn-sm" title="New notebook"
			onclick="event.preventDefault();var t=prompt('Notebook name');if(t&&t.trim()){htmx.ajax('POST','/fragments/folders',{target:'#nav-panel',swap:'innerHTML',values:{title:t.trim()}})}">+ Folder</button>
	</div><div class="nav-items">${folderSections || '<div class="empty-hint">No notebooks yet</div>'}</div>
	<div class="folder-context-menu" id="folder-context-menu" hidden>
		<button type="button" class="folder-context-item" onclick="editFolderFromMenu()">Edit notebook</button>
		<button type="button" class="folder-context-item danger" onclick="deleteFolderFromMenu()">Delete notebook</button>
	</div>
	<div class="folder-modal-backdrop" id="folder-modal-backdrop" hidden onclick="closeFolderModal()"></div>
	<div class="folder-modal" id="folder-modal" hidden>
		<form class="folder-modal-card" id="folder-edit-form" onsubmit="submitFolderEdit(event)">
			<h3 class="folder-modal-title">Edit notebook</h3>
			<input type="text" id="folder-edit-title" class="login-input" placeholder="Notebook name" required />
			<div class="folder-modal-actions">
				<button type="button" class="btn btn-sm btn-secondary" onclick="closeFolderModal()">Cancel</button>
				<button type="submit" class="btn btn-sm btn-primary">Save</button>
			</div>
		</form>
	</div>
	<div class="folder-modal-backdrop" id="link-modal-backdrop" hidden onclick="closeLinkModal()"></div>
	<div class="folder-modal" id="link-modal" hidden>
		<form class="folder-modal-card" id="link-edit-form" onsubmit="submitLink(event)">
			<h3 class="folder-modal-title">Insert link</h3>
			<input type="text" id="link-edit-label" class="login-input" placeholder="Label (e.g. Example Site)" />
			<input type="url" id="link-edit-url" class="login-input" placeholder="https://example.com" required />
			<div class="folder-modal-actions">
				<button type="button" class="btn btn-sm btn-secondary" onclick="closeLinkModal()">Cancel</button>
				<button type="submit" class="btn btn-sm btn-primary">Insert</button>
			</div>
		</form>
	</div>
	<div class="folder-modal-backdrop" id="history-modal-backdrop" hidden onclick="closeHistoryModal()"></div>
	<div class="history-modal" id="history-modal" hidden>
		<div class="history-modal-card">
			<div class="history-modal-header">
				<h3 class="folder-modal-title">Note history</h3>
				<button type="button" class="btn btn-icon history-close-btn" onclick="closeHistoryModal()" title="Close">&#10005;</button>
			</div>
			<div id="history-modal-inner"></div>
		</div>
	</div>`;
};

const adminUserRow = (u, currentUserId) => {
	const enabled = u.enabled !== false;
	const isSelf = u.id === currentUserId;
	const created = u.created_time ? new Date(u.created_time).toISOString().slice(0, 10) : '';
	const modalId = `user-modal-${u.id}`;
	const totpEnabled = !!u.totpEnabled;
	return `<tr>
		<td>${escapeHtml(u.email || '')}</td>
		<td>${escapeHtml(u.full_name || '')}</td>
		<td>
			<span class="badge ${enabled ? 'badge-ok' : 'badge-off'}">${enabled ? 'Enabled' : 'Disabled'}</span>
			${totpEnabled ? '<span class="badge badge-mfa">MFA</span>' : ''}
		</td>
		<td>${escapeHtml(created)}</td>
		<td class="admin-actions-cell">
			<button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('${modalId}').showModal()">Actions</button>
			<dialog id="${modalId}" class="admin-modal">
				<div class="admin-modal-content">
					<div class="admin-modal-header">
						<h3>Manage User</h3>
						<button type="button" class="admin-modal-close" onclick="this.closest('dialog').close()">&times;</button>
					</div>
					<div class="admin-modal-user">
						<strong>${escapeHtml(u.email || '')}</strong>
						${u.full_name ? `<span>${escapeHtml(u.full_name)}</span>` : ''}
						<span class="badge ${enabled ? 'badge-ok' : 'badge-off'}">${enabled ? 'Enabled' : 'Disabled'}</span>
						${totpEnabled ? '<span class="badge badge-mfa">MFA</span>' : ''}
					</div>
					<div class="admin-modal-actions">
						<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/password" class="admin-modal-form">
							<label class="admin-modal-label">Reset Password</label>
							<div class="admin-modal-row">
								<div class="login-password-wrap">
									<input type="password" name="password" placeholder="New password" required class="login-input" />
									<button type="button" class="login-eye" onclick="var p=this.parentNode.querySelector('input');if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>
								</div>
								<button type="submit" class="btn btn-primary">Reset</button>
							</div>
						</form>
						<div class="admin-modal-divider"></div>
						<div class="admin-modal-form">
							<label class="admin-modal-label">Two-Factor Authentication</label>
							${totpEnabled ? `
							<p class="admin-modal-hint">MFA is enabled for this user.</p>
							<details class="admin-totp-details">
								<summary class="btn btn-sm btn-secondary">Show TOTP Secret</summary>
								<div class="admin-totp-reveal">
									<img src="${u.totpQr || ''}" alt="TOTP QR" class="admin-totp-qr" />
									<code class="admin-totp-seed">${escapeHtml(u.totpSeed || '')}</code>
								</div>
							</details>
							<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/mfa/disable" style="margin-top:8px">
								<button type="submit" class="btn btn-secondary btn-block">Disable MFA</button>
							</form>
							` : `
							<p class="admin-modal-hint">MFA is not enabled. Generate a new TOTP seed for this user.</p>
							<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/mfa/enable">
								<button type="submit" class="btn btn-secondary btn-block">Enable MFA</button>
							</form>
							`}
						</div>
						${!isSelf ? `<div class="admin-modal-divider"></div>
						<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/${enabled ? 'disable' : 'enable'}" class="admin-modal-form">
							<label class="admin-modal-label">${enabled ? 'Disable Access' : 'Enable Access'}</label>
							<p class="admin-modal-hint">${enabled ? 'User will not be able to log in or sync.' : 'User will be able to log in and sync again.'}</p>
							<button type="submit" class="btn btn-secondary btn-block">${enabled ? 'Disable User' : 'Enable User'}</button>
						</form>
						<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/delete" class="admin-modal-form" onsubmit="return confirm('Delete user ${escapeHtml(u.email || '')} and all their data? This cannot be undone.')">
							<label class="admin-modal-label">Delete User</label>
							<p class="admin-modal-hint">Permanently delete this user and all their notes, folders, and resources.</p>
							<button type="submit" class="btn btn-danger btn-block">Delete User</button>
						</form>` : `<div class="admin-modal-divider"></div>
						<p class="admin-modal-hint">This is your admin account. You cannot disable or delete yourself.</p>`}
					</div>
					<div class="admin-modal-footer">
						<button type="button" class="btn btn-secondary btn-block" onclick="this.closest('dialog').close()">Cancel</button>
					</div>
				</div>
			</dialog>
		</td>
	</tr>`;
};

const settingsPage = (options = {}) => {
	const { user, settings = {}, userTotpEnabled = false, userTotpSetupSeed = '', userTotpSetupQr = '', isAdmin = false, isDockerAdmin = false, adminUsers = null, flash = '', flashError = '', activeTab = 'appearance' } = options;
	const validTabs = ['appearance', 'profile', 'security'];
	if (isAdmin) validTabs.push('admin');
	const tab = validTabs.includes(activeTab) ? activeTab : 'appearance';
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
	<meta name="theme-color" content="#08110b" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	${appleSplashLinks}
	<link rel="stylesheet" href="/styles.css" />
	<title>Joplock Settings</title>
</head>
<body class="theme-${escapeHtml(settings.theme || 'matrix')}">
	<div class="settings-page">
		<div class="settings-card">
			<div class="settings-header">
				<div>
					<h1 class="settings-title">Joplock Settings</h1>
					<p class="settings-sub">${escapeHtml(user.email)}</p>
				</div>
				<a href="/" class="btn btn-sm btn-secondary">Back to notes</a>
			</div>
			${flash ? `<div class="settings-flash settings-flash-ok">${escapeHtml(flash)}</div>` : ''}
			${flashError ? `<div class="settings-flash settings-flash-err">${escapeHtml(flashError)}</div>` : ''}
			<div class="settings-tabs" role="tablist">
				<button type="button" role="tab" class="settings-tab${tab === 'appearance' ? ' active' : ''}" data-tab="appearance" onclick="switchTab('appearance')">Appearance</button>
				<button type="button" role="tab" class="settings-tab${tab === 'profile' ? ' active' : ''}" data-tab="profile" onclick="switchTab('profile')">Profile</button>
				<button type="button" role="tab" class="settings-tab${tab === 'security' ? ' active' : ''}" data-tab="security" onclick="switchTab('security')">Security</button>
				${isAdmin ? `<button type="button" role="tab" class="settings-tab${tab === 'admin' ? ' active' : ''}" data-tab="admin" onclick="switchTab('admin')">Admin</button>` : ''}
			</div>

			<!-- Tab: Appearance -->
			<div class="settings-tab-panel${tab === 'appearance' ? ' active' : ''}" id="tab-appearance">
				<section class="settings-section">
					<h2 class="settings-section-title">Appearance</h2>
					<p class="settings-section-sub">Font and theme settings — changes are saved automatically.</p>
					<div class="settings-grid">
						<label class="settings-field">
							<span>Theme</span>
							<select id="settings-theme" class="login-input" onchange="saveSetting('theme',this.value)">
								${themeOptions.map(t => `<option value="${t[0]}"${(settings.theme || 'matrix') === t[0] ? ' selected' : ''}>${t[1]}</option>`).join('')}
							</select>
						</label>
						<label class="settings-field">
							<span>Note font size</span>
							<input type="range" min="12" max="24" value="${escapeHtml(settings.noteFontSize || 15)}" id="settings-note-font" onchange="saveSetting('noteFontSize',this.value)" />
							<output id="settings-note-font-value">${escapeHtml(settings.noteFontSize || 15)}px</output>
						</label>
						<label class="settings-field">
							<span>Mobile note font size</span>
							<input type="range" min="12" max="28" value="${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}" id="settings-mobile-note-font" onchange="saveSetting('mobileNoteFontSize',this.value)" />
							<output id="settings-mobile-note-font-value">${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}px</output>
						</label>
						<label class="settings-field">
							<span>Code font size</span>
							<input type="range" min="10" max="22" value="${escapeHtml(settings.codeFontSize || 12)}" id="settings-code-font" onchange="saveSetting('codeFontSize',this.value)" />
							<output id="settings-code-font-value">${escapeHtml(settings.codeFontSize || 12)}px</output>
						</label>
						<label class="settings-field settings-checkbox">
							<span>Note body font</span>
							<label><input type="checkbox" id="settings-note-monospace" onchange="saveSetting('noteMonospace',this.checked?'1':'0')"${settings.noteMonospace ? ' checked' : ''} /> Use monospace for note text</label>
						</label>
						<label class="settings-field">
							<span>Open notes in</span>
							<select id="settings-note-open-mode" class="login-input" onchange="saveSetting('noteOpenMode',this.value)">
								<option value="preview"${(settings.noteOpenMode || 'preview') === 'preview' ? ' selected' : ''}>Rendered mode</option>
								<option value="markdown"${settings.noteOpenMode === 'markdown' ? ' selected' : ''}>Markdown mode</option>
							</select>
						</label>
						<label class="settings-field settings-checkbox">
							<span>Live search</span>
							<label><input type="checkbox" id="settings-live-search" onchange="saveSetting('liveSearch',this.checked?'1':'0')"${settings.liveSearch ? ' checked' : ''} /> Search as you type (≥3 chars)</label>
						</label>
						<label class="settings-field settings-checkbox">
							<span>Startup</span>
							<label><input type="checkbox" id="settings-resume-last-note" onchange="saveSetting('resumeLastNote',this.checked?'1':'0')"${settings.resumeLastNote ? ' checked' : ''} /> Reopen the last edited note on startup</label>
						</label>
						<label class="settings-field">
							<span>Date format</span>
							<select id="settings-date-format" class="login-input" onchange="saveSetting('dateFormat',this.value)">
								${validDateFormats.map(f => `<option value="${escapeHtml(f)}"${(settings.dateFormat || 'YYYY-MM-DD') === f ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('')}
							</select>
						</label>
						<label class="settings-field">
							<span>DateTime format</span>
							<select id="settings-datetime-format" class="login-input" onchange="saveSetting('datetimeFormat',this.value)">
								${validDatetimeFormats.map(f => `<option value="${escapeHtml(f)}"${(settings.datetimeFormat || 'YYYY-MM-DD HH:mm') === f ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('')}
							</select>
						</label>
					</div>
				</section>
			</div>

			<!-- Tab: Profile -->
			<div class="settings-tab-panel${tab === 'profile' ? ' active' : ''}" id="tab-profile">
				<form class="settings-form" method="POST" action="/settings/profile">
				<section class="settings-section">
					<h2 class="settings-section-title">Profile</h2>
					<p class="settings-section-sub">Update your name and email.</p>
					<div class="settings-grid">
						<label class="settings-field">
							<span>Full name</span>
							<input type="text" class="login-input" name="fullName" value="${escapeHtml(user.fullName || '')}" placeholder="Your name" />
						</label>
						<label class="settings-field">
							<span>Email</span>
							<input type="email" class="login-input" name="email" value="${escapeHtml(user.email || '')}" required />
						</label>
					</div>
				</section>
				<div class="settings-actions"><button type="submit" class="btn btn-primary">Save profile</button></div>
				</form>
			</div>

			<!-- Tab: Security -->
			<div class="settings-tab-panel${tab === 'security' ? ' active' : ''}" id="tab-security">
				<form class="settings-form" method="POST" action="/settings/security">
				<section class="settings-section">
					<h2 class="settings-section-title">Session</h2>
					<p class="settings-section-sub">Automatically log out after a period of inactivity.</p>
					<div class="settings-grid">
						<label class="settings-field settings-checkbox">
							<span>Auto-logout</span>
							<label><input type="checkbox" name="autoLogout" value="1"${settings.autoLogout ? ' checked' : ''} /> Enable auto-logout after inactivity</label>
						</label>
						<label class="settings-field">
							<span>Timeout (minutes)</span>
							<input type="number" class="login-input" name="autoLogoutMinutes" min="1" max="480" value="${escapeHtml(settings.autoLogoutMinutes || 15)}" />
						</label>
					</div>
				</section>
				<div class="settings-actions"><button type="submit" class="btn btn-primary">Save session settings</button></div>
				</form>
				${isDockerAdmin ? `
				<section class="settings-section">
					<h2 class="settings-section-title">Change Password</h2>
					<p class="settings-section-sub">This account's password is managed via <code>JOPLOCK_ADMIN_PASSWORD</code> in the deployment configuration.</p>
				</section>
				` : `
				<section class="settings-section">
					<h2 class="settings-section-title">Change Password</h2>
					<p class="settings-section-sub">Enter your current password and a new password.</p>
					<form class="settings-form" method="POST" action="/settings/password">
					<div class="settings-grid">
						<label class="settings-field">
							<span>Current password</span>
							<div class="login-password-wrap">
								<input type="password" class="login-input" name="currentPassword" autocomplete="current-password" placeholder="Required" required />
								<button type="button" class="login-eye" onclick="var p=this.parentNode.querySelector('input');if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>
							</div>
						</label>
						<label class="settings-field">
							<span>New password</span>
							<div class="login-password-wrap">
								<input type="password" class="login-input" name="newPassword" autocomplete="new-password" placeholder="New password" required />
								<button type="button" class="login-eye" onclick="var p=this.parentNode.querySelector('input');if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>
							</div>
						</label>
						<label class="settings-field">
							<span>Confirm new password</span>
							<div class="login-password-wrap">
								<input type="password" class="login-input" name="confirmPassword" autocomplete="new-password" placeholder="Repeat new password" required />
								<button type="button" class="login-eye" onclick="var p=this.parentNode.querySelector('input');if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>
							</div>
						</label>
					</div>
					<div class="settings-actions"><button type="submit" class="btn btn-primary">Change password</button></div>
					</form>
				</section>
				`}
				<section class="settings-section">
					<h2 class="settings-section-title">Two-Factor Authentication</h2>
					<p class="settings-section-sub">Protect your account with a 6-digit code from your authenticator app.</p>
					${userTotpEnabled ? `
					<div class="settings-security-card settings-mfa-enabled">
						<p class="settings-mfa-status"><span class="badge badge-ok">Enabled</span> Two-factor authentication is active on your account.</p>
						<form method="POST" action="/settings/mfa/disable" class="settings-mfa-disable">
							<p class="settings-section-sub">To disable MFA, enter your current 6-digit code.</p>
							<div class="settings-mfa-row">
								<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" class="login-input" required pattern="[0-9]{6}" />
								<button type="submit" class="btn btn-danger">Disable MFA</button>
							</div>
						</form>
					</div>
					` : userTotpSetupSeed ? `
					<div class="settings-security-card settings-mfa-setup">
						<p class="settings-mfa-status"><span class="badge badge-warning">Setup in progress</span></p>
						<p>Scan this QR code with your authenticator app:</p>
						<img src="${userTotpSetupQr}" alt="MFA QR code" class="settings-qr" />
						<p class="settings-secret">Or enter manually: <code>${escapeHtml(userTotpSetupSeed)}</code></p>
						<form method="POST" action="/settings/mfa/verify" class="settings-mfa-verify">
							<input type="hidden" name="seed" value="${escapeHtml(userTotpSetupSeed)}" />
							<p>Enter the 6-digit code from your app to confirm setup:</p>
							<div class="settings-mfa-row">
								<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" class="login-input" required pattern="[0-9]{6}" autofocus />
								<button type="submit" class="btn btn-primary">Verify &amp; Enable</button>
							</div>
						</form>
						<form method="POST" action="/settings/mfa/cancel" class="settings-mfa-cancel">
							<button type="submit" class="btn btn-secondary">Cancel Setup</button>
						</form>
					</div>
					` : `
					<div class="settings-security-card">
						<p class="settings-mfa-status"><span class="badge badge-off">Disabled</span> Two-factor authentication is not enabled.</p>
						<form method="POST" action="/settings/mfa/setup">
							<button type="submit" class="btn btn-primary">Enable MFA</button>
						</form>
					</div>
					`}
				</section>
			</div>

			${isAdmin ? `<!-- Tab: Admin -->
			<div class="settings-tab-panel${tab === 'admin' ? ' active' : ''}" id="tab-admin">
				<section class="settings-section">
					<h2 class="settings-section-title">Create New User</h2>
					<form class="settings-form" method="POST" action="/admin/users">
					<div class="settings-grid">
						<label class="settings-field">
							<span>Email</span>
							<input type="email" class="login-input" name="email" required placeholder="user@example.com" />
						</label>
						<label class="settings-field">
							<span>Full name</span>
							<input type="text" class="login-input" name="fullName" placeholder="Full name" />
						</label>
						<label class="settings-field">
							<span>Password</span>
							<div class="login-password-wrap">
								<input type="password" class="login-input" name="password" required placeholder="Initial password" />
								<button type="button" class="login-eye" onclick="var p=this.parentNode.querySelector('input');if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>
							</div>
						</label>
					</div>
					<div class="settings-actions"><button type="submit" class="btn btn-primary">Create user</button></div>
					</form>
				</section>
				<section class="settings-section">
					<h2 class="settings-section-title">Users</h2>
					${adminUsers && adminUsers.length ? `<div class="admin-table-wrap"><table class="admin-table">
						<thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
						<tbody>${adminUsers.map(u => adminUserRow(u, user.id)).join('')}</tbody>
					</table></div>` : '<p class="settings-section-sub">No users found.</p>'}
				</section>
			</div>` : ''}
		</div>
	</div>
	<script>
	(function(){
		function bindRange(inputId,valueId,cssVar){var input=document.getElementById(inputId);var value=document.getElementById(valueId);if(!input||!value)return;document.body.style.setProperty(cssVar,input.value+'px');value.textContent=input.value+'px';input.addEventListener('input',function(){document.body.style.setProperty(cssVar,this.value+'px');value.textContent=this.value+'px'})}
		function bindMonospace(){var input=document.getElementById('settings-note-monospace');if(!input)return;document.body.classList.toggle('note-body-monospace',input.checked);input.addEventListener('change',function(){document.body.classList.toggle('note-body-monospace',this.checked)})}
		bindRange('settings-note-font','settings-note-font-value','--font-size-note');
		bindRange('settings-mobile-note-font','settings-mobile-note-font-value','--font-size-note-mobile');
		bindRange('settings-code-font','settings-code-font-value','--font-size-code');
		bindMonospace();
		window.saveSetting=function(key,value){
			var body=encodeURIComponent(key)+'='+encodeURIComponent(value);
			fetch('/api/web/settings',{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).catch(function(){});
			if(key==='theme'){
				document.body.classList.forEach(function(c){if(c.startsWith('theme-'))document.body.classList.remove(c)});
				document.body.classList.add('theme-'+value);
				try{localStorage.setItem('joplock-theme',value)}catch(e){}
			}
		};
		window.switchTab=function(name){
			document.querySelectorAll('.settings-tab').forEach(function(t){t.classList.toggle('active',t.dataset.tab===name)});
			document.querySelectorAll('.settings-tab-panel').forEach(function(p){p.classList.toggle('active',p.id==='tab-'+name)});
			try{localStorage.setItem('joplock-settings-tab',name)}catch(e){}
		};
		(function(){var saved=null;try{saved=localStorage.getItem('joplock-settings-tab')}catch(e){}var initial='${escapeHtml(tab)}';if(saved&&saved!==initial)switchTab(saved)})();
		document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.target.closest('dialog[open]')){window.location.href='/'}});
	})();
	</script>
</body>
</html>`;
};

// Column 3: editor
const editorFragment = (note, folders, currentFolderId = '') => {
	if (!note) {
		return '<div class="editor-empty">Select a note</div>';
	}
	const folderOptions = (folders || []).map(f =>
		`<option value="${escapeHtml(f.id)}"${f.id === note.parentId ? ' selected' : ''}>${escapeHtml(f.title || 'Untitled')}</option>`,
	).join('');
	return `<form class="editor-form" id="note-editor-form"
		hx-put="/fragments/editor/${encodeURIComponent(note.id)}"
		hx-trigger="joplock:save"
		hx-target="#autosave-status"
		hx-swap="innerHTML"
		hx-indicator="#autosave-indicator">
		<div class="editor-titlebar">
			<select name="parentId" class="editor-folder-select" title="Move to folder">${folderOptions}</select>
			<span class="editor-folder-arrow">&#9656;</span>
			${noteSyncStateFragment(note)}
			<input type="hidden" name="currentFolderId" value="${escapeHtml(currentFolderId || '')}" />
			<input type="hidden" name="title" class="editor-title-hidden"
				value="${escapeHtml(stripMarkdownForTitle(note.title || ''))}" />
			<div class="editor-title" contenteditable="true"
				data-placeholder="Note title">${escapeHtml(stripMarkdownForTitle(note.title || ''))}</div>
			<span id="autosave-status"></span>
			<button type="button" id="undo-save-btn" class="btn btn-sm btn-secondary undo-save-btn" title="Undo last save (Ctrl+Shift+Z)" onclick="undoSnapshot()" hidden>Undo</button>
			<span id="autosave-indicator" class="htmx-indicator">Saving...</span>
			${note.deletedTime ? `<button type="button" class="btn btn-sm" title="Restore from trash"
				hx-post="/fragments/notes/${encodeURIComponent(note.id)}/restore"
				hx-target="#nav-panel"
				hx-swap="innerHTML">Restore</button>` : ''}
			<button type="button" class="btn btn-icon mode-toggle-btn" title="Markdown" id="markdown-toggle" onclick="setEditorMode('markdown')">MD</button>
			<button type="button" class="btn btn-icon mode-toggle-btn" title="Rendered Markdown" id="preview-toggle" onclick="setEditorMode('preview')">&#128065;</button>
			<button type="button" class="btn btn-icon btn-danger" title="Delete"
				hx-delete="/fragments/notes/${encodeURIComponent(note.id)}"
				hx-target="#nav-panel"
				hx-swap="innerHTML"
				hx-params="none"
				hx-confirm="${note.deletedTime ? 'Permanently delete this note?' : 'Move this note to trash?'}">&#128465;</button>
		</div>
		<div class="editor-toolbar" id="editor-toolbar">
			<button type="button" class="tb" data-format="bold" title="Bold (Ctrl+B)" onclick="wrapSel('**','**')"><b>B</b></button>
			<button type="button" class="tb" data-format="italic" title="Italic (Ctrl+I)" onclick="wrapSel('*','*')"><i>I</i></button>
			<button type="button" class="tb" data-format="underline" title="Underline" onclick="wrapSel('++','++')"><u>U</u></button>
			<button type="button" class="tb" data-format="strikethrough" title="Strikethrough" onclick="wrapSel('~~','~~')"><s>S</s></button>
			<span class="tb-div"></span>
			<button type="button" class="tb" data-format="h1" title="Heading 1" onclick="insertPfx('# ')">H1</button>
			<button type="button" class="tb" data-format="h2" title="Heading 2" onclick="insertPfx('## ')">H2</button>
			<button type="button" class="tb" data-format="h3" title="Heading 3" onclick="insertPfx('### ')">H3</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Bullet list" onclick="insertPfx('- ')">&#8226;</button>
			<button type="button" class="tb" title="Numbered list" onclick="insertPfx('1. ')">1.</button>
			<button type="button" class="tb" title="Checkbox" onclick="insertPfx('- [ ] ')">&#9744;</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" data-format="inline-code" title="Inline code" onclick="wrapSel('\`','\`')">&lt;/&gt;</button>
			<button type="button" class="tb" title="Code block" onclick="openCodeModal()">{ }</button>
			<button type="button" class="tb" title="Quote" onclick="insertPfx('> ')">&#8220;</button>
			<button type="button" class="tb" title="Horizontal rule" onclick="insertTxt('\\n---\\n')">&#8212;</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Insert date" onclick="insertStamp('date')">Date</button>
			<button type="button" class="tb" title="Insert date and time" onclick="insertStamp('datetime')">DateTime</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Clear formatting" onclick="clearFormat()">&#119899;<sub>x</sub></button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Link" onclick="insertLink()">&#128279;</button>
			<button type="button" class="tb" title="Image" onclick="insertImg()">&#128247;</button>
			<button type="button" class="tb" title="Upload file" onclick="document.getElementById('file-upload').click()">&#128206;</button>
			<input type="file" id="file-upload" style="display:none" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" onchange="uploadFile(this.files[0]);this.value=''" />
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Note history" onclick="openHistoryModal('${escapeHtml(note.id)}')">&#128336;</button>
		</div>
		<div class="search-nav-bar" id="search-nav-bar" hidden>
			<span class="search-nav-counter" id="search-nav-counter"></span>
			<button type="button" class="search-nav-btn" title="Previous match" onclick="searchNavStep(-1)">&#8593;</button>
			<button type="button" class="search-nav-btn" title="Next match" onclick="searchNavStep(1)">&#8595;</button>
			<button type="button" class="search-nav-btn search-nav-close" title="Dismiss" onclick="searchNavDismiss()">&#10005;</button>
		</div>
		<textarea name="body" class="editor-body" id="note-body"
			style="display:none">${escapeHtml(note.body || '')}</textarea>
		<div class="cm-host" id="cm-host" style="display:none"
			ondrop="handleDrop(event)" ondragover="event.preventDefault()"></div>
		<div class="editor-preview" id="note-preview" contenteditable="true"
			ondrop="handleDrop(event)" ondragover="event.preventDefault()">${renderMarkdown(note.body || '')}</div>
	</form>${noteMetaFragment(note).replace('<span id="note-meta"', '<span id="note-meta" hx-swap-oob="outerHTML"')}`;
};

const mobileEditorFragment = (note, folders, currentFolderId = '') => editorFragment(note, folders, currentFolderId)
	.replace(/<div class="editor-titlebar">[\s\S]*?<\/div>\s*<div class="editor-toolbar"/,'<div class="editor-toolbar"')
	.replace(/\s*<div class="search-nav-bar" id="search-nav-bar" hidden>[\s\S]*?<\/div>\s*/,'')
	.replace(' hx-swap-oob="outerHTML"', '');

const autosaveStatusFragment = () => '<span class="autosave-ok">Saved</span>';

// Render only inline markdown (bold, italic, strikethrough, inline code) — no block elements
const renderInlineMarkdown = (text) => {
	if (!text) return '';
	let html = text;
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
	html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
	html = html.replace(/`(.+?)`/g, '<code spellcheck="false">$1</code>');
	return html;
};

// Simple markdown to HTML renderer (handles common Joplin markdown)
const renderMarkdown = (markdown) => {
	if (!markdown) return '';
	const codeBlocks = [];
	const storeCodeBlock = (code, lang) => {
		const i = codeBlocks.length;
		codeBlocks.push({code, lang: lang || ''});
		return `\x00CB${i}\x00`;
	};

	let text = String(markdown);

	// Extract code blocks before any markdown/html transforms so their contents stay opaque.
	text = text.replace(/^```(\w*)\n([\s\S]*?)\n```$/gm, (_m, lang, code) => storeCodeBlock(code, lang));

	// Consecutive full-line backtick spans → code block (ASCII art pasted as `line` per line)
	text = text.replace(/(^`.+`(?:\n(?:`.+`|[ \t]*))*)/gm, match => {
		const lines = match.split('\n');
		const code = lines.map(l => /^`([\s\S]*)`$/.test(l) ? l.replace(/^`([\s\S]*)`$/, '$1') : l).join('\n').trimEnd();
		return storeCodeBlock(code);
	});

	let html = escapeHtml(text);

	// Passthrough <br> tags (used for blank line preservation in Joplin)
	html = html.replace(/&lt;br&gt;/g, '<br>');

	// Passthrough &nbsp; (common in notes pasted from web/rich text)
	html = html.replace(/&amp;nbsp;/g, '&nbsp;');

	// Passthrough inline <img> HTML tags (restore escaped versions)
	// Handles: <img src=":/id" ...>, <img src=":/id" ... />, and normal URL src
	html = html.replace(/&lt;img\s([\s\S]*?)(?:\/)?&gt;/g, (_m, attrs) => {
		const restored = attrs.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
		const srcMatch = restored.match(/src=":\/([\w]{32})"/);
		const fixedAttrs = srcMatch ? restored.replace(/src=":\/([\w]{32})"/, `src="/resources/${srcMatch[1]}"`) : restored;
		return `<img ${fixedAttrs} class="preview-img" />`;
	});

	// Headings
	html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
	html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
	html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
	html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
	html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
	html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

	// Horizontal rule
	html = html.replace(/^---+$/gm, '<hr>');

	// Bold + italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	// Bold
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	// Italic
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	// Strikethrough
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
	// Underline (Joplin markdown-it plugin)
	html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
	// Inline code
	html = html.replace(/`([^`]+)`/g, '<code spellcheck="false">$1</code>');

	// Joplin resource images: ![alt](:/resourceId)
	html = html.replace(/!\[([^\]]*)\]\(:\/([0-9a-zA-Z]{32})\)/g, '<img src="/resources/$2" alt="$1" class="preview-img" />');
	// Regular images: ![alt](url)
	html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="preview-img" />');
	// Joplin resource links: [text](:/resourceId)
	html = html.replace(/\[([^\]]*)\]\(:\/([0-9a-zA-Z]{32})\)/g, '<a href="/resources/$2" target="_blank" rel="noopener">$1</a>');
	// Regular links: [text](url)
	html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

	// Checkboxes
	html = html.replace(/^- \[x\](?:\s+(.*))?$/gm, (_m, text) => `<div class="md-checkbox checked"><span class="md-cb-icon">&#9745;</span>&nbsp;${text || ''}</div>`);
	html = html.replace(/^- \[ \](?:\s+(.*))?$/gm, (_m, text) => `<div class="md-checkbox"><span class="md-cb-icon">&#9744;</span>&nbsp;${text || ''}</div>`);

	// Unordered lists
	html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
	// Wrap consecutive <li> in <ul>
	html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
	// Ordered lists
	html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="ol-item">$1</li>');
	// Wrap consecutive ol-item <li> in <ol>
	html = html.replace(/((?:<li class="ol-item">.*<\/li>\n?)+)/g, (_m, items) => `<ol>${items.replace(/ class="ol-item"/g, '')}</ol>`);
	// Isolate block tags so paragraph wrapping does not create invalid <p><h1>...</h1></p> markup.
	html = html.replace(/\n+(<(?:h[1-6]|pre|ul|ol|blockquote|hr|div)[> ])/g, '\n\n$1');
	html = html.replace(/(<\/(?:h[1-6]|pre|ul|ol|blockquote|div)>|<hr>)\n+/g, '$1\n\n');
	// Blockquote
	html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

	// Preserve extra blank lines (3+ newlines) as explicit markers before paragraph splitting
	html = html.replace(/\n{3,}/g, match => {
		const extraBlanks = match.length - 2; // beyond the normal paragraph break
		return `\n\n${Array.from({ length: extraBlanks }, () => '<div class="md-blank-line"><br></div>').join('')}\n\n`;
	});

	// Paragraphs: double newline → paragraph break
	const blocks = html.split('\n\n');
	const blockRe = /^<(?:h[1-6]|pre|ul|ol|blockquote|hr|div)|\x00CB\d+\x00/;
	const out = [];
	for (let i = 0; i < blocks.length; i++) {
		const trimmed = blocks[i].trim();
		if (!trimmed) continue;
		if (blockRe.test(trimmed)) { out.push(trimmed); continue; }
		out.push(`<p>${trimmed.replace(/\n/g, '<br>')}</p>`);
	}
	html = out.join('');

	// Restore code block placeholders
	html = html.replace(/\x00CB(\d+)\x00/g, (_m, i) => {
		const b = codeBlocks[i];
		const cls = b.lang ? ` class="language-${b.lang}"` : '';
		return `<pre spellcheck="false"><code${cls}>${escapeHtml(b.code)}</code></pre>`;
	});

	// Strip any hx-* attributes from rendered HTML to prevent htmx from
	// processing user content (e.g. data: URI images or pasted HTML with htmx attrs)
	html = html.replace(/\s+hx-[a-z-]+="[^"]*"/g, '');

	return html;
};

const searchResultsFragment = (notes, hasMore = false, nextOffset = 0, query = '') => {
	if (!notes.length) return '<div class="empty-hint">No results</div>';
	const items = notes.map(n => noteListItem(n, '', 'search')).join('');
	if (!hasMore) return items;
	const loadMore = `<button class="notelist-load-more"
		hx-get="/fragments/search?q=${encodeURIComponent(query)}&offset=${nextOffset}"
		hx-target="#notelist-items"
		hx-swap="beforeend"
		hx-on::after-request="this.remove()">Load more results&hellip;</button>`;
	return items + loadMore;
};

// Full page
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
	<link rel="stylesheet" href="/styles.css" />
	<title>Joplock</title>
</head>
<body class="theme-dark-grey${settings.noteMonospace ? ' note-body-monospace' : ''}" style="--font-size-note:${escapeHtml(settings.noteFontSize || 15)}px;--font-size-note-mobile:${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}px;--font-size-code:${escapeHtml(settings.codeFontSize || 12)}px;">
	<script>
	(function(){
		var keys=['joplock-theme','joplock-nav-collapsed','joplock-nav-folders'];
		try{keys.forEach(function(k){localStorage.removeItem(k)})}catch(e){}
	})();
	</script>
	<div class="login-page">
		<div class="login-card">
			<h1 class="login-title">Joplock</h1>
			<p class="login-sub">Sign in with your Joplin Server credentials.</p>
			<form class="login-form" method="POST" action="/login">
				<input type="email" name="email" placeholder="Email" class="login-input" required autofocus />
				<div class="login-password-wrap">
					<input type="password" name="password" id="login-password" placeholder="Password" class="login-input" required />
					<button type="button" class="login-eye" onclick="var p=document.getElementById('login-password');if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>
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
	<link rel="stylesheet" href="/styles.css" />
	<script src="/htmx.min.js"></script>
	<script src="/turndown.min.js"></script>
	<script src="/codemirror.min.js"></script>
	<script src="/hljs.min.js"></script>
	<title>Joplock</title>
</head>
<body class="app-shell theme-${escapeHtml(settings.theme || 'matrix')}${settings.noteMonospace ? ' note-body-monospace' : ''}" style="--font-size-note:${escapeHtml(settings.noteFontSize || 15)}px;--font-size-note-mobile:${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}px;--font-size-code:${escapeHtml(settings.codeFontSize || 12)}px;">
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
				<span class="mobile-header-title" id="mobile-editor-title"></span>
				<span class="mobile-editor-status" id="mobile-editor-status"></span>
				<button class="mobile-header-btn mobile-editor-search-btn" id="mobile-editor-search-open" onclick="mobileEditorSearchOpen()" title="Find in note">&#128269;</button>
				<button class="mobile-header-btn mobile-mode-toggle" id="mobile-md-toggle" onclick="setEditorMode('markdown')" title="Markdown">MD</button>
				<button class="mobile-header-btn mobile-mode-toggle" id="mobile-preview-toggle" onclick="setEditorMode('preview')" title="Rendered">&#128065;</button>
				<button class="mobile-header-btn" id="mobile-delete-btn" title="Delete" style="color:var(--danger)">&#128465;</button>
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
		<button class="mobile-fab-menu-btn" onclick="mobileFabNewFolder()">&#128193; New folder</button>
		<button class="mobile-fab-menu-btn mobile-fab-menu-cancel" onclick="mobileFabClose()">Cancel</button>
	</div>
	<!-- Mobile context menu (long-press on note row) -->
	<div class="mobile-ctx-backdrop" id="mobile-ctx-backdrop" style="display:none" onclick="mobileCtxClose()"></div>
	<div class="mobile-ctx-sheet" id="mobile-ctx-sheet" style="display:none">
		<div class="mobile-ctx-title" id="mobile-ctx-title"></div>
		<button class="mobile-ctx-btn" id="mobile-ctx-delete">&#128465; Delete note</button>
		<button class="mobile-ctx-btn mobile-ctx-btn-cancel" onclick="mobileCtxClose()">Cancel</button>
	</div>
	<div class="app-statusbar">
		<a href="/settings" class="btn btn-icon status-settings-link" title="Settings">&#9881;</a>
		<span class="status-user">${escapeHtml(user.fullName || user.email)}</span>
		${noteMetaFragment({ createdTime: 0, updatedTime: 0 })}
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
	var _dbg=${debug ? 'true' : 'false'};
	function _log(){if(!_dbg)return;var a=Array.prototype.slice.call(arguments);a.unshift('[joplock]');console.log.apply(console,a)}
	if('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(function(){});
	function syncThemeColor(){var meta=document.querySelector('meta[name="theme-color"]');if(!meta)return;var color=getComputedStyle(document.body).getPropertyValue('--theme-color').trim();if(color)meta.setAttribute('content',color)}
	function setTheme(t){document.body.classList.forEach(function(c){if(c.startsWith('theme-'))document.body.classList.remove(c)});document.body.classList.add('theme-'+t);syncThemeColor();localStorage.setItem('joplock-theme',t);fetch('/api/web/theme',{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'theme='+encodeURIComponent(t)}).catch(function(){})}
	var _defaultNoteOpenMode=${JSON.stringify(settings.noteOpenMode || 'preview')};
	var _mobileStartup=${JSON.stringify(mobileStartup || null)};
	var _phoneMaxWidth=599;
	var _mobileShellMaxWidth=768;
	function viewportWidth(){return Math.max(window.innerWidth||0,document.documentElement&&document.documentElement.clientWidth||0)}
	function isPhoneMode(){return viewportWidth()<=_phoneMaxWidth}
	function isTabletMode(){var w=viewportWidth();return w>_phoneMaxWidth&&w<=_mobileShellMaxWidth}
	function isMobileShellMode(){return viewportWidth()<=_mobileShellMaxWidth}
	function isDesktopMode(){return !isMobileShellMode()}
	(function(){var serverTheme='${escapeHtml(settings.theme || 'matrix')}';var s=localStorage.getItem('joplock-theme');var e=document.querySelector('.theme-picker');if(s&&s!==serverTheme){localStorage.setItem('joplock-theme',serverTheme)}if(e)e.value=serverTheme})();
	window.addEventListener('pageshow',function(e){if(e.persisted)window.location.replace('/login')});
	function setMobileNav(open){var nav=document.getElementById('nav-panel');var bd=document.getElementById('mobile-nav-backdrop');if(!nav||!bd)return;nav.classList.toggle('open',open);bd.classList.toggle('open',open);document.body.classList.toggle('mobile-nav-open',open)}
	function toggleNav(){if(isMobileShellMode()){var nav=document.getElementById('nav-panel');if(!nav)return;setMobileNav(!nav.classList.contains('open'))}else{document.body.classList.toggle('nav-collapsed');localStorage.setItem('joplock-nav-collapsed',document.body.classList.contains('nav-collapsed')?'1':'')}}
	function closeNav(){setMobileNav(false)}
	(function(){if(localStorage.getItem('joplock-nav-collapsed')==='1')document.body.classList.add('nav-collapsed')})();
	function activeEditorForm(){if(isMobileShellMode()){var mobileBody=document.getElementById('mobile-editor-body');var mobileForm=mobileBody&&mobileBody.querySelector?mobileBody.querySelector('#note-editor-form'):null;if(mobileForm)return mobileForm}return document.getElementById('note-editor-form')}
	function queryActiveEditor(selector){var form=activeEditorForm();return form&&form.querySelector?form.querySelector(selector):null}
	function activeEditorMeta(){if(isMobileShellMode()){var mobileBody=document.getElementById('mobile-editor-body');var mobileMeta=mobileBody&&mobileBody.querySelector?mobileBody.querySelector('#note-meta'):null;if(mobileMeta)return mobileMeta}return document.getElementById('note-meta')}
	function setSaveState(html,text){var s=queryActiveEditor('#autosave-status');if(s)s.innerHTML=html||'';var mobile=document.getElementById('mobile-editor-status');if(mobile)mobile.innerHTML=text?html:''}
	function markEdited(){setSaveState('<span class="autosave-edited">Edited</span>','Edited');_log('markEdited')}
	function renderNoteMeta(){var meta=activeEditorMeta();if(!meta)return;var c=Number(meta.getAttribute('data-created-time')||0),u=Number(meta.getAttribute('data-updated-time')||0);if(!c&&!u){meta.textContent='';return}var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var fmt=function(ts){if(!ts)return '';var d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'-'+months[d.getMonth()]+'-'+String(d.getFullYear()).slice(-2)};meta.textContent='Created '+fmt(c)+' | Edited '+fmt(u)}
	var _folderMenuState={id:'',title:''};
	function closeFolderContextMenu(){var menu=document.getElementById('folder-context-menu');if(menu)menu.hidden=true}
	function openFolderContextMenu(event,id,title){if(event){event.preventDefault();event.stopPropagation()}var menu=document.getElementById('folder-context-menu');if(!menu)return false;_folderMenuState={id:id,title:title};menu.hidden=false;menu.style.left=(event.clientX||16)+'px';menu.style.top=(event.clientY||16)+'px';return false}
	function closeFolderModal(){var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
	function openFolderModal(){var input=document.getElementById('folder-edit-title');var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(input)input.value=_folderMenuState.title||'';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;closeFolderContextMenu();if(input)input.focus()}
	function editFolderFromMenu(){if(!_folderMenuState.id)return;openFolderModal()}
	function deleteFolderFromMenu(){if(!_folderMenuState.id)return;closeFolderContextMenu();if(confirm('Delete notebook "'+(_folderMenuState.title||'Untitled')+'"?')){htmx.ajax('DELETE','/fragments/folders/'+encodeURIComponent(_folderMenuState.id),{target:'#nav-panel',swap:'innerHTML'})}}
	function submitFolderEdit(event){if(event)event.preventDefault();var input=document.getElementById('folder-edit-title');var title=input?input.value.trim():'';if(!_folderMenuState.id||!title)return false;htmx.ajax('PUT','/fragments/folders/'+encodeURIComponent(_folderMenuState.id),{target:'#nav-panel',swap:'innerHTML',values:{title:title}});closeFolderModal();return false}
	function navFolderState(){try{return JSON.parse(localStorage.getItem('joplock-nav-folders')||'{}')}catch(e){return {}}}
	function saveNavFolderState(s){localStorage.setItem('joplock-nav-folders',JSON.stringify(s))}
	function toggleNavFolder(id,force){
		var el=document.querySelector('.nav-folder[data-folder-id="'+id.replace(/"/g,'\\"')+'"]');
		if(!el)return;
		var collapsed=force===undefined?!el.classList.contains('collapsed'):!force;
		el.classList.toggle('collapsed',collapsed);
		var s=navFolderState();s[id]=collapsed?'0':'1';saveNavFolderState(s);
		// Lazy-load notes on first expand
		if(!collapsed){
			var notesDiv=el.querySelector('.nav-folder-notes[data-folder-id]');
			if(notesDiv&&!notesDiv.getAttribute('data-loaded')){
				notesDiv.setAttribute('data-loaded','1');
				var folderId=notesDiv.getAttribute('data-folder-id');
				htmx.ajax('GET','/fragments/folder-notes?folderId='+encodeURIComponent(folderId),{target:notesDiv,swap:'innerHTML'});
			}
		}
	}
	function getTA(){return queryActiveEditor('#note-body')}
	function getPV(){var pv=queryActiveEditor('#note-preview');return pv&&pv.style.display!=='none'?pv:null}
	function isMarkdownVisible(){var host=queryActiveEditor('#cm-host');return !!(host&&host.style.display!=='none')}
	function inMobileEditor(){var form=activeEditorForm();return !!(form&&form.closest&&form.closest('#mobile-editor-body'))}
	var _cmView=null;
	function getCM(){return _cmView}
	function cmVal(){return _cmView?_cmView.state.doc.toString():''}
	function cmSetVal(v){if(!_cmView)return;_cmView.dispatch({changes:{from:0,to:_cmView.state.doc.length,insert:v}})}
	function cmSyncToTA(){var ta=getTA();if(ta&&_cmView)ta.value=cmVal()}
	function initCM(host,content){
		if(_cmView){_cmView.destroy();_cmView=null}
		var C=window.CM;
		var joplockTheme=C.EditorView.theme({
			'&':{height:'100%',fontSize:'14px'},
			'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Mono",monospace',lineHeight:'1.65'},
			'.cm-content':{padding:'16px 20px',caretColor:'var(--accent)'},
			'.cm-gutters':{display:'none'},
			'.cm-search.cm-panel':{display:'none'},
			'.cm-searchMatch':{backgroundColor:'#ffe066',color:'#111',borderRadius:'2px'},
			'.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#ff9800',color:'#111',borderRadius:'2px'},
			'.cm-selectionBackground':{backgroundColor:'color-mix(in srgb, var(--accent) 25%, transparent) !important'},
			'&.cm-focused .cm-selectionBackground':{backgroundColor:'color-mix(in srgb, var(--accent) 30%, transparent) !important'},
			'.cm-cursor':{borderLeftColor:'var(--accent)'},
			'.cm-matchingBracket':{backgroundColor:'color-mix(in srgb, var(--accent) 25%, transparent)'}
		});
		var joplockHighlight=C.HighlightStyle.define([
			{tag:C.tags.heading1,fontWeight:'bold',fontSize:'1.6em',color:'var(--text-heading)'},
			{tag:C.tags.heading2,fontWeight:'bold',fontSize:'1.35em',color:'var(--text-heading)'},
			{tag:C.tags.heading3,fontWeight:'bold',fontSize:'1.15em',color:'var(--text-heading)'},
			{tag:[C.tags.heading4,C.tags.heading5,C.tags.heading6],fontWeight:'bold',color:'var(--text-heading)'},
			{tag:C.tags.strong,fontWeight:'bold',color:'var(--text-heading)'},
			{tag:C.tags.emphasis,fontStyle:'italic'},
			{tag:C.tags.strikethrough,textDecoration:'line-through'},
			{tag:C.tags.link,color:'var(--accent)',textDecoration:'underline'},
			{tag:C.tags.url,color:'var(--accent)'},
			{tag:C.tags.processingInstruction,fontFamily:'"Cascadia Mono",monospace',color:'var(--accent)'},
			{tag:C.tags.monospace,fontFamily:'"Cascadia Mono",monospace'},
			{tag:C.tags.meta,color:'var(--text-dim)'},
			{tag:C.tags.quote,color:'var(--text-dim)',fontStyle:'italic'},
			{tag:C.tags.keyword,color:'#c678dd'},
			{tag:[C.tags.string,C.tags.special(C.tags.brace)],color:'#98c379'},
			{tag:C.tags.number,color:'#d19a66'},
			{tag:C.tags.bool,color:'#d19a66'},
			{tag:[C.tags.definition(C.tags.variableName),C.tags.function(C.tags.variableName)],color:'#61afef'},
			{tag:C.tags.typeName,color:'#e5c07b'},
			{tag:C.tags.comment,color:'var(--text-dim)',fontStyle:'italic'},
			{tag:C.tags.operator,color:'#56b6c2'},
			{tag:C.tags.className,color:'#e5c07b'},
			{tag:C.tags.propertyName,color:'#e06c75'},
			{tag:C.tags.attributeName,color:'#d19a66'},
			{tag:C.tags.attributeValue,color:'#98c379'}
		]);
		var onUpdate=C.EditorView.updateListener.of(function(upd){
			if(upd.docChanged){cmSyncToTA();var ta=getTA();if(ta)ta.dispatchEvent(new Event('input',{bubbles:true}))}
		});
		_cmView=new C.EditorView({
			state:C.EditorState.create({
				doc:content||'',
					extensions:[
						C.markdown({base:C.markdownLanguage,codeLanguages:[
					C.LanguageDescription.of({name:'javascript',alias:['js','jsx'],load:function(){return Promise.resolve(C.javascript({jsx:true}))}}),
					C.LanguageDescription.of({name:'typescript',alias:['ts','tsx'],load:function(){return Promise.resolve(C.javascript({typescript:true,jsx:true}))}}),
					C.LanguageDescription.of({name:'html',load:function(){return Promise.resolve(C.html())}}),
					C.LanguageDescription.of({name:'css',load:function(){return Promise.resolve(C.css())}}),
					C.LanguageDescription.of({name:'json',load:function(){return Promise.resolve(C.json())}}),
					C.LanguageDescription.of({name:'sql',load:function(){return Promise.resolve(C.sql())}}),
					C.LanguageDescription.of({name:'python',alias:['py'],load:function(){return Promise.resolve(C.python())}}),
					C.LanguageDescription.of({name:'xml',load:function(){return Promise.resolve(C.xml())}}),
					C.LanguageDescription.of({name:'go',alias:['golang'],load:function(){return Promise.resolve(C.go())}}),
					C.LanguageDescription.of({name:'c++',alias:['cpp','c'],load:function(){return Promise.resolve(C.cpp())}}),
					C.LanguageDescription.of({name:'yaml',alias:['yml','dockerfile','docker-compose'],load:function(){return Promise.resolve(C.yaml())}}),
					C.LanguageDescription.of({name:'shell',alias:['bash','sh','zsh'],load:function(){return Promise.resolve(C.StreamLanguage.define(C.shell))}})
				]}),
					C.syntaxHighlighting(joplockHighlight),
					C.syntaxHighlighting(C.defaultHighlightStyle,{fallback:true}),
					joplockTheme,
					C.drawSelection(),
					C.highlightActiveLine(),
					C.bracketMatching(),
						C.highlightSelectionMatches(),
						C.history(),
						C.keymap.of([...C.defaultKeymap,...C.historyKeymap,...C.searchKeymap.filter(function(b){var k=b.key||'';return k!=='Mod-f'&&k!=='F3'&&k!=='Mod-g'}),C.indentWithTab]),
						C.placeholder('Start writing...'),
						onUpdate,
						C.EditorView.lineWrapping
				]
			}),
			parent:host
		});
	}
	var _editorMode='markdown';
	function syncEditorModeButtons(){var previewVisible=!!getPV();var markdownVisible=isMarkdownVisible();var mode=previewVisible?'preview':'markdown';_editorMode=mode;var mdBtn=document.getElementById('markdown-toggle');var pvBtn=document.getElementById('preview-toggle');if(mdBtn)mdBtn.classList.toggle('active',mode==='markdown');if(pvBtn)pvBtn.classList.toggle('active',mode==='preview');var mMd=document.getElementById('mobile-md-toggle');var mPv=document.getElementById('mobile-preview-toggle');if(mMd)mMd.classList.toggle('active',mode==='markdown');if(mPv)mPv.classList.toggle('active',mode==='preview');var tb=document.getElementById('editor-toolbar');if(tb&&inMobileEditor())tb.style.display='flex';document.body.classList.toggle('mobile-markdown-mode',inMobileEditor()&&mode==='markdown')}
	function activeSearchInput(){if(isMobileShellMode()){var mobileInput=document.getElementById('mobile-editor-search-input');if(mobileInput)return mobileInput}return document.getElementById('nav-search')}
	function currentListSearchInput(){return document.getElementById('nav-search')||document.getElementById('mobile-search-input')}
	function currentListSearchTerm(){var input=currentListSearchInput();return input&&typeof input.value==='string'?input.value:''}
	function activeSearchTerm(){var input=activeSearchInput();return input&&typeof input.value==='string'?input.value:''}
	var _cmSearchMatches=[];
	function clearCodeMirrorSearch(){_cmSearchMatches=[];if(_cmView&&window.CM&&window.CM.SearchQuery&&window.CM.setSearchQuery){_cmView.dispatch({effects:window.CM.setSearchQuery.of(new window.CM.SearchQuery({search:'',caseSensitive:false}))});}}
	function collectCodeMirrorSearchMatches(query){if(!_cmView||!query||!query.valid||!query.search)return[];var cursor=query.getCursor(_cmView.state.doc);var out=[];for(var next=cursor.next();!next.done;next=cursor.next())out.push({from:next.value.from,to:next.value.to});return out}
	function setCodeMirrorSearchActive(idx){if(!_cmView||!_cmSearchMatches.length)return;_searchMarkIdx=((idx%_cmSearchMatches.length)+_cmSearchMatches.length)%_cmSearchMatches.length;var match=_cmSearchMatches[_searchMarkIdx];var Sel=_cmView.state.selection.constructor;_cmView.dispatch({selection:Sel.cursor(match.from),scrollIntoView:true});searchNavShow(_cmSearchMatches.length,_searchMarkIdx)}
	function clearPreviewSearchMarks(root){if(!root)return;root.querySelectorAll('mark.search-highlight').forEach(function(m){var text=document.createTextNode(m.textContent);m.parentNode.replaceChild(text,m)});root.normalize()}
		function applyMobileTitleMode(){var ti=queryActiveEditor('.editor-title');if(!ti)return;var mobile=isMobileShellMode();var inMobileEditor=!!ti.closest('#mobile-editor-body');ti.contentEditable=(mobile&&!inMobileEditor)?'false':'true';ti.classList.toggle('editor-title-mobile-readonly',mobile&&!inMobileEditor)}
	var _pvSyncTimer=null;var _syncPVInFlight=false;
	var _previewDirty=false;
	function syncPV(){var pv=getPV(),ta=getTA();if(pv&&ta){var md=htmlToMarkdown(pv);if(ta.value!==md){ta.value=md;ta.dispatchEvent(new Event('input',{bubbles:true}));_previewDirty=false;return true}}_previewDirty=false;return false}
	function scheduleSyncPV(){if(_pvSyncTimer)clearTimeout(_pvSyncTimer);_pvSyncTimer=setTimeout(function(){_pvSyncTimer=null;_syncPVInFlight=true;var changed=syncPV();_syncPVInFlight=false;autoTitle();if(!changed){_log('scheduleSyncPV: no markdown change')}},150)}
	// Auto-title: first line of body becomes title unless user manually edited it
	var _titleManual=false;
	function stripMdForTitle(s){var t=String(s||'').trim();while(t.charAt(0)==='#')t=t.slice(1).trimStart();t=t.split('**').join('').split('__').join('').split('++').join('').split('*').join('').split('_').join('').split('~~').join('').split(String.fromCharCode(96)).join('');var out='';for(var i=0;i<t.length;i++){var ch=t.charAt(i);if(ch==='!'&&t.charAt(i+1)==='['){var altEnd=t.indexOf(']',i+2);var imgOpen=altEnd>=0?t.indexOf('(',altEnd+1):-1;var imgClose=imgOpen>=0?t.indexOf(')',imgOpen+1):-1;if(altEnd>=0&&imgOpen===altEnd+1&&imgClose>=0){out+=t.slice(i+2,altEnd);i=imgClose;continue}}if(ch==='['){var labelEnd=t.indexOf(']',i+1);var linkOpen=labelEnd>=0?t.indexOf('(',labelEnd+1):-1;var linkClose=linkOpen>=0?t.indexOf(')',linkOpen+1):-1;if(labelEnd>=0&&linkOpen===labelEnd+1&&linkClose>=0){out+=t.slice(i+1,labelEnd);i=linkClose;continue}}out+=ch}return out.trim()}
	function syncTitle(){var ti=queryActiveEditor('.editor-title');var hi=queryActiveEditor('.editor-title-hidden');var mobileTitle=document.getElementById('mobile-editor-title');if(ti&&hi){var plain=stripMdForTitle(ti.textContent);hi.value=plain;hi.dispatchEvent(new Event('input',{bubbles:true}));ti.textContent=plain;if(mobileTitle)mobileTitle.textContent=plain||'Note';markEdited();scheduleSaveTitle()}}
	function initAutoTitle(){_titleManual=false;var ti=queryActiveEditor('.editor-title');if(ti){ti.addEventListener('input',function(){_titleManual=true;syncTitle()})}}
	function autoTitle(){if(_titleManual)return;var ta=getTA();var ti=queryActiveEditor('.editor-title');var mobileTitle=document.getElementById('mobile-editor-title');if(!ta||!ti)return;var val=ta.value;var lines=val.split('\\n');var first='';for(var i=0;i<lines.length;i++){var l=lines[i].replace(/^#+\\s*/,'').trim();if(l){first=l;break}}var firstPlain=stripMdForTitle(first);if(firstPlain&&firstPlain!==ti.textContent){ti.textContent=firstPlain;if(mobileTitle)mobileTitle.textContent=firstPlain||'Note';var hi=queryActiveEditor('.editor-title-hidden');if(hi){hi.value=firstPlain;hi.dispatchEvent(new Event('input',{bubbles:true}))}}}
	function pad2(value){return String(value).padStart(2,'0')}
	var _dateFmt=${JSON.stringify(String(settings.dateFormat || 'MMM-DD-YY'))};
	var _datetimeFmt=${JSON.stringify(String(settings.datetimeFormat || 'YYYY-MM-DD HH:mm'))};
	function formatStamp(kind){var d=new Date();var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var fmt=kind==='datetime'?_datetimeFmt:_dateFmt;var YYYY=String(d.getFullYear());var YY=YYYY.slice(-2);var MM=pad2(d.getMonth()+1);var MMM=months[d.getMonth()];var DD=pad2(d.getDate());var h24=d.getHours();var HH=pad2(h24);var h12=h24%12||12;var hh=pad2(h12);var A=h24<12?'AM':'PM';var mn=pad2(d.getMinutes());var ss=pad2(d.getSeconds());return fmt.replace('YYYY',YYYY).replace('YY',YY).replace('MMM',MMM).replace('MM',MM).replace('DD',DD).replace('HH',HH).replace('hh',hh).replace('mm',mn).replace('ss',ss).replace('A',A).replace('a',A.toLowerCase())}
	function renderInlineMd(t){if(!t)return '';var h=t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');h=h.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');h=h.replace(/\\*(.+?)\\*/g,'<em>$1</em>');h=h.replace(/~~(.+?)~~/g,'<del>$1</del>');h=h.replace(/\\+\\+(.+?)\\+\\+/g,'<u>$1</u>');h=h.replace(/\`([^\`]+)\`/g,'<code spellcheck="false">$1</code>');return h}
	// Image resize via drag handles
	var _resizing=null;
	function initImgResize(pv){if(!pv||pv.dataset.imgResizeInit)return;pv.dataset.imgResizeInit='1';pv.addEventListener('mousedown',function(e){if(e.target.tagName==='IMG'&&e.target.classList.contains('preview-img')){var img=e.target,rect=img.getBoundingClientRect();var nearRight=e.clientX>rect.right-16,nearBottom=e.clientY>rect.bottom-16;if(nearRight||nearBottom){e.preventDefault();_resizing={img:img,startX:e.clientX,startY:e.clientY,startW:img.offsetWidth,startH:img.offsetHeight}}}})}
	document.addEventListener('mousemove',function(e){if(!_resizing)return;e.preventDefault();var dx=e.clientX-_resizing.startX,dy=e.clientY-_resizing.startY;var nw=Math.max(32,_resizing.startW+dx);var ratio=_resizing.startH/_resizing.startW;_resizing.img.style.width=nw+'px';_resizing.img.style.height=Math.round(nw*ratio)+'px'});
	document.addEventListener('mouseup',function(){if(_resizing){_resizing=null;syncPV()}});
	function pvBlockText(block){if(!block)return '';var text=typeof block.innerText==='string'?block.innerText:(block.textContent||'');return text.replace(/\\r/g,'')}
	function insertPVText(text){var sel=window.getSelection();if(!sel||!sel.rangeCount)return false;var range=sel.getRangeAt(0);range.deleteContents();var node=document.createTextNode(text);range.insertNode(node);range.setStart(node,text.length);range.collapse(true);sel.removeAllRanges();sel.addRange(range);return true}
	function setPVCaret(node,offset){var sel=window.getSelection();if(!sel)return;var range=document.createRange();if(node&&node.nodeType===3){range.setStart(node,Math.min(offset,node.textContent.length));range.collapse(true)}else{range.selectNodeContents(node);range.collapse(false)}sel.removeAllRanges();sel.addRange(range)}
	function replacePVBlock(buildNode){var pv=getPV();if(!pv)return false;var sel=window.getSelection();if(!sel||!sel.rangeCount)return false;var range=sel.getRangeAt(0);if(!pv.contains(range.commonAncestorContainer))return false;var block=range.startContainer;while(block&&block!==pv&&block.nodeType!==1)block=block.parentNode;if(!block||block===pv)block=range.startContainer.parentNode;while(block&&block!==pv&&block.nodeType===1&&!/^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(block.nodeName))block=block.parentNode;var neo=buildNode(block,sel.toString(),range,pv);if(!neo)return false;if(block&&block.parentNode&&block!==pv){block.parentNode.replaceChild(neo,block)}else{range.deleteContents();range.insertNode(neo)}var focusNode=neo.querySelector?neo.querySelector('code'):null;if(!focusNode)focusNode=neo;var textNode=focusNode.firstChild&&focusNode.firstChild.nodeType===3?focusNode.firstChild:null;setPVCaret(textNode||focusNode,textNode?textNode.textContent.length:0);syncPV();pv.focus();return true}
	function transformPVBlock(tagName,defaultText){return replacePVBlock(function(block,selectedText,range,pv){var text=(!range.collapsed&&selectedText?selectedText:(block&&block!==pv?pvBlockText(block):selectedText))||defaultText;var neo=document.createElement(tagName);if(tagName==='pre'){neo.spellcheck=false;var code=document.createElement('code');code.textContent=text;neo.appendChild(code)}else{neo.textContent=text}return neo})}
	function clearFormat(){var pv=getPV();if(pv){document.execCommand('removeFormat',false,null);var sel=window.getSelection();if(sel&&sel.rangeCount){var range=sel.getRangeAt(0);var block=range.startContainer;while(block&&block!==pv&&block.nodeType!==1)block=block.parentNode;if(block&&block!==pv&&/^(H[1-6]|BLOCKQUOTE|PRE)$/.test(block.nodeName)){var p=document.createElement('p');p.textContent=block.textContent;block.parentNode.replaceChild(p,block);var r=document.createRange();r.selectNodeContents(p);sel.removeAllRanges();sel.addRange(r)}}syncPV();pv.focus();return}var cm=getCM();if(cm){var s=cm.state.selection.main;var from=s.from,to=s.to,sel=cm.state.sliceDoc(from,to);sel=sel.replace(/(\\*{1,2}|~~|\\+\\+|\`)(.*?)\\1/g,'$2');sel=sel.replace(/^#{1,6}\\s+/gm,'');sel=sel.replace(/^>\\s?/gm,'');sel=sel.replace(/^[-*]\\s/gm,'');sel=sel.replace(/^\\d+\\.\\s/gm,'');cm.dispatch({changes:{from:from,to:to,insert:sel},selection:{anchor:from,head:from+sel.length}});cm.focus()}}
	function wrapSel(a,b){var pv=getPV();if(pv){var fenced=String.fromCharCode(10)+String.fromCharCode(96,96,96)+String.fromCharCode(10);var inlineCode=String.fromCharCode(96);if(a===fenced&&b===fenced&&transformPVBlock('pre','code'))return;if(a===inlineCode&&b===inlineCode){document.execCommand('insertHTML',false,'<code spellcheck="false">'+(window.getSelection().toString()||'code')+'</code>');syncPV();pv.focus();return}var cmdMap={'**':'bold','*':'italic','~~':'strikethrough','++':'underline'};var cmd=cmdMap[a];if(cmd){document.execCommand(cmd,false,null);syncPV();pv.focus();return}}var cm=getCM();if(cm){var s=cm.state.selection.main;var from=s.from,to=s.to,sel=cm.state.sliceDoc(from,to)||'text';var ins=a+sel+b;cm.dispatch({changes:{from:from,to:to,insert:ins},selection:{anchor:from+a.length,head:from+a.length+sel.length}});cm.focus()}}
	function insertPfx(p){var pv=getPV();if(pv){var sel=window.getSelection();if(sel.rangeCount){var range=sel.getRangeAt(0);var block=range.startContainer;while(block&&block!==pv&&block.nodeType!==1)block=block.parentNode;if(!block||block===pv)block=range.startContainer.parentNode;var hm=p.match(/^(#{1,6})\\s/);if(hm){var lvl=hm[1].length;var tag='h'+lvl;if(block&&block.parentNode&&block!==pv){var neo=document.createElement(tag);neo.textContent=block.textContent;block.parentNode.replaceChild(neo,block)}else{document.execCommand('insertHTML',false,'<'+tag+'>'+(sel.toString()||'Heading')+'</'+tag+'>')}setTimeout(function(){syncPV();pv.focus()},0);return}if(p==='- [ ] '){var neo=document.createElement('div');neo.className='md-checkbox';var iconSpan=document.createElement('span');iconSpan.className='md-cb-icon';iconSpan.textContent='\u2610';neo.appendChild(iconSpan);var nbsp=document.createTextNode('\u00a0');neo.appendChild(nbsp);var sel2=window.getSelection();var range2=sel2.rangeCount?sel2.getRangeAt(0):null;if(range2){range2.deleteContents();range2.insertNode(neo);var r=document.createRange();r.setStart(nbsp,1);r.collapse(true);sel2.removeAllRanges();sel2.addRange(r)}else{pv.appendChild(neo)}neo.scrollIntoView({block:'nearest'});syncPV();pv.focus();return}if(p==='- '){document.execCommand('insertUnorderedList',false,null);syncPV();pv.focus();return}if(p==='1. '){document.execCommand('insertOrderedList',false,null);syncPV();pv.focus();return}if(p==='> '&&transformPVBlock('blockquote','Quote'))return}return}var cm=getCM();if(cm){var s=cm.state.selection.main;var line=cm.state.doc.lineAt(s.from);cm.dispatch({changes:{from:line.from,to:line.from,insert:p}});cm.focus()}}
	function insertTxt(x){var pv=getPV();if(pv){if(x==='\\n---\\n'){document.execCommand('insertHorizontalRule',false,null);syncPV();pv.focus();return}document.execCommand('insertText',false,x);syncPV();pv.focus();return}var cm=getCM();if(cm){var s=cm.state.selection.main;cm.dispatch({changes:{from:s.from,to:s.to,insert:x},selection:{anchor:s.from+x.length}});cm.focus()}}
	function insertStamp(kind){insertTxt(formatStamp(kind))}
	var _linkSavedRange=null;var _linkSavedTA=null;
	function closeLinkModal(){var modal=document.getElementById('link-modal');var backdrop=document.getElementById('link-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
	function openLinkModal(){var pv=getPV();var cm=getCM();if(pv){var sel=window.getSelection();_linkSavedRange=sel&&sel.rangeCount?sel.getRangeAt(0).cloneRange():null;var labelInput=document.getElementById('link-edit-label');if(labelInput)labelInput.value=(sel&&sel.toString())||''}else if(cm){var s=cm.state.selection.main;var labelInput=document.getElementById('link-edit-label');if(labelInput)labelInput.value=cm.state.sliceDoc(s.from,s.to)}var modal=document.getElementById('link-modal');var backdrop=document.getElementById('link-modal-backdrop');var urlInput=document.getElementById('link-edit-url');if(urlInput)urlInput.value='';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;if(urlInput)urlInput.focus()}
	function submitLink(event){if(event)event.preventDefault();var url=document.getElementById('link-edit-url');var label=document.getElementById('link-edit-label');var u=(url?url.value:'').trim();if(!u)return false;var t=(label?label.value:'').trim()||u;closeLinkModal();var pv=getPV();if(pv){if(_linkSavedRange){var sel=window.getSelection();sel.removeAllRanges();sel.addRange(_linkSavedRange)}_linkSavedRange=null;document.execCommand('insertHTML',false,'<a href="'+u.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">'+t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</a>');syncPV();pv.focus();return false}var cm=getCM();if(cm){var md='['+t+']('+u+')';var s=cm.state.selection.main;cm.dispatch({changes:{from:s.from,to:s.to,insert:md},selection:{anchor:s.from+md.length}});cm.focus()}return false}
	function insertLink(){openLinkModal()}
	var _codeSavedSel=null;
	var _codeSavedRange=null;
	var _codeEditPre=null;
	var _codeModalCM=null;
	var _codeLangMap={'javascript':function(C){return C.javascript({jsx:true})},'typescript':function(C){return C.javascript({typescript:true,jsx:true})},'html':function(C){return C.html()},'css':function(C){return C.css()},'json':function(C){return C.json()},'sql':function(C){return C.sql()},'python':function(C){return C.python()},'xml':function(C){return C.xml()},'go':function(C){return C.go()},'c':function(C){return C.cpp()},'cpp':function(C){return C.cpp()},'yaml':function(C){return C.yaml()},'bash':function(C){return C.StreamLanguage.define(C.shell)}};
	function _codeModalLangExt(lang){var C=window.CM;var fn=_codeLangMap[lang];return fn?fn(C):[]}
	function _initCodeModalCM(host,content,lang){if(_codeModalCM){_codeModalCM.destroy();_codeModalCM=null}var C=window.CM;var theme=C.EditorView.theme({'&':{height:'100%',fontSize:'13px'},'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Mono",monospace',lineHeight:'1.5'},'.cm-content':{padding:'12px'},'.cm-gutters':{display:'none'},'.cm-activeLine':{backgroundColor:'var(--bg-hover)'},'.cm-selectionBackground':{backgroundColor:'var(--accent-dim) !important'},'&.cm-focused .cm-selectionBackground':{backgroundColor:'var(--accent-dim) !important'},'.cm-cursor':{borderLeftColor:'var(--accent)'}});_codeModalCM=new C.EditorView({state:C.EditorState.create({doc:content||'',extensions:[_codeModalLangExt(lang),C.syntaxHighlighting(C.defaultHighlightStyle,{fallback:true}),C.syntaxHighlighting(C.HighlightStyle.define([{tag:C.tags.keyword,color:'#c678dd'},{tag:[C.tags.string,C.tags.special(C.tags.brace)],color:'#98c379'},{tag:C.tags.number,color:'#d19a66'},{tag:C.tags.bool,color:'#d19a66'},{tag:[C.tags.definition(C.tags.variableName),C.tags.function(C.tags.variableName)],color:'#61afef'},{tag:C.tags.typeName,color:'#e5c07b'},{tag:C.tags.comment,color:'var(--text-dim)',fontStyle:'italic'},{tag:C.tags.operator,color:'#56b6c2'},{tag:C.tags.className,color:'#e5c07b'},{tag:C.tags.propertyName,color:'#e06c75'},{tag:C.tags.attributeName,color:'#d19a66'},{tag:C.tags.attributeValue,color:'#98c379'}])),theme,C.drawSelection(),C.highlightActiveLine(),C.bracketMatching(),C.history(),C.keymap.of([...C.defaultKeymap,...C.historyKeymap,C.indentWithTab]),C.placeholder('Paste or type code here...'),C.EditorView.lineWrapping]}),parent:host});_codeModalCM.focus()}
	function _updateCodeModalLang(lang){if(!_codeModalCM)return;var C=window.CM;var doc=_codeModalCM.state.doc.toString();var host=_codeModalCM.dom.parentElement;_codeModalCM.destroy();_initCodeModalCM(host,doc,lang)}
	function closeCodeModal(){if(_codeModalCM){_codeModalCM.destroy();_codeModalCM=null}var modal=document.getElementById('code-modal');if(modal)modal.hidden=true}
	function openCodeModal(editPre){var pv=getPV();var cm=getCM();var sel='';var lang='';_codeSavedSel=null;_codeSavedRange=null;_codeEditPre=editPre||null;if(_codeEditPre){var codeEl=_codeEditPre.querySelector('code[class*="language-"]');sel=codeEl?codeEl.textContent:(_codeEditPre.querySelector('code')||_codeEditPre).textContent;if(codeEl){var classes=(codeEl.getAttribute('class')||'').split(' ');for(var i=0;i<classes.length;i++){if(classes[i].indexOf('language-')===0){lang=classes[i].slice(9);break}}}}else if(pv){var s=window.getSelection();_codeSavedRange=s&&s.rangeCount?s.getRangeAt(0).cloneRange():null;sel=(s&&s.toString())||''}else if(cm){var s=cm.state.selection.main;_codeSavedSel={from:s.from,to:s.to};sel=cm.state.sliceDoc(s.from,s.to)}var langEl=document.getElementById('code-lang');if(langEl){langEl.value=lang;langEl.onchange=function(){_updateCodeModalLang(langEl.value)}}var title=document.getElementById('code-modal-title');if(title)title.textContent=_codeEditPre?'Edit code block':'Insert code block';var submitBtn=document.getElementById('code-modal-submit');if(submitBtn)submitBtn.textContent=_codeEditPre?'Save':'Insert';var modal=document.getElementById('code-modal');if(modal)modal.hidden=false;var host=document.getElementById('code-input');if(host){host.innerHTML='';_initCodeModalCM(host,sel,lang)}}
	function submitCode(event){if(event)event.preventDefault();var lang=document.getElementById('code-lang');var l=(lang?lang.value:'');var code=_codeModalCM?_codeModalCM.state.doc.toString():'';closeCodeModal();var pv=getPV();if(pv&&_codeEditPre){var codeEl=_codeEditPre.querySelector('code');if(!codeEl){codeEl=document.createElement('code');_codeEditPre.appendChild(codeEl)}codeEl.textContent=code;codeEl.className=l?'language-'+l:'';if(codeEl.dataset.highlighted)delete codeEl.dataset.highlighted;_codeEditPre=null;initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);syncPV();pv.focus();return false}if(pv){if(_codeSavedRange){var sel=window.getSelection();sel.removeAllRanges();sel.addRange(_codeSavedRange)}_codeSavedRange=null;var escaped=code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');var cls=l?' class="language-'+l+'"':'';document.execCommand('insertHTML',false,'<pre spellcheck="false"><code'+cls+'>'+escaped+'</code></pre>');initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);syncPV();pv.focus();return false}var cm=getCM();if(cm){var s=_codeSavedSel||cm.state.selection.main;var md='\\n\`\`\`'+l+'\\n'+code+'\\n\`\`\`\\n';cm.dispatch({changes:{from:s.from,to:s.to,insert:md},selection:{anchor:s.from+md.length}});cm.focus()}_codeSavedSel=null;_codeSavedRange=null;_codeEditPre=null;return false}
	function insertImg(){var pv=getPV();if(pv){var u=prompt('Image URL:');if(!u)return;document.execCommand('insertHTML',false,'<img src="'+u+'" alt="image" class="preview-img" />');syncPV();pv.focus();return}var u=prompt('Image URL:');if(u)insertTxt('![image]('+u+')')}
	function uploadFile(f){if(!f)return;var s=document.getElementById('autosave-status');var fd=new FormData();fd.append('file',f);var xhr=new XMLHttpRequest();xhr.upload.onprogress=function(e){if(e.lengthComputable){var pct=Math.round(e.loaded/e.total*100);setSaveState('<span class="autosave-saving">Uploading '+pct+'%</span>','Uploading')}};xhr.onload=function(){setSaveState('','');var d;try{d=JSON.parse(xhr.responseText)}catch(e){alert('Upload failed');return}if(d.error){alert(d.error);return}var pv=getPV();if(pv&&d.resourceId){if(f.type.startsWith('image/')){document.execCommand('insertHTML',false,'<img src="/resources/'+d.resourceId+'" alt="'+f.name+'" class="preview-img" />')}else{document.execCommand('insertHTML',false,'<a href="/resources/'+d.resourceId+'" target="_blank" rel="noopener">'+f.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</a>')}syncPV();pv.focus();return}insertTxt(d.markdown)};xhr.onerror=function(){setSaveState('','');alert('Upload failed')};if(s)setSaveState('<span class="autosave-saving">Uploading 0%</span>','Uploading');xhr.open('POST','/fragments/upload');xhr.send(fd)}
	// --- history modal ---
	var _historyNoteId=null;var _historySnapshotId=null;
	function openHistoryModal(noteId){_historyNoteId=noteId;_historySnapshotId=null;var modal=document.getElementById('history-modal');var backdrop=document.getElementById('history-modal-backdrop');var inner=document.getElementById('history-modal-inner');if(!modal||!backdrop||!inner)return;inner.innerHTML='<div class="history-loading">Loading...</div>';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;htmx.ajax('GET','/fragments/history/'+encodeURIComponent(noteId),{target:'#history-modal-inner',swap:'innerHTML'})}
	function closeHistoryModal(){var modal=document.getElementById('history-modal');var backdrop=document.getElementById('history-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
	function selectHistorySnapshot(id){_historySnapshotId=id;document.querySelectorAll('.history-item').forEach(function(el){el.classList.toggle('history-item-active',el.dataset.snapshotId===id)});var label=document.getElementById('history-selected-label');var preview=document.getElementById('history-preview');if(preview)preview.innerHTML='<div class="history-loading">Loading...</div>';if(label)label.textContent='Loading...';htmx.ajax('GET','/fragments/history-snapshot/'+encodeURIComponent(id),{target:'#history-preview',swap:'innerHTML'}).then(function(){var d=new Date(parseInt(id)*1||0);var label=document.getElementById('history-selected-label');if(label)label.textContent=''});_log('selectHistorySnapshot',id)}
	function restoreHistorySnapshot(noteId){var sid=_historySnapshotId;if(!sid){alert('Select a snapshot first.');return}if(!confirm('Restore this version? The current note will be overwritten.'))return;var form=activeEditorForm();var cfi=(form&&form.querySelector('[name="currentFolderId"]'))?form.querySelector('[name="currentFolderId"]').value:'';closeHistoryModal();_log('restoreHistorySnapshot',noteId,sid);htmx.ajax('POST','/fragments/history/'+encodeURIComponent(noteId)+'/restore/'+encodeURIComponent(sid),{target:'#autosave-status',swap:'innerHTML',values:{currentFolderId:cfi}}).then(function(){var s=queryActiveEditor('#autosave-status');if(s&&!s.querySelector('.autosave-error'))s.innerHTML='<span class="autosave-ok">Restored</span>';_snapshots=[];_log('restore done')}).catch(function(e){alert('Restore failed: '+e.message)})}
	// --- client ring buffer (in-session undo) ---
	var _snapshots=[];var _snapshotMaxCount=20;var _undoTimer=null;
	function pushSnapshot(){var ta=getTA();var title=queryActiveEditor('[name="title"]');var body=ta?ta.value:'';var t=title?title.value:'';if(_snapshots.length>0&&_snapshots[_snapshots.length-1].body===body&&_snapshots[_snapshots.length-1].title===t)return;_snapshots.push({body:body,title:t,ts:Date.now()});if(_snapshots.length>_snapshotMaxCount)_snapshots.shift();var btn=queryActiveEditor('#undo-save-btn');if(btn)btn.hidden=_snapshots.length<2;_log('pushSnapshot count',_snapshots.length)}
	function undoSnapshot(){if(_snapshots.length<2){_log('undoSnapshot: nothing to undo');return}if(_undoTimer){clearTimeout(_undoTimer);_undoTimer=null}_snapshots.pop();var snap=_snapshots[_snapshots.length-1];var btn=queryActiveEditor('#undo-save-btn');if(btn)btn.hidden=_snapshots.length<2;_log('undoSnapshot restoring ts',snap.ts);var ta=getTA();var titleInput=queryActiveEditor('[name="title"]');var titleDiv=queryActiveEditor('.editor-title');var pv=getPV();if(ta)ta.value=snap.body;if(titleInput)titleInput.value=snap.title;if(titleDiv)titleDiv.textContent=snap.title;var cm=getCM();if(cm&&!pv)cmSetVal(snap.body);if(pv&&pv.style.display!=='none'){fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(snap.body)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;syncPV()}).catch(function(){})}if(ta)ta.dispatchEvent(new Event('input',{bubbles:true}));scheduleSave();var s=queryActiveEditor('#autosave-status');if(s){s.innerHTML='<span class="autosave-edited">Undone</span>';clearTimeout(_undoTimer);_undoTimer=setTimeout(function(){var s2=queryActiveEditor('#autosave-status');if(s2&&s2.querySelector('.autosave-edited'))s2.innerHTML='<span class="autosave-ok">Saved</span>'},3000)}}
	function handleDrop(e){e.preventDefault();var files=e.dataTransfer&&e.dataTransfer.files;if(!files||!files.length)return;for(var i=0;i<files.length;i++)uploadFile(files[i])}
	var _tdService=null;
	function getTurndown(){
		if(_tdService)return _tdService;
		var td=new TurndownService({headingStyle:'atx',hr:'---',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*',strongDelimiter:'**',br:'\\n'});
		// Joplin resource images (with optional resize dimensions)
		td.addRule('joplinImg',{filter:function(n){return n.nodeName==='IMG'},replacement:function(c,n){
			var alt=n.getAttribute('alt')||'';var src=n.getAttribute('src')||'';
			var w=n.style.width||n.getAttribute('width');var h=n.style.height||n.getAttribute('height');
			var rm=src.match(/^\\/resources\\/([0-9a-zA-Z]{32})$/);
			if(w||h){var iSrc=rm?':/'+rm[1]:src;return '<img src="'+iSrc+'" alt="'+alt+'"'+(w?' width="'+parseInt(w)+'"':'')+(h?' height="'+parseInt(h)+'"':'')+' />'}
			if(rm)return '!['+alt+'](:/'+ rm[1]+')';return '!['+alt+']('+src+')'}});
		// Joplin resource links
		td.addRule('joplinLink',{filter:function(n){return n.nodeName==='A'&&/^\\/resources\\/[0-9a-zA-Z]{32}(?:\\?download=1)?$/.test((n.getAttribute('href')||'').split('#')[0])},
			replacement:function(c,n){var m=(n.getAttribute('href')||'').match(/^\\/resources\\/([0-9a-zA-Z]{32})/);return '['+c+'](:/'+ m[1]+')'}});
		// md-blank-line divs — use placeholder to survive <br> normalization
		td.addRule('blankLine',{filter:function(n){return n.nodeName==='DIV'&&n.classList.contains('md-blank-line')},replacement:function(){return '\\x00BL\\x00'}});
		// md-checkbox divs
		td.addRule('checkbox',{filter:function(n){return n.nodeName==='DIV'&&n.classList.contains('md-checkbox')},
			replacement:function(c,n){var checked=n.classList.contains('checked');var txt=c.replace(/^[\\u2611\\u2610\\u2612\\u2705\\u00a0 ]+/,'');return (checked?'- [x] ':'- [ ] ')+txt+'\\n'}});
		// Strikethrough
		td.addRule('strikethrough',{filter:['del','s','strike'],replacement:function(c){return c.trim()?'~~'+c.trim()+'~~':''}});
		// Underline
		td.addRule('underline',{filter:'u',replacement:function(c){return c.trim()?'++'+c.trim()+'++':''}});
		// Empty divs from contenteditable (Enter key creates <div><br></div>) — emit <br> for blank line
		td.addRule('emptyDiv',{filter:function(n){return n.nodeName==='DIV'&&!n.classList.length&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '\\n<br>\\n'}});
		// Empty paragraphs from contenteditable (<p><br></p>) — emit <br> for blank line
		td.addRule('emptyP',{filter:function(n){return n.nodeName==='P'&&!n.querySelector('img')&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '\\n\\n<br>\\n\\n'}});
		_tdService=td;return td}
	function htmlToMarkdown(el){
		var root=el.cloneNode(true);
		root.querySelectorAll('.pre-copy-btn').forEach(function(btn){btn.remove()});
		var md=getTurndown().turndown(root.innerHTML);
		var nbsp=String.fromCharCode(160);
		while(md.indexOf(nbsp)>=0)md=md.split(nbsp).join('&nbsp;');
		var nl=String.fromCharCode(10);
		var headingGapRe=new RegExp('^(#{1,6}[^'+nl+']*)'+nl+'{2,}(?=\\S)','gm');
		var headingLeadRe=new RegExp('([^'+nl+'])'+nl+'{2,}(#{1,6}\\s)','g');
		md=md.split('<br/>').join('<br>');
		md=md.split('<br>'+nl).join(nl);
		while(md.indexOf('<br><br>')>=0)md=md.split('<br><br>').join('<br>'+nl);
		md=md.replace(headingLeadRe,'$1'+nl+'$2');
		md=md.replace(headingGapRe,'$1'+nl);
		md=md.replace(new RegExp(nl+nl+'<br>$'),'');
		md=md.replace(/\\n*(?:\\x00BL\\x00\\n*)+/g,function(m){var count=(m.match(/\\x00BL\\x00/g)||[]).length;return nl+nl+Array(count+1).join(nl)});
		var out='';
		for(var i=0;i<md.length;i++){
			var ch=md.charAt(i),nx=md.charAt(i+1);
			if(ch.charCodeAt(0)===92&&(nx==='['||nx===']'||nx.charCodeAt(0)===96||nx==='*'||nx==='_'||nx.charCodeAt(0)===92||nx==='$')){out+=nx;i++;continue}
			out+=ch
		}
		return out
	}
	function setEditorMode(mode){var ta=getTA(),pv=queryActiveEditor('#note-preview'),tb=queryActiveEditor('#editor-toolbar'),host=queryActiveEditor('#cm-host'),form=activeEditorForm();if(!ta||!pv)return;if(form)form.dataset.editorMode=mode;if(mode==='preview'){_previewDirty=false;if(_cmView)cmSyncToTA();fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(ta.value)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;pv.contentEditable='true';pv.style.display='';if(host)host.style.display='none';_editorMode='preview';syncEditorModeButtons();activatePV(pv);applySearchHighlight()})}else{if(_pvSyncTimer){clearTimeout(_pvSyncTimer);_pvSyncTimer=null}if(pv.contentEditable==='true'&&_previewDirty){syncPV()}_previewDirty=false;pv.contentEditable='false';pv.oninput=null;pv.onkeyup=null;pv.style.display='none';if(host){host.style.display='';if(!_cmView)initCM(host,ta.value);else cmSetVal(ta.value);setTimeout(function(){if(_cmView)_cmView.focus();applySearchHighlight()},0)}if(tb)tb.style.display='';_editorMode='markdown';syncEditorModeButtons()}}
	document.addEventListener('keydown',function(e){if(e.key==='Escape'){var codeModal=document.getElementById('code-modal');if(codeModal&&!codeModal.hidden){closeCodeModal();return}closeFolderContextMenu();closeFolderModal();closeLinkModal();var bar=document.getElementById('search-nav-bar');if(bar&&!bar.hidden){searchNavDismiss();return}}if(!getTA()&&!getPV()&&!getCM())return;if((e.ctrlKey||e.metaKey)&&e.key==='b'){e.preventDefault();wrapSel('**','**')}if((e.ctrlKey||e.metaKey)&&e.key==='i'){e.preventDefault();wrapSel('*','*')}if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();if(_editorMode==='preview'&&_searchMarks.length){searchNavStep(1)}else{applySearchHighlight()}}});
	document.addEventListener('click',function(e){var menu=document.getElementById('folder-context-menu');if(menu&&!menu.hidden&&!menu.contains(e.target))closeFolderContextMenu()});
	function highlightCodeBlocks(container){if(!window.hljs||!container)return;container.querySelectorAll('pre code[class*="language-"]').forEach(function(el){if(el.dataset.highlighted)return;window.hljs.highlightElement(el)})}
	function ensureEditableAfterPre(pv){if(!pv)return;var pres=pv.querySelectorAll('pre');pres.forEach(function(pre){var next=pre.nextElementSibling;if(!next){var p=document.createElement('p');p.innerHTML='<br>';pv.appendChild(p)}})}
	function initCopyButtons(pv){if(!pv)return;pv.querySelectorAll('pre').forEach(function(pre){pre.contentEditable='false';pre.style.cursor='pointer';if(pre.querySelector('.pre-copy-btn'))return;var btn=document.createElement('button');btn.type='button';btn.className='pre-copy-btn';btn.title='Copy code';btn.textContent='Copy';btn.addEventListener('click',function(e){e.stopPropagation();var code=pre.querySelector('code');var text=code?code.textContent:(pre.textContent||'');navigator.clipboard.writeText(text).then(function(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},1500)}).catch(function(){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},1500)})});pre.insertBefore(btn,pre.firstChild);pre.addEventListener('click',function(e){if(e.target.closest('.pre-copy-btn'))return;e.preventDefault();e.stopPropagation();openCodeModal(pre)})})}
	function activatePV(pv){if(!pv)return;pv.contentEditable='true';initImgResize(pv);initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);pv.oninput=function(){_previewDirty=true;scheduleSyncPV()};pv.onkeyup=null;if(pv.dataset.pvInit)return;pv.dataset.pvInit='1';
		pv.addEventListener('click',function(e){var link=e.target.closest('a');if(link&&pv.contains(link)){var href=link.getAttribute('href')||'';if(href){e.preventDefault();window.open(href,'_blank','noopener');return}}});
		// Click checkbox icon to toggle checked state
		pv.addEventListener('click',function(e){var cb=e.target.closest('.md-checkbox');if(!cb)return;var iconEl=cb.querySelector('.md-cb-icon');if(!iconEl){var txt=cb.firstChild;if(!txt||txt.nodeType!==3)return;var icon=txt.textContent.charAt(0);if(icon!=='\u2610'&&icon!=='\u2611')return;var r=document.createRange();r.setStart(txt,0);r.setEnd(txt,Math.min(2,txt.textContent.length));var iconRect=r.getBoundingClientRect();if(e.clientX>iconRect.right)return;e.preventDefault();var checked=!cb.classList.contains('checked');cb.classList.toggle('checked',checked);txt.textContent=(checked?'\u2611':'\u2610')+txt.textContent.slice(1);syncPV();return}var iconRect=iconEl.getBoundingClientRect();if(e.clientX>iconRect.right)return;e.preventDefault();var checked=!cb.classList.contains('checked');cb.classList.toggle('checked',checked);iconEl.textContent=checked?'\u2611':'\u2610';syncPV()});
		// Enter inside code blocks should stay in the same block; Enter after checkbox creates new checkbox
		pv.addEventListener('keydown',function(e){if(e.key==='Enter'){var sel=window.getSelection();if(!sel.rangeCount)return;var range=sel.getRangeAt(0);var node=range.startContainer;var el=node.nodeType===3?node.parentElement:node;var pre=el&&el.closest?el.closest('pre'):null;if(pre&&pv.contains(pre)){e.preventDefault();var code=pre.querySelector('code')||pre;var txt=code.textContent||'';var atEnd=(node===code||node.parentElement===code)&&range.startOffset===(node.nodeType===3?node.textContent.length:code.childNodes.length)&&!range.toString();if(atEnd&&txt.endsWith('\\n')){code.textContent=txt.slice(0,-1);var np=document.createElement('p');np.innerHTML='<br>';pre.parentNode.insertBefore(np,pre.nextSibling);var nr=document.createRange();nr.setStart(np,0);nr.collapse(true);sel.removeAllRanges();sel.addRange(nr);np.scrollIntoView({block:'nearest'});syncPV();return}if(insertPVText('\\n'))syncPV();return}var cb=el&&el.closest?el.closest('.md-checkbox'):null;if(!cb&&node.nodeType===1&&range.startOffset>0){var prev=node.childNodes[range.startOffset-1];if(prev&&prev.nodeType===1&&prev.classList&&prev.classList.contains('md-checkbox'))cb=prev}if(!cb)return;e.preventDefault();var label=(cb.textContent||'').replace(/^[\\u2610\\u2611][\\u00a0 ]*/,'').replace(/\\u00a0|\\s/g,'');if(!label){var para=document.createElement('p');para.innerHTML='<br>';if(cb.parentNode)cb.parentNode.replaceChild(para,cb);var rp=document.createRange();rp.setStart(para,0);rp.collapse(true);sel.removeAllRanges();sel.addRange(rp);para.scrollIntoView({block:'nearest'});syncPV();return}var neo=document.createElement('div');neo.className='md-checkbox';var iconSpan2=document.createElement('span');iconSpan2.className='md-cb-icon';iconSpan2.textContent='\u2610';neo.appendChild(iconSpan2);var tn=document.createTextNode('\u00a0');neo.appendChild(tn);cb.parentNode.insertBefore(neo,cb.nextSibling);var r=document.createRange();r.setStart(tn,1);r.collapse(true);sel.removeAllRanges();sel.addRange(r);neo.scrollIntoView({block:'nearest'});syncPV();return}});
		// Scroll to keep cursor visible while typing
		pv.addEventListener('input',function(){var sel=window.getSelection();if(sel&&sel.rangeCount){var r=sel.getRangeAt(0).getBoundingClientRect();var pr=pv.getBoundingClientRect();if(r.bottom>pr.bottom-8)pv.scrollTop+=r.bottom-pr.bottom+24}});
		// Force plain-text paste — if inside <pre>, insert raw text directly; otherwise wrap leading-space content in <pre><code>
		pv.addEventListener('paste',function(e){e.preventDefault();var text=(e.clipboardData||window.clipboardData).getData('text/plain');if(!text)return;var sel=window.getSelection();var inPre=false;if(sel&&sel.rangeCount){var node=sel.getRangeAt(0).startContainer;while(node&&node!==pv){if(node.nodeName==='PRE'||node.nodeName==='CODE'){inPre=true;break}node=node.parentNode}}if(inPre){insertPVText(text);syncPV();return}var trimmed=text.trim();if(/^https?:\\/\\/\\S+$/.test(trimmed)&&trimmed.indexOf('\\n')<0){var hasSelection=sel&&sel.rangeCount&&!sel.getRangeAt(0).collapsed;var label=hasSelection?sel.getRangeAt(0).toString()||trimmed:trimmed;var a=document.createElement('a');a.href=trimmed;a.target='_blank';a.rel='noopener';a.textContent=label;if(sel&&sel.rangeCount){var range=sel.getRangeAt(0);range.deleteContents();range.insertNode(a);range.setStartAfter(a);range.collapse(true);sel.removeAllRanges();sel.addRange(range)}syncPV();return}document.execCommand('insertText',false,text);syncPV()})}	function djb2(str){var h=5381;for(var i=0;i<str.length;i++)h=((h<<5)+h+str.charCodeAt(i))>>>0;return h}
	function formHash(form){if(!form)return 0;var parts=[];var els=form.elements;for(var i=0;i<els.length;i++){var el=els[i];if(el.name)parts.push(el.name+'='+el.value)}return djb2(parts.join('&'))}
	var _savedHash=0;
	var _saveTimer=null;
	var _saveTitleTimer=null;
	function _anyModalOpen(){var ids=['code-modal','link-modal','folder-modal','history-modal'];for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(el&&!el.hidden)return true}return false}
	function scheduleSave(){if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=setTimeout(function(){_saveTimer=null;if(_syncPVInFlight||_pvSyncTimer){_log('scheduleSave deferred, syncPV in flight');scheduleSave();return}if(_anyModalOpen()){_log('scheduleSave deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSave skip, hash unchanged',h);return}_log('scheduleSave firing, hash',_savedHash,'->',h);htmx.trigger(form,'joplock:save')},2000)}
	function scheduleSaveTitle(){if(_saveTitleTimer)clearTimeout(_saveTitleTimer);if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=null;_saveTitleTimer=setTimeout(function(){_saveTitleTimer=null;if(_anyModalOpen()){_log('scheduleSaveTitle deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSaveTitle skip, hash unchanged',h);return}_log('scheduleSaveTitle firing');htmx.trigger(form,'joplock:save')},1000)}
	function snapshotHash(){var form=activeEditorForm();_savedHash=formHash(form);_log('snapshotHash',_savedHash)}
	function initEditorPanel(){var form=activeEditorForm();if(!form||form.dataset.editorInit)return;form.dataset.editorInit='1';_log('initEditorPanel',form.getAttribute('hx-put'));if(isMobileShellMode())closeNav();_previewDirty=false;setSaveState('','');snapshotHash();_snapshots=[];var undoBtn=queryActiveEditor('#undo-save-btn');if(undoBtn)undoBtn.hidden=true;pushSnapshot();form.addEventListener('input',function(){markEdited();scheduleSave()});form.addEventListener('change',function(){markEdited();scheduleSave()});initAutoTitle();applyMobileTitleMode();renderNoteMeta();var ta=getTA();if(ta){ta.addEventListener('input',function(){autoTitle()})}var pendingSearch=(window._pendingNoteSearchTerm||'').trim();var mobileEditor=inMobileEditor();if(mobileEditor&&pendingSearch){var header=document.getElementById('mobile-editor-header');var searchHeader=document.getElementById('mobile-editor-search-header');if(header)header.style.display='none';if(searchHeader)searchHeader.style.display=''}var searchInput=activeSearchInput();if(searchInput&&pendingSearch&&!searchInput.value)searchInput.value=pendingSearch;window._pendingNoteSearchTerm='';var pv=queryActiveEditor('#note-preview');var host=queryActiveEditor('#cm-host');var defaultMode=form.dataset.editorMode||_defaultNoteOpenMode||'preview';if(defaultMode!=='markdown')defaultMode='preview';form.dataset.editorMode=defaultMode;if(defaultMode==='preview'&&pv&&pv.style.display!=='none'){_editorMode='preview';activatePV(pv);if(host)host.style.display='none';syncEditorModeButtons();applySearchHighlight()}else{_editorMode='markdown';form.dataset.editorMode='markdown';if(pv)pv.style.display='none';if(host){host.style.display='';initCM(host,ta?ta.value:'')}syncEditorModeButtons();applySearchHighlight()}}
	function applySearchHighlight(){var term=activeSearchTerm();var bar=document.getElementById('search-nav-bar');if(bar)bar.hidden=true;_searchMarks=[];_searchMarkIdx=0;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);if(!term||!term.trim()){clearCodeMirrorSearch();return}term=term.trim();if(_editorMode==='preview'&&pv){clearCodeMirrorSearch();var savedHandler=pv.oninput;pv.oninput=null;highlightInPreview(pv,term);pv.oninput=savedHandler}else if(_editorMode==='markdown'&&_cmView&&window.CM&&window.CM.SearchQuery&&window.CM.setSearchQuery){			window.CM.openSearchPanel(_cmView);var q=new window.CM.SearchQuery({search:term,caseSensitive:false});_cmView.dispatch({effects:window.CM.setSearchQuery.of(q)});_cmSearchMatches=collectCodeMirrorSearchMatches(q);if(_cmSearchMatches.length)setCodeMirrorSearchActive(0);else searchNavShow(0,0)}}
	function escapeRegex(s){var specials=['.','+','*','?','^','$','(',')','{','}','[',']','|','\\\\'];return s.split('').map(function(c){return specials.indexOf(c)>=0?'\\\\'+c:c}).join('')}
	var _searchMarks=[];var _searchMarkIdx=0;
	function searchNavShow(total,idx){var bar=document.getElementById('search-nav-bar');var counter=document.getElementById('search-nav-counter');if(bar){if(total===0){bar.hidden=true}else{bar.hidden=false;if(counter)counter.textContent=(idx+1)+' / '+total}}var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(mobileCounter){mobileCounter.hidden=total===0;if(total>0)mobileCounter.textContent=(idx+1)+' / '+total}if(mobilePrev)mobilePrev.hidden=total===0;if(mobileNext)mobileNext.hidden=total===0}
	function searchNavSetActive(idx){_searchMarks.forEach(function(m,i){m.classList.toggle('search-highlight-active',i===idx)});var m=_searchMarks[idx];if(m)m.scrollIntoView({block:'center',behavior:'smooth'})}
	function searchNavStep(dir){if(_editorMode==='markdown'&&_cmSearchMatches.length){setCodeMirrorSearchActive(_searchMarkIdx+dir);return}if(!_searchMarks.length)return;_searchMarkIdx=(_searchMarkIdx+dir+_searchMarks.length)%_searchMarks.length;searchNavSetActive(_searchMarkIdx);searchNavShow(_searchMarks.length,_searchMarkIdx)}
	function searchNavDismiss(){var bar=document.getElementById('search-nav-bar');var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(bar)bar.hidden=true;if(mobileCounter)mobileCounter.hidden=true;if(mobilePrev)mobilePrev.hidden=true;if(mobileNext)mobileNext.hidden=true;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);_searchMarks=[];_searchMarkIdx=0;clearCodeMirrorSearch()}
	function highlightInPreview(pv,term){if(!pv||!term)return;_searchMarks=[];_searchMarkIdx=0;var walker=document.createTreeWalker(pv,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentElement&&n.parentElement.closest('script,style,mark')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}},false);var nodes=[];var node;while((node=walker.nextNode()))nodes.push(node);var re=new RegExp(escapeRegex(term),'gi');nodes.forEach(function(n){var matches=[];var m;re.lastIndex=0;while((m=re.exec(n.textContent))!==null)matches.push({start:m.index,end:m.index+m[0].length});if(!matches.length)return;var frag=document.createDocumentFragment();var last=0;matches.forEach(function(r){if(r.start>last)frag.appendChild(document.createTextNode(n.textContent.slice(last,r.start)));var mark=document.createElement('mark');mark.className='search-highlight';mark.textContent=n.textContent.slice(r.start,r.end);_searchMarks.push(mark);frag.appendChild(mark);last=r.end});if(last<n.textContent.length)frag.appendChild(document.createTextNode(n.textContent.slice(last)));n.parentNode.replaceChild(frag,n)});if(_searchMarks.length){searchNavSetActive(0);searchNavShow(_searchMarks.length,0)}else{searchNavShow(0,0)}}
	function initNavPanel(){_log('initNavPanel');var state=navFolderState();document.querySelectorAll('.nav-folder').forEach(function(el){var id=el.getAttribute('data-folder-id');var selected=el.getAttribute('data-selected')==='1';var open=state[id]===true||state[id]==='1'||state[id]===1;if(state[id]===undefined)open=el.getAttribute('data-all-notes')==='1';if(selected)open=true;el.classList.toggle('collapsed',!open);// Lazy-load if expanded and not yet loaded
		if(open){var notesDiv=el.querySelector('.nav-folder-notes[data-folder-id]');if(notesDiv&&!notesDiv.getAttribute('data-loaded')){notesDiv.setAttribute('data-loaded','1');var folderId=notesDiv.getAttribute('data-folder-id');htmx.ajax('GET','/fragments/folder-notes?folderId='+encodeURIComponent(folderId),{target:notesDiv,swap:'innerHTML'})}}})}
	document.body.addEventListener('htmx:afterSettle',function(){initNavPanel();initEditorPanel()});
	function showNoteOverlay(){var o=document.getElementById('note-loading-overlay');if(o)o.classList.add('active')}
	function hideNoteOverlay(){var o=document.getElementById('note-loading-overlay');if(o)o.classList.remove('active')}
	document.body.addEventListener('click',function(e){var btn=e.target.closest('.notelist-item');if(btn&&!e.defaultPrevented)showNoteOverlay()},true);
	document.body.addEventListener('htmx:beforeRequest',function(e){var elt=e.detail&&e.detail.elt;_log('htmx:beforeRequest',elt&&elt.id,elt&&elt.getAttribute&&elt.getAttribute('hx-get'),elt&&elt.getAttribute&&elt.getAttribute('hx-put'));});
	document.body.addEventListener('htmx:afterRequest',function(e){var xhr=e.detail&&e.detail.xhr;_log('htmx:afterRequest',e.detail&&e.detail.successful,xhr&&xhr.status,xhr&&typeof xhr.responseText==='string'?xhr.responseText.slice(0,120):'');var elt=e.detail&&e.detail.elt;if(elt&&elt.classList&&elt.classList.contains('notelist-item')&&!e.detail.successful)hideNoteOverlay();if(elt&&elt.id==='note-editor-form'&&e.detail.successful){snapshotHash();pushSnapshot();setSaveState('<span class="autosave-ok">Saved</span>','Saved');_log('afterRequest snapshotHash after save')}if(e.detail&&e.detail.successful&&document.body.classList.contains('is-offline')){clearOffline()}});
	document.body.addEventListener('htmx:afterSwap',function(e){var target=e.detail&&e.detail.target;_log('htmx:afterSwap',target&&target.id);if(target&&target.id==='editor-panel'){hideNoteOverlay();if(_cmView){_cmView.destroy();_cmView=null}_searchMarks=[];_searchMarkIdx=0}});
	function showOffline(){setSaveState('<span class="autosave-offline">Offline</span>','Offline');document.body.classList.add('is-offline');_log('offline indicator shown')}
	function clearOffline(){document.body.classList.remove('is-offline');_log('offline indicator cleared')}
	document.body.addEventListener('htmx:sendError',function(e){var elt=e.detail&&e.detail.elt;_log('htmx:sendError',elt&&elt.id);if(elt&&elt.id==='note-editor-form')showOffline()});
	document.body.addEventListener('htmx:responseError',function(e){var elt=e.detail&&e.detail.elt;var xhr=e.detail&&e.detail.xhr;_log('htmx:responseError',elt&&elt.id,xhr&&xhr.status);if(elt&&elt.id==='note-editor-form')showOffline()});
	window.addEventListener('online',function(){_log('browser online event');if(document.body.classList.contains('is-offline')){var s=document.getElementById('autosave-status');var dirty=s&&s.querySelector('.autosave-edited');if(dirty){scheduleSave()}else if(s){setSaveState('<span class="autosave-ok">Reconnected</span>','Saved')}clearOffline()}});
	window.addEventListener('load',function(){initNavPanel();initEditorPanel()});
	window.addEventListener('resize',applyMobileTitleMode);
	document.addEventListener('keydown',function(e){var mac=navigator.platform&&navigator.platform.indexOf('Mac')!==-1;var mod=mac?e.metaKey:e.ctrlKey;if(mod&&e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undoSnapshot()}});
		function flushSave(callback){var form=activeEditorForm();var status=queryActiveEditor('#autosave-status');var dirty=status&&status.querySelector('.autosave-edited');if(!form||!dirty){_log('flushSave skip (not dirty)');if(callback)callback(true);return}if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}if(_saveTitleTimer){clearTimeout(_saveTitleTimer);_saveTitleTimer=null}var pv=getPV();if(pv)syncPV();else cmSyncToTA();syncTitle();var fd=new FormData(form);var url=form.getAttribute('hx-put');if(!url){if(callback)callback(true);return}var body=new URLSearchParams(fd).toString();_log('flushSave',url);fetch(url,{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(function(html){_log('flushSave ok',html.slice(0,80));snapshotHash();window._mobileNewNoteId=null;setSaveState('<span class="autosave-ok">Saved</span>','Saved');if(callback)callback(true)}).catch(function(err){_log('flushSave error',err);showOffline();if(callback)callback(false)})}
	document.addEventListener('click',function(e){var btn=e.target.closest('.notelist-item');if(!btn)return;var form=document.getElementById('note-editor-form');var status=document.getElementById('autosave-status');var dirty=status&&status.querySelector('.autosave-edited');if(!form||!dirty)return;_log('notelist-item click intercepted, flushing save');e.preventDefault();e.stopImmediatePropagation();flushSave(function(saved){if(saved){_log('flushSave done, re-clicking note');btn.click()}})},true);
	(function(){var _al=${settings.autoLogout ? 'true' : 'false'};var _alMs=${Number(settings.autoLogoutMinutes) || 15}*60000;if(!_al)return;_log('autoLogout enabled, timeout',_alMs/60000,'min');var _last=Date.now();['keydown','click','input','scroll','touchstart'].forEach(function(evt){document.addEventListener(evt,function(){_last=Date.now()},true)});setInterval(function(){if(Date.now()-_last>_alMs){_log('autoLogout: inactive for',_alMs/60000,'min, logging out');window.location.assign('/logout')}},30000)})();
	window.joplockLiveSearch=${settings.liveSearch ? 'true' : 'false'};
	(function(){var _navSearchSavedValue=null;function enableLiveSearch(){var el=document.getElementById('nav-search');if(!el||!window.joplockLiveSearch||el.dataset.liveSearch)return;el.dataset.liveSearch='1';el.setAttribute('hx-trigger','search-submit, input changed delay:300ms');el.addEventListener('htmx:beforeRequest',function(e){var v=el.value;if(v.length>0&&v.length<3){e.preventDefault();return}});htmx.process(el)}function restoreNavSearch(){if(_navSearchSavedValue===null)return;var el=document.getElementById('nav-search');if(!el){_navSearchSavedValue=null;return;}el.value=_navSearchSavedValue;el.selectionStart=el.selectionEnd=el.value.length;_navSearchSavedValue=null}enableLiveSearch();document.body.addEventListener('htmx:beforeSwap',function(e){var target=e.detail&&e.detail.target;if(target&&target.id==='nav-panel'){var el=document.getElementById('nav-search');if(el)_navSearchSavedValue=el.value}});document.body.addEventListener('htmx:afterSettle',function(){enableLiveSearch();restoreNavSearch()})})();
	function confirmLogout(event){
		var ok=window.confirm('Log out?\\n\\nThis clears local data on this device, including the current session and saved UI state. Your notes and other server data remain on the server.');
		if(!ok&&event)event.preventDefault();
		return ok;
	}
	// --- Mobile navigation ---
	(function(){
		var _mobileStack=[];// 'folders' | 'notes' | 'editor'
		var _mobileFolderId='';
		var _mobileFolderTitle='';
		var _mobileNoteId='';
		var _mobileInitDone=false;
		function isMobile(){return isMobileShellMode()}
		function mobileResumeTarget(){
			if(!_mobileStartup||!_mobileStartup.noteId)return null;
			return {
				folderId:_mobileStartup.folderId||'',
				folderTitle:_mobileStartup.folderTitle||'Notes',
				noteId:_mobileStartup.noteId,
				noteTitle:_mobileStartup.noteTitle||'Note',
			};
		}
		function mobileScreenId(name){return'mobile-'+name+'-screen'}
		function showMobileScreen(name,dir){
			var screens=['folders','notes','editor'];
			screens.forEach(function(s){
				var el=document.getElementById(mobileScreenId(s));
				if(!el)return;
				if(s===name){el.classList.remove('mobile-screen-right','mobile-screen-left');el.classList.add('mobile-screen-active')}
				else{el.classList.remove('mobile-screen-active');el.classList.add(dir==='forward'?'mobile-screen-left':'mobile-screen-right')}
			})
		}
		window.mobilePushNotes=function(folderId,folderTitle){
			if(!isMobile())return;
			_mobileFolderId=folderId;_mobileFolderTitle=folderTitle||'Notes';
			_mobileStack=['folders','notes'];
			var titleEl=document.getElementById('mobile-notes-title');if(titleEl)titleEl.textContent=_mobileFolderTitle;
			var body=document.getElementById('mobile-notes-body');if(body)body.innerHTML='<div class="empty-hint" style="padding:16px">Loading...</div>';
			showMobileScreen('notes','forward');
			htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(folderId),{target:'#mobile-notes-body',swap:'innerHTML'});
		};
		window.mobilePushEditor=function(noteId,folderId){
			if(!isMobile())return;
			_mobileNoteId=noteId;
			_mobileStack=['folders','notes','editor'];
			window.mobileEditorSearchClose();
			showMobileScreen('editor','forward');
			var body=document.getElementById('mobile-editor-body');if(body)body.innerHTML='<div class="editor-empty mobile-loading-note"><div class="note-loading-ring"></div></div>';
			htmx.ajax('GET','/fragments/editor/'+encodeURIComponent(noteId)+'?currentFolderId='+encodeURIComponent(folderId||_mobileFolderId),{target:'#mobile-editor-body',swap:'innerHTML'}).then(function(){hideNoteOverlay()}).catch(function(){hideNoteOverlay()});
		};
		window.mobilePopScreen=function(){
			if(!isMobile())return;
			_mobileStack.pop();
			var current=_mobileStack[_mobileStack.length-1]||'folders';
			showMobileScreen(current,'back');
			if(current==='folders'){
				// flush any dirty save when leaving editor
				flushSave(function(){})
			}
		};
		window.mobileEditorBack=function(){
			var form=document.getElementById('note-editor-form');
			var titleEl=form&&form.querySelector('.editor-title');
			var bodyEl=form&&form.querySelector('#note-body');
			var noteId=_mobileNoteId;
			var title=((titleEl&&titleEl.textContent)||'').trim();
			var body=((bodyEl&&bodyEl.value)||'').trim();
			var shouldDiscard=!!(window._mobileNewNoteId&&noteId===window._mobileNewNoteId&&!body&&(title===''||title==='Untitled note'));
			if(shouldDiscard){
				fetch('/fragments/notes/'+encodeURIComponent(noteId),{method:'DELETE',headers:{'hx-request':'true','hx-params':'none'}})
					.then(function(){window._mobileNewNoteId=null;mobileRefreshNotes();mobilePopScreen()})
					.catch(function(){mobilePopScreen()});
				return;
			}
			flushSave(function(){mobileRefreshNotes();mobilePopScreen()});
		};
		// Wire mobile delete button after editor loads
		function wireMobileDeleteBtn(noteId,isDeleted){
			var btn=document.getElementById('mobile-delete-btn');
			if(!btn)return;
			btn.onclick=function(){
				var msg=isDeleted?'Permanently delete this note?':'Move this note to trash?';
				if(!confirm(msg))return;
				fetch('/fragments/notes/'+encodeURIComponent(noteId),{method:'DELETE',headers:{'hx-request':'true','hx-params':'none'}})
					.then(function(){mobilePopScreen();mobileRefreshNotes()});
			};
		}
		function mobileRefreshNotes(){
			if(_mobileFolderId){
				var body=document.getElementById('mobile-notes-body');
				if(body)htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_mobileFolderId),{target:'#mobile-notes-body',swap:'innerHTML'});
			}
		}
		window.mobileNewNote=function(){
			var fid=_mobileStack.indexOf('notes')>=0?_mobileFolderId:'';
			console.error('[mobile] mobileNewNote called', { stack:_mobileStack.slice(), fid:fid, folderId:_mobileFolderId });
			htmx.ajax('POST','/fragments/mobile/notes/new',{target:'#mobile-notes-body',swap:'innerHTML',values:{folderId:fid||''}});
			console.error('[mobile] mobileNewNote POST fired');
		};
		window.mobileFabOpen=function(){
			if(_mobileStack[_mobileStack.length-1]==='notes') return mobileNewNote();
			var b=document.getElementById('mobile-fab-menu-backdrop');
			var m=document.getElementById('mobile-fab-menu');
			if(b)b.style.display='';
			if(m)m.style.display='';
		};
		window.mobileFabClose=function(){
			var b=document.getElementById('mobile-fab-menu-backdrop');
			var m=document.getElementById('mobile-fab-menu');
			if(b)b.style.display='none';
			if(m)m.style.display='none';
		};
		window.mobileFabNewNote=function(){
			mobileFabClose();
			_mobileFolderId='__all__';
			_mobileFolderTitle='All Notes';
			var titleEl=document.getElementById('mobile-notes-title');if(titleEl)titleEl.textContent='All Notes';
			showMobileScreen('notes','forward');
			_mobileStack=['folders','notes'];
			mobileNewNote();
		};
		window.mobileFabNewFolder=function(){
			mobileFabClose();
			var title=prompt('New folder name:');
			if(!title||!title.trim())return;
			htmx.ajax('POST','/fragments/folders',{target:'#mobile-folders-body',swap:'none',values:{title:title.trim(),parentId:''}}).then(function(){
				htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
			});
		};
		window.mobileNewNoteInFolder=function(folderId,folderTitle,event){
			if(event){event.preventDefault();event.stopPropagation();}
			_mobileFolderId=folderId;
			_mobileFolderTitle=folderTitle||'Notes';
			var titleEl=document.getElementById('mobile-notes-title');if(titleEl)titleEl.textContent=_mobileFolderTitle;
			showMobileScreen('notes','forward');
			_mobileStack=['folders','notes'];
			mobileNewNote();
		};
		// Context menu (long-press on note rows)
		var _ctxNoteId=null,_ctxNoteTitle=null,_ctxLongPressTimer=null;
		function mobileCtxOpen(noteId,noteTitle){
			_ctxNoteId=noteId;_ctxNoteTitle=noteTitle;
			var backdrop=document.getElementById('mobile-ctx-backdrop');
			var sheet=document.getElementById('mobile-ctx-sheet');
			var titleEl=document.getElementById('mobile-ctx-title');
			var delBtn=document.getElementById('mobile-ctx-delete');
			if(titleEl)titleEl.textContent=noteTitle||'Untitled';
			if(delBtn)delBtn.onclick=function(){mobileCtxDelete()};
			if(backdrop)backdrop.style.display='';
			if(sheet)sheet.style.display='';
		}
		window.mobileCtxClose=function(){
			var backdrop=document.getElementById('mobile-ctx-backdrop');
			var sheet=document.getElementById('mobile-ctx-sheet');
			if(backdrop)backdrop.style.display='none';
			if(sheet)sheet.style.display='none';
			_ctxNoteId=null;_ctxNoteTitle=null;
		};
		function mobileCtxDelete(){
			if(!_ctxNoteId)return;
			var id=_ctxNoteId;
			mobileCtxClose();
			if(!confirm('Move this note to trash?'))return;
			fetch('/fragments/notes/'+encodeURIComponent(id),{method:'DELETE',headers:{'hx-request':'true','hx-params':'none'}})
				.then(function(){mobileRefreshNotes()});
		}
		function wireNoteRowLongPress(container){
			if(!container)return;
			container.querySelectorAll('.mobile-note-row[data-note-id]').forEach(function(row){
				if(row.dataset.lpWired)return;
				row.dataset.lpWired='1';
				row.addEventListener('touchstart',function(e){
					var id=row.dataset.noteId,title=row.dataset.noteTitle;
					_ctxLongPressTimer=setTimeout(function(){
						e.preventDefault();
						mobileCtxOpen(id,title);
					},500);
				},{passive:true});
				row.addEventListener('touchend',function(){if(_ctxLongPressTimer){clearTimeout(_ctxLongPressTimer);_ctxLongPressTimer=null}});
				row.addEventListener('touchmove',function(){if(_ctxLongPressTimer){clearTimeout(_ctxLongPressTimer);_ctxLongPressTimer=null}});
			});
		}
		// Search
		var _mobileSearchTimer=null;
		window.mobileSearchOpen=function(){
			var fh=document.getElementById('mobile-folders-header');
			var sh=document.getElementById('mobile-search-header');
			var inp=document.getElementById('mobile-search-input');
			if(fh)fh.style.display='none';
			if(sh)sh.style.display='';
			if(inp){inp.value='';inp.focus()}
			var body=document.getElementById('mobile-folders-body');
			if(body)body.innerHTML='';
		};
		window.mobileSearchClose=function(){
			var fh=document.getElementById('mobile-folders-header');
			var sh=document.getElementById('mobile-search-header');
			if(fh)fh.style.display='';
			if(sh)sh.style.display='none';
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
		};
		window.mobileSearchQuery=function(q){
			if(_mobileSearchTimer)clearTimeout(_mobileSearchTimer);
			if(!q||!q.trim()){var body=document.getElementById('mobile-folders-body');if(body)body.innerHTML='';return}
			if(q.trim().length<2)return;
			_mobileSearchTimer=setTimeout(function(){
				htmx.ajax('GET','/fragments/mobile/search?q='+encodeURIComponent(q.trim()),{target:'#mobile-folders-body',swap:'innerHTML'});
			},300);
		};
		window.mobileEditorSearchOpen=function(){
			var header=document.getElementById('mobile-editor-header');
			var searchHeader=document.getElementById('mobile-editor-search-header');
			var input=document.getElementById('mobile-editor-search-input');
			if(header)header.style.display='none';
			if(searchHeader)searchHeader.style.display='';
			if(input&&!input.value){var pending=window._pendingNoteSearchTerm||'';var listTerm=currentListSearchTerm();var seed=(pending&&pending.trim())||(listTerm&&listTerm.trim())||'';if(seed)input.value=seed;window._pendingNoteSearchTerm=''}
			if(input){input.focus();input.select();applySearchHighlight()}
		};
		window.mobileEditorSearchClose=function(){
			var header=document.getElementById('mobile-editor-header');
			var searchHeader=document.getElementById('mobile-editor-search-header');
			var mobileBar=document.getElementById('mobile-search-nav-bar');
			var input=document.getElementById('mobile-editor-search-input');
			if(input)input.value='';
			if(searchHeader)searchHeader.style.display='none';
			if(mobileBar)mobileBar.hidden=true;
			if(header)header.style.display='';
			searchNavDismiss();
		};
		window.mobileEditorSearchQuery=function(){applySearchHighlight()};
		function mobileInit(){
			if(!isMobile())return;
			document.getElementById('mobile-app').setAttribute('aria-hidden','false');
			if(_mobileInitDone)return;
			_mobileInitDone=true;
			var resume=mobileResumeTarget();
			if(resume){
				_mobileFolderId=resume.folderId;
				_mobileFolderTitle=resume.folderTitle;
				_mobileNoteId=resume.noteId;
				_mobileStack=['folders','notes','editor'];
				var notesTitle=document.getElementById('mobile-notes-title');if(notesTitle)notesTitle.textContent=_mobileFolderTitle;
				var editorTitle=document.getElementById('mobile-editor-title');if(editorTitle)editorTitle.textContent=resume.noteTitle;
				showMobileScreen('editor','forward');
				htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
				htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_mobileFolderId),{target:'#mobile-notes-body',swap:'innerHTML'});
			}else{
				_mobileStack=['folders'];
				showMobileScreen('folders','forward');
				htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
			}
			var fab=document.getElementById('mobile-fab');
			if(fab&&!fab.dataset.debugWired){
				fab.dataset.debugWired='1';
				fab.addEventListener('click',function(ev){
					var r=fab.getBoundingClientRect();
					var topEl=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
					console.log('[mobile] FAB click heard', { display:getComputedStyle(fab).display, z:getComputedStyle(fab).zIndex, rect:{x:r.x,y:r.y,w:r.width,h:r.height}, topEl:topEl&&topEl.id, topTag:topEl&&topEl.tagName });
				});
				fab.addEventListener('touchstart',function(){
					console.log('[mobile] FAB touchstart heard');
				},{passive:true});
			}
			var headerNewBtn=document.querySelector('#mobile-notes-screen .mobile-header button[title="New note"]');
			if(headerNewBtn&&!headerNewBtn.dataset.debugWired){
				headerNewBtn.dataset.debugWired='1';
				headerNewBtn.addEventListener('click',function(){
					console.log('[mobile] header + click heard');
				});
				headerNewBtn.addEventListener('touchstart',function(){
					console.log('[mobile] header + touchstart heard');
				},{passive:true});
			}
			// Swipe right to go back
			var startX=0,startY=0,swiping=false;
			document.getElementById('mobile-app').addEventListener('touchstart',function(e){startX=e.touches[0].clientX;startY=e.touches[0].clientY;swiping=true},{passive:true});
				document.getElementById('mobile-app').addEventListener('touchend',function(e){
					if(!swiping)return;swiping=false;
					var dx=e.changedTouches[0].clientX-startX;
					var dy=e.changedTouches[0].clientY-startY;
					if(Math.abs(dx)>Math.abs(dy)*1.5&&dx>60&&_mobileStack.length>1){mobileEditorBack()}
				},{passive:true});
		}
		function syncResponsiveMode(){
			if(isMobile()){
				mobileInit();
				return;
			}
			var app=document.getElementById('mobile-app');
			if(app)app.setAttribute('aria-hidden','true');
			mobileFabClose();
			mobileCtxClose();
			var fab=document.getElementById('mobile-fab');
			if(fab)fab.style.display='none';
			var foldersHeader=document.getElementById('mobile-folders-header');
			var searchHeader=document.getElementById('mobile-search-header');
			if(foldersHeader)foldersHeader.style.display='';
			if(searchHeader)searchHeader.style.display='none';
			setMobileNav(false);
		}
		function initMobileToolbar(){
			var tb=document.getElementById('editor-toolbar');
			if(!tb||!inMobileEditor())return;
			if(tb.dataset.mobileToolbarInit==='1'){syncEditorModeButtons();return}
			tb.dataset.mobileToolbarInit='1';
			tb.style.position='fixed';
			tb.style.left='0';tb.style.right='0';
			tb.style.bottom='0';
			tb.style.zIndex='50';
			tb.style.background='var(--bg-side)';
			tb.style.borderTop='1px solid var(--border)';
			// Adjust editor body padding so toolbar doesn't overlap content
			var body=document.getElementById('mobile-editor-body');
			if(body)body.style.paddingBottom='90px';
			tb.style.display='flex';
			function positionToolbar(){
				if(!inMobileEditor()||!tb)return;
				var vv=window.visualViewport;
				// Use innerHeight - vv.height so toolbar clears keyboard + iOS accessory bar
				var keyboardH=vv?Math.max(0,window.innerHeight-vv.height):0;
				tb.style.bottom=keyboardH+'px';
			}
			if(window.visualViewport){
				window.visualViewport.addEventListener('resize',positionToolbar);
				window.visualViewport.addEventListener('scroll',positionToolbar);
			}
			positionToolbar();
			syncEditorModeButtons();
		}
		// Update editor title when editor loads
			document.body.addEventListener('htmx:afterSettle',function(e){
			var t=e.detail&&e.detail.target;
			if(t&&t.id==='mobile-editor-body'){
				if(_cmView){_cmView.destroy();_cmView=null}
				initEditorPanel();
				var titleInput=t.querySelector('.editor-title');
				var titleEl=document.getElementById('mobile-editor-title');
				if(titleEl&&titleInput)titleEl.textContent=titleInput.textContent||'Note';
				var mobileStatus=document.getElementById('mobile-editor-status');
				if(mobileStatus){
					var dirty=t.querySelector('#autosave-status .autosave-edited');
					var saved=t.querySelector('#autosave-status .autosave-ok');
					mobileStatus.innerHTML=dirty?'<span class="autosave-edited">Edited</span>':(saved?'<span class="autosave-ok">Saved</span>':'');
				}
				// Update title dynamically as user edits
				if(titleInput&&titleEl){titleInput.addEventListener('input',function(){titleEl.textContent=titleInput.textContent||'Note'})}
				// Hide desktop titlebar in mobile editor
				var titlebar=t.querySelector('.editor-titlebar');
				if(titlebar&&isMobile())titlebar.style.display='none';
				// Wire delete button
				var form=t.querySelector('#note-editor-form');
				var noteId=form?decodeURIComponent((form.getAttribute('hx-put')||'').replace('/fragments/editor/','')):'';
				var isDeleted=!!t.querySelector('.btn-danger[hx-confirm*="Permanently"]');
				wireMobileDeleteBtn(noteId,isDeleted);
				// Show FAB only when on notes screen
				var fab=document.getElementById('mobile-fab');if(fab)fab.style.display='none';
				// Position toolbar above keyboard using visualViewport
				initMobileToolbar();
			}
			if(t&&(t.id==='mobile-notes-body'||t.id==='mobile-folders-body')){
				var fab=document.getElementById('mobile-fab');
				if(fab)fab.style.display=(t.id==='mobile-notes-body'||t.id==='mobile-folders-body')?'flex':'none';
				wireNoteRowLongPress(t);
			}
		});
		// Handle new note response: push to editor
		document.body.addEventListener('htmx:afterRequest',function(e){
			var t=e.detail&&e.detail.target;
			console.log('[mobile] htmx:afterRequest target=',t&&t.id,'xhr status=',e.detail.xhr&&e.detail.xhr.status);
			if(t&&t.id==='mobile-notes-body'){
				var xhr=e.detail.xhr;
				var noteId=xhr&&xhr.getResponseHeader('X-Mobile-Note-Id');
				console.log('[mobile] notes-body afterRequest noteId=',noteId);
				if(noteId){window._mobileNewNoteId=noteId;mobilePushEditor(noteId,_mobileFolderId)}
			}
		});
		window.addEventListener('resize',syncResponsiveMode);
		syncResponsiveMode();
	})();
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

const mobileFoldersFragment = (folders, countsOrNotes) => {
	// Accept either a Map (counts) or legacy notes array
	let allCount, notesByFolder;
	if (countsOrNotes instanceof Map) {
		allCount = countsOrNotes.get('__all__') || 0;
		notesByFolder = countsOrNotes;
	} else {
		const notes = countsOrNotes || [];
		allCount = notes.filter(n => !n.deletedTime).length;
		notesByFolder = new Map();
		for (const note of notes) {
			if (note.deletedTime) continue;
			const key = note.parentId || '';
			notesByFolder.set(key, (notesByFolder.get(key) || 0) + 1);
		}
	}
	const allRow = `<button class="mobile-folder-row" onclick="mobilePushNotes('__all__','All Notes')">
		<span class="mobile-folder-icon">${allNotesIcon}</span>
		<span class="mobile-folder-title">All Notes</span>
		<span class="mobile-folder-count">${allCount}</span>
		<span class="mobile-folder-add" onclick="mobileNewNoteInFolder('__all__','All Notes',event)">+</span>
		<span class="mobile-folder-arrow">&#8250;</span>
	</button>`;
	const folderRows = (folders || []).filter(f => !f.isVirtualAllNotes && f.id !== trashFolderId).map(f => {
		const count = notesByFolder.get(f.id) || 0;
		return `<button class="mobile-folder-row" onclick="mobilePushNotes(${escapeHtml(JSON.stringify(f.id))},${escapeHtml(JSON.stringify(f.title || 'Untitled'))})">
			<span class="mobile-folder-icon">${folderOutlineIcon}</span>
			<span class="mobile-folder-title">${escapeHtml(f.title || 'Untitled')}</span>
			<span class="mobile-folder-count">${count || ''}</span>
			<span class="mobile-folder-add" onclick="mobileNewNoteInFolder(${escapeHtml(JSON.stringify(f.id))},${escapeHtml(JSON.stringify(f.title || 'Untitled'))},event)">+</span>
			<span class="mobile-folder-arrow">&#8250;</span>
		</button>`;
	}).join('');
	return `${allRow}${folderRows || '<div class="empty-hint" style="padding:24px 16px;text-align:center"><div style="font-size:40px;margin-bottom:8px">&#128193;</div><div>No notebooks yet</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">Create one in the desktop app</div></div>'}`;
};

const mobileNotesFragment = (notes, folderId, folderTitle, hasMore = false, nextOffset = 0) => {
	if (!notes.length) return '<div class="empty-hint" style="padding:24px 16px;text-align:center"><div style="font-size:40px;margin-bottom:8px">&#128221;</div><div>No notes yet</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">Tap + to create one</div></div>';
	const items = notes.map(n => `<button class="mobile-note-row" data-note-id="${escapeHtml(n.id)}" data-note-title="${escapeHtml(n.title || 'Untitled')}" onclick="mobilePushEditor(${escapeHtml(JSON.stringify(n.id))},${escapeHtml(JSON.stringify(folderId))})">
		<span class="mobile-note-title">${escapeHtml(stripMarkdownForTitle(n.title || 'Untitled') || 'Untitled')}</span>
		<span class="mobile-note-arrow">&#8250;</span>
	</button>`).join('');
	if (!hasMore) return items;
	const loadMore = `<button class="notelist-load-more"
		hx-get="/fragments/mobile/notes?folderId=${encodeURIComponent(folderId)}&offset=${nextOffset}"
		hx-target="#mobile-notes-body"
		hx-swap="beforeend"
		hx-on::after-request="this.remove()">Load more&hellip;</button>`;
	return items + loadMore;
};

const mobileSearchFragment = (notes, hasMore = false, nextOffset = 0, query = '') => {
	if (!notes.length) return '<div class="empty-hint" style="padding:24px 16px;text-align:center"><div style="font-size:40px;margin-bottom:8px">&#128269;</div><div>No results found</div></div>';
	const items = notes.map(n => `<button class="mobile-note-row" data-note-id="${escapeHtml(n.id)}" data-note-title="${escapeHtml(n.title || 'Untitled')}" onclick="window._pendingNoteSearchTerm=((document.getElementById('mobile-search-input')||{}).value||'').trim();mobilePushEditor(${escapeHtml(JSON.stringify(n.id))},${escapeHtml(JSON.stringify(n.parentId || ''))})">
		<span class="mobile-note-title">${escapeHtml(stripMarkdownForTitle(n.title || 'Untitled') || 'Untitled')}</span>
		<span class="mobile-note-arrow">&#8250;</span>
	</button>`).join('');
	if (!hasMore) return items;
	const loadMore = `<button class="notelist-load-more" style="padding:12px 16px"
		hx-get="/fragments/mobile/search?q=${encodeURIComponent(query)}&offset=${nextOffset}"
		hx-target="#mobile-search-results"
		hx-swap="beforeend"
		hx-on::after-request="this.remove()">Load more results&hellip;</button>`;
	return items + loadMore;
};


module.exports = {
	escapeHtml,
	folderListItem,
	folderListFragment,
	navigationFragment,
	folderNotesPageFragment,
	noteListItem,
	noteListFragment,
	noteSyncStateFragment,
	noteMetaFragment,
	editorFragment,
	mobileEditorFragment,
	autosaveStatusFragment,
	autosaveConflictFragment,
	historyModalFragment,
	historySnapshotPreviewFragment,
	stripMarkdownForTitle,
	renderInlineMarkdown,
	renderMarkdown,
	searchResultsFragment,
	mobileFoldersFragment,
	mobileNotesFragment,
	mobileSearchFragment,
	settingsPage,
	adminUserRow,
	layoutPage,
	loggedOutPage,
	mfaPage,
};
