// HTML fragment generators for htmx partial responses
'use strict';

const {
	escapeHtml,
	folderOutlineIcon,
	allNotesIcon,
	trashFolderId,
	stripMarkdownForTitle,
	renderMarkdown,
} = require('./shared');

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
		const countKey = folder.isVirtualAllNotes ? '__all__' : (folderId === trashFolderId ? '__trash__' : folderId);
		const count = counts.get(countKey) || folder.noteCount || 0;
		const isOpen = folderId === selectedFolderId;
		const isExpandable = count > 0;
		const isTrash = folderId === trashFolderId;
		const isAllNotes = !!folder.isVirtualAllNotes;
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
				${note.deletedTime ? 'hx-confirm="Permanently delete this note?"' : 'data-confirm-trash="Move this note to trash?"'}>&#128465;</button>
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

module.exports = {
	noteDomId,
	folderListItem,
	folderListFragment,
	noteListItem,
	noteListFragment,
	noteSyncStateFragment,
	noteMetaFragment,
	autosaveConflictFragment,
	fmtHistoryTime,
	historyModalFragment,
	historySnapshotPreviewFragment,
	folderNotesPageFragment,
	navigationFragment,
	editorFragment,
	mobileEditorFragment,
	autosaveStatusFragment,
	searchResultsFragment,
};
