const crypto = require('crypto');
const qrImage = require('qr-image');

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const normalizeSeed = seed => `${seed || ''}`.trim().toUpperCase().replace(/\s+/g, '');

const base32Decode = value => {
	const normalized = normalizeSeed(value).replace(/=+$/g, '');
	let bits = '';
	for (const char of normalized) {
		const index = base32Alphabet.indexOf(char);
		if (index < 0) throw new Error('Invalid TOTP seed');
		bits += index.toString(2).padStart(5, '0');
	}
	const bytes = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
	}
	return Buffer.from(bytes);
};

const base32Encode = buffer => {
	let bits = '';
	for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
	let result = '';
	for (let i = 0; i < bits.length; i += 5) {
		const chunk = bits.slice(i, i + 5).padEnd(5, '0');
		result += base32Alphabet[Number.parseInt(chunk, 2)];
	}
	return result;
};

const generateSeed = () => {
	// 20 bytes = 160 bits, standard for TOTP
	const bytes = crypto.randomBytes(20);
	return base32Encode(bytes);
};

const hotp = (secret, counter) => {
	const buf = Buffer.alloc(8);
	buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
	buf.writeUInt32BE(counter % 0x100000000, 4);
	const digest = crypto.createHmac('sha1', secret).update(buf).digest();
	const offset = digest[digest.length - 1] & 0x0f;
	const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
	return `${binary % 1000000}`.padStart(6, '0');
};

// Verify TOTP code against arbitrary seed
const verifyWithSeed = (seed, code, now = Date.now()) => {
	if (!seed) return false;
	const token = `${code || ''}`.replace(/\s+/g, '');
	if (!/^\d{6}$/.test(token)) return false;
	try {
		const secret = base32Decode(seed);
		const counter = Math.floor(now / 30000);
		for (let offset = -1; offset <= 1; offset++) {
			if (hotp(secret, counter + offset) === token) return true;
		}
	} catch {
		return false;
	}
	return false;
};

// Generate otpauth URI for arbitrary seed
const otpauthUri = (seed, accountLabel, issuer = 'Joplock') => {
	if (!seed) return '';
	const normalizedSeed = normalizeSeed(seed);
	const label = encodeURIComponent(`${issuer}:${accountLabel}`);
	return `otpauth://totp/${label}?secret=${normalizedSeed}&issuer=${encodeURIComponent(issuer)}`;
};

// Generate QR code as SVG data URL (synchronous for template use)
let _qrCache = new Map();
const qrCodeDataUrl = (text) => {
	if (!text) return '';
	if (_qrCache.has(text)) return _qrCache.get(text);
	let svg = '';
	try {
		svg = qrImage.imageSync(text, { type: 'svg', margin: 2 });
	} catch {
		return '';
	}
	const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	_qrCache.set(text, dataUrl);
	// Limit cache size
	if (_qrCache.size > 100) {
		const first = _qrCache.keys().next().value;
		_qrCache.delete(first);
	}
	return dataUrl;
};

const createMfaService = options => {
	const seed = normalizeSeed(options.seed);
	const issuer = options.issuer || 'Joplock';
	const enabled = !!seed;
	const secret = enabled ? base32Decode(seed) : null;

	return {
		enabled() {
			return enabled;
		},

		issuer() {
			return issuer;
		},

		otpauthUri(accountLabel) {
			if (!enabled) return '';
			const label = encodeURIComponent(`${issuer}:${accountLabel}`);
			return `otpauth://totp/${label}?secret=${seed}&issuer=${encodeURIComponent(issuer)}`;
		},

		verify(code, now = Date.now()) {
			if (!enabled) return true;
			const token = `${code || ''}`.replace(/\s+/g, '');
			if (!/^\d{6}$/.test(token)) return false;
			const counter = Math.floor(now / 30000);
			for (let offset = -1; offset <= 1; offset++) {
				if (hotp(secret, counter + offset) === token) return true;
			}
			return false;
		},

		maskedSeed() {
			if (!enabled) return '';
			return seed;
		},

		qrDataUrl(accountLabel) {
			if (!enabled) return '';
			return qrCodeDataUrl(this.otpauthUri(accountLabel));
		},
	};
};

module.exports = {
	base32Decode,
	base32Encode,
	createMfaService,
	generateSeed,
	hotp,
	normalizeSeed,
	otpauthUri,
	qrCodeDataUrl,
	verifyWithSeed,
};
