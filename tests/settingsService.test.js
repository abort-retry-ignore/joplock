const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsService, defaultAppSettings, defaultSettings, normalizeAppSettings, normalizeSettings, AI_PROVIDERS, normalizeAiProfiles, normalizeTextExpanders, defaultAiProfiles } = require('../app/settingsService');

test('settingsService returns defaults when row is missing', async () => {
	const queries = [];
	const service = createSettingsService({
		query: async (sql, params) => {
			queries.push({ sql, params });
			if (sql.includes('SELECT')) return { rows: [] };
			return { rows: [] };
		},
	});
	const settings = await service.settingsByUserId('user-1');
	assert.deepEqual(settings, defaultSettings);
	assert.ok(queries[0].sql.includes('CREATE TABLE IF NOT EXISTS joplock_settings'));
});

test('settingsService saves normalized settings as JSON', async () => {
	const calls = [];
	const service = createSettingsService({
		query: async (sql, params) => {
			calls.push({ sql, params });
			return { rows: [] };
		},
	});
	const saved = await service.saveSettings('user-1', {
		noteFontSize: '99',
		codeFontSize: '8',
		noteMonospace: '1',
		resumeLastNote: '1',
		lastNoteId: 'note-1',
		lastNoteFolderId: '__all_notes__',
		dateFormat: 'DD/MM/YYYY',
		datetimeFormat: 'DD/MM/YYYY HH:mm',
		autoLogout: '1',
		autoLogoutMinutes: '30',
		openRouterApiKey: '  sk-or-v1-test  ',
		openRouterModel: 'openai/gpt-4o-mini',
	});
	assert.equal(saved.noteFontSize, 24);
	assert.equal(saved.codeFontSize, 10);
	assert.equal(saved.noteMonospace, true);
	assert.equal(saved.resumeLastNote, true);
	assert.equal(saved.lastNoteId, 'note-1');
	assert.equal(saved.lastNoteFolderId, '__all_notes__');
	assert.equal(saved.dateFormat, 'DD/MM/YYYY');
	assert.equal(saved.datetimeFormat, 'DD/MM/YYYY HH:mm');
	assert.equal(saved.autoLogout, true);
	assert.equal(saved.autoLogoutMinutes, 30);
	assert.equal(saved.openRouterApiKey, 'sk-or-v1-test');
	assert.equal(saved.openRouterModel, 'openai/gpt-4o-mini');
	assert.deepEqual(saved.textExpanders, []);
	const insertCall = calls.find(c => c.sql.includes('INSERT INTO joplock_settings'));
	assert.ok(insertCall, 'should insert into joplock_settings');
	const jsonStr = insertCall.params[1];
	const parsed = JSON.parse(jsonStr);
	assert.equal(parsed.autoLogout, true);
	assert.equal(parsed.autoLogoutMinutes, 30);
	assert.equal(parsed.openRouterApiKey, 'sk-or-v1-test');
	assert.equal(parsed.openRouterModel, 'openai/gpt-4o-mini');
});

test('normalizeSettings stores text expanders', () => {
	const settings = normalizeSettings({ textExpanders: JSON.stringify([{ id: 'one', trigger: ' ;sig ', text: 'Regards' }, { trigger: ';sig', text: 'Duplicate' }, { trigger: '', text: 'Missing' }, { trigger: '12345678901234567890', text: 'Long' }, { trigger: ':ai', action: 'ai', profileId: 'p1' }]) });
	assert.deepEqual(settings.textExpanders, [{ id: 'one', trigger: ';sig', action: 'text', profileId: '', text: 'Regards' }, { id: 'te-123456789012345', trigger: '123456789012345', action: 'text', profileId: '', text: 'Long' }, { id: 'te-:ai', trigger: ':ai', action: 'ai', profileId: 'p1', text: '' }]);
	assert.deepEqual(normalizeTextExpanders([{ trigger: ';br', text: 'Best regards' }]), [{ id: 'te-;br', trigger: ';br', action: 'text', profileId: '', text: 'Best regards' }]);
});

test('settingsService reads JSON settings from row', async () => {
	const stored = { noteFontSize: 18, codeFontSize: 14, noteMonospace: true, dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm', autoLogout: true, autoLogoutMinutes: 60 };
	const service = createSettingsService({
		query: async (sql) => {
			if (sql.includes('SELECT')) return { rows: [{ settings: stored }] };
			return { rows: [] };
		},
	});
	const settings = await service.settingsByUserId('user-1');
	assert.equal(settings.noteFontSize, 18);
	assert.equal(settings.autoLogout, true);
	assert.equal(settings.autoLogoutMinutes, 60);
});

test('settingsService appSettings returns defaults when row is missing', async () => {
	const service = createSettingsService({
		query: async (sql) => {
			if (sql.includes('SELECT')) return { rows: [] };
			return { rows: [] };
		},
	});
	const settings = await service.appSettings();
	assert.deepEqual(settings, defaultAppSettings);
});

test('settingsService saves normalized app settings as JSON', async () => {
	const calls = [];
	const service = createSettingsService({
		query: async (sql, params) => {
			calls.push({ sql, params });
			return { rows: [] };
		},
	});
	const saved = await service.saveAppSettings({ authRateLimitAttempts: '9999' });
	assert.equal(saved.authRateLimitAttempts, 1000);
	const insertCall = calls.find(c => c.sql.includes('INSERT INTO joplock_settings'));
	assert.ok(insertCall, 'should insert app settings into joplock_settings');
	assert.equal(insertCall.params[0], '__app__');
	assert.equal(JSON.parse(insertCall.params[1]).authRateLimitAttempts, 1000);
});

test('settingsService returns defaults when table creation fails', async () => {
	const service = createSettingsService({
		query: async () => { throw new Error('permission denied'); },
	});
	const settings = await service.settingsByUserId('user-1');
	assert.deepEqual(settings, defaultSettings);
});

test('normalizeSettings clamps autoLogoutMinutes', () => {
	assert.equal(normalizeSettings({ autoLogoutMinutes: 0 }).autoLogoutMinutes, 1);
	assert.equal(normalizeSettings({ autoLogoutMinutes: 999 }).autoLogoutMinutes, 480);
	assert.equal(normalizeSettings({ autoLogoutMinutes: 'abc' }).autoLogoutMinutes, 15);
	assert.equal(normalizeSettings({ autoLogoutMinutes: 120 }).autoLogoutMinutes, 120);
});

test('normalizeSettings coerces autoLogout', () => {
	assert.equal(normalizeSettings({ autoLogout: '1' }).autoLogout, true);
	assert.equal(normalizeSettings({ autoLogout: true }).autoLogout, true);
	assert.equal(normalizeSettings({ autoLogout: 1 }).autoLogout, true);
	assert.equal(normalizeSettings({ autoLogout: '0' }).autoLogout, false);
	assert.equal(normalizeSettings({ autoLogout: false }).autoLogout, false);
	assert.equal(normalizeSettings({ autoLogout: undefined }).autoLogout, false);
});

test('normalizeSettings coerces resumeLastNote and preserves last note state', () => {
	const settings = normalizeSettings({ resumeLastNote: '1', lastNoteId: 'n1', lastNoteFolderId: '__all_notes__' });
	assert.equal(settings.resumeLastNote, true);
	assert.equal(settings.lastNoteId, 'n1');
	assert.equal(settings.lastNoteFolderId, '__all_notes__');
	assert.equal(normalizeSettings({ resumeLastNote: '0' }).resumeLastNote, false);
});

test('normalizeSettings accepts new matrix theme variants', () => {
	assert.equal(normalizeSettings({ theme: 'matrix-blue' }).theme, 'matrix-blue');
	assert.equal(normalizeSettings({ theme: 'matrix-purple' }).theme, 'matrix-purple');
	assert.equal(normalizeSettings({ theme: 'matrix-amber' }).theme, 'matrix-amber');
	assert.equal(normalizeSettings({ theme: 'matrix-orange' }).theme, 'matrix-orange');
	assert.equal(normalizeSettings({ theme: 'not-a-theme' }).theme, 'matrix');
});

test('normalizeSettings coerces autocomplete settings and trims openRouter fields', () => {
	const settings = normalizeSettings({ autocompleteEnabled: '0', proseAutocompleteManualTrigger: 'ellipsis', proseAutocompleteSentenceCount: '99', openRouterApiKey: '  key  ', openRouterModel: '  model  ' });
	assert.equal(settings.autocompleteEnabled, undefined);
	assert.equal(settings.proseAutocompleteManualTrigger, undefined);
	assert.equal(settings.proseAutocompleteSentenceCount, 8);
	assert.equal(settings.openRouterApiKey, 'key');
	assert.equal(settings.openRouterModel, 'model');
	assert.equal(normalizeSettings({ proseAutocompleteSentenceCount: '3' }).proseAutocompleteSentenceCount, 3);
});

test('normalizeAppSettings clamps authRateLimitAttempts', () => {
	assert.equal(normalizeAppSettings({ authRateLimitAttempts: 0 }).authRateLimitAttempts, 1);
	assert.equal(normalizeAppSettings({ authRateLimitAttempts: 2000 }).authRateLimitAttempts, 1000);
	assert.equal(normalizeAppSettings({ authRateLimitAttempts: 'abc' }).authRateLimitAttempts, 20);
	assert.equal(normalizeAppSettings({ authRateLimitAttempts: 25 }).authRateLimitAttempts, 25);
});

test('AI_PROVIDERS has 8 entries with expected provider ids', () => {
	assert.equal(AI_PROVIDERS.length, 8);
	const ids = AI_PROVIDERS.map(p => p.id);
	assert.ok(ids.includes('openrouter'));
	assert.ok(ids.includes('openai'));
	assert.ok(ids.includes('groq'));
	assert.ok(ids.includes('together'));
	assert.ok(ids.includes('mistral'));
	assert.ok(ids.includes('perplexity'));
	assert.ok(ids.includes('ollama'));
	assert.ok(ids.includes('custom'));
	assert.ok(!ids.includes('custom1'));
	assert.ok(!ids.includes('custom2'));
	assert.ok(!ids.includes('custom3'));
	for (const p of AI_PROVIDERS) {
		assert.ok(typeof p.url === 'string', `${p.id} url should be string`);
		assert.ok(typeof p.defaultModel === 'string', `${p.id} defaultModel should be string`);
	}
});

test('defaultAiProfiles is empty (profiles are fully user-defined)', () => {
	assert.deepEqual(defaultAiProfiles, []);
});

test('normalizeAiProfiles returns empty array when no profiles and no legacy key', () => {
	const result = normalizeAiProfiles([], '', '');
	assert.deepEqual(result, []);
});

test('normalizeAiProfiles migrates legacy openRouterApiKey to openrouter profile', () => {
	const result = normalizeAiProfiles([], 'sk-or-v1-legacykey', 'openai/gpt-4o-mini');
	assert.equal(result.length, 1);
	const profile = result[0];
	assert.equal(profile.id, 'p-legacy-openrouter');
	assert.equal(profile.providerId, 'openrouter');
	assert.equal(profile.apiKey, 'sk-or-v1-legacykey');
	assert.equal(profile.model, 'openai/gpt-4o-mini');
	assert.equal(profile.temperature, 0.7);
	assert.equal(profile.active, true);
});

test('normalizeAiProfiles does not migrate legacy key when profile already has one', () => {
	// Old-format profile (id === provider id, no providerId) is detected and migrated.
	const existing = [{ id: 'openrouter', apiKey: 'sk-existing', model: 'gpt-4', url: '', active: true }];
	const result = normalizeAiProfiles(existing, 'sk-legacy', 'old-model');
	// Should have migrated to one new-format profile with providerId 'openrouter'
	const profile = result.find(p => p.providerId === 'openrouter');
	assert.ok(profile, 'should have an openrouter-provider profile');
	assert.equal(profile.apiKey, 'sk-existing');
	assert.equal(profile.model, 'gpt-4');
	// Legacy key must not be used
	assert.ok(!result.some(p => p.apiKey === 'sk-legacy'));
});

test('normalizeAiProfiles ensures exactly one active profile', () => {
	// New-format profiles: multiple active → keep only the first
	const multi = [
		{ id: 'p-1', name: 'First', providerId: 'openrouter', apiKey: 'k1', model: '', url: '', active: true },
		{ id: 'p-2', name: 'Second', providerId: 'openai', apiKey: 'k2', model: '', url: '', active: true },
		{ id: 'p-3', name: 'Third', providerId: 'groq', apiKey: 'k3', model: '', url: '', active: true },
	];
	const result = normalizeAiProfiles(multi, '', '');
	const active = result.filter(p => p.active);
	assert.equal(active.length, 1);
	assert.equal(active[0].id, 'p-1');
});

test('normalizeAiProfiles accepts JSON string input', () => {
	const profiles = [{ id: 'p-abc', name: 'My Groq', providerId: 'groq', apiKey: 'gsk-key', model: 'llama3', url: '', temperature: 1.3, active: true }];
	const result = normalizeAiProfiles(JSON.stringify(profiles), '', '');
	assert.equal(result.length, 1);
	const groq = result.find(p => p.id === 'p-abc');
	assert.ok(groq, 'should find profile by id');
	assert.equal(groq.providerId, 'groq');
	assert.equal(groq.apiKey, 'gsk-key');
	assert.equal(groq.temperature, 1.3);
	assert.equal(groq.active, true);
});

test('normalizeSettings includes aiProfiles with backward migration from openRouterApiKey', () => {
	const result = normalizeSettings({ openRouterApiKey: 'sk-or-v1-test', openRouterModel: 'openai/gpt-4o-mini' });
	assert.ok(Array.isArray(result.aiProfiles));
	assert.equal(result.aiProfiles.length, 1);
	const profile = result.aiProfiles[0];
	assert.equal(profile.id, 'p-legacy-openrouter');
	assert.equal(profile.providerId, 'openrouter');
	assert.equal(profile.apiKey, 'sk-or-v1-test');
	assert.equal(profile.model, 'openai/gpt-4o-mini');
	assert.equal(profile.temperature, 0.7);
	assert.equal(profile.active, true);
});

test('normalizeSettings preserves aiProfiles when already set', () => {
	const profiles = [
		{ id: 'p-my-groq', name: 'My Groq', providerId: 'groq', apiKey: 'gsk-key', model: '', url: '', temperature: 2.5, active: true },
		{ id: 'p-my-or', name: 'My OpenRouter', providerId: 'openrouter', apiKey: 'sk-key', model: '', url: '', active: false },
	];
	const result = normalizeSettings({ aiProfiles: profiles });
	assert.equal(result.aiProfiles.length, 2);
	const groq = result.aiProfiles.find(p => p.id === 'p-my-groq');
	assert.ok(groq, 'should find groq profile by id');
	assert.equal(groq.apiKey, 'gsk-key');
	assert.equal(groq.temperature, 2);
	assert.equal(groq.active, true);
});
