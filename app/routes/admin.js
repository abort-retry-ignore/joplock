'use strict';

const fs = require('fs');

const { generateSeed } = require('../auth/mfaService');
const { contentDispositionFilename, redirect, parseBody, sendJson } = require('./_helpers');

const handle = async (url, request, response, ctx) => {
	const { authenticatedUser, settingsService, adminService, isJoplockAdmin, backupService, maintenance } = ctx;

	if (!url.pathname.startsWith('/admin')) return false;

	const auth = await authenticatedUser(request);
	if (auth.error || !auth.user || !isJoplockAdmin(auth.user)) {
		redirect(response, '/');
		return true;
	}

	// POST /admin/users — create user
	if (url.pathname === '/admin/users' && request.method === 'POST') {
		const body = await parseBody(request);
		try {
			await adminService.createUser(body.email, body.fullName || '', body.password || '');
			redirect(response, '/settings?saved=1&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Create user failed')}&tab=admin`);
		}
		return true;
	}

	// POST /admin/users/:id/password
	const resetMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/password$/);
	if (resetMatch && request.method === 'POST') {
		const userId = decodeURIComponent(resetMatch[1]);
		const body = await parseBody(request);
		try {
			await adminService.resetPassword(userId, body.password || '');
			redirect(response, '/settings?saved=1&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Reset password failed')}&tab=admin`);
		}
		return true;
	}

	// POST /admin/users/:id/disable|enable
	const disableMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/(disable|enable)$/);
	if (disableMatch && request.method === 'POST') {
		const userId = decodeURIComponent(disableMatch[1]);
		const enabled = disableMatch[2] === 'enable';
		try {
			await adminService.setEnabled(userId, enabled);
			redirect(response, '/settings?saved=1&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Operation failed')}&tab=admin`);
		}
		return true;
	}

	// POST /admin/users/:id/delete
	const deleteMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/delete$/);
	if (deleteMatch && request.method === 'POST') {
		const userId = decodeURIComponent(deleteMatch[1]);
		try {
			await adminService.deleteUser(userId);
			redirect(response, '/settings?saved=1&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Delete failed')}&tab=admin`);
		}
		return true;
	}

	// POST /admin/users/:id/mfa/enable
	const mfaEnableMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/mfa\/enable$/);
	if (mfaEnableMatch && request.method === 'POST') {
		const userId = decodeURIComponent(mfaEnableMatch[1]);
		try {
			const newSeed = generateSeed();
			await settingsService.setTotpSeed(userId, newSeed);
			redirect(response, '/settings?saved=1&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Enable MFA failed')}&tab=admin`);
		}
		return true;
	}

	// POST /admin/users/:id/mfa/disable
	const mfaDisableMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/mfa\/disable$/);
	if (mfaDisableMatch && request.method === 'POST') {
		const userId = decodeURIComponent(mfaDisableMatch[1]);
		try {
			await settingsService.clearTotpSeed(userId);
			redirect(response, '/settings?saved=1&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Disable MFA failed')}&tab=admin`);
		}
		return true;
	}

	if (url.pathname === '/admin/status' && request.method === 'GET') {
		sendJson(response, 200, {
			job: backupService ? backupService.currentStatus() : null,
			maintenanceMode: maintenance.isEnabled(),
			maintenanceReason: maintenance.reason(),
		});
		return true;
	}

	if (url.pathname === '/admin/backups' && request.method === 'POST') {
		const body = await parseBody(request);
		try {
			await backupService.startBackupJob({ mode: body.compressionMode || '', useCompression: body.useCompression === '1' });
			redirect(response, '/settings?saved=Backup+started&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Backup failed')}&tab=admin`);
		}
		return true;
	}

	const downloadMatch = url.pathname.match(/^\/admin\/backups\/([^/]+)\/download$/);
	if (downloadMatch && request.method === 'GET') {
		try {
			const fileName = decodeURIComponent(downloadMatch[1]);
			const backup = await backupService.backupPath(fileName);
			response.writeHead(200, {
				'Cache-Control': 'no-store',
				'Content-Length': backup.size,
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${contentDispositionFilename(backup.name)}"`,
			});
			fs.createReadStream(backup.path).pipe(response);
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Download failed')}&tab=admin`);
		}
		return true;
	}

	if (url.pathname === '/admin/restore' && request.method === 'POST') {
		const body = await parseBody(request);
		if ((body.confirm || '') !== 'RESTORE') {
			redirect(response, '/settings?error=Type+RESTORE+to+confirm&tab=admin');
			return true;
		}
		maintenance.enable('restore');
		try {
			await backupService.startRestoreJob(body.backupName || '');
			redirect(response, '/settings?saved=Restore+started&tab=admin');
		} catch (error) {
			redirect(response, `/settings?error=${encodeURIComponent(error.message || 'Restore failed')}&tab=admin`);
		}
		return true;
	}

	// Unknown admin route
	redirect(response, '/settings?tab=admin');
	return true;
};

module.exports = { handle };
