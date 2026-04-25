'use strict';

const http = require('http');
const bcrypt = require('bcryptjs');

// ---------- password strength ----------
const isStrongPassword = password => {
	if (!password || password.length < 12) return false;
	const hasLower = /[a-z]/.test(password);
	const hasUpper = /[A-Z]/.test(password);
	const hasDigit = /[0-9]/.test(password);
	const hasSpecial = /[^a-zA-Z0-9]/.test(password);
	const categories = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
	return categories >= 3;
};

// ---------- HTTP helper to Joplin internal API ----------
const requestJoplin = (origin, method, path, body, sessionId, publicUrl) => new Promise((resolve, reject) => {
	const url = new URL(origin);
	const pub = publicUrl ? new URL(publicUrl) : url;
	const payload = body ? JSON.stringify(body) : null;
	const headers = {
		'Content-Type': 'application/json',
		Host: pub.host,
		Origin: pub.origin,
		'X-Forwarded-Host': pub.host,
		'X-Forwarded-Proto': pub.protocol.replace(':', ''),
	};
	if (sessionId) headers['x-api-auth'] = sessionId;
	if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

	const req = http.request({
		hostname: url.hostname,
		port: url.port,
		path,
		method,
		headers,
	}, res => {
		const chunks = [];
		res.on('data', c => chunks.push(c));
		res.on('end', () => {
			const text = Buffer.concat(chunks).toString('utf8');
			let json = null;
			try { json = JSON.parse(text); } catch {}
			resolve({ statusCode: res.statusCode, body: json, raw: text });
		});
	});
	req.on('error', reject);
	if (payload) req.write(payload);
	req.end();
});

const createAdminService = ({ database, joplinServerOrigin, joplinServerPublicUrl, adminEmail, adminPassword }) => {
	// token cache
	let _token = null;
	let _tokenExpiry = 0;
	const TOKEN_TTL_MS = 11 * 60 * 60 * 1000; // 11h

	const getAdminToken = async () => {
		if (_token && Date.now() < _tokenExpiry) return _token;
		const res = await requestJoplin(joplinServerOrigin, 'POST', '/api/sessions', {
			email: adminEmail,
			password: adminPassword,
		}, null, joplinServerPublicUrl);
		if (!res.body || !res.body.id) {
			throw new Error(`Admin login failed (${res.statusCode}): ${res.raw}`);
		}
		_token = res.body.id;
		_tokenExpiry = Date.now() + TOKEN_TTL_MS;
		return _token;
	};

	// ---------- Bootstrap: ensure admin user exists ----------
	const ensureAdminUser = async () => {
		// Validate password strength first
		if (!isStrongPassword(adminPassword)) {
			process.stderr.write('[joplock] FATAL: JOPLOCK_ADMIN_PASSWORD is too weak. Must be ≥12 chars with letters, numbers, and at least 3 character categories.\n');
			process.exit(1);
		}

		// Check if admin user exists in Joplin DB
		let rows;
		try {
			const result = await database.query(
				'SELECT id, email, is_admin, enabled FROM users WHERE email = $1 LIMIT 1',
				[adminEmail],
			);
			rows = result.rows;
		} catch (err) {
			process.stderr.write(`[joplock] WARNING: Could not query users table for admin bootstrap: ${err.message}\n`);
			return;
		}

		if (rows.length === 0) {
			// Fresh install — create user directly in DB
			process.stdout.write(`[joplock] Creating admin user ${adminEmail}...\n`);
			const passwordHash = await bcrypt.hash(adminPassword, 10);
			const now = Date.now();
			const id = require('crypto').randomBytes(16).toString('hex');
			try {
				await database.query(`
					INSERT INTO users (id, email, password, is_admin, enabled, email_confirmed, created_time, updated_time, must_set_password, account_type, max_item_size, can_share_folder, can_share_note, max_total_item_size)
					VALUES ($1, $2, $3, 1, 1, 1, $4, $4, 0, 0, 0, 1, 1, 0)
				`, [id, adminEmail, passwordHash, now]);
				process.stdout.write(`[joplock] Admin user created.\n`);
			} catch (err) {
				// Fallback: minimal insert if some columns don't exist
				try {
					await database.query(`
						INSERT INTO users (id, email, password, is_admin, enabled, email_confirmed, created_time, updated_time)
						VALUES ($1, $2, $3, 1, 1, 1, $4, $4)
					`, [id, adminEmail, passwordHash, now]);
					process.stdout.write(`[joplock] Admin user created (minimal).\n`);
				} catch (err2) {
					process.stderr.write(`[joplock] ERROR: Could not create admin user: ${err2.message}\n`);
				}
			}
		} else {
			const user = rows[0];
			const needsFix = !Number(user.is_admin) || !Number(user.enabled);
			// Always reset password to match docker-defined JOPLOCK_ADMIN_PASSWORD
			const passwordHash = await bcrypt.hash(adminPassword, 10);
			const now = Date.now();
			try {
				await database.query(
					'UPDATE users SET password=$1, is_admin=1, enabled=1, updated_time=$2 WHERE email=$3',
					[passwordHash, now, adminEmail],
				);
				if (needsFix) {
					process.stdout.write(`[joplock] Admin user fixed (is_admin/enabled) and password reset.\n`);
				}
			} catch (err) {
				process.stderr.write(`[joplock] WARNING: Could not reset admin password: ${err.message}\n`);
			}
		}
	};

	// ---------- User operations ----------

	const listUsers = async () => {
		const token = await getAdminToken();
		const res = await requestJoplin(joplinServerOrigin, 'GET', '/api/users', null, token, joplinServerPublicUrl);
		if (!res.body || !res.body.items) throw Object.assign(new Error('Failed to list users'), { statusCode: res.statusCode });

		// Augment with enabled flag from DB
		const apiUsers = res.body.items;
		const ids = apiUsers.map(u => u.id);
		let enabledMap = {};
		if (ids.length) {
			try {
				const result = await database.query(
					`SELECT id, enabled FROM users WHERE id = ANY($1)`,
					[ids],
				);
				for (const row of result.rows) {
					enabledMap[row.id] = !!Number(row.enabled);
				}
			} catch {}
		}
		return apiUsers.map(u => ({ ...u, enabled: enabledMap[u.id] !== undefined ? enabledMap[u.id] : true }));
	};

	const createUser = async (email, fullName, password) => {
		const token = await getAdminToken();
		// Step 1: create user (Joplin sets a random password + must_set_password=1)
		const createRes = await requestJoplin(joplinServerOrigin, 'POST', '/api/users', { email, full_name: fullName }, token, joplinServerPublicUrl);
		if (!createRes.body || !createRes.body.id) {
			throw Object.assign(new Error(createRes.body && createRes.body.error ? createRes.body.error : 'Create user failed'), { statusCode: createRes.statusCode });
		}
		const userId = createRes.body.id;
		// Step 2: set real password + clear must_set_password
		const passwordRes = await requestJoplin(joplinServerOrigin, 'PATCH', `/api/users/${userId}`, {
			password,
			must_set_password: 0,
		}, token, joplinServerPublicUrl);
		if (passwordRes.statusCode >= 400) {
			throw Object.assign(new Error(passwordRes.body && passwordRes.body.error ? passwordRes.body.error : 'Set password failed'), { statusCode: passwordRes.statusCode });
		}
		// Step 3: confirm email via direct DB write
		try {
			await database.query('UPDATE users SET email_confirmed=1, enabled=1 WHERE id=$1', [userId]);
		} catch {}
		return { id: userId, email, full_name: fullName };
	};

	const resetPassword = async (userId, newPassword) => {
		const token = await getAdminToken();
		const res = await requestJoplin(joplinServerOrigin, 'PATCH', `/api/users/${userId}`, {
			password: newPassword,
			must_set_password: 0,
		}, token, joplinServerPublicUrl);
		if (res.statusCode >= 400) {
			throw Object.assign(new Error(res.body && res.body.error ? res.body.error : 'Reset password failed'), { statusCode: res.statusCode });
		}
	};

	const setEnabled = async (userId, enabled) => {
		await database.query('UPDATE users SET enabled=$1 WHERE id=$2', [enabled ? 1 : 0, userId]);
	};

	const deleteUser = async (userId) => {
		// Disable first, then schedule deletion via user_deletions table
		await setEnabled(userId, false);
		const now = Date.now();
		try {
			await database.query(`
				INSERT INTO user_deletions (id, owner_id, process_data, process_account, scheduled_time)
				VALUES ($1, $2, 1, 1, $3)
				ON CONFLICT DO NOTHING
			`, [require('crypto').randomBytes(16).toString('hex'), userId, now]);
		} catch (err) {
			// Try without ON CONFLICT if old schema
			try {
				await database.query(`
					INSERT INTO user_deletions (id, owner_id, process_data, process_account, scheduled_time)
					VALUES ($1, $2, 1, 1, $3)
				`, [require('crypto').randomBytes(16).toString('hex'), userId, now]);
			} catch (err2) {
				process.stderr.write(`[joplock] WARNING: Could not insert user_deletions: ${err2.message}\n`);
			}
		}
	};

	const updateProfile = async (sessionToken, userId, { fullName, email }) => {
		const res = await requestJoplin(joplinServerOrigin, 'PATCH', `/api/users/${userId}`, {
			...(fullName !== undefined ? { full_name: fullName } : {}),
			...(email !== undefined ? { email } : {}),
		}, sessionToken, joplinServerPublicUrl);
		if (res.statusCode >= 400) {
			throw Object.assign(new Error(res.body && res.body.error ? res.body.error : 'Update profile failed'), { statusCode: res.statusCode });
		}
		return res.body;
	};

	const verifyPassword = async (email, password) => {
		const res = await requestJoplin(joplinServerOrigin, 'POST', '/api/sessions', { email, password }, null, joplinServerPublicUrl);
		if (res.statusCode < 200 || res.statusCode >= 300) return null;
		return res.body && res.body.id ? res.body.id : null;
	};

	const changePassword = async (sessionToken, userId, newPassword) => {
		const res = await requestJoplin(joplinServerOrigin, 'PATCH', `/api/users/${userId}`, {
			password: newPassword,
			must_set_password: 0,
		}, sessionToken, joplinServerPublicUrl);
		if (res.statusCode >= 400) {
			throw Object.assign(new Error(res.body && res.body.error ? res.body.error : 'Change password failed'), { statusCode: res.statusCode });
		}
	};

	return {
		ensureAdminUser,
		getAdminToken,
		listUsers,
		createUser,
		resetPassword,
		setEnabled,
		deleteUser,
		updateProfile,
		verifyPassword,
		changePassword,
		adminEmail,
	};
};

module.exports = { createAdminService, isStrongPassword };
