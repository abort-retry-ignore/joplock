'use strict';

const { generateSeed, otpauthUri, qrCodeDataUrl, verifyWithSeed } = require('../auth/mfaService');
const { redirect, parseBody } = require('./_helpers');
const templates = require('../templates');

const handle = async (url, request, response, ctx) => {
	const { sendHtml, authenticatedUser, settingsService, adminService, database, isJoplockAdmin } = ctx;

	// GET /settings
	if (url.pathname === '/settings' && request.method === 'GET') {
		const auth = await authenticatedUser(request);
		if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
		const settings = await settingsService.settingsByUserId(auth.user.id);
		const isAdmin = isJoplockAdmin(auth.user);
		let adminUsers = null;
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
		}
		const userTotpSeed = await settingsService.getTotpSeed(auth.user.id);
		const userTotpEnabled = !!userTotpSeed;
		const setupSeed = url.searchParams.get('mfaSetup') || '';
		const userTotpSetupSeed = setupSeed && !userTotpEnabled ? setupSeed : '';
		const userTotpSetupQr = userTotpSetupSeed ? qrCodeDataUrl(otpauthUri(userTotpSetupSeed, auth.user.email, 'Joplock')) : '';
		sendHtml(response, 200, templates.settingsPage({
			user: auth.user,
			settings,
			userTotpEnabled,
			userTotpSetupSeed,
			userTotpSetupQr,
			isAdmin,
			isDockerAdmin: isAdmin,
			adminUsers,
			flash: url.searchParams.get('saved') === '1' ? 'Settings saved.' : (url.searchParams.get('mfaEnabled') === '1' ? 'MFA enabled successfully.' : ''),
			flashError: url.searchParams.get('error') || '',
			activeTab: url.searchParams.get('tab') || 'appearance',
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
