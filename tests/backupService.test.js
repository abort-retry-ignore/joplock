const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const { createBackupService, ensureWithinDir, timestampForFile } = require('../app/backupService');

const makeChild = ({ exitCode = 0, stdoutText = '', stderrText = '' } = {}) => {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	process.nextTick(() => {
		if (stdoutText) child.stdout.write(stdoutText);
		child.stdout.end();
		if (stderrText) child.stderr.write(stderrText);
		child.stderr.end();
		child.emit('close', exitCode);
	});
	return child;
};

test('ensureWithinDir rejects invalid backup names', () => {
	assert.throws(() => ensureWithinDir('/tmp/backups', '../evil.dump'));
	assert.throws(() => ensureWithinDir('/tmp/backups', 'evil.sql'));
});

test('timestampForFile produces filesystem-safe timestamp', () => {
	assert.equal(timestampForFile(Date.UTC(2026, 4, 18, 14, 22, 31)), '2026-05-18T14-22-31Z');
});

test('backup service lists backups newest first', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-backups-'));
	const oldFile = path.join(dir, 'joplock-backup-older.dump');
	const newFile = path.join(dir, 'joplock-backup-newer.dump');
	fs.writeFileSync(oldFile, 'one');
	fs.writeFileSync(newFile, 'two');
	const older = new Date('2026-05-18T14:00:00Z');
	const newer = new Date('2026-05-18T15:00:00Z');
	fs.utimesSync(oldFile, older, older);
	fs.utimesSync(newFile, newer, newer);
	const service = createBackupService({ backupDir: dir, postgresConfig: {} });
	const backups = await service.listBackups();
	assert.equal(backups[0].name, 'joplock-backup-newer.dump');
	assert.equal(backups[1].name, 'joplock-backup-older.dump');
});

test('backup service starts backup job via pg_dump and completes in background', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-backups-'));
	let spawnArgs = null;
	const service = createBackupService({
		backupDir: dir,
		postgresConfig: { database: 'joplin', host: 'db', port: 5432, user: 'joplin', password: 'secret' },
		now: () => Date.UTC(2026, 4, 18, 14, 22, 31),
		spawnImpl: (cmd, args, options) => {
			spawnArgs = { cmd, args, options };
			return makeChild({ stdoutText: 'dump-bytes' });
		},
	});
	const backup = await service.startBackupJob();
	assert.equal(spawnArgs.cmd, 'pg_dump');
	assert.deepEqual(spawnArgs.args, ['--format=custom', '--compress=zstd:19', '--no-owner', '--no-privileges', '--dbname', 'joplin']);
	assert.equal(backup.fileName, 'joplock-backup-2026-05-18T14-22-31Z.dump');
	await service.waitForIdle();
	assert.ok(fs.existsSync(path.join(dir, backup.fileName)));
	assert.equal(service.currentStatus().state, 'completed');
});

test('backup service clamps compression level for gzip fallback', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-backups-'));
	let spawnArgs = null;
	const service = createBackupService({
		backupDir: dir,
		compression: '',
		compressionLevel: 42,
		postgresConfig: { database: 'joplin', host: 'db', port: 5432, user: 'joplin', password: 'secret' },
		spawnImpl: (cmd, args, options) => {
			spawnArgs = { cmd, args, options };
			return makeChild({ stdoutText: 'dump-bytes' });
		},
	});
	await service.startBackupJob();
	assert.ok(spawnArgs.args.includes('--compress=gzip:9'));
});

test('backup service uses explicit compression spec when provided', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-backups-'));
	let spawnArgs = null;
	const service = createBackupService({
		backupDir: dir,
		compression: 'gzip:1',
		postgresConfig: { database: 'joplin', host: 'db', port: 5432, user: 'joplin', password: 'secret' },
		spawnImpl: (cmd, args, options) => {
			spawnArgs = { cmd, args, options };
			return makeChild({ stdoutText: 'dump-bytes' });
		},
	});
	await service.startBackupJob();
	assert.ok(spawnArgs.args.includes('--compress=gzip:1'));
});

test('backup service starts restore job via pg_restore and completes in background', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-backups-'));
	fs.writeFileSync(path.join(dir, 'joplock-backup-2026.dump'), 'x');
	let spawnArgs = null;
	const service = createBackupService({
		backupDir: dir,
		postgresConfig: { database: 'joplin', host: 'db', port: 5432, user: 'joplin', password: 'secret' },
		spawnImpl: (cmd, args, options) => {
			spawnArgs = { cmd, args, options };
			return makeChild();
		},
	});
	await service.startRestoreJob('joplock-backup-2026.dump');
	await service.waitForIdle();
	assert.equal(spawnArgs.cmd, 'pg_restore');
	assert.ok(spawnArgs.args.includes('--clean'));
	assert.ok(spawnArgs.args.includes('--single-transaction'));
	assert.ok(spawnArgs.args.includes(path.join(dir, 'joplock-backup-2026.dump')));
	assert.equal(service.currentStatus().state, 'completed');
});
