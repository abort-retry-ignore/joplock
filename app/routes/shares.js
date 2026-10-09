'use strict';

const { randomBytes } = require('crypto');
const { sendJson, parseBody } = require('./_helpers');
const { requestUpstream } = require('../items/itemWriteService');
const { subtreeIds } = require('../items/folderTree');

const STATUS_WAITING = 0;
const STATUS_ACCEPTED = 1;

const upstream = (ctx, sessionId, method, path, body) => {
	const { joplinServerOrigin, joplinServerPublicUrl } = ctx;
	const configuredPublicUrl = new URL(joplinServerPublicUrl);
	const headers = { 'x-api-auth': sessionId };
	if (body) headers['content-type'] = 'application/json';
	return requestUpstream(joplinServerOrigin, {
		method,
		path,
		publicHost: configuredPublicUrl.host,
		publicProtocol: configuredPublicUrl.protocol.replace(':', ''),
		headers,
	}, body ? JSON.stringify(body) : null);
};

const jsonResult = result => {
	const text = result.body.toString('utf8');
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return { error: text || `Upstream ${result.statusCode}` };
	}
};

const sharesList = data => {
	if (Array.isArray(data)) return data;
	if (data && Array.isArray(data.items)) return data.items;
	if (data && Array.isArray(data.shares)) return data.shares;
	return [];
};

const inviteesList = data => {
	if (Array.isArray(data)) return data;
	if (data && Array.isArray(data.items)) return data.items;
	if (data && Array.isArray(data.share_users)) return data.share_users;
	return [];
};

const shareFolderId = share => share && (share.folder_id || share.notebook_id || share.folderId || share.notebookId || '');

// `share_id` of an item.
//
// The authoritative value is the `jop_share_id` COLUMN: Joplin Server moves share_id
// out of the item JSON on every API save, so the JSON copy is absent or stale for any
// item that has been edited. The JSON is only a fallback for items stamped directly in
// the database.
//
// `items` also holds binary resource blobs (jop_type 0, e.g. every uploaded
// image/PDF). Those are not valid UTF-8, so convert_from() raises
// "invalid byte sequence" and aborts the WHOLE statement - and SQL gives no
// guarantee that a sibling `jop_type = ...` predicate runs first. The CASE
// guarantees only note/folder rows are ever decoded. (With an unguarded
// expression every share fan-out / revoke silently did nothing once the
// account owned a single uploaded attachment: the callers swallow errors.)
const shareIdOf = (alias = '') => `(COALESCE(NULLIF(${alias}jop_share_id, ''), CASE WHEN ${alias}jop_type IN (1, 2) THEN convert_from(${alias}content, 'UTF8')::json->>'share_id' END))`;

const newId = () => randomBytes(16).toString('hex');

const autoAcceptShareUser = async (database, shareUserId) => {
	if (!database || !shareUserId) return;
	await database.query(`UPDATE share_users SET status = $1 WHERE id = $2`, [STATUS_ACCEPTED, shareUserId]);
};

// Every notebook at or below `rootFolderId` and every note directly inside any of
// them (trashed notes included: they keep their share membership until purged).
// Notebooks nest, so a share covers the whole subtree, not just direct children.
const collectSubtreeItems = async (itemService, database, ownerId, rootFolderId) => {
	const folders = await itemService.foldersByUserId(ownerId);
	const folderIds = subtreeIds(folders, rootFolderId);
	const result = await database.query(
		`SELECT jop_id FROM items WHERE owner_id = $1 AND jop_type = 1 AND jop_parent_id = ANY($2::text[])`,
		[ownerId, folderIds],
	);
	return { folderIds, noteIds: (result.rows || []).map(r => r.jop_id).filter(Boolean) };
};

// Stamp (or, with shareId '', clear) share_id/is_shared on notes and notebooks.
//
// Written straight into the item JSON because re-serializing a note through the
// sidecar would rewrite fields we do not model. `jop_share_id` is the column the
// Joplin Server share service reads, so it is kept in step with the JSON; if a
// server version lacks the column we fall back to the JSON alone.
const setShareOnItems = async (database, ownerId, itemIds, shareId) => {
	if (!database || !itemIds || !itemIds.length) return;
	const now = Date.now();
	const jsonSet = `convert_to(
		jsonb_set(jsonb_set(convert_from(content,'UTF8')::jsonb, '{share_id}', $2::jsonb), '{is_shared}', $3::jsonb)::text,
		'UTF8'
	)`;
	const shareJson = JSON.stringify(shareId || '');
	const sharedJson = JSON.stringify(shareId ? 1 : 0);
	try {
		await database.query(
			`UPDATE items SET content = ${jsonSet}, jop_share_id = $5, updated_time = $4
			 WHERE jop_id = ANY($1::text[]) AND jop_type IN (1, 2) AND owner_id = $6`,
			[itemIds, shareJson, sharedJson, now, shareId || '', ownerId],
		);
	} catch (error) {
		if (!error || error.code !== '42703') throw error; // undefined_column
		await database.query(
			`UPDATE items SET content = ${jsonSet}, updated_time = $4
			 WHERE jop_id = ANY($1::text[]) AND jop_type IN (1, 2) AND owner_id = $5`,
			[itemIds, shareJson, sharedJson, now, ownerId],
		);
	}
};

const ensureShareIdsOnNotebook = async (ctx, auth, notebookId, shareId) => {
	const { itemService, database } = ctx;
	if (!database) return;
	const folder = await itemService.folderByUserIdAndJopId(auth.user.id, notebookId);
	if (!folder) return;
	const { folderIds, noteIds } = await collectSubtreeItems(itemService, database, auth.user.id, notebookId);
	await setShareOnItems(database, auth.user.id, folderIds.concat(noteIds), shareId);
};

const populateUserItems = async (database, recipientUserId, ownerId, shareId, notebookId) => {
	if (!database || !recipientUserId || !ownerId) return;
	// Discover schema once; fall back quietly if shapes differ.
	const cols = await database.query(`
		SELECT column_name FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'user_items'
	`).catch(() => ({ rows: [] }));
	const colSet = new Set((cols.rows || []).map(r => r.column_name));
	if (!colSet.has('user_id') || !colSet.has('item_id')) return;

	const items = await database.query(`
		SELECT id, jop_id FROM items
		WHERE owner_id = $1
		  AND (
		    jop_id = $2
		    OR jop_parent_id = $2
		    OR COALESCE(${shareIdOf()}, '') = $3
		  )
	`, [ownerId, notebookId, shareId || '']).catch(() => ({ rows: [] }));

	for (const row of items.rows || []) {
		const jopId = row.jop_id;
		if (!jopId) continue;
		const exists = await database.query(
			`SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $2 LIMIT 1`,
			[recipientUserId, jopId],
		).catch(() => ({ rows: [] }));
		if (exists.rows && exists.rows.length) continue;

		const fields = ['user_id', 'item_id'];
		const values = [recipientUserId, jopId];
			if (colSet.has('share_id') && shareId) {
				fields.push('share_id');
				values.push(shareId);
			}
			if (colSet.has('updated_time')) {
				fields.push('updated_time');
				values.push(Date.now());
			}
			if (colSet.has('created_time')) {
				fields.push('created_time');
				values.push(Date.now());
			}
			const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
			await database.query(
				`INSERT INTO user_items (${fields.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
				values,
			).catch(() => null);
	}
};

const acceptedShareUserIds = async (database, shareId) => {
	const result = await database.query(
		`SELECT user_id FROM share_users WHERE share_id = $1 AND status = $2`,
		[shareId, STATUS_ACCEPTED],
	).catch(() => ({ rows: [] }));
	return (result.rows || []).map(r => r.user_id).filter(Boolean);
};

// Give every accepted recipient of the share access to the notebook's items.
const grantRecipientAccess = async (database, ownerId, shareId, rootFolderId) => {
	for (const userId of await acceptedShareUserIds(database, shareId)) {
		await populateUserItems(database, userId, ownerId, shareId, rootFolderId);
	}
};

// Take the given items away from every recipient of the share.
const revokeRecipientAccess = async (database, shareId, itemIds) => {
	if (!database || !shareId || !itemIds || !itemIds.length) return;
	await database.query(
		`DELETE FROM user_items
		 WHERE user_id IN (SELECT user_id FROM share_users WHERE share_id = $1)
		   AND item_id = ANY($2::text[])`,
		[shareId, itemIds],
	);
};

// What folder operations (create/move/delete) call to keep sharing consistent
// when notebooks or notes cross a share boundary. All methods are no-ops without
// a database (unit tests with fakes).
//   shareId          the share the items now belong to ('' = none)
//   previousShareId  the share they belonged to before ('' = none)
const createShareSync = ({ itemService, itemWriteService, database }) => {
	// Re-save every notebook and note of the subtree THROUGH THE API with the new share
	// fields. This is what makes stock Joplin clients follow along: Joplin Server only
	// adds/removes a recipient's copy (and tells their client to delete it) when it
	// sees a change event with previous_share_id, and only API writes create those.
	// Direct database writes are silent, so a subtree moved OUT of a share used to
	// stay in the recipient's Joplin app. Items the API cannot rewrite (Joplin
	// end-to-end encrypted ones) are left to the database stamping below.
	const stampThroughApi = async ({ ownerId, folderIds, noteIds, shareId, sessionId, requestContext }) => {
		if (!itemWriteService || !sessionId) return;
		const fields = { shareId, isShared: !!shareId };
		const skipped = [];
		for (const id of folderIds) {
			const folder = await itemService.folderByUserIdAndJopId(ownerId, id).catch(() => null);
			if (!folder || folder.e2ee || (folder.shareId || '') === shareId) continue;
			try { await itemWriteService.updateFolder(sessionId, folder, fields, requestContext); } catch (error) { skipped.push(error); }
		}
		for (const id of noteIds) {
			const note = await itemService.noteByUserIdAndJopId(ownerId, id, { deleted: 'all' }).catch(() => null);
			if (!note || note.e2ee || (note.shareId || '') === shareId) continue;
			try { await itemWriteService.updateNote(sessionId, note, fields, requestContext); } catch (error) { skipped.push(error); }
		}
		if (skipped.length) throw skipped[0];
	};

	return {
		// A notebook and everything beneath it changes share.
		async setSubtreeShare({ ownerId, folderId, shareId = '', previousShareId = '', sessionId, requestContext }) {
			if (!database) return;
			const { folderIds, noteIds } = await collectSubtreeItems(itemService, database, ownerId, folderId);
			const ids = folderIds.concat(noteIds);
			// API first (it compares against the current share), then the database sweep
			// for anything the API could not write, then Joplock's own recipient rows.
			let apiError = null;
			try {
				await stampThroughApi({ ownerId, folderIds, noteIds, shareId, sessionId, requestContext });
			} catch (error) { apiError = error; }
			await setShareOnItems(database, ownerId, ids, shareId);
			if (previousShareId && previousShareId !== shareId) await revokeRecipientAccess(database, previousShareId, ids);
			if (shareId) await grantRecipientAccess(database, ownerId, shareId, folderId);
			if (apiError) throw apiError;
		},
		// Individual items (e.g. notes moved out of a deleted notebook) change share. The
		// caller has already written them through the API; this keeps Joplock's own
		// recipient rows and the stored JSON in step.
		async setItemsShare({ ownerId, itemIds, shareId = '', previousShareId = '', rootFolderId = '' }) {
			if (!database || !itemIds || !itemIds.length) return;
			await setShareOnItems(database, ownerId, itemIds, shareId);
			if (previousShareId && previousShareId !== shareId) await revokeRecipientAccess(database, previousShareId, itemIds);
			if (shareId) await grantRecipientAccess(database, ownerId, shareId, rootFolderId);
		},
	};
};

const createShareUpstream = async (ctx, sessionId, notebookId) => {
	// Joplin Server has used both folder_id and notebook_id historically.
	let result = await upstream(ctx, sessionId, 'POST', '/api/shares', { folder_id: notebookId });
	if (result.statusCode >= 400) {
		result = await upstream(ctx, sessionId, 'POST', '/api/shares', { notebook_id: notebookId });
	}
	return result;
};

const handle = async (url, request, response, ctx) => {
	const { authenticatedUser, itemService, itemWriteService, folderOps, database, vaultService, upstreamRequestContext } = ctx;
	const p = url.pathname;
	const method = request.method;
	ctx._request = request;

	// POST /api/web/shares — create share for a notebook
	if (p === '/api/web/shares' && method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const body = await parseBody(request);
			const notebookId = `${body.notebookId || body.folderId || ''}`.trim();
			if (!notebookId) { sendJson(response, 400, { error: 'notebookId is required' }); return true; }

			const folder = await itemService.folderByUserIdAndJopId(auth.user.id, notebookId);
			if (!folder) { sendJson(response, 404, { error: 'Notebook not found' }); return true; }
			if (vaultService) {
				const vault = await vaultService.getVaultByFolderId(auth.user.id, notebookId).catch(() => null);
				if (vault) { sendJson(response, 400, { error: 'Vault notebooks cannot be shared' }); return true; }
			}

			// Notebooks nest: a share root must be top level (Joplin's rule), a notebook
			// inside a share is already shared, and a vault below cannot be shared.
			if (folderOps) {
				await folderOps.prepareForShare({ user: auth.user, folderId: notebookId, requestContext: upstreamRequestContext(request) });
			}

			// Reuse existing share for this notebook if present.
			const listResult = await upstream(ctx, auth.user.sessionId, 'GET', '/api/shares', null);
			const existing = sharesList(jsonResult(listResult)).find(s => shareFolderId(s) === notebookId);
			let share = existing;
			if (!share) {
				const result = await createShareUpstream(ctx, auth.user.sessionId, notebookId);
				const data = jsonResult(result);
				if (result.statusCode < 200 || result.statusCode >= 300) {
					sendJson(response, result.statusCode, data.error ? data : { error: data.error || 'Share creation failed', ...data });
					return true;
				}
				share = data;
			}
			const shareId = share && share.id;
			if (shareId) {
				await ensureShareIdsOnNotebook(ctx, auth, notebookId, shareId);
			}
			sendJson(response, 200, share);
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Share creation failed' });
		}
		return true;
	}

	// GET /api/web/shares — list shares (optional ?notebook_id=)
	if (p === '/api/web/shares' && method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const result = await upstream(ctx, auth.user.sessionId, 'GET', '/api/shares', null);
			let items = sharesList(jsonResult(result));
			const notebookId = (url.searchParams.get('notebook_id') || url.searchParams.get('folder_id') || '').trim();
			if (notebookId) items = items.filter(s => shareFolderId(s) === notebookId);
			sendJson(response, 200, { items });
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Failed to list shares' });
		}
		return true;
	}

	// GET /api/web/shares/:id/invites — list people on a share
	const invitesGetMatch = p.match(/^\/api\/web\/shares\/([^/]+)\/invites$/);
	if (invitesGetMatch && method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const shareId = invitesGetMatch[1];
			let result = await upstream(ctx, auth.user.sessionId, 'GET', `/api/shares/${encodeURIComponent(shareId)}/users`, null);
			if (result.statusCode >= 400) {
				result = await upstream(ctx, auth.user.sessionId, 'GET', `/api/share_users?share_id=${encodeURIComponent(shareId)}`, null);
			}
			let items = inviteesList(jsonResult(result));
			// Normalize /api/shares/:id/users format: {items:[{id,status,user:{id,email}}]}
			items = items.map(i => ({
				...i,
				user_id: i.user_id || i.userId || (i.user && i.user.id) || '',
				email: i.email || (i.user && i.user.email) || '',
			}));
			// Enrich with emails and can_write from users/share_users tables
			if (database && items.length) {
				const userIds = items.map(i => i.user_id).filter(Boolean);
				if (userIds.length) {
					const users = await database.query(
						`SELECT id, email, full_name FROM users WHERE id = ANY($1::text[])`,
						[userIds],
					).catch(() => ({ rows: [] }));
					const byId = new Map((users.rows || []).map(u => [u.id, u]));
					const suRows = await database.query(
						`SELECT user_id, can_write FROM share_users WHERE share_id = $1 AND user_id = ANY($2::text[])`,
						[shareId, userIds],
					).catch(() => ({ rows: [] }));
					const canWriteByUser = new Map((suRows.rows || []).map(r => [r.user_id, !!(Number(r.can_write))]));
					items = items.map(i => {
						const u = byId.get(i.user_id);
						const cw = canWriteByUser.has(i.user_id) ? canWriteByUser.get(i.user_id) : true;
						return Object.assign(i, {
							email: i.email || (u ? u.email : ''),
							full_name: u ? u.full_name : (i.full_name || ''),
							can_write: cw,
						});
					});
				}
			}
			sendJson(response, 200, { items });
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Failed to list invitees' });
		}
		return true;
	}

	// POST /api/web/shares/:id/invites — invite + auto-accept (no confirmation)
	const invitesPostMatch = p.match(/^\/api\/web\/shares\/([^/]+)\/invites$/);
	if (invitesPostMatch && method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const shareId = invitesPostMatch[1];
			if (database) {
				const ownerCheck = await database.query(
					`SELECT 1 FROM shares WHERE id = $1 AND owner_id = $2 LIMIT 1`,
					[shareId, auth.user.id],
				).catch(() => ({ rows: [] }));
				if (!ownerCheck.rows || !ownerCheck.rows.length) {
					sendJson(response, 403, { error: 'Only the owner can invite users' });
					return true;
				}
			}
			const body = await parseBody(request);
			const email = `${body.email || ''}`.trim().toLowerCase();
			const canWrite = body.can_write !== undefined ? !!Number(body.can_write) : true;
			if (!email) { sendJson(response, 400, { error: 'email is required' }); return true; }
			if (auth.user.email && email === `${auth.user.email}`.toLowerCase()) {
				sendJson(response, 400, { error: 'Cannot share with yourself' });
				return true;
			}

			const result = await upstream(ctx, auth.user.sessionId, 'POST', `/api/shares/${encodeURIComponent(shareId)}/users`, {
				email,
			});
			const data = jsonResult(result);
			if (result.statusCode < 200 || result.statusCode >= 300) {
				sendJson(response, result.statusCode, data.error ? data : { error: data.error || data.message || 'Invitation failed', ...data });
				return true;
			}

			const inviteId = data.id || data.share_user_id;
			if (inviteId && database) {
				await autoAcceptShareUser(database, inviteId);
				await database.query(`UPDATE share_users SET can_write = $1 WHERE id = $2`, [canWrite ? 1 : 0, inviteId]).catch(() => null);
				// Resolve recipient + notebook for user_items fan-out
				const su = await database.query(
					`SELECT su.user_id, s.owner_id, COALESCE(s.folder_id, s.item_id, '') AS notebook_id
					 FROM share_users su
					 JOIN shares s ON s.id = su.share_id
					 WHERE su.id = $1
					 LIMIT 1`,
					[inviteId],
				).catch(() => ({ rows: [] }));
				// shares schema varies; try alternate columns
				let row = su.rows && su.rows[0];
				if (!row) {
					const su2 = await database.query(
						`SELECT su.user_id, s.owner_id, s.id AS share_id
						 FROM share_users su
						 JOIN shares s ON s.id = su.share_id
						 WHERE su.id = $1 LIMIT 1`,
						[inviteId],
					).catch(() => ({ rows: [] }));
					row = su2.rows && su2.rows[0];
				}
				if (row && row.user_id) {
					// Find notebook id from shares list / folder with matching share_id
					let notebookId = row.notebook_id || '';
					if (!notebookId) {
						const folder = await database.query(
							`SELECT jop_id FROM items
							 WHERE owner_id = $1 AND jop_type = 2
							   AND COALESCE(${shareIdOf()}, '') = $2
							 LIMIT 1`,
							[row.owner_id || auth.user.id, shareId],
						).catch(() => ({ rows: [] }));
						notebookId = folder.rows && folder.rows[0] ? folder.rows[0].jop_id : '';
					}
					if (notebookId) {
						await ensureShareIdsOnNotebook(ctx, auth, notebookId, shareId);
						await populateUserItems(database, row.user_id, row.owner_id || auth.user.id, shareId, notebookId);
					}
				}
				data.status = STATUS_ACCEPTED;
			}

			sendJson(response, 200, data);
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Invitation failed' });
		}
		return true;
	}

	// GET /api/web/shares/:id
	const shareGetMatch = p.match(/^\/api\/web\/shares\/([^/]+)$/);
	if (shareGetMatch && method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const shareId = shareGetMatch[1];
			const result = await upstream(ctx, auth.user.sessionId, 'GET', `/api/shares/${shareId}`, null);
			sendJson(response, result.statusCode, jsonResult(result));
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Failed to load share' });
		}
		return true;
	}

	// DELETE /api/web/shares/:id
	if (shareGetMatch && method === 'DELETE') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const shareId = shareGetMatch[1];
			// Only owner can stop sharing
			if (database) {
				const ownerCheck = await database.query(
					`SELECT 1 FROM shares WHERE id = $1 AND owner_id = $2 LIMIT 1`,
					[shareId, auth.user.id],
				).catch(() => ({ rows: [] }));
				if (!ownerCheck.rows || !ownerCheck.rows.length) {
					sendJson(response, 403, { error: 'Only the owner can stop sharing' });
					return true;
				}
			}
			const result = await upstream(ctx, auth.user.sessionId, 'DELETE', `/api/shares/${shareId}`, null);
			// Clean up user_items for all recipients of this share
			if (database) {
				await database.query(`DELETE FROM user_items WHERE item_id IN (
					SELECT i.jop_id FROM items i
					WHERE COALESCE(${shareIdOf('i.')}, '') = $1
				)`, [shareId]).catch(() => null);
				await database.query(`DELETE FROM share_users WHERE share_id = $1`, [shareId]).catch(() => null);
				// Clear the dead share id from the owner's notebook tree (the notebook, every
				// sub-notebook and their notes), as Joplin's own client does when unsharing.
				// Left behind, Joplin Server answers any later write of those items with
				// "share not found" (422), so they could no longer be edited or trashed.
				const stale = await database.query(
					`SELECT i.jop_id FROM items i WHERE i.owner_id = $1 AND COALESCE(${shareIdOf('i.')}, '') = $2`,
					[auth.user.id, shareId],
				).catch(() => ({ rows: [] }));
				await setShareOnItems(database, auth.user.id, (stale.rows || []).map(r => r.jop_id), '').catch(() => null);
			}
			sendJson(response, result.statusCode, result.statusCode >= 200 && result.statusCode < 300 ? { ok: true } : jsonResult(result));
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Failed to delete share' });
		}
		return true;
	}

	// POST /api/web/shares/:id/leave
	const leaveMatch = p.match(/^\/api\/web\/shares\/([^/]+)\/leave$/);
	if (leaveMatch && method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const shareId = leaveMatch[1];
			if (database) {
				const su = await database.query(
					`SELECT id, user_id FROM share_users WHERE share_id = $1 AND user_id = $2 AND status = 1 LIMIT 1`,
					[shareId, auth.user.id],
				).catch(() => ({ rows: [] }));
				const row = su.rows && su.rows[0];
				if (row) {
					await database.query(`DELETE FROM share_users WHERE id = $1`, [row.id]);
					await database.query(`DELETE FROM user_items WHERE user_id = $1 AND item_id IN (
						SELECT jop_id FROM items WHERE owner_id = (
							SELECT owner_id FROM shares WHERE id = $2
						)
					)`, [auth.user.id, shareId]).catch(() => null);
				}
				sendJson(response, 200, { ok: true });
			} else {
				sendJson(response, 500, { error: 'Database not available' });
			}
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Leave failed' });
		}
		return true;
	}

	// PATCH /api/web/shares/invites/:id
	const invitePatchMatch = p.match(/^\/api\/web\/shares\/invites\/([^/]+)$/);
	if (invitePatchMatch && method === 'PATCH') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const inviteId = invitePatchMatch[1];
			// Only share owner can modify permissions
			if (database) {
				const ownerCheck = await database.query(
					`SELECT 1 FROM share_users su JOIN shares s ON s.id = su.share_id WHERE su.id = $1 AND s.owner_id = $2 LIMIT 1`,
					[inviteId, auth.user.id],
				).catch(() => ({ rows: [] }));
				if (!ownerCheck.rows || !ownerCheck.rows.length) {
					sendJson(response, 403, { error: 'Only the owner can modify permissions' });
					return true;
				}
			}
			const body = await parseBody(request);
			if (database) {
				const sets = [];
				const vals = [];
				if (body.status !== undefined) { sets.push(`status = $${sets.length + 1}`); vals.push(Number(body.status)); }
				if (body.can_write !== undefined) { sets.push(`can_write = $${sets.length + 1}`); vals.push(Number(body.can_write) ? 1 : 0); }
				if (sets.length) {
					vals.push(inviteId);
					await database.query(`UPDATE share_users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
				}
				sendJson(response, 200, { ok: true });
			} else {
				const result = await upstream(ctx, auth.user.sessionId, 'PATCH', `/api/share_users/${inviteId}`, body);
				sendJson(response, result.statusCode, jsonResult(result));
			}
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Permission update failed' });
		}
		return true;
	}

	// POST accept / reject — still supported, but auto-accept means rarely needed
	const acceptMatch = p.match(/^\/api\/web\/shares\/invites\/([^/]+)\/accept$/);
	if (acceptMatch && method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const inviteId = acceptMatch[1];
			if (database) await autoAcceptShareUser(database, inviteId);
			sendJson(response, 200, { ok: true });
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Accept failed' });
		}
		return true;
	}

	const rejectMatch = p.match(/^\/api\/web\/shares\/invites\/([^/]+)\/reject$/);
	if (rejectMatch && method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const inviteId = rejectMatch[1];
			if (database) {
				await database.query(`DELETE FROM share_users WHERE id = $1`, [inviteId]);
				await database.query(`DELETE FROM user_items WHERE item_id IN (
					SELECT item_id FROM user_items ui2 WHERE ui2.user_id = (SELECT user_id FROM share_users WHERE id = $1)
				)`, [inviteId]).catch(() => {});
			}
			sendJson(response, 200, { ok: true });
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Reject failed' });
		}
		return true;
	}

	// DELETE /api/web/shares/invites/:id
	if (invitePatchMatch && method === 'DELETE') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const inviteId = invitePatchMatch[1];
			// Only share owner can remove users
			if (database) {
				const ownerCheck = await database.query(
					`SELECT 1 FROM share_users su JOIN shares s ON s.id = su.share_id WHERE su.id = $1 AND s.owner_id = $2 LIMIT 1`,
					[inviteId, auth.user.id],
				).catch(() => ({ rows: [] }));
				if (!ownerCheck.rows || !ownerCheck.rows.length) {
					sendJson(response, 403, { error: 'Only the owner can remove users' });
					return true;
				}
			}
			if (database) {
				const su = await database.query(`SELECT user_id, share_id FROM share_users WHERE id = $1`, [inviteId]).catch(() => ({ rows: [] }));
				const row = su.rows && su.rows[0];
				await database.query(`DELETE FROM share_users WHERE id = $1`, [inviteId]);
				if (row) {
					await database.query(`DELETE FROM user_items WHERE user_id = $1 AND item_id IN (
						SELECT i.jop_id FROM items i WHERE COALESCE(${shareIdOf('i.')}, '') = $2
					)`, [row.user_id, row.share_id]).catch(() => {});
				}
				sendJson(response, 200, { ok: true });
			} else {
				const result = await upstream(ctx, auth.user.sessionId, 'DELETE', `/api/share_users/${inviteId}`, null);
				sendJson(response, result.statusCode >= 200 && result.statusCode < 300 ? 200 : result.statusCode,
					result.statusCode >= 200 && result.statusCode < 300 ? { ok: true } : jsonResult(result));
			}
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'Revoke failed' });
		}
		return true;
	}

	// GET /api/web/users/search?q=
	if (p === '/api/web/users/search' && method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }
			const q = (url.searchParams.get('q') || '').trim();
			if (!q || q.length < 2) { sendJson(response, 200, { users: [] }); return true; }

			if (database) {
				const result = await database.query(`
					SELECT id, email, full_name
					FROM users
					WHERE (email ILIKE $1 OR full_name ILIKE $1)
					  AND id <> $2
					ORDER BY email ASC
					LIMIT 10
				`, [`%${q}%`, auth.user.id]);
				sendJson(response, 200, { users: result.rows || [] });
				return true;
			}

			const upstreamResult = await upstream(ctx, auth.user.sessionId, 'GET', `/api/users?search=${encodeURIComponent(q)}`, null);
			sendJson(response, upstreamResult.statusCode, jsonResult(upstreamResult));
		} catch (e) {
			sendJson(response, e.statusCode || 500, { error: e.message || 'User search failed' });
		}
		return true;
	}

	return false;
};

module.exports = {
	handle, autoAcceptShareUser, STATUS_ACCEPTED, STATUS_WAITING, populateUserItems, ensureShareIdsOnNotebook,
	collectSubtreeItems, setShareOnItems, createShareSync, revokeRecipientAccess,
};
