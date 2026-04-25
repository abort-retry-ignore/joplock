const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCookies, sessionIdFromHeaders } = require('../app/auth/cookies');

test('parseCookies should parse cookie header values', () => {
	assert.deepEqual(parseCookies('a=1; sessionId=abc123; theme=dark'), {
		a: '1',
		sessionId: 'abc123',
		theme: 'dark',
	});
});

test('sessionIdFromHeaders should return sessionId cookie value', () => {
	assert.equal(sessionIdFromHeaders({ cookie: 'foo=bar; sessionId=test-session; x=y' }), 'test-session');
});

test('sessionIdFromHeaders should return empty string when missing', () => {
	assert.equal(sessionIdFromHeaders({ cookie: 'foo=bar' }), '');
	assert.equal(sessionIdFromHeaders({}), '');
});
