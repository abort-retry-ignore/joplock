'use strict';

/**
 * shareProxyGuard.js
 *
 * Phase 1: blocks non-owner writes to shared items. Items with non-empty
 * share_id where items.owner_id !== userId are rejected with 403.
 *
 * Reuses parsing utilities from vaultProxyGuard.
 */

const { MODEL_TYPE_NOTE } = require('../items/itemService');
const { resolveItemShareAccess } = require('../items/shareAccess');
const {
	shouldInspect,
	parseJoplinItem,
	noteIdFromItemPath,
	bufferRequest,
	extractMultipartFile,
	BUFFER_CAP_BYTES,
} = require('./vaultProxyGuard');

const inspectAndGuard = async (request, strippedPathname, ctx) => {
	const { itemService, authenticatedUser, log } = ctx;
	const method = request.method.toUpperCase();

	if (!shouldInspect(method, strippedPathname)) {
		return { action: 'stream' };
	}

	let userId;
	try {
		const auth = await authenticatedUser(request, { isHeartbeat: true });
		if (!auth || !auth.user) return { action: 'stream' };
		userId = auth.user.id;
	} catch {
		return { action: 'stream' };
	}

	// PUT /api/items/root:/<id>.md:/content — single note write (multipart)
	if (method === 'PUT' && /^\/api\/items\/root:\/[^/]+\.md:\/content$/.test(strippedPathname)) {
		const { buffer, overCap } = await bufferRequest(request);
		if (overCap) return { action: 'stream' };

		const contentType = request.headers['content-type'] || '';
		const fileData = extractMultipartFile(buffer, contentType);
		if (!fileData) return { action: 'allow', buffer };

		const itemText = fileData.toString('utf8');
		const parsed = parseJoplinItem(itemText);
		if (!parsed) return { action: 'allow', buffer };

		const typeNum = parseInt(parsed.meta.type_ || '0', 10);
		if (typeNum !== MODEL_TYPE_NOTE) return { action: 'allow', buffer };

		const shareId = (parsed.meta.share_id || '').trim();
		const itemId = parsed.meta.id || noteIdFromItemPath(strippedPathname);

		if (shareId && itemId) {
			const existing = await itemService.noteByUserIdAndJopId(userId, itemId).catch(() => null);

			if (!existing) {
				// New note — check if parent folder is shared
				const parentId = parsed.meta.parent_id || '';
				if (parentId) {
					const parent = await itemService.folderByUserIdAndJopId(userId, parentId).catch(() => null);
					if (parent && parent.shareId && parent.ownerId !== userId) {
						let canWrite = false;
						if (itemService.database) {
							const su = await itemService.database.query(
								`SELECT can_write FROM share_users WHERE share_id = $1 AND user_id = $2 AND status = 1 LIMIT 1`,
								[parent.shareId, userId],
							).catch(() => ({ rows: [] }));
							if (su.rows && su.rows[0]) canWrite = !!(Number(su.rows[0].can_write));
						}
						if (!canWrite) {
							log(`share proxy guard: blocked new note in shared folder ${parentId}`);
							return { action: 'reject', status: 403, message: 'Shared items are read-only' };
						}
					}
				}
				return { action: 'allow', buffer };
			}

			if (existing.shareId && existing.ownerId !== userId) {
				const access = await resolveItemShareAccess(itemService, userId, itemId).catch(() => null);
				if (access && !access.canWrite) {
					log(`share proxy guard: blocked PUT ${strippedPathname} (shared, no write permission)`);
					return { action: 'reject', status: 403, message: 'Shared items are read-only' };
				}
			}
		}

		return { action: 'allow', buffer };
	}

	// PUT /api/batch_items — batch note writes
	if (method === 'PUT' && strippedPathname === '/api/batch_items') {
		const { buffer, overCap } = await bufferRequest(request);
		if (overCap) return { action: 'stream' };

		let batchItems;
		try {
			const parsed = JSON.parse(buffer.toString('utf8'));
			batchItems = Array.isArray(parsed.items) ? parsed.items : [];
		} catch {
			return { action: 'allow', buffer };
		}

		for (const batchItem of batchItems) {
			const noteId = noteIdFromItemPath(batchItem.name || '');
			if (!noteId) continue;

			const itemText = typeof batchItem.body === 'string' ? batchItem.body : '';
			const parsed = parseJoplinItem(itemText);
			if (!parsed) continue;

			const typeNum = parseInt(parsed.meta.type_ || '0', 10);
			if (typeNum !== MODEL_TYPE_NOTE) continue;

			const shareId = (parsed.meta.share_id || '').trim();
			if (!shareId) continue;

			const existing = await itemService.noteByUserIdAndJopId(userId, noteId).catch(() => null);
			if (existing && existing.shareId && existing.ownerId !== userId) {
				const access = await resolveItemShareAccess(itemService, userId, noteId).catch(() => null);
				if (access && !access.canWrite) {
					log(`share proxy guard: blocked batch PUT item ${batchItem.name}`);
					return { action: 'reject', status: 403, message: 'Shared items are read-only' };
				}
			}
		}

		return { action: 'allow', buffer };
	}

	// DELETE /api/items/root:/<id>.md: — single note delete
	if (method === 'DELETE' && /^\/api\/items\/root:\/[^/]+\.md:$/.test(strippedPathname)) {
		const noteId = noteIdFromItemPath(strippedPathname);
		if (noteId) {
			const existing = await itemService.noteByUserIdAndJopId(userId, noteId, { deleted: 'all' }).catch(() => null);
			if (existing && existing.shareId && existing.ownerId && existing.ownerId !== userId) {
				// DELETE: always owner-only regardless of can_write
				log(`share proxy guard: blocked DELETE ${strippedPathname} (shared, non-owner)`);
				return { action: 'reject', status: 403, message: 'Only the owner can delete this item' };
			}
		}
		return { action: 'allow', buffer: null };
	}

	// DELETE /api/batch_items — batch note deletes
	if (method === 'DELETE' && strippedPathname === '/api/batch_items') {
		const { buffer, overCap } = await bufferRequest(request);
		if (overCap) return { action: 'stream' };

		let items;
		try {
			const parsed = JSON.parse(buffer.toString('utf8'));
			items = Array.isArray(parsed.items) ? parsed.items : [];
		} catch {
			return { action: 'allow', buffer };
		}

		for (const itemName of items) {
			const noteId = noteIdFromItemPath(itemName);
			if (!noteId) continue;
			const existing = await itemService.noteByUserIdAndJopId(userId, noteId, { deleted: 'all' }).catch(() => null);
			if (existing && existing.shareId && existing.ownerId && existing.ownerId !== userId) {
				log(`share proxy guard: blocked batch DELETE item ${itemName} (shared, non-owner)`);
				return { action: 'reject', status: 403, message: 'Only the owner can delete this item' };
			}
		}

		return { action: 'allow', buffer };
	}

	// DELETE paths: stream through — Joplin Server handles permission
	return { action: 'stream' };
};

module.exports = { inspectAndGuard, BUFFER_CAP_BYTES };
