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
		const vaultIcon = f.isVault ? `<span role="button" tabindex="0" class="vault-folder-lock btn-icon-sm mobile-vault-folder-lock" data-folder-id="${escapeHtml(f.id)}" title="Lock vault" onclick="event.preventDefault();event.stopPropagation();toggleVaultLock('${escapeHtml(f.id)}')">${svgLockClosed}</span>` : '';
		return `<button class="mobile-folder-row" onclick="mobilePushNotes(${escapeHtml(JSON.stringify(f.id))},${escapeHtml(JSON.stringify(f.title || 'Untitled'))})">
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
const mobileNoteRow = (n, onclickJs) => {
	const protectedByVault = !!(n.isEncrypted || n.inVault);
	const lockIcon = protectedByVault ? '<span class="note-lock-icon" data-note-id="' + escapeHtml(n.id) + '">' + svgLockClosed + '</span>' : '';
	return `<button class="mobile-note-row" data-note-id="${escapeHtml(n.id)}" data-note-title="${escapeHtml(n.title || 'Untitled')}"${n.isEncrypted ? ' data-encrypted="1"' : ''}${protectedByVault && n.parentId ? ` data-vault-id="${escapeHtml(n.parentId)}"` : ''} onclick="${onclickJs}">
		${lockIcon}<span class="mobile-note-title">${escapeHtml(stripMarkdownForTitle(n.title || 'Untitled') || 'Untitled')}</span>
		<span class="mobile-note-arrow">&#8250;</span>
	</button>`;
};

const mobileNotesFragment = (notes, folderId, folderTitle, hasMore = false, nextOffset = 0) => {
	if (!notes.length) return '<div class="empty-hint" style="padding:24px 16px;text-align:center"><div style="font-size:40px;margin-bottom:8px">&#128221;</div><div>No notes yet</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">Tap + to create one</div></div>';
	const items = notes.map(n =>
		mobileNoteRow(n, `mobilePushEditor(${escapeHtml(JSON.stringify(n.id))},${escapeHtml(JSON.stringify(folderId))})`)
	).join('');
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
	const items = notes.map(n =>
		mobileNoteRow(n, `window._pendingNoteSearchTerm=((document.getElementById('mobile-search-input')||{}).value||'').trim();mobilePushEditor(${escapeHtml(JSON.stringify(n.id))},${escapeHtml(JSON.stringify(n.parentId || ''))})`)
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
