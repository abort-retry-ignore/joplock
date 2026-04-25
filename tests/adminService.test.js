'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAdminService, isStrongPassword } = require('../app/adminService');

test('isStrongPassword rejects short password', () => {
	assert.equal(isStrongPassword('Short1!'), false);
});

test('isStrongPassword rejects password with only one category', () => {
	assert.equal(isStrongPassword('aaaaaaaaaaaaa'), false);
});

test('isStrongPassword rejects password with two categories', () => {
	assert.equal(isStrongPassword('aaaaAAAAAAAAA'), false);
});

test('isStrongPassword accepts password with 3+ categories and length>=12', () => {
	assert.equal(isStrongPassword('aaAAA123456!'), true);
});

test('isStrongPassword accepts lowercase+digits+special', () => {
	assert.equal(isStrongPassword('aabbcc123!!!'), true);
});

test('isStrongPassword rejects null/undefined', () => {
	assert.equal(isStrongPassword(null), false);
	assert.equal(isStrongPassword(undefined), false);
	assert.equal(isStrongPassword(''), false);
});

test('isStrongPassword requires at least 12 chars', () => {
	assert.equal(isStrongPassword('aA1!aA1!aA1'), false); // 11 chars
	assert.equal(isStrongPassword('aA1!aA1!aA1!'), true); // 12 chars
});

test('createUser clears must_set_password with integer 0', async () => {
	const requests = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
			if (req.method === 'POST' && req.url === '/api/sessions') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ id: 'admin-token' }));
				return;
			}
			if (req.method === 'POST' && req.url === '/api/users') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ id: 'user-1' }));
				return;
			}
			if (req.method === 'PATCH' && req.url === '/api/users/user-1') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ id: 'user-1' }));
				return;
			}
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'not found' }));
		});
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	const database = { query: async () => ({ rows: [] }) };
	const service = createAdminService({
		database,
		joplinServerOrigin: `http://127.0.0.1:${port}`,
		joplinServerPublicUrl: `http://127.0.0.1:${port}`,
		adminEmail: 'admin@example.com',
		adminPassword: 'AdminPass123!',
	});
	try {
		await service.createUser('new@example.com', 'New User', 'UserPass123!');
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
	const patchReq = requests.find(r => r.method === 'PATCH' && r.url === '/api/users/user-1');
	assert.ok(patchReq);
	assert.equal(patchReq.body.must_set_password, 0);
});

test('createUser fails when password update fails', async () => {
	const server = http.createServer((req, res) => {
		if (req.method === 'POST' && req.url === '/api/sessions') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id: 'admin-token' }));
			return;
		}
		if (req.method === 'POST' && req.url === '/api/users') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id: 'user-1' }));
			return;
		}
		if (req.method === 'PATCH' && req.url === '/api/users/user-1') {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'bad password update' }));
			return;
		}
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'not found' }));
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	const database = { query: async () => ({ rows: [] }) };
	const service = createAdminService({
		database,
		joplinServerOrigin: `http://127.0.0.1:${port}`,
		joplinServerPublicUrl: `http://127.0.0.1:${port}`,
		adminEmail: 'admin@example.com',
		adminPassword: 'AdminPass123!',
	});
	try {
		await assert.rejects(() => service.createUser('new@example.com', 'New User', 'UserPass123!'), /bad password update/);
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
});
