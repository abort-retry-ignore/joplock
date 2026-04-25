const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsService, defaultSettings, normalizeSettings } = require('../app/settingsService');

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
	const insertCall = calls.find(c => c.sql.includes('INSERT INTO joplock_settings'));
	assert.ok(insertCall, 'should insert into joplock_settings');
	const jsonStr = insertCall.params[1];
	const parsed = JSON.parse(jsonStr);
	assert.equal(parsed.autoLogout, true);
	assert.equal(parsed.autoLogoutMinutes, 30);
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
