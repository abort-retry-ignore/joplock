const path = require('path');
const { createPoolFromEnv, createSessionService } = require('./app/auth/sessionService');

const { createItemService, ensureIndexes } = require('./app/items/itemService');
const { createItemWriteService } = require('./app/items/itemWriteService');
const { createSettingsService } = require('./app/settingsService');
const { createHistoryService } = require('./app/historyService');
const { createAdminService } = require('./app/adminService');
const { createVaultService } = require('./app/vaultService');
const { createServer } = require('./app/createServer');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3001');
const joplinServerOrigin = process.env.JOPLIN_SERVER_ORIGIN || 'http://server:22300';
const joplinPublicBasePath = process.env.JOPLIN_PUBLIC_BASE_PATH || '';
const joplinPublicBaseUrl = process.env.JOPLOCK_PUBLIC_BASE_URL || `http://localhost:${port}`;
const joplinServerPublicUrl = process.env.JOPLIN_SERVER_PUBLIC_URL || `${joplinPublicBaseUrl}${joplinPublicBasePath}`;
const publicDir = path.join(__dirname, 'public');

const adminEmail = process.env.JOPLOCK_ADMIN_EMAIL || '';
const adminPassword = process.env.JOPLOCK_ADMIN_PASSWORD || '';
const ignoreAdminMfa = process.env.IGNORE_ADMIN_MFA === 'true' || process.env.IGNORE_ADMIN_MFA === '1';

const databasePool = createPoolFromEnv(process.env);
const sessionService = createSessionService(databasePool);
const itemService = createItemService(databasePool);
const settingsService = createSettingsService(databasePool);
const historyService = createHistoryService(databasePool);
const vaultService = createVaultService(databasePool);
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
	debug: process.env.DEBUG === 'true' || process.env.DEBUG === '1',
});

server.listen(port, host, () => {
	process.stdout.write(`Joplock listening on http://${host}:${port}\n`);
});

server.on('close', () => {
	void databasePool.end();
});
