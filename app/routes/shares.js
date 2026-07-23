'use strict';

const { randomBytes } = require('crypto');
const { sendJson, parseBody } = require('./_helpers');
const { requestUpstream } = require('../items/itemWriteService');

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

const newId = () => randomBytes(16).toString('hex');

const autoAcceptShareUser = async (database, shareUserId) => {
	if (!database || !shareUserId) return;
	await database.query(`UPDATE share_users SET status = $1 WHERE id = $2`, [STATUS_ACCEPTED, shareUserId]);
};

const ensureShareIdsOnNotebook = async (ctx, auth, notebookId, shareId) => {
	const { itemService, database } = ctx;
	const folder = await itemService.folderByUserIdAndJopId(auth.user.id, notebookId);
	if (!folder) return;
	if (!folder.shareId || folder.shareId !== shareId || !folder.isShared) {
		if (database) {
			await database.query(`
				UPDATE items SET
					content = convert_to(
						jsonb_set(jsonb_set(convert_from(content,'UTF8')::jsonb, '{share_id}', $3::jsonb), '{is_shared}', '1'::jsonb)::text,
						'UTF8'
					),
					updated_time = $4
				WHERE jop_id = $1 AND jop_type = 2 AND owner_id = $2
			`, [notebookId, auth.user.id, JSON.stringify(shareId), Date.now()]).catch(() => null);
		}
	}
	// Update all notes in the notebook
	const notes = await itemService.notesByUserId(auth.user.id, { folderId: notebookId, deleted: 'all' });
	const noteIds = notes.map(n => n.jopId || n.jop_id || n.id).filter(Boolean);
	if (noteIds.length && database) {
		await database.query(`
			UPDATE items SET
				content = convert_to(
					jsonb_set(jsonb_set(convert_from(content,'UTF8')::jsonb, '{share_id}', $2::jsonb), '{is_shared}', '1'::jsonb)::text,
					'UTF8'
				),
				updated_time = $3
			WHERE jop_id = ANY($1::text[]) AND jop_type = 1 AND owner_id = $4
		`, [noteIds, JSON.stringify(shareId), Date.now(), auth.user.id]).catch(() => null);
	}
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
		    OR COALESCE(convert_from(content, 'UTF8')::json->>'share_id', '') = $3
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

const createShareUpstream = async (ctx, sessionId, notebookId) => {
	// Joplin Server has used both folder_id and notebook_id historically.
	let result = await upstream(ctx, sessionId, 'POST', '/api/shares', { folder_id: notebookId });
	if (result.statusCode >= 400) {
		result = await upstream(ctx, sessionId, 'POST', '/api/shares', { notebook_id: notebookId });
	}
	return result;
};

const handle = async (url, request, response, ctx) => {
	const { authenticatedUser, itemService, itemWriteService, database, vaultService, upstreamRequestContext } = ctx;
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
							   AND COALESCE(convert_from(content,'UTF8')::json->>'share_id','') = $2
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
					WHERE COALESCE(convert_from(i.content,'UTF8')::json->>'share_id','') = $1
				)`, [shareId]).catch(() => null);
				await database.query(`DELETE FROM share_users WHERE share_id = $1`, [shareId]).catch(() => null);
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
						SELECT i.jop_id FROM items i WHERE COALESCE(convert_from(i.content,'UTF8')::json->>'share_id','') = $2
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

module.exports = { handle, autoAcceptShareUser, STATUS_ACCEPTED, STATUS_WAITING, populateUserItems, ensureShareIdsOnNotebook };
