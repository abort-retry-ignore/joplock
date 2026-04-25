const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryService, hashBody } = require('../app/historyService');

const makeDb = (rows = [], queries = []) => ({
	query: async (sql, params) => {
		queries.push({ sql, params });
		if (/SELECT.*joplock_history.*LIMIT 1/.test(sql)) return { rows };
		if (/SELECT.*joplock_history/.test(sql) && sql.includes('ORDER BY saved_time')) return { rows };
		return { rows: [] };
	},
});

test('historyService: hashBody produces consistent hash', () => {
	assert.equal(hashBody('hello'), hashBody('hello'));
	assert.notEqual(hashBody('hello'), hashBody('world'));
});

test('historyService: saveSnapshot skips when table unavailable', async () => {
	const service = createHistoryService({
		query: async () => { throw new Error('permission denied'); },
	});
	// should not throw
	await service.saveSnapshot('u1', 'n1', 'Title', 'Body');
});

test('historyService: saveSnapshot inserts first snapshot', async () => {
	const queries = [];
	const service = createHistoryService({
		query: async (sql, params) => {
			queries.push({ sql, params });
			// Most-recent check returns no previous snapshot
			if (sql.includes('SELECT') && sql.includes('LIMIT 1')) return { rows: [] };
			return { rows: [] };
		},
	});
	await service.saveSnapshot('u1', 'n1', 'Title', 'Body text');
	const insert = queries.find(q => q.sql.includes('INSERT INTO joplock_history'));
	assert.ok(insert, 'should insert');
	assert.equal(insert.params[0], 'n1');
	assert.equal(insert.params[1], 'u1');
	assert.equal(insert.params[2], 'Title');
	assert.equal(insert.params[3], 'Body text');
});

test('historyService: saveSnapshot skips identical hash', async () => {
	const queries = [];
	const hash = hashBody('Same body');
	const service = createHistoryService({
		query: async (sql, params) => {
			queries.push({ sql, params });
			if (sql.includes('SELECT') && sql.includes('LIMIT 1')) {
				return { rows: [{ body_hash: hash, saved_time: Date.now() - 60000 }] };
			}
			return { rows: [] };
		},
	});
	await service.saveSnapshot('u1', 'n1', 'Title', 'Same body');
	const insert = queries.find(q => q.sql.includes('INSERT INTO joplock_history'));
	assert.ok(!insert, 'should skip insert when hash identical');
});

test('historyService: saveSnapshot skips when too recent', async () => {
	const queries = [];
	const service = createHistoryService({
		query: async (sql) => {
			queries.push({ sql });
			if (sql.includes('SELECT') && sql.includes('LIMIT 1')) {
				return { rows: [{ body_hash: hashBody('Old body'), saved_time: Date.now() - 5000 }] };
			}
			return { rows: [] };
		},
	});
	await service.saveSnapshot('u1', 'n1', 'Title', 'New body');
	const insert = queries.find(q => q.sql.includes('INSERT INTO joplock_history'));
	assert.ok(!insert, 'should skip when last snapshot was < 30s ago');
});

test('historyService: listSnapshots returns empty array when table unavailable', async () => {
	const service = createHistoryService({
		query: async () => { throw new Error('nope'); },
	});
	const list = await service.listSnapshots('n1');
	assert.deepEqual(list, []);
});

test('historyService: listSnapshots maps rows correctly', async () => {
	const rows = [
		{ id: '5', title: 'My note', saved_time: '1700000000000' },
		{ id: '3', title: 'Earlier', saved_time: '1699000000000' },
	];
	const service = createHistoryService({
		query: async (sql) => {
			if (sql.includes('CREATE')) return { rows: [] };
			if (sql.includes('CREATE INDEX')) return { rows: [] };
			return { rows };
		},
	});
	const list = await service.listSnapshots('n1');
	assert.equal(list.length, 2);
	assert.equal(list[0].id, '5');
	assert.equal(list[0].title, 'My note');
	assert.equal(list[0].savedTime, 1700000000000);
});

test('historyService: getSnapshot returns null when not found', async () => {
	const service = createHistoryService({
		query: async (sql) => {
			if (sql.includes('CREATE')) return { rows: [] };
			return { rows: [] };
		},
	});
	const snap = await service.getSnapshot('999');
	assert.equal(snap, null);
});

test('historyService: getSnapshot returns snapshot with body', async () => {
	const service = createHistoryService({
		query: async (sql) => {
			if (sql.includes('CREATE')) return { rows: [] };
			return { rows: [{ id: '7', note_id: 'note-abc', title: 'Hi', body: 'Hello world', saved_time: '1700000000000' }] };
		},
	});
	const snap = await service.getSnapshot('7');
	assert.ok(snap);
	assert.equal(snap.id, '7');
	assert.equal(snap.noteId, 'note-abc');
	assert.equal(snap.body, 'Hello world');
	assert.equal(snap.savedTime, 1700000000000);
});
