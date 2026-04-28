const MODEL_TYPE_NOTE = 1;
const MODEL_TYPE_FOLDER = 2;
const MODEL_TYPE_RESOURCE = 4;
const TRASH_FOLDER_ID = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';

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
	};
};

const ENCRYPTED_MARKER = '<!--joplock-encrypted-start-->';

const isEncryptedBody = body => typeof body === 'string' && body.indexOf(ENCRYPTED_MARKER) >= 0;

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

const ensureIndexes = async database => {
	await database.query(`
		CREATE INDEX IF NOT EXISTS idx_items_owner_type_parent_updated
		ON items (owner_id, jop_type, jop_parent_id, jop_updated_time DESC)
	`);
	// pg_trgm enables GIN trigram indexes for fast ILIKE body/title search
	await database.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
	await database.query(`
		CREATE INDEX IF NOT EXISTS idx_items_search_trgm
		ON items
		USING GIN (
			(
				COALESCE(convert_from(content, 'UTF8')::json->>'title', '') || ' ' ||
				COALESCE(convert_from(content, 'UTF8')::json->>'body', '')
			) gin_trgm_ops
		)
		WHERE jop_type = 1
	`);
};

const createItemService = database => {
	return {
		async foldersByUserId(userId) {
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2${deletedFilterSql('exclude')}
				ORDER BY LOWER(COALESCE(convert_from(content, 'UTF8')::json->>'title', '')) ASC, created_time ASC
			`, [userId, MODEL_TYPE_FOLDER]);

			return result.rows.map(mapFolderRow);
		},

		async folderByUserIdAndJopId(userId, folderId) {
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2 AND jop_id = $3
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
			let where = `WHERE owner_id = $1 AND jop_type = $2${deletedFilterSql(deleted)}`;

			if (folderId) {
				params.push(folderId);
				where += ` AND jop_parent_id = $${params.length}`;
			}

			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
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
					COALESCE(convert_from(content, 'UTF8')::json->>'title', '') AS title,
					COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) AS deleted_time,
					(COALESCE(convert_from(content, 'UTF8')::json->>'body', '') LIKE '%<!--joplock-encrypted-start-->%') AS is_encrypted
				FROM items
				WHERE owner_id = $1 AND jop_type = $2${deletedFilterSql(deleted)}
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
					WHERE owner_id = $1 AND jop_type = $2
					  AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) = 0
					GROUP BY jop_parent_id
				`, [userId, MODEL_TYPE_NOTE]),
				database.query(`
					SELECT COUNT(*) AS count
					FROM items
					WHERE owner_id = $1 AND jop_type = $2
					  AND COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) > 0
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
			let where = `WHERE owner_id = $1 AND jop_type = $2`;
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
					COALESCE(convert_from(content, 'UTF8')::json->>'title', '') AS title,
					COALESCE((convert_from(content, 'UTF8')::json->>'deleted_time')::bigint, 0) AS deleted_time,
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
			const pattern = `%${query.trim()}%`;
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM (
					SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content,
						convert_from(content, 'UTF8')::json AS parsed
					FROM items
					WHERE owner_id = $1 AND jop_type = $2
				) sub
				WHERE COALESCE((parsed->>'deleted_time')::bigint, 0) = 0
					AND (
						parsed->>'title' ILIKE $3
						OR regexp_replace(
							regexp_replace(parsed->>'body', '!?\[[^\]]*\]\(:/[a-f0-9]+\)', '', 'g'),
							'data:image/[^;]+;base64,[A-Za-z0-9+/=]+', '', 'g'
						) ILIKE $3
					)
				ORDER BY jop_updated_time DESC, created_time DESC
				LIMIT $4 OFFSET $5
			`, [userId, MODEL_TYPE_NOTE, pattern, limit, offset]);

			return result.rows.map(mapNoteRow);
		},

		async noteByUserIdAndJopId(userId, noteId, options = {}) {
			const deleted = options.deleted || 'exclude';
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2 AND jop_id = $3${deletedFilterSql(deleted)}
				LIMIT 1
			`, [userId, MODEL_TYPE_NOTE, noteId]);

			const row = result.rows[0];
			if (!row) return null;
			return mapNoteRow(row);
		},

		// Returns the binary content of a resource blob (.resource/<id>)
		async resourceBlobByUserId(userId, resourceId) {
			const blobName = `.resource/${resourceId}`;
			const result = await database.query(`
				SELECT content
				FROM items
				WHERE owner_id = $1 AND name = $2
				LIMIT 1
			`, [userId, blobName]);

			const row = result.rows[0];
			if (!row) return null;
			return row.content; // Buffer
		},

		// Returns resource metadata (mime, filename, etc.) from the .md item
		async resourceMetaByUserId(userId, resourceId) {
			const result = await database.query(`
				SELECT content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2 AND jop_id = $3
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
	mapFolderRow,
	mapNoteHeaderRow,
	mapNoteRow,
};
