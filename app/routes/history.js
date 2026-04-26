'use strict';

const { parseBody, TRASH_FOLDER_ID, selectedFolderForNav, navPanelOob } = require('./_helpers');
const templates = require('../templates');

const handle = async (url, request, response, ctx) => {
	const { sendHtml, authenticatedUser, historyService, itemService, itemWriteService,
		upstreamRequestContext, navData } = ctx;

	// GET /fragments/history/:noteId (no /restore/)
	if (url.pathname.startsWith('/fragments/history/') && !url.pathname.includes('/restore/') && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const noteId = decodeURIComponent(url.pathname.slice('/fragments/history/'.length));
			const snapshots = historyService ? await historyService.listSnapshots(noteId) : [];
			sendHtml(response, 200, templates.historyModalFragment(noteId, snapshots));
		} catch (error) {
			sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// GET /fragments/history-snapshot/:id
	if (url.pathname.startsWith('/fragments/history-snapshot/') && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return true; }
			const snapshotId = decodeURIComponent(url.pathname.slice('/fragments/history-snapshot/'.length));
			const snapshot = historyService ? await historyService.getSnapshot(snapshotId) : null;
			if (!snapshot) { sendHtml(response, 404, '<div class="empty-hint">Snapshot not found.</div>'); return true; }
			sendHtml(response, 200, templates.historySnapshotPreviewFragment(snapshot));
		} catch (error) {
			sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
		}
		return true;
	}

	// POST /fragments/history/:noteId/restore/:snapshotId
	if (url.pathname.startsWith('/fragments/history/') && url.pathname.includes('/restore/') && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendHtml(response, 401, '<span class="autosave-error">Session expired</span>'); return true; }
			const parts = url.pathname.slice('/fragments/history/'.length).split('/restore/');
			const noteId = decodeURIComponent(parts[0]);
			const snapshotId = decodeURIComponent(parts[1] || '');
			const snapshot = historyService ? await historyService.getSnapshot(snapshotId) : null;
			if (!snapshot || snapshot.noteId !== noteId) { sendHtml(response, 404, '<span class="autosave-error">Snapshot not found</span>'); return true; }
			const body = await parseBody(request);
			const currentFolderId = `${body.currentFolderId || ''}`;
			const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
			if (!existing) { sendHtml(response, 404, '<span class="autosave-error">Note not found</span>'); return true; }
			await itemWriteService.updateNote(auth.user.sessionId, existing, {
				title: snapshot.title,
				body: snapshot.body,
				parentId: existing.parentId,
			}, upstreamRequestContext(request));
			const refreshed = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
			const { folders, counts } = await navData(auth.user.id);
			const selFolder = selectedFolderForNav(currentFolderId || existing.parentId);
			sendHtml(response, 200,
				`${templates.autosaveStatusFragment()}` +
				navPanelOob(templates.navigationFragment(folders, counts, selFolder, noteId, '', selFolder)) +
				`<div id="editor-panel" hx-swap-oob="innerHTML">${templates.editorFragment(refreshed || existing, folders.filter(f => f.id !== TRASH_FOLDER_ID), selFolder)}</div>`
			);
		} catch (error) {
			sendHtml(response, error.statusCode || 500, `<span class="autosave-error">Restore failed: ${templates.escapeHtml(error.message || `${error}`)}</span>`);
		}
		return true;
	}

	return false;
};

module.exports = { handle };
