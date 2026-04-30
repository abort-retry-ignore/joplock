const { Pool } = require('pg');

const defaultSessionTtlMs = 12 * 60 * 60 * 1000;

const createPoolFromEnv = env => {
	return new Pool({
		host: env.POSTGRES_HOST || '127.0.0.1',
		port: Number(env.POSTGRES_PORT || '5432'),
		user: env.POSTGRES_USER || 'joplin',
		password: env.POSTGRES_PASSWORD || 'joplin',
		database: env.POSTGRES_DATABASE || 'joplin',
	});
};

const isSessionExpired = (createdTime, now = Date.now()) => {
	const numericCreatedTime = Number(createdTime || 0);
	if (!numericCreatedTime) return true;
	return now - numericCreatedTime >= defaultSessionTtlMs;
};

const createSessionService = database => {
	let _tableReady = null;

	const ensureTable = async () => {
		if (_tableReady !== null) return;
		try {
			await database.query(`
				CREATE TABLE IF NOT EXISTS joplock_sessions (
					session_id VARCHAR(64) PRIMARY KEY,
					last_seen BIGINT NOT NULL
				)
			`);
			_tableReady = true;
		} catch {
			_tableReady = false;
		}
	};

	return {
		async userBySessionId(sessionId) {
			if (!sessionId) return null;

			let result;
			try {
				result = await database.query(`
					SELECT
						s.id AS session_id,
						s.user_id,
						s.created_time AS session_created_time,
						u.id,
						u.email,
						u.full_name,
						u.is_admin,
						u.can_upload,
						u.email_confirmed,
						u.account_type,
						u.created_time,
						u.updated_time,
						u.enabled
					FROM sessions s
					INNER JOIN users u ON u.id = s.user_id
					WHERE s.id = $1
					LIMIT 1
				`, [sessionId]);
			} catch (err) {
				process.stderr.write(`[joplock] WARNING: session lookup failed: ${err.message}\n`);
				return null;
			}

			const row = result.rows[0];
			if (!row) return null;
			if (isSessionExpired(row.session_created_time)) return null;
			if (!Number(row.enabled)) return null;

			return {
				id: row.id,
				sessionId: row.session_id,
				email: row.email,
				fullName: row.full_name,
				isAdmin: !!Number(row.is_admin),
				canUpload: !!Number(row.can_upload),
				emailConfirmed: !!Number(row.email_confirmed),
				accountType: Number(row.account_type || 0),
				createdTime: Number(row.created_time || 0),
				updatedTime: Number(row.updated_time || 0),
			};
		},

		async touchSession(sessionId, now = Date.now()) {
			await ensureTable();
			if (!_tableReady) return;
			try {
				await database.query(`
					INSERT INTO joplock_sessions (session_id, last_seen)
					VALUES ($1, $2)
					ON CONFLICT (session_id) DO UPDATE SET last_seen = EXCLUDED.last_seen
				`, [sessionId, now]);
			} catch {
				// non-fatal
			}
		},

		async getLastSeen(sessionId) {
			await ensureTable();
			if (!_tableReady) return null;
			try {
				const result = await database.query(
					'SELECT last_seen FROM joplock_sessions WHERE session_id = $1 LIMIT 1',
					[sessionId],
				);
				return result.rows[0] ? Number(result.rows[0].last_seen) : null;
			} catch {
				return null;
			}
		},

		async deleteSession(sessionId) {
			// Delete from Joplin's sessions table (fully invalidates the session)
			try {
				await database.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
			} catch {
				// non-fatal — Joplin session may already be gone
			}
			// Delete from our tracking table
			await ensureTable();
			if (!_tableReady) return;
			try {
				await database.query(
					'DELETE FROM joplock_sessions WHERE session_id = $1',
					[sessionId],
				);
			} catch {
				// non-fatal
			}
		},
	};
};

module.exports = {
	createPoolFromEnv,
	createSessionService,
	defaultSessionTtlMs,
	isSessionExpired,
};
