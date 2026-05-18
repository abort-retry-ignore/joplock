const test = require('node:test');
const assert = require('node:assert/strict');

const { createRecoveryService } = require('../app/recoveryService');

test('recovery service is disabled without password', () => {
	const service = createRecoveryService({ enabled: true, password: '' });
	assert.equal(service.isEnabled(), false);
});

test('recovery service creates and validates sessions', () => {
	let current = 1000;
	const service = createRecoveryService({ enabled: true, password: 'secret', now: () => current, sessionTtlMinutes: 1 });
	const token = service.createSession('secret');
	assert.ok(token);
	assert.equal(service.validateSession(token), true);
	current += 61 * 1000;
	assert.equal(service.validateSession(token), false);
});

test('recovery service rejects wrong password', () => {
	const service = createRecoveryService({ enabled: true, password: 'secret' });
	assert.equal(service.createSession('bad'), '');
});
