'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEnvValue } = require('../app/env');

test('normalizeEnvValue returns empty string for non-strings', () => {
	assert.equal(normalizeEnvValue(undefined), '');
	assert.equal(normalizeEnvValue(null), '');
});

test('normalizeEnvValue strips matching single quotes', () => {
	assert.equal(normalizeEnvValue("'admin@example.com'"), 'admin@example.com');
});

test('normalizeEnvValue strips matching double quotes', () => {
	assert.equal(normalizeEnvValue('"AdminPass123!"'), 'AdminPass123!');
});

test('normalizeEnvValue preserves unquoted values', () => {
	assert.equal(normalizeEnvValue('admin@example.com'), 'admin@example.com');
	assert.equal(normalizeEnvValue("pass'word"), "pass'word");
});
