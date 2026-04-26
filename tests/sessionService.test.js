const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionService, isSessionExpired, defaultSessionTtlMs } = require('../app/auth/sessionService');

// --- isSessionExpired ---

test('isSessionExpired returns true for zero/null created time', () => {
	assert.ok(isSessionExpired(0));
	assert.ok(isSessionExpired(null));
	assert.ok(isSessionExpired(undefined));
});

test('isSessionExpired returns false for recent session', () => {
	assert.ok(!isSessionExpired(Date.now() - 1000));
});

test('isSessionExpired returns true for old session', () => {
	assert.ok(isSessionExpired(Date.now() - defaultSessionTtlMs - 1));
});

test('isSessionExpired returns false at exact boundary', () => {
	const now = Date.now();
	assert.ok(!isSessionExpired(now - defaultSessionTtlMs + 1, now));
});

test('defaultSessionTtlMs is 12 hours', () => {
	assert.equal(defaultSessionTtlMs, 12 * 60 * 60 * 1000);
});

// --- createSessionService ---

test('userBySessionId returns null for empty sessionId', async () => {
	const service = createSessionService({ query: async () => { throw new Error('should not query'); } });
	assert.equal(await service.userBySessionId(''), null);
	assert.equal(await service.userBySessionId(null), null);
});

test('userBySessionId returns null when no row found', async () => {
	const db = { query: async () => ({ rows: [] }) };
	const service = createSessionService(db);
	assert.equal(await service.userBySessionId('nonexistent'), null);
});

test('userBySessionId returns null for expired session', async () => {
	const db = {
		query: async () => ({
			rows: [{
				session_id: 's1', id: 'u1', email: 'a@b.com', full_name: 'A',
				is_admin: 0, can_upload: 1, email_confirmed: 1, account_type: 0,
				created_time: Date.now(), updated_time: Date.now(), enabled: 1,
				session_created_time: Date.now() - defaultSessionTtlMs - 1000,
			}],
		}),
	};
	const service = createSessionService(db);
	assert.equal(await service.userBySessionId('s1'), null);
});

test('userBySessionId returns null for disabled user', async () => {
	const db = {
		query: async () => ({
			rows: [{
				session_id: 's1', id: 'u1', email: 'a@b.com', full_name: 'A',
				is_admin: 0, can_upload: 1, email_confirmed: 1, account_type: 0,
				created_time: Date.now(), updated_time: Date.now(), enabled: 0,
				session_created_time: Date.now(),
			}],
		}),
	};
	const service = createSessionService(db);
	assert.equal(await service.userBySessionId('s1'), null);
});

test('userBySessionId returns mapped user for valid session', async () => {
	const now = Date.now();
	const db = {
		query: async () => ({
			rows: [{
				session_id: 's1', id: 'u1', email: 'a@b.com', full_name: 'A B',
				is_admin: 1, can_upload: 1, email_confirmed: 1, account_type: 2,
				created_time: now - 5000, updated_time: now - 1000, enabled: 1,
				session_created_time: now - 100,
			}],
		}),
	};
	const service = createSessionService(db);
	const user = await service.userBySessionId('s1');
	assert.equal(user.id, 'u1');
	assert.equal(user.email, 'a@b.com');
	assert.equal(user.fullName, 'A B');
	assert.equal(user.isAdmin, true);
	assert.equal(user.sessionId, 's1');
	assert.equal(user.accountType, 2);
});

test('userBySessionId passes sessionId to query', async () => {
	let captured = null;
	const db = { query: async (_sql, params) => { captured = params; return { rows: [] }; } };
	const service = createSessionService(db);
	await service.userBySessionId('my-session-id');
	assert.deepEqual(captured, ['my-session-id']);
});

// --- touchSession / getLastSeen / deleteSession ---

test('touchSession upserts last_seen into joplock_sessions', async () => {
	const queries = [];
	const db = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } };
	const service = createSessionService(db);
	const now = Date.now();
	await service.touchSession('sess-abc', now);
	const upsert = queries.find(q => q.sql.includes('joplock_sessions') && q.sql.includes('INSERT'));
	assert.ok(upsert, 'should have upserted into joplock_sessions');
	assert.equal(upsert.params[0], 'sess-abc');
	assert.equal(upsert.params[1], now);
});

test('getLastSeen returns null when no row exists', async () => {
	const db = { query: async () => ({ rows: [] }) };
	const service = createSessionService(db);
	// ensureTable creates the table first (two queries), then select
	const result = await service.getLastSeen('sess-xyz');
	assert.equal(result, null);
});

test('getLastSeen returns numeric last_seen when row exists', async () => {
	const lastSeen = Date.now() - 30000;
	let callCount = 0;
	const db = {
		query: async (sql) => {
			callCount++;
			if (sql.includes('SELECT last_seen')) return { rows: [{ last_seen: lastSeen }] };
			return { rows: [] };
		},
	};
	const service = createSessionService(db);
	const result = await service.getLastSeen('sess-xyz');
	assert.equal(result, lastSeen);
});

test('deleteSession removes row from joplock_sessions', async () => {
	const queries = [];
	const db = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } };
	const service = createSessionService(db);
	await service.deleteSession('sess-del');
	const del = queries.find(q => q.sql.includes('DELETE') && q.params && q.params[0] === 'sess-del');
	assert.ok(del, 'should have deleted from joplock_sessions');
});

test('touchSession is non-fatal on db error', async () => {
	const db = { query: async () => { throw new Error('db down'); } };
	const service = createSessionService(db);
	await assert.doesNotReject(() => service.touchSession('s1'));
});
