'use strict';

const DEFAULTS = {
	authWindowMs: 15 * 60 * 1000,
};

const normalizeIp = value => {
	const first = `${value || ''}`.split(',')[0].trim();
	if (!first) return 'unknown';
	return first.startsWith('::ffff:') ? first.slice(7) : first;
};

const clientIpFromRequest = request => normalizeIp(
	(request && request.headers && request.headers['x-forwarded-for']) ||
	(request && request.socket && request.socket.remoteAddress) ||
	''
);

const normalizeEmail = value => `${value || ''}`.trim().toLowerCase();

const createBucketStore = () => {
	const buckets = new Map();
	let opCount = 0;

	const cleanupExpired = now => {
		opCount += 1;
		if (opCount < 100) return;
		opCount = 0;
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt <= now) buckets.delete(key);
		}
	};

	const bucketFor = (key, windowMs, now) => {
		cleanupExpired(now);
		const existing = buckets.get(key);
		if (!existing || existing.resetAt <= now) {
			const fresh = { count: 0, resetAt: now + windowMs };
			buckets.set(key, fresh);
			return fresh;
		}
		return existing;
	};

	const stateFor = (key, maxAttempts, windowMs, now = Date.now()) => {
		const bucket = bucketFor(key, windowMs, now);
		const allowed = bucket.count < maxAttempts;
		return {
			allowed,
			count: bucket.count,
			resetAt: bucket.resetAt,
			retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
		};
	};

	const increment = (key, maxAttempts, windowMs, now = Date.now()) => {
		const bucket = bucketFor(key, windowMs, now);
		bucket.count += 1;
		return stateFor(key, maxAttempts, windowMs, now);
	};

	return {
		stateFor,
		increment,
		clear(key) {
			buckets.delete(key);
		},
	};
};

const createRateLimitService = options => {
	const config = { ...DEFAULTS, ...(options || {}) };
	const store = createBucketStore();

	const authKey = (ip, scope) => `auth:${normalizeIp(ip)}:${scope || 'unknown'}`;

	return {
		config,
		clientIpFromRequest,
		check(ip, scope, maxAttempts) {
			const state = store.stateFor(authKey(ip, scope), maxAttempts, config.authWindowMs);
			if (!state.allowed) return { limited: true, retryAfterSec: state.retryAfterSec };
			return { limited: false, retryAfterSec: 0 };
		},
		recordFailure(ip, scope, maxAttempts) {
			return store.increment(authKey(ip, scope), maxAttempts, config.authWindowMs);
		},
		clear(ip, scope) {
			store.clear(authKey(ip, scope));
		},
	};
};

module.exports = {
	DEFAULTS,
	clientIpFromRequest,
	createRateLimitService,
	normalizeIp,
};
