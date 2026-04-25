const MAX_SNAPSHOTS = 50;
const MIN_INTERVAL_MS = 30000; // minimum 30s between snapshots for a given note

// simple djb2 hash for body deduplication
const hashBody = str => {
	let h = 5381;
	for (let i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
	return h.toString(36);
};

const nowMs = () => Date.now();

const createHistoryService = database => {
	let _tableAvailable = null;

	const ensureTable = async () => {
		if (_tableAvailable !== null) return;
		try {
			await database.query(`
				CREATE TABLE IF NOT EXISTS joplock_history (
					id BIGSERIAL PRIMARY KEY,
					note_id VARCHAR(32) NOT NULL,
					user_id VARCHAR(32) NOT NULL,
					title TEXT NOT NULL DEFAULT '',
					body TEXT NOT NULL DEFAULT '',
					body_hash VARCHAR(16) NOT NULL DEFAULT '',
					saved_time BIGINT NOT NULL
				)
			`);
			await database.query(`
				CREATE INDEX IF NOT EXISTS joplock_history_note_time
				ON joplock_history (note_id, saved_time DESC)
			`);
			_tableAvailable = true;
		} catch {
			_tableAvailable = false;
		}
	};

	return {
		/**
		 * Save a snapshot. Skips if:
		 * - table unavailable
		 * - body hash identical to most recent snapshot for this note
		 * - last snapshot for this note was < MIN_INTERVAL_MS ago
		 * After insert, prunes to MAX_SNAPSHOTS per note.
		 */
		async saveSnapshot(userId, noteId, title, body) {
			await ensureTable();
			if (!_tableAvailable) return;
			const hash = hashBody(body);
			const ts = nowMs();
			try {
				// check most recent snapshot
				const last = await database.query(
					'SELECT body_hash, saved_time FROM joplock_history WHERE note_id = $1 ORDER BY saved_time DESC LIMIT 1',
					[noteId],
				);
				const prev = last.rows[0];
				if (prev) {
					if (prev.body_hash === hash) return; // identical content
					if (ts - Number(prev.saved_time) < MIN_INTERVAL_MS) return; // too soon
				}
				await database.query(
					'INSERT INTO joplock_history (note_id, user_id, title, body, body_hash, saved_time) VALUES ($1,$2,$3,$4,$5,$6)',
					[noteId, userId, title || '', body || '', hash, ts],
				);
				// prune old entries beyond MAX_SNAPSHOTS
				await database.query(`
					DELETE FROM joplock_history
					WHERE note_id = $1 AND id NOT IN (
						SELECT id FROM joplock_history WHERE note_id = $1
						ORDER BY saved_time DESC LIMIT $2
					)
				`, [noteId, MAX_SNAPSHOTS]);
			} catch {
				// history is best-effort; never break saves
			}
		},

		/**
		 * List snapshots for a note (newest first), metadata only (no body).
		 */
		async listSnapshots(noteId) {
			await ensureTable();
			if (!_tableAvailable) return [];
			try {
				const result = await database.query(
					'SELECT id, title, saved_time FROM joplock_history WHERE note_id = $1 ORDER BY saved_time DESC LIMIT $2',
					[noteId, MAX_SNAPSHOTS],
				);
				return result.rows.map(r => ({
					id: String(r.id),
					title: r.title,
					savedTime: Number(r.saved_time),
				}));
			} catch {
				return [];
			}
		},

		/**
		 * Get a single snapshot by id (includes body).
		 */
		async getSnapshot(snapshotId) {
			await ensureTable();
			if (!_tableAvailable) return null;
			try {
				const result = await database.query(
					'SELECT id, note_id, title, body, saved_time FROM joplock_history WHERE id = $1 LIMIT 1',
					[snapshotId],
				);
				const r = result.rows[0];
				if (!r) return null;
				return {
					id: String(r.id),
					noteId: r.note_id,
					title: r.title,
					body: r.body,
					savedTime: Number(r.saved_time),
				};
			} catch {
				return null;
			}
		},
	};
};

module.exports = { createHistoryService, hashBody };
