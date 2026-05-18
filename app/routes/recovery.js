'use strict';

const fs = require('fs');

const { sessionIdFromHeaders } = require('../auth/cookies');
const { RECOVERY_COOKIE } = require('../recoveryService');
const { contentDispositionFilename, parseBody, redirect, sendJson } = require('./_helpers');

const recoveryCookie = token => `${RECOVERY_COOKIE}=${encodeURIComponent(token)}; Path=/recovery; HttpOnly; SameSite=Lax; Max-Age=1800`;
const expiredRecoveryCookie = () => `${RECOVERY_COOKIE}=; Path=/recovery; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

const handle = async (url, request, response, ctx) => {
	const { sendHtml, templates, recoveryService, backupService, maintenance } = ctx;
	if (!url.pathname.startsWith('/recovery')) return false;

	const isEnabled = recoveryService && recoveryService.isEnabled();
	const token = sessionIdFromHeaders(request.headers, RECOVERY_COOKIE);
	const isAuthenticated = !!(isEnabled && recoveryService.validateSession(token));
	const render = async extras => {
		const backups = isAuthenticated && backupService && backupService.isConfigured() ? await backupService.listBackups().catch(() => []) : [];
		sendHtml(response, 200, templates.recoveryPage({
			isAuthenticated,
			recoveryEnabled: isEnabled,
			backups,
			backupDir: backupService && backupService.isConfigured() ? (process.env.JOPLOCK_BACKUP_DIR || '') : '',
			maintenanceMode: maintenance.isEnabled(),
			activeOperation: backupService && backupService.isBusy() ? backupService.activeOperation() : '',
			...extras,
		}));
	};

	if (url.pathname === '/recovery' && request.method === 'GET') {
		await render({ error: url.searchParams.get('error') || '', flash: url.searchParams.get('saved') || '' });
		return true;
	}

	if (url.pathname === '/recovery/login' && request.method === 'POST') {
		if (!isEnabled) {
			redirect(response, '/recovery?error=Recovery+mode+is+disabled');
			return true;
		}
		const body = await parseBody(request);
		const newToken = recoveryService.createSession(body.password || '');
		if (!newToken) {
			redirect(response, '/recovery?error=Invalid+recovery+password');
			return true;
		}
		redirect(response, '/recovery?saved=Recovery+mode+enabled', { 'Set-Cookie': recoveryCookie(newToken) });
		return true;
	}

	if (url.pathname === '/recovery/logout' && request.method === 'POST') {
		recoveryService && recoveryService.endSession(token);
		redirect(response, '/recovery?saved=Recovery+session+ended', { 'Set-Cookie': expiredRecoveryCookie() });
		return true;
	}

	if (!isAuthenticated) {
		redirect(response, '/recovery?error=Recovery+login+required');
		return true;
	}

	if (url.pathname === '/recovery/status' && request.method === 'GET') {
		sendJson(response, 200, {
			job: backupService ? backupService.currentStatus() : null,
			maintenanceMode: maintenance.isEnabled(),
			maintenanceReason: maintenance.reason(),
		});
		return true;
	}

	if (url.pathname === '/recovery/backups' && request.method === 'POST') {
		const body = await parseBody(request);
		try {
			await backupService.startBackupJob({ mode: body.compressionMode || '', useCompression: body.useCompression === '1' });
			redirect(response, '/recovery?saved=Backup+started');
		} catch (error) {
			redirect(response, `/recovery?error=${encodeURIComponent(error.message || 'Backup failed')}`);
		}
		return true;
	}

	const downloadMatch = url.pathname.match(/^\/recovery\/backups\/([^/]+)\/download$/);
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
			redirect(response, `/recovery?error=${encodeURIComponent(error.message || 'Download failed')}`);
		}
		return true;
	}

	if (url.pathname === '/recovery/restore' && request.method === 'POST') {
		const body = await parseBody(request);
		if ((body.confirm || '') !== 'RESTORE') {
			redirect(response, '/recovery?error=Type+RESTORE+to+confirm');
			return true;
		}
		maintenance.enable('restore');
		try {
			await backupService.startRestoreJob(body.backupName || '');
			redirect(response, '/recovery?saved=Restore+started');
		} catch (error) {
			redirect(response, `/recovery?error=${encodeURIComponent(error.message || 'Restore failed')}`);
		}
		return true;
	}

	await render({ error: 'Unknown recovery route' });
	return true;
};

module.exports = { handle, RECOVERY_COOKIE };
