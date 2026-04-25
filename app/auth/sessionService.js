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
	return {
		async userBySessionId(sessionId) {
			if (!sessionId) return null;

			const result = await database.query(`
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
	};
};

module.exports = {
	createPoolFromEnv,
	createSessionService,
	defaultSessionTtlMs,
	isSessionExpired,
};
