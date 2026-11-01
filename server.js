const path = require('path');
const fs = require('fs');
const { createPoolFromEnv, createSessionService } = require('./app/auth/sessionService');

const { createItemService, ensureIndexes } = require('./app/items/itemService');
const { createItemWriteService } = require('./app/items/itemWriteService');
const { createSettingsService } = require('./app/settingsService');
const { createHistoryService } = require('./app/historyService');
const { createAdminService } = require('./app/adminService');
const { createVaultService } = require('./app/vaultService');
const { createBackupService } = require('./app/backupService');
const { createRecoveryService } = require('./app/recoveryService');
const { createRateLimitService } = require('./app/auth/rateLimitService');
const { createServer } = require('./app/createServer');
const { normalizeEnvValue } = require('./app/env');
const { readDemoConfig, ensureDemoAccount } = require('./app/demoMode');
const { startDefaultAdminGuard } = require('./app/defaultAdminGuard');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3001');
const joplinServerOrigin = process.env.JOPLIN_SERVER_ORIGIN || 'http://server:22300';
const joplinPublicBasePath = process.env.JOPLIN_PUBLIC_BASE_PATH || '';
const joplinPublicBaseUrl = process.env.JOPLOCK_PUBLIC_BASE_URL || `http://localhost:${port}`;
const joplinServerPublicUrl = process.env.JOPLIN_SERVER_PUBLIC_URL || `${joplinPublicBaseUrl}${joplinPublicBasePath}`;
const publicDir = path.join(__dirname, 'public');

const adminEmail = normalizeEnvValue(process.env.JOPLOCK_ADMIN_EMAIL || '');
const adminPassword = normalizeEnvValue(process.env.JOPLOCK_ADMIN_PASSWORD || '');
const ignoreAdminMfa = process.env.IGNORE_ADMIN_MFA === 'true' || process.env.IGNORE_ADMIN_MFA === '1';
const backupDir = process.env.JOPLOCK_BACKUP_DIR || '';
const recoveryEnabled = process.env.JOPLOCK_RECOVERY_ENABLED === 'true' || process.env.JOPLOCK_RECOVERY_ENABLED === '1';
const recoveryPassword = normalizeEnvValue(process.env.JOPLOCK_RECOVERY_PASSWORD || '');
const recoverySessionTtlMinutes = Number(process.env.JOPLOCK_RECOVERY_SESSION_TTL_MINUTES || '30');
const backupCompression = process.env.JOPLOCK_BACKUP_COMPRESSION || 'zstd:19';
const backupCompressionLevel = Number(process.env.JOPLOCK_BACKUP_COMPRESSION_LEVEL || '9');
const sessionCookieMaxAge = Number(process.env.JOPLOCK_SESSION_COOKIE_MAX_AGE_SECONDS || '31536000');
let demo;
try {
	demo = readDemoConfig(process.env, normalizeEnvValue);
} catch (error) {
	// a public demo with a half-done configuration must not start
	process.stderr.write(`[joplock] FATAL: demo mode: ${error.message}\n`);
	process.exit(1);
}
const loginRateLimitService = createRateLimitService();

// Joplock version: env var → version.txt (Docker build) → package.json
let joplockVersion = '';
if (process.env.JOPLOCK_VERSION) {
	joplockVersion = process.env.JOPLOCK_VERSION;
} else {
	try {
		const vPath = path.join(__dirname, 'version.txt');
		if (fs.existsSync(vPath)) {
			joplockVersion = fs.readFileSync(vPath, 'utf8').trim();
		}
	} catch {}
}
if (!joplockVersion) {
	try { joplockVersion = require('./package.json').version; } catch {}
}

const databasePool = createPoolFromEnv(process.env);
const sessionService = createSessionService(databasePool);
const itemService = createItemService(databasePool);
const settingsService = createSettingsService(databasePool);
const historyService = createHistoryService(databasePool);
const vaultService = createVaultService(databasePool);
const backupService = createBackupService({
	backupDir,
	compression: backupCompression,
	compressionLevel: backupCompressionLevel,
	postgresConfig: {
		host: process.env.POSTGRES_HOST || '127.0.0.1',
		port: Number(process.env.POSTGRES_PORT || '5432'),
		user: process.env.POSTGRES_USER || 'joplin',
		password: process.env.POSTGRES_PASSWORD || 'joplin',
		database: process.env.POSTGRES_DATABASE || 'joplin',
	},
});
const recoveryService = createRecoveryService({
	enabled: recoveryEnabled,
	password: recoveryPassword,
	sessionTtlMinutes: recoverySessionTtlMinutes,
});
const itemWriteService = createItemWriteService({
	joplinServerOrigin,
	joplinServerPublicUrl,
});

const adminService = adminEmail ? createAdminService({
	database: databasePool,
	joplinServerOrigin,
	joplinServerPublicUrl,
	adminEmail,
	adminPassword,
}) : null;

// Bootstrap admin user (non-blocking, best-effort after server starts)
if (adminService) {
	adminService.ensureAdminUser().catch(err => {
		process.stderr.write(`[joplock] Admin bootstrap error: ${err.message}\n`);
	});
}

// Demo mode: create the demo account / put its password and role back (best-effort, after Joplin migrates)
if (demo.enabled) {
	if (adminService) process.stderr.write('[joplock] WARNING: demo mode with JOPLOCK_ADMIN_EMAIL set: the admin cannot sign in through the demo login page anyway; leave it unset.\n');
	ensureDemoAccount({ database: databasePool, config: demo, log: line => process.stdout.write(`${line}\n`) }).catch(err => {
		process.stderr.write(`[joplock] Demo account error: ${err.message}\n`);
	});
}

// Lock Joplin Server's default admin@localhost while it still has the password "admin"
startDefaultAdminGuard({ database: databasePool, log: line => process.stderr.write(`${line}\n`) });

// Create DB indexes (non-blocking, best-effort)
ensureIndexes(databasePool).catch(err => {
	process.stderr.write(`[joplock] Index creation error: ${err.message}\n`);
});

const server = createServer({
	publicDir,
	joplinPublicBasePath,
	joplinPublicBaseUrl,
	joplinServerPublicUrl,
	joplinServerOrigin,
	sessionService,
	itemService,
	settingsService,
	historyService,
	itemWriteService,
	adminService,
	adminEmail,
	ignoreAdminMfa,
	database: databasePool,
	vaultService,
	backupService,
	recoveryService,
	rateLimitService: loginRateLimitService,
	sessionCookieMaxAge,
	debug: process.env.DEBUG === 'true' || process.env.DEBUG === '1',
	joplockVersion,
	demo,
});

server.listen(port, host, () => {
	process.stdout.write(`Joplock listening on http://${host}:${port}\n`);
});

server.on('close', () => {
	void databasePool.end();
});
