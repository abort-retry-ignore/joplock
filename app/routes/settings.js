'use strict';

const { generateSeed, otpauthUri, qrCodeDataUrl, verifyWithSeed } = require('../auth/mfaService');
const { redirect, parseBody } = require('./_helpers');
const templates = require('../templates');

const summarizeCompressionUsage = rows => {
	const usageRows = Array.isArray(rows) ? rows.map(row => ({
		compression: row.compression || 'none',
		rowCount: Number(row.row_count || 0),
		totalBytes: Number(row.total_bytes || 0),
	})) : [];
	const activeRows = usageRows.filter(row => row.rowCount > 0);
	const compressionNames = new Set(activeRows.map(row => row.compression));
	return {
		current: !activeRows.length ? 'none' : (compressionNames.size === 1 ? activeRows[0].compression : 'mixed'),
		rows: usageRows,
	};
};

const handle = async (url, request, response, ctx) => {
	const { sendHtml, authenticatedUser, settingsService, adminService, database, isJoplockAdmin, backupService, maintenance } = ctx;

	// GET /settings
	if (url.pathname === '/settings' && request.method === 'GET') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		const settings = await settingsService.settingsByUserId(auth.user.id);
		const isAdmin = isJoplockAdmin(auth.user);
		const appSettings = isAdmin ? await settingsService.appSettings() : null;
		let dbCompression = null;
		let adminUsers = null;
		let backups = [];
		if (isAdmin) {
			try {
				const users = await adminService.listUsers();
				adminUsers = await Promise.all(users.map(async u => {
					const totpSeed = await settingsService.getTotpSeed(u.id);
					return {
						...u,
						totpEnabled: !!totpSeed,
						totpSeed: totpSeed || null,
						totpQr: totpSeed ? qrCodeDataUrl(otpauthUri(totpSeed, u.email, 'Joplock')) : null,
					};
				}));
			} catch {}
			try {
				if (backupService && backupService.isConfigured()) backups = await backupService.listBackups();
			} catch {}
			try {
				const versionResult = await database.query('SELECT current_setting(\'server_version\') AS version, current_setting(\'server_version_num\')::int AS version_num');
				const versionRow = versionResult.rows[0] || {};
				const pgVersion = versionRow.version || '';
				const pgVersionNum = Number(versionRow.version_num || 0);
				const supportsToastCompression = pgVersionNum >= 140000;
				if (supportsToastCompression) {
					const [settingsResult, usageResult] = await Promise.all([
						database.query(`
						SELECT current_setting('default_toast_compression') AS current,
							(SELECT enumvals FROM pg_settings WHERE name = 'default_toast_compression') AS available
						`),
						database.query(`
							SELECT
								CASE
									WHEN jop_type = 1 THEN 'notes'
									WHEN name LIKE '.resource/%' THEN 'attachments'
								END AS kind,
								COALESCE(pg_column_compression(content), 'none') AS compression,
								COUNT(*) AS row_count,
								COALESCE(SUM(octet_length(content)), 0) AS total_bytes
							FROM items
							WHERE jop_type = 1 OR name LIKE '.resource/%'
							GROUP BY 1, 2
							ORDER BY 1, 2
						`),
					]);
					const row = settingsResult.rows[0] || {};
					const usageRows = Array.isArray(usageResult.rows) ? usageResult.rows : [];
					dbCompression = {
						pgVersion,
						supported: true,
						current: row.current || '',
						available: Array.isArray(row.available) ? row.available : [],
						usage: {
							notes: summarizeCompressionUsage(usageRows.filter(entry => entry.kind === 'notes')),
							attachments: summarizeCompressionUsage(usageRows.filter(entry => entry.kind === 'attachments')),
						},
					};
				} else {
					dbCompression = { pgVersion, supported: false, current: '', available: [], usage: null };
				}
			} catch {}
		}
		const userTotpSeed = await settingsService.getTotpSeed(auth.user.id);
		const userTotpEnabled = !!userTotpSeed;
		const setupSeed = url.searchParams.get('mfaSetup') || '';
		const userTotpSetupSeed = setupSeed && !userTotpEnabled ? setupSeed : '';
		const userTotpSetupQr = userTotpSetupSeed ? qrCodeDataUrl(otpauthUri(userTotpSetupSeed, auth.user.email, 'Joplock')) : '';
		const savedParam = url.searchParams.get('saved') || '';
		sendHtml(response, 200, templates.settingsPage({
			user: auth.user,
			settings,
			userTotpEnabled,
			userTotpSetupSeed,
			userTotpSetupQr,
			isAdmin,
			isDockerAdmin: isAdmin,
			adminUsers,
			backups,
			backupEnabled: !!(backupService && backupService.isConfigured()),
			backupBusy: !!(backupService && backupService.isBusy && backupService.isBusy()),
			maintenanceMode: maintenance && maintenance.isEnabled ? maintenance.isEnabled() : false,
			activeOperation: maintenance && maintenance.reason ? maintenance.reason() : '',
			dbCompression,
			appSettings,
			flash: savedParam === '1' ? 'Settings saved.' : (savedParam || (url.searchParams.get('mfaEnabled') === '1' ? 'MFA enabled successfully.' : '')),
			flashError: url.searchParams.get('error') || '',
			activeTab: url.searchParams.get('tab') || 'appearance',
			hasExplicitTab: url.searchParams.has('tab'),
		}));
		return true;
	}

	// POST /settings/security
	if (url.pathname === '/settings/security' && request.method === 'POST') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		const body = await parseBody(request);
		const current = await settingsService.settingsByUserId(auth.user.id);
		await settingsService.saveSettings(auth.user.id, {
			...current,
			autoLogout: body.autoLogout,
			autoLogoutMinutes: body.autoLogoutMinutes,
		});
		redirect(response, '/settings?saved=1&tab=security');
		return true;
	}

	// POST /settings/password
	if (url.pathname === '/settings/password' && request.method === 'POST') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		if (isJoplockAdmin(auth.user)) {
			redirect(response, '/settings?error=Password+is+managed+via+deployment+configuration&tab=security');
			return true;
		}
		const body = await parseBody(request);
		try {
			if (!body.currentPassword) { redirect(response, '/settings?error=Current+password+required&tab=security'); return true; }
			if (!body.newPassword) { redirect(response, '/settings?error=New+password+required&tab=security'); return true; }
			if (body.newPassword !== body.confirmPassword) { redirect(response, '/settings?error=Passwords+do+not+match&tab=security'); return true; }
			if (adminService) {
				const verifyToken = await adminService.verifyPassword(auth.user.email, body.currentPassword);
				if (!verifyToken) { redirect(response, '/settings?error=Current+password+is+incorrect&tab=security'); return true; }
				await adminService.changePassword(auth.user.sessionId, auth.user.id, body.newPassword);
			}
			redirect(response, '/settings?saved=1&tab=appearance');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Password change failed')}&tab=security`);
		}
		return true;
	}

	// POST /settings/profile
	if (url.pathname === '/settings/profile' && request.method === 'POST') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		const body = await parseBody(request);
		try {
			if (body.fullName !== undefined) {
				await database.query(
					'UPDATE users SET full_name = $1, updated_time = $2 WHERE id = $3',
					[body.fullName, Date.now(), auth.user.id]
				);
			}
			if (adminService && body.email && body.email !== auth.user.email) {
				await adminService.updateProfile(auth.user.sessionId, auth.user.id, { email: body.email });
			}
			redirect(response, '/settings?saved=1&tab=profile');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Update failed')}&tab=profile`);
		}
		return true;
	}

	// POST /settings/mfa/setup
	if (url.pathname === '/settings/mfa/setup' && request.method === 'POST') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		const existingSeed = await settingsService.getTotpSeed(auth.user.id);
		if (existingSeed) { redirect(response, '/settings?error=MFA+already+enabled&tab=security'); return true; }
		const newSeed = generateSeed();
		redirect(response, `/settings?mfaSetup=${encodeURIComponent(newSeed)}&tab=security`);
		return true;
	}

	// POST /settings/mfa/verify
	if (url.pathname === '/settings/mfa/verify' && request.method === 'POST') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		const body = await parseBody(request);
		const seed = body.seed || '';
		const code = body.totp || '';
		if (!seed || !verifyWithSeed(seed, code)) {
			redirect(response, `/settings?mfaSetup=${encodeURIComponent(seed)}&error=Invalid+code.+Try+again.&tab=security`);
			return true;
		}
		await settingsService.setTotpSeed(auth.user.id, seed);
		redirect(response, '/settings?mfaEnabled=1&tab=security');
		return true;
	}

	// POST /settings/mfa/cancel
	if (url.pathname === '/settings/mfa/cancel' && request.method === 'POST') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		redirect(response, '/settings?tab=security');
		return true;
	}

	// POST /settings/mfa/disable
	if (url.pathname === '/settings/mfa/disable' && request.method === 'POST') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		const body = await parseBody(request);
		const code = body.totp || '';
		const existingSeed = await settingsService.getTotpSeed(auth.user.id);
		if (!existingSeed) { redirect(response, '/settings?error=MFA+not+enabled&tab=security'); return true; }
		if (!verifyWithSeed(existingSeed, code)) { redirect(response, '/settings?error=Invalid+code&tab=security'); return true; }
		await settingsService.clearTotpSeed(auth.user.id);
		redirect(response, '/settings?saved=1&tab=security');
		return true;
	}

	return false;
};

module.exports = { handle };
