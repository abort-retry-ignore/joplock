const validThemes = ['matrix','matrix-blue','matrix-purple','matrix-amber','matrix-orange','dark-grey','dark-red','dark','light','oled-dark','solarized-light','solarized-dark','nord','dracula','aritim-dark'];

// Provider templates — preset URL and default model per service.
// 'custom' allows any OpenAI-compatible URL.
const AI_PROVIDERS = [
	{ id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', defaultModel: 'openai/gpt-4o-mini' },
	{ id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini' },
	{ id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', defaultModel: 'llama3-8b-8192' },
	{ id: 'together', name: 'Together AI', url: 'https://api.together.xyz/v1/chat/completions', defaultModel: 'meta-llama/Llama-3-8b-chat-hf' },
	{ id: 'mistral', name: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', defaultModel: 'mistral-small-latest' },
	{ id: 'perplexity', name: 'Perplexity', url: 'https://api.perplexity.ai/chat/completions', defaultModel: 'sonar' },
	{ id: 'ollama', name: 'Ollama (local)', url: 'http://localhost:11434/v1/chat/completions', defaultModel: 'llama3.2' },
	{ id: 'custom', name: 'Custom', url: '', defaultModel: '' },
];

const AI_PROVIDER_IDS = new Set(AI_PROVIDERS.map(p => p.id));

const normalizeNumber = (value, fallback, min, max) => {
	const numeric = Number.parseFloat(`${value}`);
	if (Number.isNaN(numeric)) return fallback;
	return Math.max(min, Math.min(max, numeric));
};

// Normalize a single user-defined profile (new format: {id, name, providerId, apiKey, model, url, temperature, active}).
const normalizeAiProfile = input => ({
	id: `${(input && input.id) || ''}`.trim(),
	name: `${(input && input.name) || ''}`.trim(),
	providerId: AI_PROVIDER_IDS.has(`${(input && input.providerId) || ''}`) ? `${input.providerId}` : 'openrouter',
	apiKey: `${(input && input.apiKey) || ''}`.trim(),
	model: `${(input && input.model) || ''}`.trim(),
	url: `${(input && input.url) || ''}`.trim(),
	temperature: normalizeNumber(input && input.temperature, 0.7, 0, 2),
	active: !!(input && input.active),
});

const normalizeAiProfiles = (aiProfiles, legacyApiKey, legacyModel) => {
	let inputArray = aiProfiles;
	if (typeof inputArray === 'string') {
		try { inputArray = JSON.parse(inputArray); } catch (_) { inputArray = []; }
	}
	if (!Array.isArray(inputArray)) inputArray = [];

	// Detect old slot-format (10 entries keyed by provider id, no providerId field).
	// Old entries have their provider id as the id (e.g. 'openrouter', 'openai', ...)
	const isOldFormat = inputArray.length > 0 && inputArray[0] && !inputArray[0].providerId && AI_PROVIDER_IDS.has(`${inputArray[0].id || ''}`);

	let result;
	if (isOldFormat) {
		// Migrate old format: create new-format profiles for any slot that has an API key.
		result = inputArray
			.filter(p => p && p.apiKey)
			.map((p, i) => {
				const prov = AI_PROVIDERS.find(pv => pv.id === p.id);
				return {
					id: `p-${p.id}-${i}`,
					name: (prov && prov.name) || p.id,
					providerId: AI_PROVIDER_IDS.has(`${p.id || ''}`) ? p.id : 'openrouter',
					apiKey: `${p.apiKey || ''}`.trim(),
					model: `${p.model || ''}`.trim(),
					url: `${p.url || ''}`.trim(),
					temperature: normalizeNumber(p.temperature, 0.7, 0, 2),
					active: !!p.active,
				};
			});
	} else {
		// New format: each entry is a user-defined profile with an id, name, and providerId.
		result = inputArray
			.filter(p => p && typeof p === 'object')
			.map(p => normalizeAiProfile(p))
			.filter(p => p.id);
	}

	// Legacy key migration: if no profiles exist and the old openRouterApiKey is set, create one.
	if (result.length === 0) {
		const legKey = `${legacyApiKey || ''}`.trim();
		if (legKey) {
			result = [{
				id: 'p-legacy-openrouter',
				name: 'OpenRouter',
				providerId: 'openrouter',
				apiKey: legKey,
				model: `${legacyModel || ''}`.trim(),
				url: '',
				temperature: 0.7,
				active: true,
			}];
		}
	}

	// Ensure exactly one profile is active (when profiles exist).
	if (result.length > 0) {
		const activeCount = result.filter(p => p.active).length;
		if (activeCount === 0) {
			result[0].active = true;
		} else if (activeCount > 1) {
			let seen = false;
			for (const p of result) { if (p.active) { if (seen) p.active = false; else seen = true; } }
		}
	}

	return result;
};

// defaultAiProfiles: empty — profiles are fully user-defined.
const defaultAiProfiles = [];

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
	highlightActiveLine: true,
	confirmTrash: true,
	encryptionAutoLockMinutes: 5,
	uiMode: 'auto',
	proseAutocompleteSentenceCount: 1,
	openRouterApiKey: '',
	openRouterModel: 'openai/gpt-4o-mini',
	aiProfiles: defaultAiProfiles,  // empty [] — profiles are user-defined
	textExpanders: [],
});

const APP_SETTINGS_ROW_ID = '__app__';

const defaultAppSettings = Object.freeze({
	authRateLimitAttempts: 20,
});

const validUiModes = ['auto', 'mobile', 'desktop'];
const nowMs = () => Date.now();

const normalizeInteger = (value, fallback, min, max) => {
	const numeric = Number.parseInt(`${value}`, 10);
	if (Number.isNaN(numeric)) return fallback;
	return Math.max(min, Math.min(max, numeric));
};

const normalizeTextExpanders = entries => {
	let list = entries;
	if (typeof list === 'string') {
		try { list = JSON.parse(list); } catch { list = []; }
	}
	if (!Array.isArray(list)) return [];
	const seen = new Set();
	return list.map(entry => {
		const trigger = `${entry && entry.trigger != null ? entry.trigger : ''}`.trim().slice(0, 15);
		const action = `${entry && entry.action === 'ai' ? 'ai' : 'text'}`;
		const text = `${entry && entry.text != null ? entry.text : ''}`;
		if (!trigger || seen.has(trigger) || (action === 'text' && !text)) return null;
		seen.add(trigger);
		return {
			id: `${entry.id || ''}`.trim() || `te-${trigger}`,
			trigger,
			action,
			profileId: `${entry && entry.profileId != null ? entry.profileId : ''}`.trim(),
			text,
		};
	}).filter(Boolean).slice(0, 100);
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
	highlightActiveLine: settings.highlightActiveLine !== false && settings.highlightActiveLine !== '0' && settings.highlightActiveLine !== 0,
	confirmTrash: settings.confirmTrash !== false && settings.confirmTrash !== '0' && settings.confirmTrash !== 0,
	encryptionAutoLockMinutes: normalizeInteger(settings.encryptionAutoLockMinutes, defaultSettings.encryptionAutoLockMinutes, 0, 480),
	uiMode: validUiModes.includes(settings.uiMode) ? settings.uiMode : defaultSettings.uiMode,
	proseAutocompleteSentenceCount: normalizeInteger(settings.proseAutocompleteSentenceCount, defaultSettings.proseAutocompleteSentenceCount, 1, 8),
	openRouterApiKey: `${settings.openRouterApiKey || ''}`.trim(),
	openRouterModel: `${settings.openRouterModel || ''}`.trim() || defaultSettings.openRouterModel,
	aiProfiles: normalizeAiProfiles(settings.aiProfiles, settings.openRouterApiKey, settings.openRouterModel),
	textExpanders: normalizeTextExpanders(settings.textExpanders),
});

const normalizeAppSettings = settings => ({
	authRateLimitAttempts: normalizeInteger(settings.authRateLimitAttempts, defaultAppSettings.authRateLimitAttempts, 1, 1000),
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

		async appSettings() {
			await ensureTable();
			if (!_tableAvailable) return { ...defaultAppSettings };
			try {
				const result = await database.query(
					'SELECT settings FROM joplock_settings WHERE user_id = $1 LIMIT 1',
					[APP_SETTINGS_ROW_ID],
				);
				const row = result.rows[0];
				if (!row) return { ...defaultAppSettings };
				const json = typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings || {});
				return normalizeAppSettings({ ...defaultAppSettings, ...json });
			} catch {
				return { ...defaultAppSettings };
			}
		},

		async saveAppSettings(settings) {
			await ensureTable();
			const normalized = normalizeAppSettings(settings);
			if (!_tableAvailable) return normalized;
			const timestamp = nowMs();
			await database.query(`
				INSERT INTO joplock_settings (user_id, settings, updated_time)
				VALUES ($1, $2, $3)
				ON CONFLICT (user_id) DO UPDATE SET
					settings = EXCLUDED.settings,
					updated_time = EXCLUDED.updated_time
			`, [APP_SETTINGS_ROW_ID, JSON.stringify(normalized), timestamp]);
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
	defaultAppSettings,
	defaultSettings,
	normalizeAppSettings,
	normalizeSettings,
	validDateFormats,
	validDatetimeFormats,
	validThemes,
	validUiModes,
	AI_PROVIDERS,
	AI_PROVIDER_IDS,
	defaultAiProfiles,
	normalizeAiProfile,
	normalizeAiProfiles,
	normalizeTextExpanders,
};
