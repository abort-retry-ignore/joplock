const validThemes = ['matrix','matrix-blue','matrix-purple','matrix-amber','matrix-orange','dark-grey','dark-red','dark','light','oled-dark','solarized-light','solarized-dark','nord','dracula','aritim-dark'];

const validDateFormats = [
	'YYYY-MM-DD',
	'MM/DD/YYYY',
	'DD/MM/YYYY',
	'MMM DD, YYYY',
	'DD MMM YYYY',
	'YYYY.MM.DD',
];

const validDatetimeFormats = [
	'YYYY-MM-DD HH:mm',
	'MM/DD/YYYY HH:mm',
	'DD/MM/YYYY HH:mm',
	'MMM DD, YYYY HH:mm',
	'DD MMM YYYY HH:mm',
	'YYYY.MM.DD HH:mm',
	'YYYY-MM-DD HH:mm:ss',
	'MM/DD/YYYY hh:mm A',
	'DD/MM/YYYY hh:mm A',
];

const defaultSettings = Object.freeze({
	noteFontSize: 15,
	mobileNoteFontSize: 17,
	codeFontSize: 12,
	noteMonospace: false,
	noteOpenMode: 'preview',
	resumeLastNote: true,
	lastNoteId: '',
	lastNoteFolderId: '',
	dateFormat: 'YYYY-MM-DD',
	datetimeFormat: 'YYYY-MM-DD HH:mm',
	autoLogout: false,
	autoLogoutMinutes: 15,
	theme: 'matrix',
	liveSearch: false,
});

const nowMs = () => Date.now();

const normalizeInteger = (value, fallback, min, max) => {
	const numeric = Number.parseInt(`${value}`, 10);
	if (Number.isNaN(numeric)) return fallback;
	return Math.max(min, Math.min(max, numeric));
};

const normalizeSettings = settings => ({
	noteFontSize: normalizeInteger(settings.noteFontSize, defaultSettings.noteFontSize, 12, 24),
	mobileNoteFontSize: normalizeInteger(settings.mobileNoteFontSize, normalizeInteger(settings.noteFontSize, defaultSettings.noteFontSize, 12, 24) + 2, 12, 28),
	codeFontSize: normalizeInteger(settings.codeFontSize, defaultSettings.codeFontSize, 10, 22),
	noteMonospace: !!Number(settings.noteMonospace) || settings.noteMonospace === true || settings.noteMonospace === '1',
	noteOpenMode: settings.noteOpenMode === 'markdown' ? 'markdown' : defaultSettings.noteOpenMode,
	resumeLastNote: !!Number(settings.resumeLastNote) || settings.resumeLastNote === true || settings.resumeLastNote === '1',
	lastNoteId: `${settings.lastNoteId || ''}`,
	lastNoteFolderId: `${settings.lastNoteFolderId || ''}`,
	dateFormat: validDateFormats.includes(settings.dateFormat) ? settings.dateFormat : defaultSettings.dateFormat,
	datetimeFormat: validDatetimeFormats.includes(settings.datetimeFormat) ? settings.datetimeFormat : defaultSettings.datetimeFormat,
	autoLogout: !!Number(settings.autoLogout) || settings.autoLogout === true || settings.autoLogout === '1',
	autoLogoutMinutes: normalizeInteger(settings.autoLogoutMinutes, defaultSettings.autoLogoutMinutes, 1, 480),
	theme: validThemes.includes(settings.theme) ? settings.theme : defaultSettings.theme,
	liveSearch: !!Number(settings.liveSearch) || settings.liveSearch === true || settings.liveSearch === '1',
});

const createSettingsService = database => {
	let _tableAvailable = null;

	const ensureTable = async () => {
		if (_tableAvailable !== null) return;
		try {
			await database.query(`
				CREATE TABLE IF NOT EXISTS joplock_settings (
					user_id VARCHAR(32) PRIMARY KEY,
					settings JSONB NOT NULL DEFAULT '{}',
					updated_time BIGINT NOT NULL,
					totp_seed VARCHAR(64)
				)
			`);
			// Add totp_seed column if missing (migration for existing tables)
			await database.query(`
				ALTER TABLE joplock_settings ADD COLUMN IF NOT EXISTS totp_seed VARCHAR(64)
			`).catch(() => {});
			_tableAvailable = true;
		} catch {
			_tableAvailable = false;
		}
	};

	return {
		async settingsByUserId(userId) {
			await ensureTable();
			if (!_tableAvailable) return { ...defaultSettings };
			try {
				const result = await database.query(
					'SELECT settings FROM joplock_settings WHERE user_id = $1 LIMIT 1',
					[userId],
				);
				const row = result.rows[0];
				if (!row) return { ...defaultSettings };
				const json = typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings || {});
				return normalizeSettings({ ...defaultSettings, ...json });
			} catch {
				return { ...defaultSettings };
			}
		},

		async saveSettings(userId, settings) {
			await ensureTable();
			const normalized = normalizeSettings(settings);
			if (!_tableAvailable) return normalized;
			const timestamp = nowMs();
			await database.query(`
				INSERT INTO joplock_settings (user_id, settings, updated_time)
				VALUES ($1, $2, $3)
				ON CONFLICT (user_id) DO UPDATE SET
					settings = EXCLUDED.settings,
					updated_time = EXCLUDED.updated_time
			`, [userId, JSON.stringify(normalized), timestamp]);
			return normalized;
		},

		async getTotpSeed(userId) {
			await ensureTable();
			if (!_tableAvailable) return null;
			try {
				const result = await database.query(
					'SELECT totp_seed FROM joplock_settings WHERE user_id = $1 LIMIT 1',
					[userId],
				);
				return result.rows[0]?.totp_seed || null;
			} catch {
				return null;
			}
		},

		async setTotpSeed(userId, seed) {
			await ensureTable();
			if (!_tableAvailable) return false;
			const timestamp = nowMs();
			try {
				await database.query(`
					INSERT INTO joplock_settings (user_id, settings, updated_time, totp_seed)
					VALUES ($1, '{}', $2, $3)
					ON CONFLICT (user_id) DO UPDATE SET
						totp_seed = EXCLUDED.totp_seed,
						updated_time = EXCLUDED.updated_time
				`, [userId, timestamp, seed]);
				return true;
			} catch {
				return false;
			}
		},

		async clearTotpSeed(userId) {
			await ensureTable();
			if (!_tableAvailable) return false;
			const timestamp = nowMs();
			try {
				await database.query(
					'UPDATE joplock_settings SET totp_seed = NULL, updated_time = $2 WHERE user_id = $1',
					[userId, timestamp],
				);
				return true;
			} catch {
				return false;
			}
		},
	};
};

module.exports = {
	createSettingsService,
	defaultSettings,
	normalizeSettings,
	validDateFormats,
	validDatetimeFormats,
	validThemes,
};
