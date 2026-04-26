'use strict';

const http = require('http');
const { sessionIdFromHeaders } = require('../auth/cookies');
const { verifyWithSeed } = require('../auth/mfaService');
const { redirect, expiredSessionCookie, send, parseBody } = require('./_helpers');
const templates = require('../templates');

const handle = async (url, request, response, ctx) => {
	const { sendHtml, sessionService, settingsService, itemWriteService, upstreamRequestContext,
		joplinServerOrigin, configuredPublicUrl, ignoreAdminMfa, adminEmail,
		ensureStarterContent, debug } = ctx;

	// GET /login/mfa
	if (url.pathname === '/login/mfa' && request.method === 'GET') {
		const pendingSession = sessionIdFromHeaders(request.headers, 'pendingSession');
		if (!pendingSession) {
			redirect(response, '/login');
			return true;
		}
		sendHtml(response, 200, templates.mfaPage({ error: url.searchParams.get('error') || '' }));
		return true;
	}

	// POST /login/mfa
	if (url.pathname === '/login/mfa' && request.method === 'POST') {
		try {
			const pendingSession = sessionIdFromHeaders(request.headers, 'pendingSession');
			if (!pendingSession) {
				redirect(response, '/login');
				return true;
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
				return true;
			}
			const userTotpSeed = await settingsService.getTotpSeed(user.id);
			if (!userTotpSeed || !verifyWithSeed(userTotpSeed, totp)) {
				redirect(response, '/login/mfa?error=Invalid+code');
				return true;
			}
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
		} catch {
			redirect(response, '/login/mfa?error=Verification+failed');
		}
		return true;
	}

	// GET /login
	if (url.pathname === '/login' && request.method === 'GET') {
		if (url.searchParams.get('loggedOut') === '1') {
			sendHtml(response, 200, templates.layoutPage({ debug,
				user: null,
				joplinBasePath: ctx.joplinPublicBasePath,
				settings: null,
				mfaEnabled: false,
				loginError: url.searchParams.get('error') || '',
			}));
			return true;
		}
		const auth = await ctx.authenticatedUser(request);
		if (!auth.error && auth.user) {
			redirect(response, '/');
			return true;
		}
		sendHtml(response, 200, templates.layoutPage({ debug,
			user: null,
			joplinBasePath: ctx.joplinPublicBasePath,
			settings: null,
			mfaEnabled: false,
			loginError: url.searchParams.get('error') || '',
		}));
		return true;
	}

	// POST /login
	if (url.pathname === '/login' && request.method === 'POST') {
		try {
			const body = await parseBody(request);
			const email = body.email || '';
			const password = body.password || '';
			const totp = body.totp || '';
			if (!email || !password) {
				redirect(response, `/login?error=${encodeURIComponent('Email and password are required')}`);
				return true;
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
					upstreamResponse.on('end', () => resolve({
						statusCode: upstreamResponse.statusCode || 500,
						body: Buffer.concat(chunks).toString('utf8'),
					}));
				});
				upstreamRequest.on('error', reject);
				upstreamRequest.write(payload);
				upstreamRequest.end();
			});

			if (loginResult.statusCode < 200 || loginResult.statusCode >= 300) {
				redirect(response, `/login?error=${encodeURIComponent('Invalid email or password')}`);
				return true;
			}
			const session = JSON.parse(loginResult.body);
			const user = await sessionService.userBySessionId(session.id);
			const isDockerAdmin = ignoreAdminMfa && adminEmail && user && user.email === adminEmail;
			if (user && !isDockerAdmin) {
				const userTotpSeed = await settingsService.getTotpSeed(user.id);
				if (userTotpSeed) {
					if (!totp) {
						response.writeHead(302, {
							'Cache-Control': 'no-store',
							'Set-Cookie': `pendingSession=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`,
							Location: '/login/mfa',
						});
						response.end();
						return true;
					}
					if (!verifyWithSeed(userTotpSeed, totp)) {
						redirect(response, `/login?error=${encodeURIComponent('Invalid authentication code')}`);
						return true;
					}
				}
			}
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
			redirect(response, `/login?error=${encodeURIComponent(`Login failed: ${error.message || error}`)}`);
		}
		return true;
	}

	// POST/GET /logout
	if (url.pathname === '/logout' && (request.method === 'POST' || request.method === 'GET')) {
		send(response, 200, templates.loggedOutPage(ctx.joplinPublicBasePath), {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/html; charset=utf-8',
			'Set-Cookie': expiredSessionCookie(),
		});

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
		}, upstreamRes => { upstreamRes.resume(); });
		upstreamReq.on('timeout', () => upstreamReq.destroy());
		upstreamReq.on('error', () => {});
		if (request.method === 'POST') {
			request.pipe(upstreamReq);
		} else {
			upstreamReq.end();
		}
		return true;
	}

	// POST /heartbeat — updates last-seen for session timeout tracking
	if (url.pathname === '/heartbeat' && request.method === 'POST') {
		const auth = await ctx.authenticatedUser(request);
		if (auth.error) { send(response, 401, ''); return true; }
		await sessionService.touchSession(auth.user.sessionId);
		send(response, 204, '');
		return true;
	}

	return false;
};

module.exports = { handle };
