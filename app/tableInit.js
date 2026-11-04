'use strict';

// Joplock creates its own tables (joplock_settings, joplock_history, joplock_vaults, joplock_sessions) on
// first use. That first use can come before Postgres accepts connections: on a fresh install, or after a
// host reboot starts every container at once. Remembering that failure for good silently dropped every
// settings save, skipped note history, and made vault notebooks look like ordinary ones (so the server
// stopped refusing plain text in them), all until Joplock was restarted. So a failed attempt is retried
// after a short pause, and callers that arrive during an attempt share it: two simultaneous
// CREATE TABLE IF NOT EXISTS can collide in Postgres. Tests: tests/tableInit.test.js.

// Returns ensure(): resolves true once the table exists, false while it cannot be created yet.
const createTableInit = (create, { retryMs = 5000, now = Date.now } = {}) => {
	let available = false;
	let retryAt = 0;
	let attempt = null;
	return () => {
		if (available || now() < retryAt) return Promise.resolve(available);
		if (!attempt) {
			attempt = Promise.resolve()
				.then(create)
				.then(() => { available = true; }, () => { retryAt = now() + retryMs; })
				.then(() => { attempt = null; return available; });
		}
		return attempt;
	};
};

module.exports = { createTableInit };
