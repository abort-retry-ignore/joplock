'use strict';

const { NOTE_PAGE_SIZE } = require('../items/itemService');
const { parseBody, TRASH_FOLDER_ID } = require('./_helpers');
const templates = require('../templates');

const handle = async (url, request, response, ctx) => {
	const { sendHtml, authenticatedUser, itemService, itemWriteService, upstreamRequestContext } = ctx;

	// GET /fragments/mobile/folders
	if (url.pathname === '/fragments/mobile/folders' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const [folders, counts] = await Promise.all([
				itemService.foldersByUserId(auth.user.id),
				itemService.folderNoteCountsByUserId(auth.user.id),
			]);
			sendHtml(response, 200, templates.mobileFoldersFragment(folders, counts));
		} catch {
			sendHtml(response, 500, '<div class="empty-hint">Error</div>');
		}
		return true;
	}

	// GET /fragments/mobile/notes
	if (url.pathname === '/fragments/mobile/notes' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const folderId = url.searchParams.get('folderId') || '__all__';
			const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
			const notes = await itemService.noteHeadersByFolder(auth.user.id, folderId, NOTE_PAGE_SIZE, offset);
			const counts = await itemService.folderNoteCountsByUserId(auth.user.id);
			const totalCount = counts.get(folderId) || counts.get('__all__') || 0;
			const hasMore = offset + notes.length < totalCount;
			sendHtml(response, 200, templates.mobileNotesFragment(notes, folderId, '', hasMore, offset + notes.length));
		} catch {
			sendHtml(response, 500, '<div class="empty-hint">Error</div>');
		}
		return true;
	}

	// POST /fragments/mobile/notes/new
	if (url.pathname === '/fragments/mobile/notes/new' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const body = await parseBody(request);
			let folderId = body.folderId || '';
			if (!folderId || folderId === '__all__') {
				const folders = await itemService.foldersByUserId(auth.user.id);
				const real = folders.filter(f => !f.isVirtualAllNotes && f.id !== TRASH_FOLDER_ID);
				let general = real.find(f => (f.title || '').toLowerCase() === 'general');
				if (!general) general = real[0];
				if (general) folderId = general.id;
			}
			const note = await itemWriteService.createNote(auth.user.sessionId, {
				title: 'Untitled note',
				body: '',
				parentId: folderId,
			}, upstreamRequestContext(request));
			const notes = await itemService.noteHeadersByFolder(auth.user.id, folderId || '__all__', NOTE_PAGE_SIZE, 0);
			const counts = await itemService.folderNoteCountsByUserId(auth.user.id);
			const totalCount = folderId && folderId !== '__all__' ? (counts.get(folderId) || 0) : (counts.get('__all__') || 0);
			const hasMore = notes.length < totalCount;
			response.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8',
				'X-Mobile-Note-Id': note.id || '',
			});
			response.end(templates.mobileNotesFragment(notes, folderId, '', hasMore, notes.length));
		} catch (error) {
			console.error('[mobile] notes/new error:', error);
			sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error && (error.message || `${error}`) || 'creating note')}</div>`);
		}
		return true;
	}

	// GET /fragments/mobile/search
	if (url.pathname === '/fragments/mobile/search' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const query = url.searchParams.get('q') || '';
			const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
			const notes = query ? await itemService.searchNotes(auth.user.id, query, 50, offset) : [];
			const hasMore = notes.length === 50;
			sendHtml(response, 200, templates.mobileSearchFragment(notes, hasMore, offset + notes.length, query));
		} catch {
			sendHtml(response, 500, '<div class="empty-hint">Search error</div>');
		}
		return true;
	}

	return false;
};

module.exports = { handle };
