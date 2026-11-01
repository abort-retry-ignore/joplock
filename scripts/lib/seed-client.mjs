// A tiny Joplock HTTP client for the seed scripts: logs in like the login form, then uses the JSON
// API with the session cookie, exactly as a browser would. Node 20+ (fetch, FormData, Blob), no deps.

export const createClient = ({ base, login, password }) => {
	const root = `${base}`.replace(/\/+$/, '');
	let cookie = '';

	const http = (path, init = {}) => fetch(`${root}${path}`, { redirect: 'manual', ...init, headers: { ...(init.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });

	const json = async (path, method = 'GET', body) => {
		const res = await http(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
		const text = await res.text();
		let data = null;
		try { data = JSON.parse(text); } catch { /* not json */ }
		if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data && data.error ? data.error : text.slice(0, 200)}`);
		return data;
	};

	const upload = async (filename, mime, buffer) => {
		const form = new FormData();
		form.append('file', new Blob([buffer], { type: mime }), filename);
		const res = await http('/fragments/upload', { method: 'POST', body: form });
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.resourceId) throw new Error(`upload ${filename} -> ${res.status} ${data.error || ''}`);
		return data.resourceId;
	};

	const tryLogin = async () => {
		const res = await http('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: login, password }) });
		const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
		const session = setCookie.map(c => /(?:^|;\s*)sessionId=([^;]+)/.exec(c)).find(Boolean);
		if (res.headers.get('location') === '/login/mfa') throw new Error('this account has MFA turned on; use an account without it');
		if (!session || !session[1]) return `${res.status} -> ${res.headers.get('location') || 'no redirect'}`;
		cookie = `sessionId=${session[1]}`;
		return null;
	};

	// On a fresh database the account may appear a few seconds after the server is up: retry.
	const loginWithRetry = async ({ attempts = 30, delayMs = 4000 } = {}) => {
		let last = '';
		for (let i = 0; i < attempts; i++) {
			try {
				last = await tryLogin();
				if (!last) return;
			} catch (error) {
				if (/MFA/.test(error.message)) throw error;
				last = error.message;
			}
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
		throw new Error(`login failed after ${attempts} attempts (${last})`);
	};

	return { http, json, upload, login: loginWithRetry };
};
