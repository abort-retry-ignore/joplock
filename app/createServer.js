'use strict';

const http = require('http');
const path = require('path');
const { sessionIdFromHeaders } = require('./auth/cookies');
const templates = require('./templates');

const {
	send, makeSendHtml, redirect, fileExists, serveFile,
	ALL_NOTES_FOLDER_ID, TRASH_FOLDER_ID,
	allNotesFolder, trashFolder, selectedFolderForNav, normalizeStoredFolderId,
} = require('./routes/_helpers');

const routeAuth = require('./routes/auth');
const routeSettings = require('./routes/settings');
const routeAdmin = require('./routes/admin');
const routeHistory = require('./routes/history');
const routeResources = require('./routes/resources');
const routeFragments = require('./routes/fragments');
const routeMobile = require('./routes/mobile');
const routeApi = require('./routes/api');

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
		adminService && adminEmail && user && user.email === adminEmail && user.isAdmin
	);

	const log = debug ? (...args) => process.stdout.write(`[joplock] ${args.join(' ')}\n`) : () => {};

	const configuredPublicUrl = new URL(joplinPublicBaseUrl);
	const configuredServerPublicUrl = new URL(joplinServerPublicUrl);

	const authenticatedUser = async request => {
		const sessionId = sessionIdFromHeaders(request.headers);
		if (!sessionId) return { error: 'Missing session', user: null };
		const user = await sessionService.userBySessionId(sessionId);
		if (!user) return { error: 'Invalid or expired session', user: null };
		// Enforce heartbeat-based session timeout if enabled
		if (settingsService) {
			const settings = await settingsService.settingsByUserId(user.id);
			if (settings.autoLogout && settings.autoLogoutMinutes > 0) {
				const lastSeen = await sessionService.getLastSeen(sessionId);
				const timeoutMs = settings.autoLogoutMinutes * 60 * 1000;
				const graceMs = 10000; // 10s grace for heartbeat jitter/latency
				const age = lastSeen !== null ? Date.now() - lastSeen : null;
				log(`heartbeat check: lastSeen=${lastSeen} age=${age}ms timeout=${timeoutMs}ms session=${sessionId.slice(0,8)}`);
				if (lastSeen !== null && age > timeoutMs + graceMs) {
					log(`heartbeat timeout: expiring session ${sessionId.slice(0,8)}`);
					await sessionService.deleteSession(sessionId);
					return { error: 'Session expired due to inactivity', user: null };
				}
			}
		}
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

	const upstreamRequestContext = _request => ({
		host: configuredServerPublicUrl.host,
		protocol: configuredServerPublicUrl.protocol.replace(':', ''),
	});

	const userSettings = async userId => settingsService ? settingsService.settingsByUserId(userId) : null;

	const saveLastNoteState = async (userId, currentSettings, noteId, folderId) => {
		if (!settingsService) return currentSettings;
		return settingsService.saveSettings(userId, {
			...currentSettings,
			lastNoteId: `${noteId || ''}`,
			lastNoteFolderId: normalizeStoredFolderId(folderId),
		});
	};

	const plainNoteTitle = title => templates.stripMarkdownForTitle(`${title || ''}`) || 'Untitled note';

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

		const sendHtml = makeSendHtml(request, log);

		// Shared context passed to all route handlers
		const ctx = {
			sendHtml,
			authenticatedUser,
			navData,
			userSettings,
			saveLastNoteState,
			plainNoteTitle,
			ensureStarterContent,
			upstreamRequestContext,
			isJoplockAdmin,
			// services
			sessionService,
			itemService,
			settingsService,
			historyService,
			itemWriteService,
			adminService,
			database,
			// config
			joplinPublicBasePath,
			joplinServerOrigin,
			configuredPublicUrl,
			ignoreAdminMfa,
			adminEmail,
			debug,
		};

		// Health check
		if (url.pathname === '/health') {
			send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
			return;
		}

		// Route handlers (order matters — first match wins)
		const routes = [
			routeAuth,
			routeSettings,
			routeAdmin,
			routeHistory,
			routeResources,
			routeMobile,
			routeFragments,
			routeApi,
		];

		for (const route of routes) {
			if (await route.handle(url, request, response, ctx)) return;
		}

		// Joplin Server proxy
		if (joplinPublicBasePath && (url.pathname === joplinPublicBasePath || url.pathname.startsWith(`${joplinPublicBasePath}/`))) {
			proxyToJoplinServer(request, response, url);
			return;
		}

		// SSR full page (GET /)
		const relativePath = url.pathname === '/' ? '/index.html' : url.pathname;

		if (relativePath === '/index.html') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error || !auth.user) {
					redirect(response, '/login');
					return;
				}
				const settings = await userSettings(auth.user.id);
				try { await ensureStarterContent(auth.user, request); } catch {}
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
						const noteFolderId = resumed.parentId || '';
						selectedFolderId = noteFolderId;
						selectedNoteId = resumed.id;
						selectedNoteContextFolderId = noteFolderId || null;
						editorContent = templates.editorFragment(resumed, folders.filter(f => f.id !== TRASH_FOLDER_ID), noteFolderId);
						mobileEditorContent = templates.mobileEditorFragment(resumed, folders.filter(f => f.id !== TRASH_FOLDER_ID), noteFolderId);
						mobileStartup = {
							folderId: noteFolderId,
							folderTitle: (folders.find(f => f.id === noteFolderId) || {}).title || 'Notes',
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
			} catch {
				sendHtml(response, 200, templates.layoutPage({ debug, user: null, joplinBasePath: joplinPublicBasePath }));
			}
			return;
		}

		// Static files
		const filePath = path.join(publicDir, relativePath.replace(/^\/+/, ''));
		if (filePath.startsWith(publicDir) && fileExists(filePath) && !relativePath.endsWith('/')) {
			serveFile(response, filePath);
			return;
		}

		// Fallback: SSR page for unknown paths
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				redirect(response, '/login');
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
		} catch {
			redirect(response, '/login');
		}
	});
};

module.exports = { createServer };
