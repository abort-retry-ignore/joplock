const test = require('node:test');
const assert = require('node:assert/strict');
const { base32Decode, base32Encode, createMfaService, generateSeed, hotp, normalizeSeed, otpauthUri, qrCodeDataUrl, verifyWithSeed } = require('../app/auth/mfaService');

// --- normalizeSeed ---

test('normalizeSeed uppercases and trims', () => {
	assert.equal(normalizeSeed('  abc def  '), 'ABCDEF');
});

test('normalizeSeed returns empty for null/undefined', () => {
	assert.equal(normalizeSeed(null), '');
	assert.equal(normalizeSeed(undefined), '');
});

// --- base32 round-trip ---

test('base32Encode then base32Decode round-trips', () => {
	const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
	const encoded = base32Encode(buf);
	const decoded = base32Decode(encoded);
	assert.deepEqual(decoded, buf);
});

test('base32Decode rejects invalid characters', () => {
	assert.throws(() => base32Decode('!!!'), /Invalid TOTP seed/);
});

test('base32Decode strips trailing padding', () => {
	const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
	const encoded = base32Encode(buf) + '====';
	const decoded = base32Decode(encoded);
	assert.deepEqual(decoded, buf);
});

// --- generateSeed ---

test('generateSeed returns 32-char base32 string', () => {
	const seed = generateSeed();
	assert.ok(/^[A-Z2-7]+$/.test(seed), 'should be valid base32');
	assert.equal(seed.length, 32); // 20 bytes * 8 bits / 5 = 32 chars
});

test('generateSeed produces unique values', () => {
	const a = generateSeed();
	const b = generateSeed();
	assert.notEqual(a, b);
});

// --- hotp ---

test('hotp returns 6-digit string', () => {
	const secret = base32Decode('JBSWY3DPEHPK3PXP');
	const code = hotp(secret, 1);
	assert.match(code, /^\d{6}$/);
});

test('hotp is deterministic for same inputs', () => {
	const secret = base32Decode('JBSWY3DPEHPK3PXP');
	assert.equal(hotp(secret, 42), hotp(secret, 42));
});

test('hotp produces different codes for different counters', () => {
	const secret = base32Decode('JBSWY3DPEHPK3PXP');
	assert.notEqual(hotp(secret, 1), hotp(secret, 2));
});

// --- verifyWithSeed ---

test('verifyWithSeed accepts correct code for current window', () => {
	const seed = 'JBSWY3DPEHPK3PXP';
	const now = Date.now();
	const counter = Math.floor(now / 30000);
	const secret = base32Decode(seed);
	const code = hotp(secret, counter);
	assert.ok(verifyWithSeed(seed, code, now));
});

test('verifyWithSeed accepts code from adjacent window', () => {
	const seed = 'JBSWY3DPEHPK3PXP';
	const now = Date.now();
	const counter = Math.floor(now / 30000);
	const secret = base32Decode(seed);
	const code = hotp(secret, counter - 1);
	assert.ok(verifyWithSeed(seed, code, now));
});

test('verifyWithSeed rejects wrong code', () => {
	assert.ok(!verifyWithSeed('JBSWY3DPEHPK3PXP', '000000'));
});

test('verifyWithSeed rejects non-6-digit input', () => {
	assert.ok(!verifyWithSeed('JBSWY3DPEHPK3PXP', 'abcdef'));
	assert.ok(!verifyWithSeed('JBSWY3DPEHPK3PXP', '12345'));
	assert.ok(!verifyWithSeed('JBSWY3DPEHPK3PXP', ''));
	assert.ok(!verifyWithSeed('JBSWY3DPEHPK3PXP', null));
});

test('verifyWithSeed returns false for empty seed', () => {
	assert.ok(!verifyWithSeed('', '123456'));
	assert.ok(!verifyWithSeed(null, '123456'));
});

test('verifyWithSeed returns false for invalid seed', () => {
	assert.ok(!verifyWithSeed('!!!INVALID!!!', '123456'));
});

// --- otpauthUri ---

test('otpauthUri generates valid URI', () => {
	const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'user@example.com');
	assert.ok(uri.startsWith('otpauth://totp/'));
	assert.ok(uri.includes('secret=JBSWY3DPEHPK3PXP'));
	assert.ok(uri.includes('issuer=Joplock'));
	assert.ok(uri.includes('user%40example.com'));
});

test('otpauthUri uses custom issuer', () => {
	const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'user@example.com', 'MyApp');
	assert.ok(uri.includes('issuer=MyApp'));
});

test('otpauthUri returns empty for null seed', () => {
	assert.equal(otpauthUri(null, 'user@example.com'), '');
});

// --- qrCodeDataUrl ---

test('qrCodeDataUrl returns SVG data URL', () => {
	const url = qrCodeDataUrl('otpauth://totp/test?secret=JBSWY3DPEHPK3PXP');
	assert.ok(url.startsWith('data:image/svg+xml;charset=utf-8,'));
});

test('qrCodeDataUrl returns empty for empty input', () => {
	assert.equal(qrCodeDataUrl(''), '');
	assert.equal(qrCodeDataUrl(null), '');
});

test('qrCodeDataUrl caches results', () => {
	const text = 'otpauth://totp/cache-test?secret=ABC';
	const a = qrCodeDataUrl(text);
	const b = qrCodeDataUrl(text);
	assert.equal(a, b);
});

// --- createMfaService ---

test('createMfaService disabled when no seed', () => {
	const mfa = createMfaService({ seed: '' });
	assert.equal(mfa.enabled(), false);
	assert.equal(mfa.maskedSeed(), '');
	assert.equal(mfa.otpauthUri('user@test.com'), '');
	assert.equal(mfa.qrDataUrl('user@test.com'), '');
	assert.ok(mfa.verify('anything'), 'disabled MFA should accept any code');
});

test('createMfaService enabled with valid seed', () => {
	const seed = 'JBSWY3DPEHPK3PXP';
	const mfa = createMfaService({ seed });
	assert.equal(mfa.enabled(), true);
	assert.equal(mfa.maskedSeed(), seed);
	assert.ok(mfa.otpauthUri('user@test.com').includes(seed));
	assert.ok(mfa.qrDataUrl('user@test.com').startsWith('data:'));
});

test('createMfaService verify accepts correct code', () => {
	const seed = 'JBSWY3DPEHPK3PXP';
	const mfa = createMfaService({ seed });
	const now = Date.now();
	const counter = Math.floor(now / 30000);
	const secret = base32Decode(seed);
	const code = hotp(secret, counter);
	assert.ok(mfa.verify(code, now));
});

test('createMfaService verify rejects wrong code', () => {
	const mfa = createMfaService({ seed: 'JBSWY3DPEHPK3PXP' });
	assert.ok(!mfa.verify('000000'));
});

test('createMfaService issuer defaults to Joplock', () => {
	const mfa = createMfaService({ seed: 'JBSWY3DPEHPK3PXP' });
	assert.equal(mfa.issuer(), 'Joplock');
});

test('createMfaService uses custom issuer', () => {
	const mfa = createMfaService({ seed: 'JBSWY3DPEHPK3PXP', issuer: 'Custom' });
	assert.equal(mfa.issuer(), 'Custom');
	assert.ok(mfa.otpauthUri('user@test.com').includes('issuer=Custom'));
});
