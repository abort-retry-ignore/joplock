'use strict';

const crypto = require('crypto');

const RECOVERY_COOKIE = 'joplockRecoverySession';

const timingSafeEqual = (a, b) => {
	const left = Buffer.from(`${a || ''}`);
	const right = Buffer.from(`${b || ''}`);
	if (left.length !== right.length) return false;
	return crypto.timingSafeEqual(left, right);
};

const createRecoveryService = options => {
	const {
		enabled = false,
		password = '',
		sessionTtlMinutes = 30,
		now = () => Date.now(),
	} = options || {};

	const sessions = new Map();

	const isEnabled = () => !!enabled && !!password;
	const ttlMs = Math.max(1, Number(sessionTtlMinutes || 30)) * 60 * 1000;

	const createSession = attempt => {
		if (!isEnabled()) throw new Error('Recovery mode is disabled');
		if (!timingSafeEqual(attempt, password)) return '';
		const token = crypto.randomBytes(24).toString('hex');
		sessions.set(token, now() + ttlMs);
		return token;
	};

	const validateSession = token => {
		if (!isEnabled() || !token) return false;
		const expiresAt = sessions.get(token);
		if (!expiresAt) return false;
		if (expiresAt <= now()) {
			sessions.delete(token);
			return false;
		}
		return true;
	};

	const endSession = token => {
		if (token) sessions.delete(token);
	};

	return {
		RECOVERY_COOKIE,
		isEnabled,
		createSession,
		validateSession,
		endSession,
	};
};

module.exports = {
	RECOVERY_COOKIE,
	createRecoveryService,
};
