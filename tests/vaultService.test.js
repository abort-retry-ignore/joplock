'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVaultService } = require('../app/vaultService');

const makeDb = (rows = [], queries = []) => ({
	query: async (sql, params) => {
		queries.push({ sql, params });
		if (/SELECT.*joplock_vaults/.test(sql)) return { rows };
		return { rows: [] };
	},
});

const makeFailDb = () => ({
	query: async () => { throw new Error('DB unavailable'); },
});

test('vaultService: createVault inserts row', async () => {
	const queries = [];
	const service = createVaultService(makeDb([], queries));
	await service.createVault('user1', 'folder1', 'salt_b64', 'verify_b64');
	const insert = queries.find(q => q.sql.includes('INSERT INTO joplock_vaults'));
	assert.ok(insert, 'should insert into joplock_vaults');
	assert.deepEqual(insert.params, ['user1', 'folder1', 'salt_b64', 'verify_b64']);
});

test('vaultService: createVault throws when table unavailable', async () => {
	const service = createVaultService(makeFailDb());
	await assert.rejects(() => service.createVault('u1', 'f1', 's', 'v'), /Vault table not available/);
});

test('vaultService: getVaultsByUserId returns mapped rows', async () => {
	const rows = [
		{ folder_id: 'f1', salt: 'salt1', verify: 'verify1', created_at: new Date('2024-01-01') },
		{ folder_id: 'f2', salt: 'salt2', verify: 'verify2', created_at: new Date('2024-01-02') },
	];
	const service = createVaultService(makeDb(rows));
	const vaults = await service.getVaultsByUserId('user1');
	assert.equal(vaults.length, 2);
	assert.equal(vaults[0].folderId, 'f1');
	assert.equal(vaults[0].salt, 'salt1');
	assert.equal(vaults[0].verify, 'verify1');
	assert.equal(vaults[1].folderId, 'f2');
});

test('vaultService: getVaultsByUserId returns empty array when table unavailable', async () => {
	const service = createVaultService(makeFailDb());
	const vaults = await service.getVaultsByUserId('user1');
	assert.deepEqual(vaults, []);
});

test('vaultService: getVaultByFolderId returns single vault', async () => {
	const rows = [
		{ folder_id: 'f1', salt: 'salt1', verify: 'verify1', created_at: new Date('2024-01-01') },
	];
	const service = createVaultService(makeDb(rows));
	const vault = await service.getVaultByFolderId('user1', 'f1');
	assert.ok(vault, 'should return a vault');
	assert.equal(vault.folderId, 'f1');
	assert.equal(vault.salt, 'salt1');
	assert.equal(vault.verify, 'verify1');
});

test('vaultService: getVaultByFolderId returns null when not found', async () => {
	const service = createVaultService(makeDb([]));
	const vault = await service.getVaultByFolderId('user1', 'missing');
	assert.equal(vault, null);
});

test('vaultService: getVaultByFolderId returns null when table unavailable', async () => {
	const service = createVaultService(makeFailDb());
	const vault = await service.getVaultByFolderId('user1', 'f1');
	assert.equal(vault, null);
});

test('vaultService: getVaultFolderIdSet returns Set of folder IDs', async () => {
	const rows = [{ folder_id: 'f1' }, { folder_id: 'f2' }];
	const service = createVaultService(makeDb(rows));
	const set = await service.getVaultFolderIdSet('user1');
	assert.ok(set instanceof Set, 'should return Set');
	assert.ok(set.has('f1'));
	assert.ok(set.has('f2'));
	assert.equal(set.size, 2);
});

test('vaultService: getVaultFolderIdSet returns empty Set when table unavailable', async () => {
	const service = createVaultService(makeFailDb());
	const set = await service.getVaultFolderIdSet('user1');
	assert.ok(set instanceof Set);
	assert.equal(set.size, 0);
});

test('vaultService: deleteVault issues DELETE query', async () => {
	const queries = [];
	const service = createVaultService(makeDb([], queries));
	const result = await service.deleteVault('user1', 'folder1');
	assert.equal(result, true);
	const del = queries.find(q => q.sql.includes('DELETE FROM joplock_vaults'));
	assert.ok(del, 'should issue DELETE');
	assert.deepEqual(del.params, ['user1', 'folder1']);
});

test('vaultService: deleteVault returns false when table unavailable', async () => {
	const service = createVaultService(makeFailDb());
	const result = await service.deleteVault('user1', 'folder1');
	assert.equal(result, false);
});
