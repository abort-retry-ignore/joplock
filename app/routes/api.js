'use strict';

const { sendJson, parseBody, normalizeStoredFolderId } = require('./_helpers');
const templates = require('../templates');

const notesForFolder = async (itemService, userId, folderId) => {
	const { VIRTUAL_ALL_NOTES_ID, VIRTUAL_TRASH_ID } = require('../items/itemService');
	const ALL_NOTES_FOLDER_ID = '__all_notes__';
	const TRASH_FOLDER_ID = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';
	if (!folderId || folderId === ALL_NOTES_FOLDER_ID) return itemService.notesByUserId(userId);
	if (folderId === TRASH_FOLDER_ID) return itemService.notesByUserId(userId, { deleted: 'only' });
	return itemService.notesByUserId(userId, { folderId });
};

const handle = async (url, request, response, ctx) => {
	const { authenticatedUser, itemService, itemWriteService, settingsService, upstreamRequestContext, plainNoteTitle } = ctx;

	// PUT /api/web/settings
	if (url.pathname === '/api/web/settings' && request.method === 'PUT') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) { response.writeHead(401); response.end(); return true; }
			const body = await parseBody(request);
			const current = await settingsService.settingsByUserId(auth.user.id);
			const updates = {};
			const allowedKeys = ['theme', 'noteFontSize', 'mobileNoteFontSize', 'codeFontSize', 'noteMonospace', 'noteOpenMode', 'resumeLastNote', 'dateFormat', 'datetimeFormat', 'liveSearch', 'confirmTrash'];
			for (const key of allowedKeys) {
				if (body[key] !== undefined) updates[key] = body[key];
			}
			if (Object.keys(updates).length > 0) {
				await settingsService.saveSettings(auth.user.id, { ...current, ...updates });
			}
			response.writeHead(204);
			response.end();
		} catch {
			response.writeHead(500);
			response.end();
		}
		return true;
	}

	// PUT /api/web/theme (legacy)
	if (url.pathname === '/api/web/theme' && request.method === 'PUT') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) { response.writeHead(401); response.end(); return true; }
			const body = await parseBody(request);
			const current = await settingsService.settingsByUserId(auth.user.id);
			await settingsService.saveSettings(auth.user.id, { ...current, theme: body.theme });
			response.writeHead(204);
			response.end();
		} catch {
			response.writeHead(500);
			response.end();
		}
		return true;
	}

	// GET /api/web/me
	if (url.pathname === '/api/web/me') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			sendJson(response, 200, { user: auth.user });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// /api/web/folders
	if (url.pathname === '/api/web/folders') {
		if (request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				const body = await parseBody(request);
				const title = `${body.title || ''}`.trim();
				if (!title) { sendJson(response, 400, { error: 'Folder title is required' }); return true; }
				const created = await itemWriteService.createFolder(auth.user.sessionId, { title, parentId: body.parentId || '' }, upstreamRequestContext(request));
				const folder = await itemService.folderByUserIdAndJopId(auth.user.id, created.id);
				sendJson(response, 201, { item: folder });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folders = await itemService.foldersByUserId(auth.user.id);
			sendJson(response, 200, { items: folders });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// DELETE /api/web/folders/:id
	if (url.pathname.startsWith('/api/web/folders/') && request.method === 'DELETE') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folderId = decodeURIComponent(url.pathname.slice('/api/web/folders/'.length));
			if (!folderId) { sendJson(response, 404, { error: 'Folder not found' }); return true; }
			await itemWriteService.deleteFolder(auth.user.sessionId, folderId, upstreamRequestContext(request));
			sendJson(response, 204, {});
		} catch (error) {
			sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// /api/web/notes
	if (url.pathname === '/api/web/notes') {
		if (request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				const body = await parseBody(request);
				const parentId = `${body.parentId || ''}`;
				if (!parentId) { sendJson(response, 400, { error: 'Note parentId is required' }); return true; }
				const created = await itemWriteService.createNote(auth.user.sessionId, {
					title: plainNoteTitle(body.title),
					body: `${body.body || ''}`,
					parentId,
				}, upstreamRequestContext(request));
				const note = await itemService.noteByUserIdAndJopId(auth.user.id, created.id);
				sendJson(response, 201, { item: note });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folderId = url.searchParams.get('folderId') || '';
			const notes = await notesForFolder(itemService, auth.user.id, folderId);
			sendJson(response, 200, { items: notes });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// /api/web/notes/:id
	if (url.pathname.startsWith('/api/web/notes/')) {
		const noteId = decodeURIComponent(url.pathname.slice('/api/web/notes/'.length));
		if (request.method === 'PUT') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return true; }
				const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!existing) { sendJson(response, 404, { error: 'Note not found' }); return true; }
				const body = await parseBody(request);
				const updated = await itemWriteService.updateNote(auth.user.sessionId, existing, {
					title: plainNoteTitle(body.title), body: body.body, parentId: body.parentId,
				}, upstreamRequestContext(request));
				const note = await itemService.noteByUserIdAndJopId(auth.user.id, updated.id);
				sendJson(response, 200, { item: note });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		if (request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return true; }
				await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
				sendJson(response, 204, {});
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return true; }
			const note = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
			if (!note) { sendJson(response, 404, { error: 'Note not found' }); return true; }
			sendJson(response, 200, { item: note });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	return false;
};

module.exports = { handle };
