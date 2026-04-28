'use strict';

const { NOTE_PAGE_SIZE, VIRTUAL_ALL_NOTES_ID, VIRTUAL_TRASH_ID } = require('../items/itemService');
const {
	parseBody, TRASH_FOLDER_ID, ALL_NOTES_FOLDER_ID, selectedFolderForNav,
	mapNavNotes, nextConflictCopyTitle, navPanelOob, rebuildNavOob,
} = require('./_helpers');
const templates = require('../templates');

const editorPanelOob = html => `<div id="editor-panel" hx-swap-oob="innerHTML">${html}</div>`;
const editorEmpty = () => editorPanelOob('<div class="editor-empty">Select a note</div>');

const moveFolderNotesToGeneral = async (userId, sessionId, folderId, itemService, itemWriteService, requestContext) => {
	const sourceFolder = await itemService.folderByUserIdAndJopId(userId, folderId);
	if (!sourceFolder) {
		const error = new Error('Notebook not found.');
		error.statusCode = 404;
		throw error;
	}
	let generalFolder = (await itemService.foldersByUserId(userId)).find(f => !f.deletedTime && f.id !== folderId && f.title === 'General');
	if (!generalFolder) {
		const created = await itemWriteService.createFolder(sessionId, { title: 'General', parentId: '' }, requestContext);
		generalFolder = { id: created.id, title: 'General' };
	}
	const notes = await itemService.notesByUserId(userId, { folderId });
	for (const note of notes) {
		await itemWriteService.updateNote(sessionId, note, { parentId: generalFolder.id }, requestContext);
	}
	return { sourceFolder, generalFolder, movedCount: notes.length };
};

const handle = async (url, request, response, ctx) => {
	const { sendHtml, authenticatedUser, itemService, itemWriteService,
		historyService, upstreamRequestContext, navData, userSettings, saveLastNoteState,
		plainNoteTitle, vaultService } = ctx;

	// Helper: enrich a note with vault info from its parent folder
	const enrichNoteWithVault = async (userId, note, folders) => {
		if (!note || !vaultService) return note;
		const vault = await vaultService.getVaultByFolderId(userId, note.parentId).catch(() => null);
		if (!vault) return note;
		const folder = (folders || []).find(f => f.id === note.parentId);
		return {
			...note,
			inVault: true,
			// Notes inside a vault folder must be treated as vault-protected even if an
			// older plaintext body still exists. Client code will either prompt for unlock
			// or, if the vault is already unlocked, immediately encrypt and save it.
			isEncrypted: true,
			vaultId: vault.folderId,
			vaultTitle: folder ? folder.title : '',
		};
	};

	const markNotesInVaults = async (userId, notes) => {
		if (!vaultService || !notes || !notes.length) return notes;
		const vaultFolderIds = await vaultService.getVaultFolderIdSet(userId).catch(() => new Set());
		if (!vaultFolderIds.size) return notes;
		return notes.map(note => vaultFolderIds.has(note.parentId) ? { ...note, inVault: true } : note);
	};

	// POST /fragments/folders
	if (url.pathname === '/fragments/folders' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const body = await parseBody(request);
			const title = `${body.title || ''}`.trim();
			if (!title) { sendHtml(response, 400, '<div class="empty-hint">Folder title is required.</div>'); return true; }
			await itemWriteService.createFolder(auth.user.sessionId, { title, parentId: body.parentId || '' }, upstreamRequestContext(request));
			const { folders: fFolders, counts: fCounts } = await navData(auth.user.id);
			sendHtml(response, 200, templates.navigationFragment(fFolders, fCounts, '', '') + templates.folderSelectOob(fFolders));
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// DELETE /fragments/folders/:id
	if (url.pathname.startsWith('/fragments/folders/') && request.method === 'DELETE') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const folderId = decodeURIComponent(url.pathname.slice('/fragments/folders/'.length));
			await moveFolderNotesToGeneral(auth.user.id, auth.user.sessionId, folderId, itemService, itemWriteService, upstreamRequestContext(request));
			await itemWriteService.deleteFolder(auth.user.sessionId, folderId, upstreamRequestContext(request));
			const { folders: dfFolders, counts: dfCounts } = await navData(auth.user.id);
			sendHtml(response, 200, templates.navigationFragment(dfFolders, dfCounts, '', '') + templates.folderSelectOob(dfFolders));
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// PUT /fragments/folders/:id
	if (url.pathname.startsWith('/fragments/folders/') && request.method === 'PUT') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const folderId = decodeURIComponent(url.pathname.slice('/fragments/folders/'.length));
			const body = await parseBody(request);
			const title = `${body.title || ''}`.trim();
			if (!folderId) { sendHtml(response, 404, '<div class="empty-hint">Folder not found.</div>'); return true; }
			if (!title) { sendHtml(response, 400, '<div class="empty-hint">Folder title is required.</div>'); return true; }
			const existingFolder = await itemService.folderByUserIdAndJopId(auth.user.id, folderId);
			if (!existingFolder) { sendHtml(response, 404, '<div class="empty-hint">Folder not found.</div>'); return true; }
			await itemWriteService.updateFolder(auth.user.sessionId, existingFolder, { title }, upstreamRequestContext(request));
			const { folders: ufFolders, counts: ufCounts } = await navData(auth.user.id);
			sendHtml(response, 200, templates.navigationFragment(ufFolders, ufCounts, folderId, '') + templates.folderSelectOob(ufFolders));
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// GET /fragments/nav
	if (url.pathname === '/fragments/nav' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const rawQuery = url.searchParams.get('q') || '';
			const query = rawQuery.trim();
			const data = await navData(auth.user.id);
			const notesOrCounts = query ? mapNavNotes(await itemService.searchNotes(auth.user.id, query)) : data.counts;
			// /fragments/nav returns the fragment directly (not OOB), so use navigationFragment
			sendHtml(response, 200, templates.navigationFragment(data.folders, notesOrCounts, '', '', rawQuery));
		} catch (error) {
			sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// GET /fragments/folder-notes
	if (url.pathname === '/fragments/folder-notes' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const folderId = url.searchParams.get('folderId') || '__all__';
			const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
			const selectedNoteId = url.searchParams.get('selectedNoteId') || '';
			const normalizedFolderId = (folderId === ALL_NOTES_FOLDER_ID) ? VIRTUAL_ALL_NOTES_ID : (folderId === TRASH_FOLDER_ID ? VIRTUAL_TRASH_ID : folderId);
			const notes = await itemService.noteHeadersByFolder(auth.user.id, normalizedFolderId, NOTE_PAGE_SIZE, offset);
			const enrichedNotes = await markNotesInVaults(auth.user.id, notes);
			const counts = await itemService.folderNoteCountsByUserId(auth.user.id);
			const virtualId = normalizedFolderId === VIRTUAL_ALL_NOTES_ID ? VIRTUAL_ALL_NOTES_ID : (normalizedFolderId === VIRTUAL_TRASH_ID ? VIRTUAL_TRASH_ID : normalizedFolderId);
			const totalCount = counts.get(virtualId) || counts.get(normalizedFolderId) || 0;
			const hasMore = offset + notes.length < totalCount;
			const contextFolderId = normalizedFolderId === VIRTUAL_ALL_NOTES_ID ? VIRTUAL_ALL_NOTES_ID : normalizedFolderId;
			sendHtml(response, 200, templates.folderNotesPageFragment(enrichedNotes, contextFolderId, selectedNoteId, hasMore, offset + notes.length, totalCount));
		} catch (error) {
			sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// POST /fragments/notes
	if (url.pathname === '/fragments/notes' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const body = await parseBody(request);
			const parentId = `${body.parentId || ''}`;
			const currentFolderId = `${body.currentFolderId || parentId || ''}`;
			if (!parentId) { sendHtml(response, 400, '<div class="empty-hint">Select a folder first.</div>'); return true; }
			const created = await itemWriteService.createNote(auth.user.sessionId, {
				title: `${body.title || ''}`.trim() || 'Untitled note',
				body: '',
				parentId,
			}, upstreamRequestContext(request));
			const [{ folders, counts }, rawNote] = await Promise.all([
				navData(auth.user.id),
				itemService.noteByUserIdAndJopId(auth.user.id, created.id),
			]);
			const note = rawNote ? await enrichNoteWithVault(auth.user.id, rawNote, folders) : rawNote;
			// Override parentId: DB may not reflect it yet due to Joplin Server async processing
			if (note && parentId) note.parentId = parentId;
			const selFolder = selectedFolderForNav(currentFolderId);
			sendHtml(response, 200,
				`${templates.navigationFragment(folders, counts, selFolder, created.id, '', selFolder)}` +
				editorPanelOob(templates.editorFragment(note, folders, selFolder))
			);
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// POST /fragments/notes/in-general
	if (url.pathname === '/fragments/notes/in-general' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const folders = await itemService.foldersByUserId(auth.user.id);
			let general = folders.find(f => !f.deletedTime && f.title === 'General');
			if (!general) {
				const created = await itemWriteService.createFolder(auth.user.sessionId, { title: 'General', parentId: '' }, upstreamRequestContext(request));
				general = { id: created.id, title: 'General' };
			}
			const created = await itemWriteService.createNote(auth.user.sessionId, {
				title: 'Untitled note',
				body: '',
				parentId: general.id,
			}, upstreamRequestContext(request));
			const [{ folders: navFolders, counts }, rawNote] = await Promise.all([
				navData(auth.user.id),
				itemService.noteByUserIdAndJopId(auth.user.id, created.id),
			]);
			const note = rawNote ? await enrichNoteWithVault(auth.user.id, rawNote, navFolders) : rawNote;
			// Override parentId: DB may not reflect it yet due to Joplin Server async processing
			if (note) note.parentId = general.id;
			const selFolder = selectedFolderForNav(general.id);
			sendHtml(response, 200,
				`${templates.navigationFragment(navFolders, counts, selFolder, created.id, '', selFolder)}` +
				editorPanelOob(templates.editorFragment(note, navFolders, selFolder))
			);
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// DELETE /fragments/notes/:id (not /fragments/editor/)
	if (url.pathname.startsWith('/fragments/notes/') && !url.pathname.startsWith('/fragments/editor/') && request.method === 'DELETE') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const noteId = decodeURIComponent(url.pathname.slice('/fragments/notes/'.length));
			let existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
			if (!existing) existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'only' });
			if (!existing) { sendHtml(response, 404, '<div class="empty-hint">Note not found.</div>'); return true; }
			if (existing.deletedTime) {
				await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
			} else {
				await itemWriteService.trashNote(auth.user.sessionId, existing, upstreamRequestContext(request));
			}
			const { folders, counts } = await navData(auth.user.id);
			sendHtml(response, 200,
				templates.navigationFragment(folders, counts, TRASH_FOLDER_ID, '') +
				editorEmpty()
			);
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// POST /fragments/notes/:id/restore
	if (url.pathname.startsWith('/fragments/notes/') && url.pathname.endsWith('/restore') && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const noteId = decodeURIComponent(url.pathname.slice('/fragments/notes/'.length, -'/restore'.length));
			const [existing, folders] = await Promise.all([
				itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'only' }),
				itemService.foldersByUserId(auth.user.id),
			]);
			if (!existing) { sendHtml(response, 404, '<div class="empty-hint">Note not found.</div>'); return true; }
			let restoreParentId = existing.parentId;
			if (!folders.find(f => f.id === restoreParentId)) {
				if (folders.length) {
					restoreParentId = folders[0].id;
				} else {
					const createdFolder = await itemWriteService.createFolder(auth.user.sessionId, { title: 'Restored items', parentId: '' }, upstreamRequestContext(request));
					restoreParentId = createdFolder.id;
				}
			}
			await itemWriteService.restoreNote(auth.user.sessionId, existing, restoreParentId, upstreamRequestContext(request));
			const [{ folders: navFolders, counts }, restoredNote] = await Promise.all([
				navData(auth.user.id),
				itemService.noteByUserIdAndJopId(auth.user.id, noteId),
			]);
			sendHtml(response, 200,
				`${templates.navigationFragment(navFolders, counts, restoreParentId, noteId, '', restoreParentId)}` +
				editorPanelOob(templates.editorFragment(restoredNote, navFolders))
			);
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// POST /fragments/trash/empty
	if (url.pathname === '/fragments/trash/empty' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const trashedNotes = await itemService.noteHeadersByUserId(auth.user.id, { deleted: 'only' });
			for (const note of trashedNotes) {
				await itemWriteService.deleteNote(auth.user.sessionId, note.id, upstreamRequestContext(request));
			}
			const { folders, counts } = await navData(auth.user.id);
			sendHtml(response, 200,
				templates.navigationFragment(folders, counts, '', '') +
				editorEmpty()
			);
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// POST /fragments/preview
	if (url.pathname === '/fragments/preview' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div>Session expired</div>'); return true; }
			const body = await parseBody(request);
			sendHtml(response, 200, templates.renderMarkdown(body.body || ''));
		} catch {
			sendHtml(response, 500, '<div>Preview error</div>');
		}
		return true;
	}

	// GET /fragments/search
	if (url.pathname === '/fragments/search' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const query = url.searchParams.get('q') || '';
			if (!query.trim()) { sendHtml(response, 200, ''); return true; }
			const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
			const notes = await itemService.searchNotes(auth.user.id, query, 50, offset);
			const enrichedNotes = await markNotesInVaults(auth.user.id, notes);
			const hasMore = notes.length === 50;
			sendHtml(response, 200, templates.searchResultsFragment(enrichedNotes, hasMore, offset + notes.length, query));
		} catch {
			sendHtml(response, 500, '<div class="empty-hint">Search error</div>');
		}
		return true;
	}

	// GET /fragments/editor/:id
	if (url.pathname.startsWith('/fragments/editor/') && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="editor-empty">Session expired.</div>'); return true; }
			const noteId = decodeURIComponent(url.pathname.slice('/fragments/editor/'.length));
			const currentFolderId = url.searchParams.get('currentFolderId') || '';
			const currentSettings = await userSettings(auth.user.id);
			const [note, folders] = await Promise.all([
				itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'all' }),
				itemService.foldersByUserId(auth.user.id),
			]);
			if (!note) { sendHtml(response, 404, '<div class="editor-empty">Note not found.</div>'); return true; }
			const enrichedNote = await enrichNoteWithVault(auth.user.id, note, folders);
			await saveLastNoteState(auth.user.id, currentSettings, note.id, currentFolderId || note.parentId);
			sendHtml(response, 200, templates.editorFragment(enrichedNote, folders, currentFolderId || note.parentId));
		} catch {
			sendHtml(response, 500, '<div class="editor-empty">Error</div>');
		}
		return true;
	}

	// PUT /fragments/editor/:id
	if (url.pathname.startsWith('/fragments/editor/') && request.method === 'PUT') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<span class="autosave-error">Session expired</span>'); return true; }
			const noteId = decodeURIComponent(url.pathname.slice('/fragments/editor/'.length));
			const body = await parseBody(request);
			const currentSettings = await userSettings(auth.user.id);
			const baseUpdatedTime = Number(body.baseUpdatedTime || 0);
			const forceSave = `${body.forceSave || ''}` === '1';
			const createCopy = `${body.createCopy || ''}` === '1';
			let existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
			if (!existing) existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'only' });
			if (!existing) { sendHtml(response, 404, '<span class="autosave-error">Note not found</span>'); return true; }
			const currentFolderId = `${body.currentFolderId || body.parentId || existing.parentId || ''}`;
			if (createCopy) {
				const parentFolderId = body.parentId || existing.parentId || '';
				const [{ folders, counts }, siblingNotes] = await Promise.all([
					navData(auth.user.id),
					itemService.noteHeadersByFolder(auth.user.id, parentFolderId || '__all__', 500, 0),
				]);
				const copyTitle = nextConflictCopyTitle(plainNoteTitle(body.title), siblingNotes.map(n => n.title));
				const created = await itemWriteService.createNote(auth.user.sessionId, {
					title: copyTitle,
					body: body.body,
					parentId: parentFolderId,
				}, upstreamRequestContext(request));
				const rawCreatedNote = await itemService.noteByUserIdAndJopId(auth.user.id, created.id);
				const createdNote = rawCreatedNote ? await enrichNoteWithVault(auth.user.id, rawCreatedNote, folders) : rawCreatedNote;
				// Override parentId: DB may not reflect it yet due to Joplin Server async processing
				if (createdNote && parentFolderId) createdNote.parentId = parentFolderId;
				await saveLastNoteState(auth.user.id, currentSettings, created.id, currentFolderId || (createdNote && createdNote.parentId) || parentFolderId);
				const selFolder = selectedFolderForNav(currentFolderId);
				sendHtml(response, 200,
					`${templates.autosaveStatusFragment()}` +
					navPanelOob(templates.navigationFragment(folders, counts, selFolder, created.id, '', selFolder)) +
					editorPanelOob(templates.editorFragment(createdNote, folders, selFolder))
				);
				return true;
			}
			if (!forceSave && baseUpdatedTime && Number(existing.updatedTime || 0) !== baseUpdatedTime) {
				sendHtml(response, 200, templates.autosaveConflictFragment(noteId));
				return true;
			}
			await itemWriteService.updateNote(auth.user.sessionId, existing, {
				title: plainNoteTitle(body.title),
				body: body.body,
				parentId: body.parentId,
			}, upstreamRequestContext(request));
			if (historyService) {
				historyService.saveSnapshot(auth.user.id, noteId, existing.title, existing.body).catch(() => {});
			}
			const refreshed = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
			await saveLastNoteState(auth.user.id, currentSettings, noteId, currentFolderId || (refreshed && refreshed.parentId) || body.parentId || existing.parentId);
			const titleChanged = plainNoteTitle(body.title) !== `${existing.title || ''}`;
			const folderChanged = `${body.parentId || ''}` !== `${existing.parentId || ''}`;
			let navOob = '';
			if (titleChanged || folderChanged) {
				navOob = await rebuildNavOob(navData, auth.user.id, currentFolderId, noteId);
			}
			sendHtml(response, 200,
				`${templates.autosaveStatusFragment()}${navOob}` +
				`${templates.noteSyncStateFragment(refreshed || existing).replace('<span id="editor-sync-state">', '<span id="editor-sync-state" hx-swap-oob="outerHTML">')}` +
				`${templates.noteMetaFragment(refreshed || existing).replace('<span id="note-meta"', '<span id="note-meta" hx-swap-oob="outerHTML"')}`
			);
		} catch (error) {
			sendHtml(response, error.statusCode || 500, '<span class="autosave-error">Save failed</span>');
		}
		return true;
	}

	return false;
};

module.exports = { handle };
