// Mobile-specific fragment generators
'use strict';

const {
	escapeHtml,
	folderOutlineIcon,
	allNotesIcon,
	trashFolderId,
	stripMarkdownForTitle,
	svgLockClosed,
} = require('./shared');
const { flattenFolderTree, rollupCounts } = require('../items/folderTree');

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
	// Inline expandable tree. Every row is rendered; rows below the top level
	// start `hidden` and the client (mobileApplyFolderTree in app.js) reveals the
	// ones whose ancestors are all expanded, using the saved expansion state.
	// Counts include sub-notebooks (like Joplin) so a collapsed parent is honest.
	const realFolders = (folders || []).filter(f => !f.isVirtualAllNotes && f.id !== trashFolderId);
	const totals = rollupCounts(realFolders, notesByFolder);
	const flatFolders = flattenFolderTree(realFolders);
	// Only reserve the chevron gutter when something is actually nested, so a
	// flat notebook list looks exactly as it did before nesting existed.
	const anyNested = flatFolders.some(f => f.hasChildren);
	const togglePlaceholder = anyNested ? '<span class="mobile-folder-toggle mobile-folder-toggle-placeholder"></span>' : '';
	const allRow = `<button class="mobile-folder-row" onclick="mobilePushNotes('__all__','All Notes')">
		${togglePlaceholder}
		<span class="mobile-folder-icon">${allNotesIcon}</span>
		<span class="mobile-folder-title">All Notes</span>
		<span class="mobile-folder-count">${allCount}</span>
		<span class="mobile-folder-add" onclick="mobileNewNoteInFolder('__all__','All Notes',event)">+</span>
		<span class="mobile-folder-arrow">&#8250;</span>
	</button>`;
	const folderRows = flatFolders.map(f => {
		const count = totals.get(f.id) || 0;
		const vaultIcon = f.isVault ? `<span role="button" tabindex="0" class="vault-folder-lock btn-icon-sm mobile-vault-folder-lock" data-folder-id="${escapeHtml(f.id)}" title="Lock vault" onclick="event.preventDefault();event.stopPropagation();toggleVaultLock('${escapeHtml(f.id)}')">${svgLockClosed}</span>` : '';
		const toggle = f.hasChildren
			? `<span role="button" tabindex="0" class="mobile-folder-toggle" aria-label="Expand or collapse" onclick="mobileToggleFolderRow(${escapeHtml(JSON.stringify(f.id))},event)">&#9656;</span>`
			: togglePlaceholder;
		return `<button class="mobile-folder-row${f.hasChildren ? ' has-children' : ''}" data-folder-id="${escapeHtml(f.id)}" data-parent-id="${escapeHtml(f.treeParentId)}" data-depth="${f.depth}" style="--m-depth:${Math.min(f.depth, 4)}"${f.depth ? ' hidden' : ''} onclick="mobilePushNotes(${escapeHtml(JSON.stringify(f.id))},${escapeHtml(JSON.stringify(f.title || 'Untitled'))})">
			${toggle}
			<span class="mobile-folder-icon">${folderOutlineIcon}</span>
			<span class="mobile-folder-title">${escapeHtml(f.title || 'Untitled')}</span>
			${vaultIcon}
			<span class="mobile-folder-count">${count || ''}</span>
			<span class="mobile-folder-add" onclick="mobileNewNoteInFolder(${escapeHtml(JSON.stringify(f.id))},${escapeHtml(JSON.stringify(f.title || 'Untitled'))},event)">+</span>
			<span class="mobile-folder-arrow">&#8250;</span>
		</button>`;
	}).join('');
	return `${allRow}${folderRows || '<div class="empty-hint" style="padding:24px 16px;text-align:center"><div style="font-size:40px;margin-bottom:8px">&#128193;</div><div>No notebooks yet</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">Create one in the desktop app</div></div>'}`;
};

// Renders a single mobile note row button.
//   onclickJs — the onclick JS expression string (varies between notes list and search)
const mobileNoteRow = (n, onclickJs, viewerUserId = '') => {
	const protectedByVault = !!(n.isEncrypted || n.inVault);
	const isOwner = !n.ownerId || n.ownerId === viewerUserId;
	const lockIcon = protectedByVault ? '<span class="note-lock-icon" data-note-id="' + escapeHtml(n.id) + '">' + svgLockClosed + '</span>' : '';
	return `<button class="mobile-note-row" data-note-id="${escapeHtml(n.id)}" data-note-title="${escapeHtml(n.title || 'Untitled')}" data-is-owner="${isOwner ? '1' : '0'}"${n.isEncrypted ? ' data-encrypted="1"' : ''}${protectedByVault && n.parentId ? ` data-vault-id="${escapeHtml(n.parentId)}"` : ''} onclick="${onclickJs}">
		${lockIcon}<span class="mobile-note-title">${escapeHtml(stripMarkdownForTitle(n.title || 'Untitled') || 'Untitled')}</span>
		<span class="mobile-note-arrow">&#8250;</span>
	</button>`;
};

const mobileNotesFragment = (notes, folderId, folderTitle, hasMore = false, nextOffset = 0, viewerUserId = '') => {
	if (!notes.length) return '<div class="empty-hint" style="padding:24px 16px;text-align:center"><div style="font-size:40px;margin-bottom:8px">&#128221;</div><div>No notes yet</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">Tap + to create one</div></div>';
	const items = notes.map(n =>
		mobileNoteRow(n, `mobilePushEditor(${escapeHtml(JSON.stringify(n.id))},${escapeHtml(JSON.stringify(folderId))})`, viewerUserId)
	).join('');
	if (!hasMore) return items;
	const loadMore = `<button class="notelist-load-more"
		hx-get="/fragments/mobile/notes?folderId=${encodeURIComponent(folderId)}&offset=${nextOffset}"
		hx-target="#mobile-notes-body"
		hx-swap="beforeend"
		hx-on::after-request="this.remove()">Load more&hellip;</button>`;
	return items + loadMore;
};

const mobileSearchFragment = (notes, hasMore = false, nextOffset = 0, query = '', viewerUserId = '') => {
	if (!notes.length) return '<div class="empty-hint" style="padding:24px 16px;text-align:center"><div style="font-size:40px;margin-bottom:8px">&#128269;</div><div>No results found</div></div>';
	const items = notes.map(n =>
		mobileNoteRow(n, `window._pendingNoteSearchTerm=((document.getElementById('mobile-search-input')||{}).value||'').trim();mobilePushEditor(${escapeHtml(JSON.stringify(n.id))},${escapeHtml(JSON.stringify(n.parentId || ''))})`, viewerUserId)
	).join('');
	if (!hasMore) return items;
	const loadMore = `<button class="notelist-load-more" style="padding:12px 16px"
		hx-get="/fragments/mobile/search?q=${encodeURIComponent(query)}&offset=${nextOffset}"
		hx-target="#mobile-search-results"
		hx-swap="beforeend"
		hx-on::after-request="this.remove()">Load more results&hellip;</button>`;
	return items + loadMore;
};

module.exports = { mobileFoldersFragment, mobileNotesFragment, mobileSearchFragment };
