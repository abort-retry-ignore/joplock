const MODEL_TYPE_NOTE = 1;
const MODEL_TYPE_FOLDER = 2;
const MODEL_TYPE_RESOURCE = 4;
const TRASH_FOLDER_ID = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';

const safeJsonExpression = expr => `CASE WHEN left(trim(${expr}), 1) = '{' THEN (${expr})::json ELSE '{}'::json END`;

const decodeItemContent = content => {
	if (!content) return {};
	const raw = Buffer.isBuffer(content) ? content.toString('utf8') : `${content}`;
	if (!raw) return {};
	return JSON.parse(raw);
};

const mapFolderRow = row => {
	const content = decodeItemContent(row.content);
	return {
		id: row.jop_id,
		parentId: row.jop_parent_id || '',
		title: content.title || '',
		icon: content.icon || '',
		deletedTime: Number(content.deleted_time || 0),
		createdTime: Number(content.created_time || row.created_time || 0),
		updatedTime: Number(row.jop_updated_time || content.updated_time || 0),
		ownerId: row.owner_id || '',
		shareId: content.share_id || '',
		isShared: !!(Number(content.is_shared || 0)),
	};
};

const ENCRYPTED_MARKER = '<!--joplock-encrypted-start-->';

const isEncryptedBody = body => typeof body === 'string' && body.indexOf(ENCRYPTED_MARKER) >= 0;

// Split a raw search query into whitespace-separated terms and build the WHERE
// fragment for them. Each term matches case-insensitively (ILIKE substring) in
// the note title OR the cleaned body (body stripped of encrypted blobs,
// resource links and inline base64 data). Clauses are ANDed, so every term must
// appear somewhere in the note, but terms may appear in any order or spread
// across title and body.
const buildNoteSearchConditions = (query, firstParamIndex) => {
	const terms = `${query || ''}`.trim().split(/\s+/).filter(Boolean);
	const params = terms.map(term => `%${term}%`);
	const clauses = terms.map((term, i) => {
		const p = firstParamIndex + i;
		return `(parsed->>'title' ILIKE $${p} OR (
					COALESCE(parsed->>'body', '') NOT LIKE '%${ENCRYPTED_MARKER}%'
					AND regexp_replace(
						regexp_replace(parsed->>'body', '!?\[[^\]]*\]\(:/[a-f0-9]+\)', '', 'g'),
						'data:image/[^;]+;base64,[A-Za-z0-9+/=]+', '', 'g'
					) ILIKE $${p}
				))`;
	});
	return { terms, params, sql: clauses.join(' AND ') };
};

const mapNoteRow = row => {
	const content = decodeItemContent(row.content);
	const body = content.body || '';
	const encrypted = isEncryptedBody(body);
	return {
		id: row.jop_id,
		parentId: row.jop_parent_id || '',
		title: content.title || '',
		body,
		bodyPreview: encrypted ? 'Encrypted' : body.slice(0, 240),
		isEncrypted: encrypted,
		isTodo: !!Number(content.is_todo || 0),
		todoCompleted: Number(content.todo_completed || 0),
		deletedTime: Number(content.deleted_time || 0),
		createdTime: Number(content.created_time || row.created_time || 0),
		updatedTime: Number(row.jop_updated_time || content.updated_time || 0),
		ownerId: row.owner_id || '',
		shareId: content.share_id || '',
		isShared: !!(Number(content.is_shared || 0)),
	};
};

const mapNoteHeaderRow = row => {
	const encrypted = !!(row.is_encrypted || false);
	return {
		id: row.jop_id,
		parentId: row.jop_parent_id || '',
		title: row.title || '',
		isEncrypted: encrypted,
		deletedTime: Number(row.deleted_time || 0),
		updatedTime: Number(row.jop_updated_time || 0),
		ownerId: row.owner_id || '',
		shareId: row.share_id || '',
		isShared: !!Number(row.is_shared || 0),
	};
};

const deletedFilterSql = mode => {
	if (mode === 'only') return ' AND COALESCE((convert_from(content, \'UTF8\')::json->>\'deleted_time\')::bigint, 0) > 0';
	if (mode === 'all') return '';
	return ' AND COALESCE((convert_from(content, \'UTF8\')::json->>\'deleted_time\')::bigint, 0) = 0';
};

const NOTE_PAGE_SIZE = 100;
const VIRTUAL_ALL_NOTES_ID = '__all__';
const VIRTUAL_TRASH_ID = '__trash__';

const itemAccessExpression = () => `
	(items.owner_id = $1 OR items.jop_id IN (
		SELECT ui.item_id FROM user_items ui
		WHERE ui.user_id = $1
	))`;

const ensureIndexes = async database => {
	await database.query(`
		CREATE OR REPLACE FUNCTION joplock_content_utf8(data bytea)
		RETURNS text
		LANGUAGE sql
		IMMUTABLE
		PARALLEL SAFE
		AS $$
			SELECT convert_from(data, 'UTF8')
		$$
	`);
	await database.query(`
		CREATE INDEX IF NOT EXISTS idx_items_owner_type_parent_updated
		ON items (owner_id, jop_type, jop_parent_id, jop_updated_time DESC)
	`);
	// pg_trgm enables GIN trigram indexes for fast ILIKE body/title search
	await database.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
	await database.query(`
		DROP INDEX IF EXISTS idx_items_search_trgm
	`);
	await database.query(`
		CREATE INDEX IF NOT EXISTS idx_items_search_trgm
		ON items
		USING GIN (
			(
				COALESCE(${safeJsonExpression('joplock_content_utf8(content)')}->>'title', '') || ' ' ||
				COALESCE(${safeJsonExpression('joplock_content_utf8(content)')}->>'body', '')
			) gin_trgm_ops
		)
		WHERE jop_type = 1
	`);
	await database.query(`CREATE INDEX IF NOT EXISTS idx_user_items_user_item ON user_items (user_id, item_id)`);
	await database.query(`CREATE INDEX IF NOT EXISTS idx_share_users_user_status ON share_users (user_id, status)`);
	await database.query(`ALTER TABLE share_users ADD COLUMN IF NOT EXISTS can_write INTEGER NOT NULL DEFAULT 1`).catch(() => null);
};

const createItemService = database => {
	return {
		async foldersByUserId(userId) {
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content, owner_id
				FROM items
				WHERE jop_type = $2${deletedFilterSql('exclude')} AND ${itemAccessExpression()}
				ORDER BY LOWER(COALESCE(convert_from(content, 'UTF8')::json->>'title', '')) ASC, created_time ASC
			`, [userId, MODEL_TYPE_FOLDER]);

			return result.rows.map(mapFolderRow);
		},

		async folderByUserIdAndJopId(userId, folderId) {
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content, owner_id
				FROM items
				WHERE jop_type = $2 AND jop_id = $3 AND ${itemAccessExpression()}
				LIMIT 1
			`, [userId, MODEL_TYPE_FOLDER, folderId]);

			const row = result.rows[0];
			if (!row) return null;
			return mapFolderRow(row);
		},

		async notesByUserId(userId, options = {}) {
			const folderId = options.folderId || '';
			const deleted = options.deleted || 'exclude';
			const params = [userId, MODEL_TYPE_NOTE];
			let where = `WHERE jop_type = $2${deletedFilterSql(deleted)} AND ${itemAccessExpression()}`;

			if (folderId) {
				params.push(folderId);
				where += ` AND jop_parent_id = $${params.length}`;
			}

			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content, owner_id
				FROM items
				${where}
				ORDER BY jop_updated_time DESC, created_time DESC
			`, params);

			return result.rows.map(mapNoteRow);
		},

		async noteHeadersByUserId(userId, options = {}) {
			const deleted = options.deleted || 'exclude';
			const result = await database.query(`
				SELECT
					jop_id,
					jop_parent_id,
					jop_updated_time,
					owner_id,
					COALESCE(convert_from(content, 'UTF8')::json->>'title', '') AS title,
					COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) AS deleted_time,
					COALESCE(convert_from(content, 'UTF8')::json->>'share_id', '') AS share_id,
					COALESCE((convert_from(content, 'UTF8')::json->>'is_shared')::int, 0) AS is_shared,
					(COALESCE(convert_from(content, 'UTF8')::json->>'body', '') LIKE '%<!--joplock-encrypted-start-->%') AS is_encrypted
				FROM items
				WHERE jop_type = $2${deletedFilterSql(deleted)} AND ${itemAccessExpression()}
				ORDER BY jop_updated_time DESC, created_time DESC
			`, [userId, MODEL_TYPE_NOTE]);

			return result.rows.map(mapNoteHeaderRow);
		},

		// Returns a Map: folderId -> count (non-deleted notes).
		// Special keys: '__all__' = total non-deleted, '__trash__' = total deleted.
		async folderNoteCountsByUserId(userId) {
			const [activeResult, trashResult] = await Promise.all([
				database.query(`
					SELECT jop_parent_id AS folder_id, COUNT(*) AS count
					FROM items
					WHERE jop_type = $2
					  AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) = 0
					  AND ${itemAccessExpression()}
					GROUP BY jop_parent_id
				`, [userId, MODEL_TYPE_NOTE]),
				database.query(`
					SELECT COUNT(*) AS count
					FROM items
					WHERE jop_type = $2
					  AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) > 0
					  AND ${itemAccessExpression()}
				`, [userId, MODEL_TYPE_NOTE]),
			]);
			const counts = new Map();
			let allCount = 0;
			for (const row of activeResult.rows) {
				const c = Number(row.count);
				counts.set(row.folder_id, c);
				allCount += c;
			}
			counts.set(VIRTUAL_ALL_NOTES_ID, allCount);
			counts.set(VIRTUAL_TRASH_ID, Number(trashResult.rows[0]?.count || 0));
			return counts;
		},

		// Paginated note headers for one folder (or virtual __all__ / __trash__).
		async noteHeadersByFolder(userId, folderId, limit = NOTE_PAGE_SIZE, offset = 0) {
			let where = `WHERE jop_type = $2 AND ${itemAccessExpression()}`;
			const params = [userId, MODEL_TYPE_NOTE];

			if (folderId === VIRTUAL_TRASH_ID) {
				where += ` AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) > 0`;
			} else {
				where += ` AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) = 0`;
				if (folderId && folderId !== VIRTUAL_ALL_NOTES_ID) {
					params.push(folderId);
					where += ` AND jop_parent_id = $${params.length}`;
				}
			}

			params.push(limit, offset);
			const result = await database.query(`
				SELECT
					jop_id,
					jop_parent_id,
					jop_updated_time,
					owner_id,
					COALESCE(convert_from(content, 'UTF8')::json->>'title', '') AS title,
					COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) AS deleted_time,
					COALESCE(convert_from(content, 'UTF8')::json->>'share_id', '') AS share_id,
					COALESCE((convert_from(content, 'UTF8')::json->>'is_shared')::int, 0) AS is_shared,
					(COALESCE(convert_from(content, 'UTF8')::json->>'body', '') LIKE '%<!--joplock-encrypted-start-->%') AS is_encrypted
				FROM items
				${where}
				ORDER BY jop_updated_time DESC, created_time DESC
				LIMIT $${params.length - 1} OFFSET $${params.length}
			`, params);
			return result.rows.map(mapNoteHeaderRow);
		},

		async searchNotes(userId, query, limit = 50, offset = 0) {
			if (!query || !query.trim()) return [];
			const { sql: termSql, params: termParams } = buildNoteSearchConditions(query, 3);
			if (!termSql) return [];
			const limitIdx = 2 + termParams.length + 1;
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content, owner_id
				FROM (
					SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content, owner_id,
						${safeJsonExpression("convert_from(content, 'UTF8')")} AS parsed
					FROM items
					WHERE jop_type = $2 AND ${itemAccessExpression()}
				) sub
				WHERE COALESCE((parsed->>'deleted_time')::bigint, 0) = 0
					AND (${termSql})
				ORDER BY jop_updated_time DESC, created_time DESC
				LIMIT $${limitIdx} OFFSET $${limitIdx + 1}
			`, [userId, MODEL_TYPE_NOTE, ...termParams, limit, offset]);

			return result.rows.map(mapNoteRow);
		},

		async noteByUserIdAndJopId(userId, noteId, options = {}) {
			const deleted = options.deleted || 'exclude';
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content, owner_id
				FROM items
				WHERE jop_type = $2 AND jop_id = $3${deletedFilterSql(deleted)} AND ${itemAccessExpression()}
				LIMIT 1
			`, [userId, MODEL_TYPE_NOTE, noteId]);

			const row = result.rows[0];
			if (!row) return null;
			return mapNoteRow(row);
		},

		// Cheap freshness probe for cross-browser sync polling. Returns
		// { updatedTime, deletedTime } without decoding the note body, or null if
		// no row exists (which usually means hard-deleted).
		async noteFreshnessByUserIdAndJopId(userId, noteId) {
			const result = await database.query(`
				SELECT jop_updated_time,
					COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) AS deleted_time
				FROM items
				WHERE jop_type = $2 AND jop_id = $3 AND ${itemAccessExpression()}
				LIMIT 1
			`, [userId, MODEL_TYPE_NOTE, noteId]);

			const row = result.rows[0];
			if (!row) return null;
			return {
				updatedTime: Number(row.jop_updated_time || 0),
				deletedTime: Number(row.deleted_time || 0),
			};
		},

		// Returns the binary content of a resource blob (.resource/<id>)
		async resourceBlobByUserId(userId, resourceId) {
			const blobName = `.resource/${resourceId}`;
			const result = await database.query(`
				SELECT content
				FROM items
				WHERE name = $2 AND ${itemAccessExpression()}
				LIMIT 1
			`, [userId, blobName]);

			const row = result.rows[0];
			if (!row) return null;
			return row.content; // Buffer
		},

		// Returns resource metadata (mime, filename, etc.) from the .md item
		async resourceMetaByUserId(userId, resourceId) {
			const result = await database.query(`
				SELECT content, owner_id
				FROM items
				WHERE jop_type = $2 AND jop_id = $3 AND ${itemAccessExpression()}
				LIMIT 1
			`, [userId, MODEL_TYPE_RESOURCE, resourceId]);

			const row = result.rows[0];
			if (!row) return null;
			const content = decodeItemContent(row.content);
			return {
				id: resourceId,
				title: content.title || '',
				mime: content.mime || 'application/octet-stream',
				filename: content.filename || '',
				fileExtension: content.file_extension || '',
				size: Number(content.size || 0),
			};
		},

		// Count orphaned resources (not referenced by any non-deleted note body)
		async countOrphanedResources(userId) {
			const result = await database.query(`
				WITH resource_ids AS (
					SELECT jop_id,
						COALESCE((convert_from(content, 'UTF8')::json ->> 'size')::bigint, 0) AS size
					FROM items
					WHERE jop_type = $2
						AND COALESCE((convert_from(content, 'UTF8')::json ->> 'deleted_time')::bigint, 0) = 0
						AND ${itemAccessExpression()}
				),
				referenced_ids AS (
					SELECT DISTINCT m[1] AS ref_id
					FROM items,
					LATERAL regexp_matches(
						convert_from(content, 'UTF8')::json ->> 'body',
						'(?::/|resources/)([0-9a-fA-F]{32})', 'g'
					) AS m
					WHERE jop_type = $3
						AND COALESCE((convert_from(content, 'UTF8')::json ->> 'deleted_time')::bigint, 0) = 0
						AND ${itemAccessExpression()}
				)
				SELECT COUNT(*)::int AS resource_count,
					COALESCE(SUM(r.size), 0)::bigint AS total_bytes
				FROM resource_ids r
				WHERE NOT EXISTS (
					SELECT 1 FROM referenced_ids ref WHERE ref.ref_id = r.jop_id
				)
			`, [userId, MODEL_TYPE_RESOURCE, MODEL_TYPE_NOTE]);
			const row = result.rows[0] || {};
			return {
				count: Number(row.resource_count || 0),
				totalBytes: Number(row.total_bytes || 0),
			};
		},

		// Get IDs of orphaned resources
		async getOrphanedResourceIds(userId) {
			const result = await database.query(`
				WITH resource_ids AS (
					SELECT jop_id
					FROM items
					WHERE jop_type = $2
						AND COALESCE((convert_from(content, 'UTF8')::json ->> 'deleted_time')::bigint, 0) = 0
						AND ${itemAccessExpression()}
				),
				referenced_ids AS (
					SELECT DISTINCT m[1] AS ref_id
					FROM items,
					LATERAL regexp_matches(
						convert_from(content, 'UTF8')::json ->> 'body',
						'(?::/|resources/)([0-9a-fA-F]{32})', 'g'
					) AS m
					WHERE jop_type = $3
						AND COALESCE((convert_from(content, 'UTF8')::json ->> 'deleted_time')::bigint, 0) = 0
						AND ${itemAccessExpression()}
				)
				SELECT r.jop_id
				FROM resource_ids r
				WHERE NOT EXISTS (
					SELECT 1 FROM referenced_ids ref WHERE ref.ref_id = r.jop_id
				)
			`, [userId, MODEL_TYPE_RESOURCE, MODEL_TYPE_NOTE]);
			return result.rows.map(r => r.jop_id);
		},
	};
};

module.exports = {
	MODEL_TYPE_FOLDER,
	MODEL_TYPE_NOTE,
	MODEL_TYPE_RESOURCE,
	TRASH_FOLDER_ID,
	NOTE_PAGE_SIZE,
	VIRTUAL_ALL_NOTES_ID,
	VIRTUAL_TRASH_ID,
	createItemService,
	ensureIndexes,
	decodeItemContent,
	isEncryptedBody,
	buildNoteSearchConditions,
	mapFolderRow,
	mapNoteHeaderRow,
	mapNoteRow,
};
