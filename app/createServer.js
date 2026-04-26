const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { sessionIdFromHeaders } = require('./auth/cookies');
const { generateSeed, otpauthUri, qrCodeDataUrl, verifyWithSeed } = require('./auth/mfaService');
const { NOTE_PAGE_SIZE, VIRTUAL_ALL_NOTES_ID, VIRTUAL_TRASH_ID } = require('./items/itemService');
const templates = require('./templates');

const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.woff2': 'font/woff2',
};

const fileExists = filePath => {
	try {
		return fs.statSync(filePath).isFile();
	} catch (error) {
		return false;
	}
};

const send = (response, statusCode, body, headers = {}) => {
	response.writeHead(statusCode, headers);
	response.end(body);
};

const _sendHtml = (response, statusCode, html, request = null, log = null) => {
	const acceptEncoding = (request && request.headers && request.headers['accept-encoding']) || '';
	if (acceptEncoding.includes('gzip') && html && html.length > 512) {
		zlib.gzip(Buffer.from(html), (err, compressed) => {
			if (err) {
				if (log) log(`gzip error: ${err.message}, sending uncompressed`);
				response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
				response.end(html);
			} else {
				if (log) log(`gzip ${html.length}b -> ${compressed.length}b (${Math.round((1 - compressed.length / html.length) * 100)}% reduction)`);
				response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
				response.end(compressed);
			}
		});
	} else {
		if (log && html && html.length > 512) log(`gzip skipped (no accept-encoding: gzip from client)`);
		response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
		response.end(html);
	}
};

const sendJson = (response, statusCode, body) => {
	send(response, statusCode, JSON.stringify(body), {
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
	});
};

const expiredSessionCookie = () => 'sessionId=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

const readBody = request => {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => {
			body += chunk;
		});
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});
};

const readRawBody = request => {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on('data', chunk => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
};

// Minimal multipart parser — extracts the first file field
const parseMultipart = (buffer, contentType) => {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!match) return null;
	const boundary = match[1] || match[2];
	const boundaryBuf = Buffer.from(`--${boundary}`);

	// Find first occurrence after the boundary
	let start = buffer.indexOf(boundaryBuf);
	if (start === -1) return null;
	start += boundaryBuf.length;

	// Find the header/body separator (\r\n\r\n)
	const headerEnd = buffer.indexOf('\r\n\r\n', start);
	if (headerEnd === -1) return null;
	const headerStr = buffer.slice(start, headerEnd).toString('utf8');

	// Extract filename and content-type from headers
	const fnMatch = headerStr.match(/filename="([^"]+)"/);
	const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);
	const filename = fnMatch ? fnMatch[1] : 'upload';
	const fileMime = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';

	const bodyStart = headerEnd + 4;
	// Find ending boundary
	const endBoundary = buffer.indexOf(boundaryBuf, bodyStart);
	// The body ends 2 bytes before the next boundary (\r\n)
	const bodyEnd = endBoundary !== -1 ? endBoundary - 2 : buffer.length;

	return {
		filename,
		mime: fileMime,
		data: buffer.slice(bodyStart, bodyEnd),
	};
};

const parseBody = async request => {
	const raw = await readBody(request);
	if (!raw) return {};
	const contentType = request.headers['content-type'] || '';
	if (contentType.includes('application/json')) {
		return JSON.parse(raw);
	}
	// Parse URL-encoded form data (htmx default)
	const params = new URLSearchParams(raw);
	const result = {};
	for (const [key, value] of params) {
		result[key] = value;
	}
	return result;
};

const nextConflictCopyTitle = (title, existingTitles) => {
	const source = `${title || 'Untitled note'}`.trim() || 'Untitled note';
	const base = source.replace(/-\d+$/, '');
	const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`^${escapedBase}-(\\d+)$`);
	let maxSuffix = 0;
	for (const existingTitle of existingTitles) {
		const match = `${existingTitle || ''}`.match(re);
		if (match) maxSuffix = Math.max(maxSuffix, Number(match[1] || 0));
	}
	return `${base}-${maxSuffix + 1}`;
};

const TRASH_FOLDER_ID = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';
const ALL_NOTES_FOLDER_ID = '__all_notes__';

const allNotesFolder = count => ({
	id: ALL_NOTES_FOLDER_ID,
	parentId: '',
	title: 'All Notes',
	noteCount: count,
	createdTime: 0,
	updatedTime: 0,
	isVirtualAllNotes: true,
});

const selectedFolderForNav = currentFolderId => currentFolderId === ALL_NOTES_FOLDER_ID ? ALL_NOTES_FOLDER_ID : currentFolderId;

const normalizeStoredFolderId = folderId => folderId === '__all__' ? ALL_NOTES_FOLDER_ID : `${folderId || ''}`;

const plainNoteTitle = title => templates.stripMarkdownForTitle(`${title || ''}`) || 'Untitled note';

const saveLastNoteState = async (settingsService, userId, currentSettings, noteId, folderId) => {
	if (!settingsService) return currentSettings;
	return settingsService.saveSettings(userId, {
		...currentSettings,
		lastNoteId: `${noteId || ''}`,
		lastNoteFolderId: normalizeStoredFolderId(folderId),
	});
};

const notesForFolder = async (itemService, userId, folderId) => {
	if (!folderId || folderId === ALL_NOTES_FOLDER_ID) return itemService.notesByUserId(userId);
	if (folderId === TRASH_FOLDER_ID) return itemService.notesByUserId(userId, { deleted: 'only' });
	return itemService.notesByUserId(userId, { folderId });
};

const contentDispositionFilename = value => `${value || 'attachment'}`.replace(/[\r\n"]/g, '_');

const shouldInlineResource = mime => /^(image\/.+|application\/pdf|text\/plain)$/i.test(`${mime || ''}`);

const trashFolder = count => ({
	id: TRASH_FOLDER_ID,
	parentId: '',
	title: 'Trash',
	noteCount: count,
	createdTime: 0,
	updatedTime: 0,
});

const mapNavNotes = notes => notes.map(note => note.deletedTime ? { ...note, parentId: TRASH_FOLDER_ID } : note);

const serveFile = (response, filePath) => {
	const extension = path.extname(filePath).toLowerCase();
	const contentType = contentTypes[extension] || 'application/octet-stream';
	const stat = fs.statSync(filePath);

	response.writeHead(200, {
		'Cache-Control': extension === '.html' ? 'no-store' : (extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=300'),
		'Content-Length': stat.size,
		'Content-Type': contentType,
	});

	fs.createReadStream(filePath).pipe(response);
};

const createServer = options => {
	const {
		publicDir,
		joplinPublicBasePath,
		joplinPublicBaseUrl,
		joplinServerPublicUrl,
		joplinServerOrigin,
		sessionService,
		itemService,
		settingsService,
		historyService,
		itemWriteService,
		adminService = null,
		adminEmail = '',
		ignoreAdminMfa = false,
		database = null,
		debug = false,
	} = options;

	const isJoplockAdmin = user => !!(
		adminService &&
		adminEmail &&
		user &&
		user.email === adminEmail &&
		user.isAdmin
	);

	const log = debug ? (...args) => process.stdout.write(`[joplock] ${args.join(' ')}\n`) : () => {};

	const configuredPublicUrl = new URL(joplinPublicBaseUrl);
	const configuredServerPublicUrl = new URL(joplinServerPublicUrl);

	const authenticatedUser = async request => {
		const sessionId = sessionIdFromHeaders(request.headers);
		if (!sessionId) return { error: 'Missing session', user: null };
		const user = await sessionService.userBySessionId(sessionId);
		if (!user) return { error: 'Invalid or expired session', user: null };
		return { error: null, user };
	};

	const navData = async userId => {
		const [folders, counts] = await Promise.all([
			itemService.foldersByUserId(userId),
			itemService.folderNoteCountsByUserId(userId),
		]);
		const allFolders = [allNotesFolder(counts.get('__all__') || 0)].concat(folders, [trashFolder(counts.get('__trash__') || 0)]);
		return { folders: allFolders, counts };
	};

	const ensureStarterContent = async (user, request) => {
		const folders = await itemService.foldersByUserId(user.id);
		if (folders.length > 0) return;
		const ctx = upstreamRequestContext(request);
		const examplesFolder = await itemWriteService.createFolder(user.sessionId, { title: 'Examples' }, ctx);
		await itemWriteService.createNote(user.sessionId, {
			title: 'Start Here',
			body: `# Welcome to Joplock

This notebook is here so a fresh install has something to open and edit right away.

## What Joplock is

- Open source: [abort-retry-ignore/joplock](https://github.com/abort-retry-ignore/joplock)
- Thin web UI for Joplin Server
- Mobile friendly and installable as PWA
- Light on memory and system resources
- Sync is automatic and usually near instant

## Security and logout

- Browser stays thin and untrusted
- Notes and attachments are not cached for offline use
- Logout clears client-visible state and cached shell data as much as browser allows

## Editing notes

- Click this note to open it.
- Use the toolbar for headings, bold, lists, links, code, and clear formatting.
- Switch between Markdown and Preview mode with the editor buttons.
- Preview mode is editable too.

## Saving changes

- Joplock autosaves after you stop typing for a moment.
- The status near the editor shows when a note is edited, saved, or offline.

## Creating notes and notebooks

- Use **+ Folder** to create a new notebook.
- Use the **+** button on a notebook row to create a note inside it.
- Search from the left panel to find notes quickly.

## Admin and users

- If this deployment defines \`JOPLOCK_ADMIN_EMAIL\` and \`JOPLOCK_ADMIN_PASSWORD\`, that user gets the Admin tab in Settings.
- The Admin tab can create users and enable or disable MFA for users.

## MFA

- Each user manages their own MFA in **Settings -> Security**.
- Admins can also manage MFA for users from the Admin tab.
- If \`IGNORE_ADMIN_MFA=true\`, the configured deployment admin can sign in without MFA.

## Markdown examples

- **Bold**
- *Italic*
- \`Inline code\`
- [Link to Joplin](https://joplinapp.org)
- [ ] Checkbox item

\`\`\`
Code block example
\`\`\`
`,
			parentId: examplesFolder.id,
		}, ctx);
	};

	const userSettings = async userId => settingsService ? settingsService.settingsByUserId(userId) : null;

	const upstreamRequestContext = _request => ({
		host: configuredServerPublicUrl.host,
		protocol: configuredServerPublicUrl.protocol.replace(':', ''),
	});

	const proxyToJoplinServer = (request, response, url) => {
		const targetPath = joplinPublicBasePath ? (url.pathname.replace(joplinPublicBasePath, '') || '/') : url.pathname;
		const targetUrl = new URL(joplinServerOrigin);
		const headers = { ...request.headers };
		headers.host = configuredServerPublicUrl.host;
		delete headers.origin;
		delete headers.referer;
		headers['x-forwarded-host'] = configuredServerPublicUrl.host;
		headers['x-forwarded-proto'] = configuredServerPublicUrl.protocol.replace(':', '');

		const upstreamRequest = http.request({
			hostname: targetUrl.hostname,
			port: targetUrl.port,
			path: targetPath + url.search,
			method: request.method,
			headers,
		}, upstreamResponse => {
			const responseHeaders = { ...upstreamResponse.headers };
			if (responseHeaders.location) {
				const location = responseHeaders.location;
				if (location === '/' || (joplinPublicBasePath && (location === `${joplinPublicBasePath}` || location === `${joplinPublicBasePath}/`))) {
					responseHeaders.location = '/';
				} else if (joplinPublicBasePath && location.startsWith('/')) {
					responseHeaders.location = `${joplinPublicBasePath}${location}`;
				}
			}
			response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
			upstreamResponse.pipe(response);
		});

		upstreamRequest.on('error', error => {
			send(response, 502, `Upstream Joplin Server proxy error: ${error.message}`, {
				'Content-Type': 'text/plain; charset=utf-8',
			});
		});

		request.pipe(upstreamRequest);
	};

	return http.createServer(async (request, response) => {
		const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
		const reqStart = Date.now();
		log(`${request.method} ${url.pathname}${url.search}`);

		const origEnd = response.end.bind(response);
		response.end = function (...args) {
			log(`${request.method} ${url.pathname} -> ${response.statusCode} (${Date.now() - reqStart}ms)`);
			return origEnd(...args);
		};

		// Per-request sendHtml that automatically gzips when client supports it
		const sendHtml = (res, statusCode, html) => _sendHtml(res, statusCode, html, request, log);

		// --- Health check ---
		if (url.pathname === '/health') {
			send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
			return;
		}

		if (url.pathname === '/settings' && request.method === 'GET') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			const settings = await userSettings(auth.user.id);
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
			// Per-user TOTP
			const userTotpSeed = await settingsService.getTotpSeed(auth.user.id);
			const userTotpEnabled = !!userTotpSeed;
			// Check if in setup mode (seed in query param)
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
			return;
		}

		// --- POST /settings/security (session settings) ---
		if (url.pathname === '/settings/security' && request.method === 'POST') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			const body = await parseBody(request);
			const current = await settingsService.settingsByUserId(auth.user.id);
			await settingsService.saveSettings(auth.user.id, {
				...current,
				autoLogout: body.autoLogout,
				autoLogoutMinutes: body.autoLogoutMinutes,
			});
			response.writeHead(302, { Location: '/settings?saved=1&tab=security' });
			response.end();
			return;
		}

		// --- POST /settings/password ---
		if (url.pathname === '/settings/password' && request.method === 'POST') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			// Block password change for docker-defined admin
			if (isJoplockAdmin(auth.user)) {
				response.writeHead(302, { Location: '/settings?error=Password+is+managed+via+deployment+configuration&tab=security' });
				response.end();
				return;
			}
			const body = await parseBody(request);
			try {
				if (!body.currentPassword) {
					response.writeHead(302, { Location: '/settings?error=Current+password+required&tab=security' });
					response.end();
					return;
				}
				if (!body.newPassword) {
					response.writeHead(302, { Location: '/settings?error=New+password+required&tab=security' });
					response.end();
					return;
				}
				if (body.newPassword !== body.confirmPassword) {
					response.writeHead(302, { Location: '/settings?error=Passwords+do+not+match&tab=security' });
					response.end();
					return;
				}
				if (adminService) {
					const verifyToken = await adminService.verifyPassword(auth.user.email, body.currentPassword);
					if (!verifyToken) {
						response.writeHead(302, { Location: '/settings?error=Current+password+is+incorrect&tab=security' });
						response.end();
						return;
					}
					await adminService.changePassword(auth.user.sessionId, auth.user.id, body.newPassword);
				}
			response.writeHead(302, { Location: '/settings?saved=1&tab=appearance' });
				response.end();
			} catch (error) {
				const msg = encodeURIComponent(error.message || 'Password change failed');
				response.writeHead(302, { Location: `/settings?error=${msg}&tab=security` });
				response.end();
			}
			return;
		}

		// --- POST /settings/profile ---
		if (url.pathname === '/settings/profile' && request.method === 'POST') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			const body = await parseBody(request);
			try {
				// Update full_name directly in Postgres — Joplin Server's PATCH API
				// silently ignores full_name for non-admin sessions.
				if (body.fullName !== undefined) {
					await database.query(
						'UPDATE users SET full_name = $1, updated_time = $2 WHERE id = $3',
						[body.fullName, Date.now(), auth.user.id]
					);
				}
				if (adminService && body.email && body.email !== auth.user.email) {
					await adminService.updateProfile(auth.user.sessionId, auth.user.id, {
						email: body.email,
					});
				}
				response.writeHead(302, { Location: '/settings?saved=1&tab=profile' });
				response.end();
			} catch (error) {
				const msg = encodeURIComponent(error.message || 'Update failed');
				response.writeHead(302, { Location: `/settings?error=${msg}&tab=profile` });
				response.end();
			}
			return;
		}

		// --- MFA routes ---
		if (url.pathname === '/settings/mfa/setup' && request.method === 'POST') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			// Check if already has TOTP
			const existingSeed = await settingsService.getTotpSeed(auth.user.id);
			if (existingSeed) {
				response.writeHead(302, { Location: '/settings?error=MFA+already+enabled&tab=security' });
				response.end();
				return;
			}
			// Generate new seed and redirect to setup page
			const newSeed = generateSeed();
			response.writeHead(302, { Location: `/settings?mfaSetup=${encodeURIComponent(newSeed)}&tab=security` });
			response.end();
			return;
		}

		if (url.pathname === '/settings/mfa/verify' && request.method === 'POST') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			const body = await parseBody(request);
			const seed = body.seed || '';
			const code = body.totp || '';
			if (!seed || !verifyWithSeed(seed, code)) {
				response.writeHead(302, { Location: `/settings?mfaSetup=${encodeURIComponent(seed)}&error=Invalid+code.+Try+again.&tab=security` });
				response.end();
				return;
			}
			// Save seed
			await settingsService.setTotpSeed(auth.user.id, seed);
			response.writeHead(302, { Location: '/settings?mfaEnabled=1&tab=security' });
			response.end();
			return;
		}

		if (url.pathname === '/settings/mfa/cancel' && request.method === 'POST') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			response.writeHead(302, { Location: '/settings?tab=security' });
			response.end();
			return;
		}

		if (url.pathname === '/settings/mfa/disable' && request.method === 'POST') {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			const body = await parseBody(request);
			const code = body.totp || '';
			const existingSeed = await settingsService.getTotpSeed(auth.user.id);
			if (!existingSeed) {
				response.writeHead(302, { Location: '/settings?error=MFA+not+enabled&tab=security' });
				response.end();
				return;
			}
			if (!verifyWithSeed(existingSeed, code)) {
				response.writeHead(302, { Location: '/settings?error=Invalid+code&tab=security' });
				response.end();
				return;
			}
			await settingsService.clearTotpSeed(auth.user.id);
			response.writeHead(302, { Location: '/settings?saved=1&tab=security' });
			response.end();
			return;
		}

		// --- Admin routes ---
		if (url.pathname.startsWith('/admin')) {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user || !isJoplockAdmin(auth.user)) {
				response.writeHead(302, { Location: '/' });
				response.end();
				return;
			}

			// POST /admin/users — create user
			if (url.pathname === '/admin/users' && request.method === 'POST') {
				const body = await parseBody(request);
				try {
					await adminService.createUser(body.email, body.fullName || '', body.password || '');
					response.writeHead(302, { Location: '/settings?saved=1&tab=admin' });
					response.end();
				} catch (error) {
					const msg = encodeURIComponent(error.message || 'Create user failed');
					response.writeHead(302, { Location: `/settings?error=${msg}&tab=admin` });
					response.end();
				}
				return;
			}

			// POST /admin/users/:id/password — reset password
			const resetMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/password$/);
			if (resetMatch && request.method === 'POST') {
				const userId = decodeURIComponent(resetMatch[1]);
				const body = await parseBody(request);
				try {
					await adminService.resetPassword(userId, body.password || '');
					response.writeHead(302, { Location: '/settings?saved=1&tab=admin' });
					response.end();
				} catch (error) {
					const msg = encodeURIComponent(error.message || 'Reset password failed');
					response.writeHead(302, { Location: `/settings?error=${msg}&tab=admin` });
					response.end();
				}
				return;
			}

			// POST /admin/users/:id/disable
			const disableMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/(disable|enable)$/);
			if (disableMatch && request.method === 'POST') {
				const userId = decodeURIComponent(disableMatch[1]);
				const enabled = disableMatch[2] === 'enable';
				try {
					await adminService.setEnabled(userId, enabled);
					response.writeHead(302, { Location: '/settings?saved=1&tab=admin' });
					response.end();
				} catch (error) {
					const msg = encodeURIComponent(error.message || 'Operation failed');
					response.writeHead(302, { Location: `/settings?error=${msg}&tab=admin` });
					response.end();
				}
				return;
			}

			// POST /admin/users/:id/delete
			const deleteMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/delete$/);
			if (deleteMatch && request.method === 'POST') {
				const userId = decodeURIComponent(deleteMatch[1]);
				try {
					await adminService.deleteUser(userId);
					response.writeHead(302, { Location: '/settings?saved=1&tab=admin' });
					response.end();
				} catch (error) {
					const msg = encodeURIComponent(error.message || 'Delete failed');
					response.writeHead(302, { Location: `/settings?error=${msg}&tab=admin` });
					response.end();
				}
				return;
			}

			// POST /admin/users/:id/mfa/enable
			const mfaEnableMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/mfa\/enable$/);
			if (mfaEnableMatch && request.method === 'POST') {
				const userId = decodeURIComponent(mfaEnableMatch[1]);
				try {
					const newSeed = generateSeed();
					await settingsService.setTotpSeed(userId, newSeed);
					response.writeHead(302, { Location: '/settings?saved=1&tab=admin' });
					response.end();
				} catch (error) {
					const msg = encodeURIComponent(error.message || 'Enable MFA failed');
					response.writeHead(302, { Location: `/settings?error=${msg}&tab=admin` });
					response.end();
				}
				return;
			}

			// POST /admin/users/:id/mfa/disable
			const mfaDisableMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/mfa\/disable$/);
			if (mfaDisableMatch && request.method === 'POST') {
				const userId = decodeURIComponent(mfaDisableMatch[1]);
				try {
					await settingsService.clearTotpSeed(userId);
					response.writeHead(302, { Location: '/settings?saved=1&tab=admin' });
					response.end();
				} catch (error) {
					const msg = encodeURIComponent(error.message || 'Disable MFA failed');
					response.writeHead(302, { Location: `/settings?error=${msg}&tab=admin` });
					response.end();
				}
				return;
			}

			// Unknown admin route
			response.writeHead(302, { Location: '/settings?tab=admin' });
			response.end();
			return;
		}

		// --- save individual setting (fire-and-forget from client) ---
		if (url.pathname === '/api/web/settings' && request.method === 'PUT') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error || !auth.user) { response.writeHead(401); response.end(); return; }
				const body = await parseBody(request);
				const current = await settingsService.settingsByUserId(auth.user.id);
				const updates = {};
				// Only allow specific keys
				const allowedKeys = ['theme', 'noteFontSize', 'mobileNoteFontSize', 'codeFontSize', 'noteMonospace', 'noteOpenMode', 'resumeLastNote', 'dateFormat', 'datetimeFormat', 'liveSearch'];
				for (const key of allowedKeys) {
					if (body[key] !== undefined) updates[key] = body[key];
				}
				if (Object.keys(updates).length > 0) {
					await settingsService.saveSettings(auth.user.id, { ...current, ...updates });
				}
				response.writeHead(204);
				response.end();
			} catch {
				response.writeHead(500);
				response.end();
			}
			return;
		}

		// --- save theme (fire-and-forget from client) - legacy ---
		if (url.pathname === '/api/web/theme' && request.method === 'PUT') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error || !auth.user) { response.writeHead(401); response.end(); return; }
				const body = await parseBody(request);
				const current = await settingsService.settingsByUserId(auth.user.id);
				await settingsService.saveSettings(auth.user.id, { ...current, theme: body.theme });
				response.writeHead(204);
				response.end();
			} catch {
				response.writeHead(500);
				response.end();
			}
			return;
		}

		// --- history: list snapshots ---
		if (url.pathname.startsWith('/fragments/history/') && !url.pathname.includes('/restore/') && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const noteId = decodeURIComponent(url.pathname.slice('/fragments/history/'.length));
				const snapshots = historyService ? await historyService.listSnapshots(noteId) : [];
				sendHtml(response, 200, templates.historyModalFragment(noteId, snapshots));
			} catch (error) {
				sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		// --- history: get snapshot body preview ---
		if (url.pathname.startsWith('/fragments/history-snapshot/') && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const snapshotId = decodeURIComponent(url.pathname.slice('/fragments/history-snapshot/'.length));
				const snapshot = historyService ? await historyService.getSnapshot(snapshotId) : null;
				if (!snapshot) { sendHtml(response, 404, '<div class="empty-hint">Snapshot not found.</div>'); return; }
				sendHtml(response, 200, templates.historySnapshotPreviewFragment(snapshot));
			} catch (error) {
				sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		// --- history: restore snapshot ---
		if (url.pathname.startsWith('/fragments/history/') && url.pathname.includes('/restore/') && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<span class="autosave-error">Session expired</span>'); return; }
				const parts = url.pathname.slice('/fragments/history/'.length).split('/restore/');
				const noteId = decodeURIComponent(parts[0]);
				const snapshotId = decodeURIComponent(parts[1] || '');
				const snapshot = historyService ? await historyService.getSnapshot(snapshotId) : null;
				if (!snapshot || snapshot.noteId !== noteId) { sendHtml(response, 404, '<span class="autosave-error">Snapshot not found</span>'); return; }
				const body = await parseBody(request);
				const currentFolderId = `${body.currentFolderId || ''}`;
				const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!existing) { sendHtml(response, 404, '<span class="autosave-error">Note not found</span>'); return; }
				await itemWriteService.updateNote(auth.user.sessionId, existing, {
					title: snapshot.title,
					body: snapshot.body,
					parentId: existing.parentId,
				}, upstreamRequestContext(request));
				const refreshed = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				const { folders, counts } = await navData(auth.user.id);
				sendHtml(response, 200, `${templates.autosaveStatusFragment()}<div id="nav-panel" hx-swap-oob="innerHTML">${templates.navigationFragment(folders, counts, selectedFolderForNav(currentFolderId || existing.parentId), noteId, '', selectedFolderForNav(currentFolderId || existing.parentId))}</div><div id="editor-panel" hx-swap-oob="innerHTML">${templates.editorFragment(refreshed || existing, folders.filter(f => f.id !== TRASH_FOLDER_ID), selectedFolderForNav(currentFolderId || existing.parentId))}</div>`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<span class="autosave-error">Restore failed: ${templates.escapeHtml(error.message || `${error}`)}</span>`);
			}
			return;
		}

		// --- htmx fragment: create folder ---
		if (url.pathname === '/fragments/folders' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const body = await parseBody(request);
				const title = `${body.title || ''}`.trim();
				if (!title) { sendHtml(response, 400, '<div class="empty-hint">Folder title is required.</div>'); return; }

				await itemWriteService.createFolder(auth.user.sessionId, { title, parentId: body.parentId || '' }, upstreamRequestContext(request));
				const { folders, counts } = await navData(auth.user.id);
				sendHtml(response, 200, templates.navigationFragment(folders, counts, '', ''));
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/folders/') && request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const folderId = decodeURIComponent(url.pathname.slice('/fragments/folders/'.length));
				await itemWriteService.deleteFolder(auth.user.sessionId, folderId, upstreamRequestContext(request));
				const { folders, counts } = await navData(auth.user.id);
				sendHtml(response, 200, templates.navigationFragment(folders, counts, '', ''));
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/folders/') && request.method === 'PUT') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const folderId = decodeURIComponent(url.pathname.slice('/fragments/folders/'.length));
				const body = await parseBody(request);
				const title = `${body.title || ''}`.trim();
				if (!folderId) { sendHtml(response, 404, '<div class="empty-hint">Folder not found.</div>'); return; }
				if (!title) { sendHtml(response, 400, '<div class="empty-hint">Folder title is required.</div>'); return; }
				const existingFolder = await itemService.folderByUserIdAndJopId(auth.user.id, folderId);
				if (!existingFolder) { sendHtml(response, 404, '<div class="empty-hint">Folder not found.</div>'); return; }

				await itemWriteService.updateFolder(auth.user.sessionId, existingFolder, { title }, upstreamRequestContext(request));
				const { folders, counts } = await navData(auth.user.id);
				sendHtml(response, 200, templates.navigationFragment(folders, counts, folderId, ''));
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		// --- htmx fragment: navigation tree ---
		if (url.pathname === '/fragments/nav' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const rawQuery = url.searchParams.get('q') || '';
				const query = rawQuery.trim();
				const data = await navData(auth.user.id);
				// In search mode, pass a notes array; otherwise pass counts Map for lazy loading
				const notesOrCounts = query ? mapNavNotes(await itemService.searchNotes(auth.user.id, query)) : data.counts;
				const navFolders = data.folders;
				sendHtml(response, 200, templates.navigationFragment(navFolders, notesOrCounts, '', '', rawQuery));
			} catch (error) {
				sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		// --- htmx fragment: lazy-load notes for a folder ---
		if (url.pathname === '/fragments/folder-notes' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const folderId = url.searchParams.get('folderId') || '__all__';
				const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
				const selectedNoteId = url.searchParams.get('selectedNoteId') || '';
				const normalizedFolderId = (folderId === ALL_NOTES_FOLDER_ID) ? VIRTUAL_ALL_NOTES_ID : folderId;
				const notes = await itemService.noteHeadersByFolder(auth.user.id, normalizedFolderId, NOTE_PAGE_SIZE, offset);
				const counts = await itemService.folderNoteCountsByUserId(auth.user.id);
				const virtualId = normalizedFolderId === VIRTUAL_ALL_NOTES_ID ? VIRTUAL_ALL_NOTES_ID : (normalizedFolderId === VIRTUAL_TRASH_ID ? VIRTUAL_TRASH_ID : normalizedFolderId);
				const totalCount = counts.get(virtualId) || counts.get(normalizedFolderId) || 0;
				const hasMore = offset + notes.length < totalCount;
				const contextFolderId = normalizedFolderId === VIRTUAL_ALL_NOTES_ID ? VIRTUAL_ALL_NOTES_ID : normalizedFolderId;
				sendHtml(response, 200, templates.folderNotesPageFragment(notes, contextFolderId, selectedNoteId, hasMore, offset + notes.length, totalCount));
			} catch (error) {
				sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname === '/fragments/notes' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const body = await parseBody(request);
				const parentId = `${body.parentId || ''}`;
				const currentFolderId = `${body.currentFolderId || parentId || ''}`;
				if (!parentId) { sendHtml(response, 400, '<div class="empty-hint">Select a folder first.</div>'); return; }

				const created = await itemWriteService.createNote(auth.user.sessionId, {
					title: `${body.title || ''}`.trim() || 'Untitled note',
					body: '',
					parentId,
				}, upstreamRequestContext(request));

				const [{ folders, counts }, note] = await Promise.all([
					navData(auth.user.id),
					itemService.noteByUserIdAndJopId(auth.user.id, created.id),
				]);
				sendHtml(response, 200, `${templates.navigationFragment(folders, counts, selectedFolderForNav(currentFolderId), created.id, '', selectedFolderForNav(currentFolderId))}<div id="editor-panel" hx-swap-oob="innerHTML">${templates.editorFragment(note, folders.filter(folder => folder.id !== TRASH_FOLDER_ID), selectedFolderForNav(currentFolderId))}</div>`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname === '/fragments/notes/in-general' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				// Find or create the 'General' folder
				const folders = await itemService.foldersByUserId(auth.user.id);
				let general = folders.find(f => !f.deletedTime && f.title === 'General');
				if (!general) {
					const created = await itemWriteService.createFolder(auth.user.sessionId, { title: 'General', parentId: '' }, upstreamRequestContext(request));
					general = { id: created.id, title: 'General' };
				}

				const created = await itemWriteService.createNote(auth.user.sessionId, {
					title: 'Untitled note',
					body: '',
					parentId: general.id,
				}, upstreamRequestContext(request));

				const [{ folders: navFolders, counts }, note] = await Promise.all([
					navData(auth.user.id),
					itemService.noteByUserIdAndJopId(auth.user.id, created.id),
				]);
				sendHtml(response, 200, `${templates.navigationFragment(navFolders, counts, selectedFolderForNav(general.id), created.id, '', selectedFolderForNav(general.id))}<div id="editor-panel" hx-swap-oob="innerHTML">${templates.editorFragment(note, navFolders.filter(f => f.id !== TRASH_FOLDER_ID), selectedFolderForNav(general.id))}</div>`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/notes/') && !url.pathname.startsWith('/fragments/editor/') && request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const noteId = decodeURIComponent(url.pathname.slice('/fragments/notes/'.length));
				let existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!existing) existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'only' });
				if (!existing) { sendHtml(response, 404, '<div class="empty-hint">Note not found.</div>'); return; }
				if (existing.deletedTime) {
					await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
				} else {
					await itemWriteService.trashNote(auth.user.sessionId, existing, upstreamRequestContext(request));
				}
				const { folders, counts } = await navData(auth.user.id);
				sendHtml(response, 200, `${templates.navigationFragment(folders, counts, TRASH_FOLDER_ID, '')}<div id="editor-panel" hx-swap-oob="innerHTML"><div class="editor-empty">Select a note</div></div>`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/notes/') && url.pathname.endsWith('/restore') && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const noteId = decodeURIComponent(url.pathname.slice('/fragments/notes/'.length, -'/restore'.length));
				const [existing, folders] = await Promise.all([
					itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'only' }),
					itemService.foldersByUserId(auth.user.id),
				]);
				if (!existing) { sendHtml(response, 404, '<div class="empty-hint">Note not found.</div>'); return; }
				let restoreParentId = existing.parentId;
				if (!folders.find(folder => folder.id === restoreParentId)) {
					if (folders.length) {
						restoreParentId = folders[0].id;
					} else {
						const createdFolder = await itemWriteService.createFolder(auth.user.sessionId, { title: 'Restored items', parentId: '' }, upstreamRequestContext(request));
						restoreParentId = createdFolder.id;
					}
				}
				await itemWriteService.restoreNote(auth.user.sessionId, existing, restoreParentId, upstreamRequestContext(request));
				const [{ folders: navFolders, counts }, restoredNote] = await Promise.all([
					navData(auth.user.id),
					itemService.noteByUserIdAndJopId(auth.user.id, noteId),
				]);
				sendHtml(response, 200, `${templates.navigationFragment(navFolders, counts, restoreParentId, noteId, '', restoreParentId)}<div id="editor-panel" hx-swap-oob="innerHTML">${templates.editorFragment(restoredNote, navFolders.filter(folder => folder.id !== TRASH_FOLDER_ID))}</div>`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname === '/fragments/trash/empty' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const trashedNotes = await itemService.noteHeadersByUserId(auth.user.id, { deleted: 'only' });
				for (const note of trashedNotes) {
					await itemWriteService.deleteNote(auth.user.sessionId, note.id, upstreamRequestContext(request));
				}
				const { folders, counts } = await navData(auth.user.id);
				sendHtml(response, 200, `${templates.navigationFragment(folders, counts, '', '')}<div id="editor-panel" hx-swap-oob="innerHTML"><div class="editor-empty">Select a note</div></div>`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		// --- Resource binary serving ---
		if (url.pathname.startsWith('/resources/') && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { send(response, 401, 'Unauthorized', { 'Content-Type': 'text/plain' }); return; }

				const resourceId = decodeURIComponent(url.pathname.slice('/resources/'.length));
				if (!resourceId || !/^[0-9a-zA-Z]{32}$/.test(resourceId)) {
					send(response, 400, 'Invalid resource ID', { 'Content-Type': 'text/plain' });
					return;
				}

				const [meta, blob] = await Promise.all([
					itemService.resourceMetaByUserId(auth.user.id, resourceId),
					itemService.resourceBlobByUserId(auth.user.id, resourceId),
				]);

				if (!blob) { send(response, 404, 'Resource not found', { 'Content-Type': 'text/plain' }); return; }

				const mime = (meta && meta.mime) || 'application/octet-stream';
				const filename = contentDispositionFilename((meta && (meta.filename || meta.title)) || `${resourceId}`);
				const download = url.searchParams.get('download') === '1';
				const disposition = `${download || !shouldInlineResource(mime) ? 'attachment' : 'inline'}; filename="${filename}"`;
				response.writeHead(200, {
					'Content-Type': mime,
					'Content-Length': blob.length,
					'Cache-Control': 'no-store',
					'Content-Disposition': disposition,
				});
				response.end(blob);
			} catch (error) {
				send(response, 500, 'Error loading resource', { 'Content-Type': 'text/plain' });
			}
			return;
		}

		// --- File upload (multipart) ---
		if (url.pathname === '/fragments/upload' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return; }

				const contentType = request.headers['content-type'] || '';
				if (!contentType.includes('multipart/form-data')) {
					sendJson(response, 400, { error: 'Expected multipart/form-data' });
					return;
				}

				const rawBody = await readRawBody(request);
				const file = parseMultipart(rawBody, contentType);
				if (!file || !file.data.length) {
					sendJson(response, 400, { error: 'No file uploaded' });
					return;
				}

				const extMatch = file.filename.match(/\.([^.]+)$/);
				const fileExtension = extMatch ? extMatch[1].toLowerCase() : '';

				const created = await itemWriteService.createResource(auth.user.sessionId, {
					title: file.filename,
					mime: file.mime,
					filename: file.filename,
					fileExtension,
					size: file.data.length,
				}, file.data, upstreamRequestContext(request));

				const isImage = file.mime.startsWith('image/');
				const markdown = isImage
					? `![${file.filename}](:/${created.id})`
					: `[${file.filename}](:/${created.id})`;

				sendJson(response, 200, { resourceId: created.id, markdown });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || 'Upload failed' });
			}
			return;
		}

		// --- Markdown preview ---
		if (url.pathname === '/fragments/preview' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div>Session expired</div>'); return; }

				const body = await parseBody(request);
				const html = templates.renderMarkdown(body.body || '');
				sendHtml(response, 200, html);
			} catch (error) {
				sendHtml(response, 500, '<div>Preview error</div>');
			}
			return;
		}

		// --- htmx fragment: search ---
		if (url.pathname === '/fragments/search' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const query = url.searchParams.get('q') || '';
				if (!query.trim()) { sendHtml(response, 200, ''); return; }
				const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
				const notes = await itemService.searchNotes(auth.user.id, query, 50, offset);
				const hasMore = notes.length === 50;
				sendHtml(response, 200, templates.searchResultsFragment(notes, hasMore, offset + notes.length, query));
			} catch (error) {
				sendHtml(response, 500, '<div class="empty-hint">Search error</div>');
			}
			return;
		}

		// --- mobile fragment: folders list ---
		if (url.pathname === '/fragments/mobile/folders' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const [folders, counts] = await Promise.all([
					itemService.foldersByUserId(auth.user.id),
					itemService.folderNoteCountsByUserId(auth.user.id),
				]);
				sendHtml(response, 200, templates.mobileFoldersFragment(folders, counts));
			} catch (error) {
				sendHtml(response, 500, '<div class="empty-hint">Error</div>');
			}
			return;
		}

		// --- mobile fragment: notes list ---
		if (url.pathname === '/fragments/mobile/notes' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const folderId = url.searchParams.get('folderId') || '__all__';
				const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
				const notes = await itemService.noteHeadersByFolder(auth.user.id, folderId, NOTE_PAGE_SIZE, offset);
				const counts = await itemService.folderNoteCountsByUserId(auth.user.id);
				const totalCount = counts.get(folderId) || counts.get('__all__') || 0;
				const hasMore = offset + notes.length < totalCount;
				sendHtml(response, 200, templates.mobileNotesFragment(notes, folderId, '', hasMore, offset + notes.length));
			} catch (error) {
				sendHtml(response, 500, '<div class="empty-hint">Error</div>');
			}
			return;
		}

		// --- mobile fragment: new note ---
		if (url.pathname === '/fragments/mobile/notes/new' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const body = await parseBody(request);
				let folderId = body.folderId || '';
				// If "all notes" or no folder, find/create General folder
				if (!folderId || folderId === '__all__') {
					const folders = await itemService.foldersByUserId(auth.user.id);
					const real = folders.filter(f => !f.isVirtualAllNotes && f.id !== TRASH_FOLDER_ID);
					let general = real.find(f => (f.title || '').toLowerCase() === 'general');
					if (!general) general = real[0];
					if (general) folderId = general.id;
				}
				const note = await itemWriteService.createNote(auth.user.sessionId, { title: 'Untitled note', body: '', parentId: folderId }, upstreamRequestContext(request));
				const notes = await itemService.noteHeadersByFolder(auth.user.id, folderId || '__all__', NOTE_PAGE_SIZE, 0);
				const counts = await itemService.folderNoteCountsByUserId(auth.user.id);
				const totalCount = folderId && folderId !== '__all__' ? (counts.get(folderId) || 0) : (counts.get('__all__') || 0);
				const hasMore = notes.length < totalCount;
				response.writeHead(200, {
					'Content-Type': 'text/html; charset=utf-8',
					'X-Mobile-Note-Id': note.id || '',
				});
				response.end(templates.mobileNotesFragment(notes, folderId, '', hasMore, notes.length));
			} catch (error) {
				console.error('[mobile] notes/new error:', error);
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error && (error.message || `${error}`) || 'creating note')}</div>`);
			}
			return;
		}

		// --- mobile fragment: search ---
		if (url.pathname === '/fragments/mobile/search' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }
				const query = url.searchParams.get('q') || '';
				const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
				const notes = query ? await itemService.searchNotes(auth.user.id, query, 50, offset) : [];
				const hasMore = notes.length === 50;
				sendHtml(response, 200, templates.mobileSearchFragment(notes, hasMore, offset + notes.length, query));
			} catch (error) {
				sendHtml(response, 500, '<div class="empty-hint">Search error</div>');
			}
			return;
		}

		// --- htmx fragment: note editor ---
		if (url.pathname.startsWith('/fragments/editor/') && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="editor-empty">Session expired.</div>'); return; }

				const noteId = decodeURIComponent(url.pathname.slice('/fragments/editor/'.length));
				const currentFolderId = url.searchParams.get('currentFolderId') || '';
				const currentSettings = await userSettings(auth.user.id);
				const [note, folders] = await Promise.all([
					itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'all' }),
					itemService.foldersByUserId(auth.user.id),
				]);
				if (!note) { sendHtml(response, 404, '<div class="editor-empty">Note not found.</div>'); return; }
				await saveLastNoteState(settingsService, auth.user.id, currentSettings, note.id, currentFolderId || note.parentId);
				sendHtml(response, 200, templates.editorFragment(note, folders, currentFolderId || note.parentId));
			} catch (error) {
				sendHtml(response, 500, '<div class="editor-empty">Error</div>');
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/editor/') && request.method === 'PUT') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<span class="autosave-error">Session expired</span>'); return; }

				const noteId = decodeURIComponent(url.pathname.slice('/fragments/editor/'.length));
				const body = await parseBody(request);
				const currentSettings = await userSettings(auth.user.id);
				const baseUpdatedTime = Number(body.baseUpdatedTime || 0);
				const forceSave = `${body.forceSave || ''}` === '1';
				const createCopy = `${body.createCopy || ''}` === '1';
				let existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!existing) existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId, { deleted: 'only' });
				if (!existing) { sendHtml(response, 404, '<span class="autosave-error">Note not found</span>'); return; }
				const currentFolderId = `${body.currentFolderId || body.parentId || existing.parentId || ''}`;
				if (createCopy) {
					const parentFolderId = body.parentId || existing.parentId || '';
					const [{ folders, counts }, siblingNotes] = await Promise.all([
						navData(auth.user.id),
						itemService.noteHeadersByFolder(auth.user.id, parentFolderId || '__all__', 500, 0),
					]);
					const copyTitle = nextConflictCopyTitle(plainNoteTitle(body.title), siblingNotes.map(note => note.title));
					const created = await itemWriteService.createNote(auth.user.sessionId, {
						title: copyTitle,
						body: body.body,
						parentId: parentFolderId,
					}, upstreamRequestContext(request));
					const createdNote = await itemService.noteByUserIdAndJopId(auth.user.id, created.id);
					await saveLastNoteState(settingsService, auth.user.id, currentSettings, created.id, currentFolderId || (createdNote && createdNote.parentId) || parentFolderId);
					sendHtml(response, 200, `${templates.autosaveStatusFragment()}<div id="nav-panel" hx-swap-oob="innerHTML">${templates.navigationFragment(folders, counts, selectedFolderForNav(currentFolderId), created.id, '', selectedFolderForNav(currentFolderId))}</div><div id="editor-panel" hx-swap-oob="innerHTML">${templates.editorFragment(createdNote, folders.filter(folder => folder.id !== TRASH_FOLDER_ID), selectedFolderForNav(currentFolderId))}</div>`);
					return;
				}
				if (!forceSave && baseUpdatedTime && Number(existing.updatedTime || 0) !== baseUpdatedTime) {
					sendHtml(response, 200, templates.autosaveConflictFragment(noteId));
					return;
				}
				await itemWriteService.updateNote(auth.user.sessionId, existing, {
					title: plainNoteTitle(body.title),
					body: body.body,
					parentId: body.parentId,
				}, upstreamRequestContext(request));
				// save history snapshot (best-effort, fire-and-forget)
				if (historyService) {
					historyService.saveSnapshot(auth.user.id, noteId, existing.title, existing.body).catch(() => {});
				}
				const refreshed = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				await saveLastNoteState(settingsService, auth.user.id, currentSettings, noteId, currentFolderId || (refreshed && refreshed.parentId) || body.parentId || existing.parentId);

				const titleChanged = plainNoteTitle(body.title) !== `${existing.title || ''}`;
				const folderChanged = `${body.parentId || ''}` !== `${existing.parentId || ''}`;
				const needsNav = titleChanged || folderChanged;
				let navOob = '';
				if (needsNav) {
					const { folders, counts } = await navData(auth.user.id);
					navOob = `<div id="nav-panel" hx-swap-oob="innerHTML">${templates.navigationFragment(folders, counts, selectedFolderForNav(currentFolderId), noteId, '', selectedFolderForNav(currentFolderId))}</div>`;
				}
				sendHtml(response, 200, `${templates.autosaveStatusFragment()}${navOob}${templates.noteSyncStateFragment(refreshed || existing).replace('<span id="editor-sync-state">', '<span id="editor-sync-state" hx-swap-oob="outerHTML">')}${templates.noteMetaFragment(refreshed || existing).replace('<span id="note-meta"', '<span id="note-meta" hx-swap-oob="outerHTML"')}`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, '<span class="autosave-error">Save failed</span>');
			}
			return;
		}

		// --- Logout (htmx) ---
		if (url.pathname === '/logout' && (request.method === 'POST' || request.method === 'GET')) {
			const sendLoggedOutPage = () => {
				send(response, 200, templates.loggedOutPage(joplinPublicBasePath), {
					'Cache-Control': 'no-store',
					'Content-Type': 'text/html; charset=utf-8',
					'Set-Cookie': expiredSessionCookie(),
				});
			};
			// Return the logout page immediately; upstream logout is best-effort.
			sendLoggedOutPage();

			const logoutUrl = new URL(joplinServerOrigin);
			const headers = { ...request.headers };
			headers.host = request.headers.host || configuredPublicUrl.host;
			headers['x-forwarded-host'] = headers.host;
			headers['x-forwarded-proto'] = (request.headers['x-forwarded-proto'] || configuredPublicUrl.protocol.replace(':', ''));
			delete headers.origin;
			delete headers.referer;

			const upstreamReq = http.request({
				hostname: logoutUrl.hostname,
				port: logoutUrl.port,
				path: '/logout',
				method: 'POST',
				headers,
				timeout: 3000,
			}, upstreamRes => {
				upstreamRes.resume();
			});
			upstreamReq.on('timeout', () => upstreamReq.destroy());
			upstreamReq.on('error', () => {});
			if (request.method === 'POST') {
				request.pipe(upstreamReq);
			} else {
				upstreamReq.end();
			}
			return;
		}

		// --- JSON API (kept for potential programmatic use) ---
		if (url.pathname === '/api/web/me') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				sendJson(response, 200, { user: auth.user });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname === '/api/web/folders') {
			if (request.method === 'POST') {
				try {
					const auth = await authenticatedUser(request);
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					const body = await parseBody(request);
					const title = `${body.title || ''}`.trim();
					if (!title) { sendJson(response, 400, { error: 'Folder title is required' }); return; }
					const created = await itemWriteService.createFolder(auth.user.sessionId, { title, parentId: body.parentId || '' }, upstreamRequestContext(request));
					const folder = await itemService.folderByUserIdAndJopId(auth.user.id, created.id);
					sendJson(response, 201, { item: folder });
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				const folders = await itemService.foldersByUserId(auth.user.id);
				sendJson(response, 200, { items: folders });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname.startsWith('/api/web/folders/') && request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				const folderId = decodeURIComponent(url.pathname.slice('/api/web/folders/'.length));
				if (!folderId) { sendJson(response, 404, { error: 'Folder not found' }); return; }
				await itemWriteService.deleteFolder(auth.user.sessionId, folderId, upstreamRequestContext(request));
				sendJson(response, 204, {});
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname === '/api/web/notes') {
			if (request.method === 'POST') {
				try {
					const auth = await authenticatedUser(request);
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					const body = await parseBody(request);
					const parentId = `${body.parentId || ''}`;
					if (!parentId) { sendJson(response, 400, { error: 'Note parentId is required' }); return; }
					const created = await itemWriteService.createNote(auth.user.sessionId, {
						title: plainNoteTitle(body.title),
						body: `${body.body || ''}`,
						parentId,
					}, upstreamRequestContext(request));
					const note = await itemService.noteByUserIdAndJopId(auth.user.id, created.id);
					sendJson(response, 201, { item: note });
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				const folderId = url.searchParams.get('folderId') || '';
				const notes = await notesForFolder(itemService, auth.user.id, folderId);
				sendJson(response, 200, { items: notes });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname.startsWith('/api/web/notes/')) {
			const noteId = decodeURIComponent(url.pathname.slice('/api/web/notes/'.length));
			if (request.method === 'PUT') {
				try {
					const auth = await authenticatedUser(request);
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return; }
					const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
					if (!existing) { sendJson(response, 404, { error: 'Note not found' }); return; }
					const body = await parseBody(request);
					const updated = await itemWriteService.updateNote(auth.user.sessionId, existing, {
						title: plainNoteTitle(body.title), body: body.body, parentId: body.parentId,
					}, upstreamRequestContext(request));
					const note = await itemService.noteByUserIdAndJopId(auth.user.id, updated.id);
					sendJson(response, 200, { item: note });
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}
			if (request.method === 'DELETE') {
				try {
					const auth = await authenticatedUser(request);
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return; }
					await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
					sendJson(response, 204, {});
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return; }
				const note = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!note) { sendJson(response, 404, { error: 'Note not found' }); return; }
				sendJson(response, 200, { item: note });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		// --- POST /login — authenticate via Joplin Server API ---
		if (url.pathname === '/login' && request.method === 'POST') {
			try {
				const body = await parseBody(request);
				const email = body.email || '';
				const password = body.password || '';
				const totp = body.totp || '';
				if (!email || !password) {
					response.writeHead(302, { Location: `/login?error=${encodeURIComponent('Email and password are required')}` });
					response.end();
					return;
				}
				const apiUrl = new URL('/api/sessions', joplinServerOrigin);
				const requestContext = upstreamRequestContext(request);
				const origin = `${requestContext.protocol}://${requestContext.host}`;
				const payload = JSON.stringify({ email, password });
				const loginResult = await new Promise((resolve, reject) => {
					const upstreamRequest = http.request({
						hostname: apiUrl.hostname,
						port: apiUrl.port,
						path: apiUrl.pathname + apiUrl.search,
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Content-Length': Buffer.byteLength(payload),
							Host: requestContext.host,
							Origin: origin,
							Referer: `${origin}/login`,
							'X-Forwarded-Host': requestContext.host,
							'X-Forwarded-Proto': requestContext.protocol,
						},
					}, upstreamResponse => {
						const chunks = [];
						upstreamResponse.on('data', chunk => chunks.push(chunk));
						upstreamResponse.on('end', () => {
							resolve({
								statusCode: upstreamResponse.statusCode || 500,
								body: Buffer.concat(chunks).toString('utf8'),
							});
						});
					});

					upstreamRequest.on('error', reject);
					upstreamRequest.write(payload);
					upstreamRequest.end();
				});

				if (loginResult.statusCode < 200 || loginResult.statusCode >= 300) {
					response.writeHead(302, { Location: `/login?error=${encodeURIComponent('Invalid email or password')}` });
					response.end();
					return;
				}
				const session = JSON.parse(loginResult.body);
				
				// Check per-user MFA (skip for docker-defined admin when IGNORE_ADMIN_MFA is set)
				const user = await sessionService.userBySessionId(session.id);
				const isDockerAdmin = ignoreAdminMfa && adminEmail && user && user.email === adminEmail;
				if (user && !isDockerAdmin) {
					const userTotpSeed = await settingsService.getTotpSeed(user.id);
					if (userTotpSeed) {
						// User has MFA - check if code provided
						if (!totp) {
							// No code yet - show MFA page with pending session
							response.writeHead(302, {
								'Cache-Control': 'no-store',
								'Set-Cookie': `pendingSession=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`,
								Location: '/login/mfa',
							});
							response.end();
							return;
						}
						if (!verifyWithSeed(userTotpSeed, totp)) {
							// Code invalid
							response.writeHead(302, { Location: `/login?error=${encodeURIComponent('Invalid authentication code')}` });
							response.end();
							return;
						}
					}
				}
				
				// Clear any pending session, set real session
				if (user) {
					try {
						await ensureStarterContent({ ...user, sessionId: session.id }, request);
					} catch {}
				}
				response.writeHead(302, {
					'Cache-Control': 'no-store',
					'Set-Cookie': [
						`sessionId=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`,
						'pendingSession=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
					],
					Location: '/',
				});
				response.end();
			} catch (error) {
				response.writeHead(302, { Location: `/login?error=${encodeURIComponent(`Login failed: ${error.message || error}`)}` });
				response.end();
			}
			return;
		}

		// --- GET /login/mfa — MFA code entry page ---
		if (url.pathname === '/login/mfa' && request.method === 'GET') {
			const pendingSession = sessionIdFromHeaders(request.headers, 'pendingSession');
			if (!pendingSession) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			sendHtml(response, 200, templates.mfaPage({
				error: url.searchParams.get('error') || '',
			}));
			return;
		}

		// --- POST /login/mfa — verify MFA code ---
		if (url.pathname === '/login/mfa' && request.method === 'POST') {
			try {
				const pendingSession = sessionIdFromHeaders(request.headers, 'pendingSession');
				if (!pendingSession) {
					response.writeHead(302, { Location: '/login' });
					response.end();
					return;
				}
				const body = await parseBody(request);
				const totp = body.totp || '';
				
				const user = await sessionService.userBySessionId(pendingSession);
				if (!user) {
					response.writeHead(302, {
						'Set-Cookie': 'pendingSession=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
						Location: '/login?error=Session+expired',
					});
					response.end();
					return;
				}
				
				const userTotpSeed = await settingsService.getTotpSeed(user.id);
				if (!userTotpSeed || !verifyWithSeed(userTotpSeed, totp)) {
					response.writeHead(302, { Location: '/login/mfa?error=Invalid+code' });
					response.end();
					return;
				}
				
				// MFA verified - set real session
				try {
					await ensureStarterContent({ ...user, sessionId: pendingSession }, request);
				} catch {}
				response.writeHead(302, {
					'Cache-Control': 'no-store',
					'Set-Cookie': [
						`sessionId=${pendingSession}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`,
						'pendingSession=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
					],
					Location: '/',
				});
				response.end();
			} catch (error) {
				response.writeHead(302, { Location: '/login/mfa?error=Verification+failed' });
				response.end();
			}
			return;
		}

		if (url.pathname === '/login' && request.method === 'GET') {
			if (url.searchParams.get('loggedOut') === '1') {
				sendHtml(response, 200, templates.layoutPage({ debug,
					user: null,
					joplinBasePath: joplinPublicBasePath,
					settings: null,
					mfaEnabled: false,
					loginError: url.searchParams.get('error') || '',
				}));
				return;
			}
			const auth = await authenticatedUser(request);
			if (!auth.error && auth.user) {
				response.writeHead(302, { Location: '/' });
				response.end();
				return;
			}

			sendHtml(response, 200, templates.layoutPage({ debug,
				user: null,
				joplinBasePath: joplinPublicBasePath,
				settings: null,
				mfaEnabled: false,
				loginError: url.searchParams.get('error') || '',
			}));
			return;
		}

		// --- Joplin Server proxy ---
		if (joplinPublicBasePath && (url.pathname === joplinPublicBasePath || url.pathname.startsWith(`${joplinPublicBasePath}/`))) {
			proxyToJoplinServer(request, response, url);
			return;
		}

		// --- SSR full page (GET /) ---
		const relativePath = url.pathname === '/' ? '/index.html' : url.pathname;

		if (relativePath === '/index.html') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error || !auth.user) {
					response.writeHead(302, { Location: '/login' });
					response.end();
					return;
				}

				const settings = await userSettings(auth.user.id);
				try {
					await ensureStarterContent(auth.user, request);
				} catch {}
				let { folders, counts } = await navData(auth.user.id);
				let selectedFolderId = '';
				let selectedNoteId = '';
				let selectedNoteContextFolderId = null;
				let editorContent = '<div class="editor-empty">Select a note</div>';
				let mobileStartup = null;
				let mobileEditorContent = '';
				if (settings && settings.resumeLastNote && settings.lastNoteId) {
					const resumed = await itemService.noteByUserIdAndJopId(auth.user.id, settings.lastNoteId, { deleted: 'all' });
					if (resumed && !resumed.deletedTime) {
						const resumeFolderId = normalizeStoredFolderId(settings.lastNoteFolderId || resumed.parentId || '');
						selectedFolderId = selectedFolderForNav(resumeFolderId || resumed.parentId || '');
						selectedNoteId = resumed.id;
						selectedNoteContextFolderId = selectedFolderId || null;
						editorContent = templates.editorFragment(resumed, folders.filter(folder => folder.id !== TRASH_FOLDER_ID), selectedFolderId || resumed.parentId);
						mobileEditorContent = templates.mobileEditorFragment(resumed, folders.filter(folder => folder.id !== TRASH_FOLDER_ID), selectedFolderId || resumed.parentId);
						mobileStartup = {
							folderId: selectedFolderId || resumed.parentId || '',
							folderTitle: selectedFolderId === ALL_NOTES_FOLDER_ID ? 'All Notes' : ((folders.find(folder => folder.id === (selectedFolderId || resumed.parentId || '')) || {}).title || 'Notes'),
							noteId: resumed.id,
							noteTitle: plainNoteTitle(resumed.title),
						};
					} else if (settings.lastNoteId || settings.lastNoteFolderId) {
						await settingsService.saveSettings(auth.user.id, { ...settings, lastNoteId: '', lastNoteFolderId: '' });
					}
				}

				sendHtml(response, 200, templates.layoutPage({ debug,
					user: auth.user,
					settings,
					mobileStartup,
					mobileEditorContent,
					navContent: templates.navigationFragment(folders, counts, selectedFolderId, selectedNoteId, '', selectedNoteContextFolderId),
					editorContent,
					joplinBasePath: joplinPublicBasePath,
				}));
			} catch (error) {
				sendHtml(response, 200, templates.layoutPage({ debug, user: null, joplinBasePath: joplinPublicBasePath }));
			}
			return;
		}

		// --- Static files ---
		const filePath = path.join(publicDir, relativePath.replace(/^\/+/, ''));

		if (filePath.startsWith(publicDir) && fileExists(filePath) && !relativePath.endsWith('/')) {
			serveFile(response, filePath);
			return;
		}

		// Fallback: serve SSR page for any unknown path (SPA-like)
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				response.writeHead(302, { Location: '/login' });
				response.end();
				return;
			}
			const settings = await userSettings(auth.user.id);
			const { folders, counts } = await navData(auth.user.id);
			sendHtml(response, 200, templates.layoutPage({ debug,
				user: auth.user,
				settings,
				navContent: templates.navigationFragment(folders, counts, '', ''),
				joplinBasePath: joplinPublicBasePath,
			}));
		} catch (error) {
			response.writeHead(302, { Location: '/login' });
			response.end();
		}
	});
};

module.exports = {
	createServer,
};
