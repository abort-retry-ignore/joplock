'use strict';

// vaultService: manages vault metadata (encrypted folder registry)
// A vault is a Joplin folder with encryption enabled.
// Vault password is set at creation and never changes.
// Salt + verify blob stored in joplock_vaults table (not in Joplin's items table).

const createVaultService = database => {
	let _tableAvailable = null;

	const ensureTable = async () => {
		if (_tableAvailable !== null) return;
		try {
			await database.query(`
				CREATE TABLE IF NOT EXISTS joplock_vaults (
					id         SERIAL PRIMARY KEY,
					user_id    VARCHAR(64) NOT NULL,
					folder_id  VARCHAR(64) NOT NULL,
					salt       TEXT NOT NULL,
					verify     TEXT NOT NULL,
					created_at TIMESTAMPTZ DEFAULT NOW(),
					UNIQUE (user_id, folder_id)
				)
			`);
			_tableAvailable = true;
		} catch {
			_tableAvailable = false;
		}
	};

	return {
		// Create a vault for a folder. salt and verify are base64 strings.
		async createVault(userId, folderId, salt, verify) {
			await ensureTable();
			if (!_tableAvailable) throw new Error('Vault table not available');
			await database.query(`
				INSERT INTO joplock_vaults (user_id, folder_id, salt, verify)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (user_id, folder_id) DO NOTHING
			`, [userId, folderId, salt, verify]);
			return { userId, folderId, salt };
		},

		// Return all vaults for a user: [{ folderId, salt, createdAt }]
		async getVaultsByUserId(userId) {
			await ensureTable();
			if (!_tableAvailable) return [];
			try {
				const result = await database.query(
					'SELECT folder_id, salt, verify, created_at FROM joplock_vaults WHERE user_id = $1 ORDER BY created_at ASC',
					[userId],
				);
				return result.rows.map(r => ({ folderId: r.folder_id, salt: r.salt, verify: r.verify, createdAt: r.created_at }));
			} catch {
				return [];
			}
		},

		// Return a single vault by folderId for a user
		async getVaultByFolderId(userId, folderId) {
			await ensureTable();
			if (!_tableAvailable) return null;
			try {
				const result = await database.query(
					'SELECT folder_id, salt, verify, created_at FROM joplock_vaults WHERE user_id = $1 AND folder_id = $2 LIMIT 1',
					[userId, folderId],
				);
				const row = result.rows[0];
				if (!row) return null;
				return { folderId: row.folder_id, salt: row.salt, verify: row.verify, createdAt: row.created_at };
			} catch {
				return null;
			}
		},

		// Return a Set of vault folder IDs for a user (for fast membership checks)
		async getVaultFolderIdSet(userId) {
			await ensureTable();
			if (!_tableAvailable) return new Set();
			try {
				const result = await database.query(
					'SELECT folder_id FROM joplock_vaults WHERE user_id = $1',
					[userId],
				);
				return new Set(result.rows.map(r => r.folder_id));
			} catch {
				return new Set();
			}
		},

		// Delete a vault entry (does NOT decrypt notes — caller must handle that)
		async deleteVault(userId, folderId) {
			await ensureTable();
			if (!_tableAvailable) return false;
			try {
				await database.query(
					'DELETE FROM joplock_vaults WHERE user_id = $1 AND folder_id = $2',
					[userId, folderId],
				);
				return true;
			} catch {
				return false;
			}
		},
	};
};

module.exports = { createVaultService };
