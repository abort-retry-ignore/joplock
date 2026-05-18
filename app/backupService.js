'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const BACKUP_EXT = '.dump';
const VALID_NAME_RE = /^[A-Za-z0-9._-]+\.dump$/;

const safeError = error => error && error.message ? error.message : `${error || 'Unknown error'}`;

const timestampForFile = now => {
	const iso = new Date(now).toISOString();
	return iso.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
};

const ensureWithinDir = (dir, fileName) => {
	if (!VALID_NAME_RE.test(fileName || '')) throw new Error('Invalid backup file name');
	const resolved = path.resolve(dir, fileName);
	const resolvedDir = path.resolve(dir) + path.sep;
	if (!resolved.startsWith(resolvedDir)) throw new Error('Invalid backup path');
	return resolved;
};

const tempPathWithinDir = (dir, fileName) => {
	const resolved = path.resolve(dir, fileName);
	const resolvedDir = path.resolve(dir) + path.sep;
	if (!resolved.startsWith(resolvedDir)) throw new Error('Invalid backup path');
	return resolved;
};

const createBackupService = options => {
	const {
		backupDir = '',
		postgresConfig = {},
		compression = 'zstd:19',
		compressionLevel = 9,
		spawnImpl = spawn,
		now = () => Date.now(),
	} = options || {};

	const normalizedCompressionLevel = Number.isFinite(Number(compressionLevel)) ? Math.max(0, Math.min(9, Number(compressionLevel))) : 9;
	const compressionArg = (typeof compression === 'string' && compression.trim()) ? compression.trim() : `gzip:${normalizedCompressionLevel}`;
	const backupCompressionArg = jobOptions => {
		if (jobOptions && jobOptions.mode === 'fast') return 'gzip:1';
		if (jobOptions && jobOptions.mode === 'balanced') return 'zstd:3';
		if (jobOptions && jobOptions.useCompression === false) return 'none';
		return compressionArg;
	};

	let currentJob = null;

	const isConfigured = () => !!backupDir;
	const isBusy = () => !!(currentJob && currentJob.state === 'running');
	const activeOperation = () => currentJob && currentJob.state === 'running' ? currentJob.type : '';

	const pgEnv = () => ({
		...process.env,
		PGHOST: `${postgresConfig.host || ''}`,
		PGPORT: `${postgresConfig.port || 5432}`,
		PGUSER: `${postgresConfig.user || ''}`,
		PGPASSWORD: `${postgresConfig.password || ''}`,
		PGDATABASE: `${postgresConfig.database || ''}`,
	});

	const ensureAvailable = async () => {
		if (!backupDir) throw new Error('Backup directory is not configured');
		await fsp.mkdir(backupDir, { recursive: true });
		await fsp.access(backupDir, fs.constants.R_OK | fs.constants.W_OK);
	};

	const listBackups = async () => {
		await ensureAvailable();
		const entries = await fsp.readdir(backupDir, { withFileTypes: true });
		const backups = [];
		for (const entry of entries) {
			if (!entry.isFile() || !VALID_NAME_RE.test(entry.name)) continue;
			const fullPath = ensureWithinDir(backupDir, entry.name);
			const stat = await fsp.stat(fullPath);
			backups.push({
				name: entry.name,
				size: stat.size,
				createdTime: stat.mtimeMs,
				path: fullPath,
			});
		}
		backups.sort((a, b) => b.createdTime - a.createdTime);
		return backups;
	};

	const backupPath = async fileName => {
		await ensureAvailable();
		const fullPath = ensureWithinDir(backupDir, fileName);
		const stat = await fsp.stat(fullPath).catch(() => null);
		if (!stat || !stat.isFile()) throw new Error('Backup file not found');
		return { path: fullPath, size: stat.size, name: fileName, createdTime: stat.mtimeMs };
	};

	const progressSnapshot = job => ({
		id: job ? job.id : '',
		type: job ? job.type : '',
		state: job ? job.state : 'idle',
		message: job ? job.message : '',
		startedAt: job ? job.startedAt : 0,
		finishedAt: job ? job.finishedAt || 0 : 0,
		fileName: job ? job.fileName || '' : '',
		bytesWritten: job ? job.bytesWritten || 0 : 0,
		stderrTail: job ? job.stderrTail || '' : '',
		error: job ? job.error || '' : '',
	});

	const currentStatus = () => progressSnapshot(currentJob);

	const setJobState = (job, updates) => {
		if (!job) return;
		Object.assign(job, updates);
	};

	const startBackupJob = async jobOptions => {
		await ensureAvailable();
		if (isBusy()) throw new Error(`Another backup operation is already running (${currentJob.type})`);
		const selectedCompressionArg = backupCompressionArg(jobOptions);
		const fileName = `joplock-backup-${timestampForFile(now())}${BACKUP_EXT}`;
		const tmpName = `${fileName}.tmp`;
		const tmpPath = tempPathWithinDir(backupDir, tmpName);
		const finalPath = ensureWithinDir(backupDir, fileName);
		const job = {
			id: `job-${now()}`,
			type: 'backup',
			state: 'running',
			message: 'Starting backup',
			startedAt: now(),
			finishedAt: 0,
			fileName,
			bytesWritten: 0,
			stderrTail: '',
			error: '',
		};
		currentJob = job;
		const out = fs.createWriteStream(tmpPath, { flags: 'wx' });
		let child;
		try {
			child = spawnImpl('pg_dump', ['--format=custom', `--compress=${selectedCompressionArg}`, '--no-owner', '--no-privileges', '--dbname', `${postgresConfig.database || ''}`], {
				env: pgEnv(),
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			setJobState(job, { state: 'failed', message: 'Backup failed to start', error: safeError(error), finishedAt: now() });
			throw error;
		}
		child.stdout.on('data', chunk => {
			job.bytesWritten += chunk.length;
			job.message = `Writing backup (${job.bytesWritten} bytes)`;
		});
		child.stderr.on('data', chunk => {
			job.stderrTail = `${job.stderrTail}${chunk.toString('utf8')}`.slice(-4000);
			job.message = 'Running pg_dump';
		});
		child.stdout.pipe(out);
		const finished = Promise.all([
			new Promise((resolve, reject) => {
				out.on('finish', resolve);
				out.on('error', reject);
			}),
			new Promise((resolve, reject) => {
				child.on('error', reject);
				child.on('close', code => {
					if (code === 0) {
						resolve();
						return;
					}
					reject(new Error(job.stderrTail.trim() || `pg_dump failed with exit code ${code}`));
				});
			}),
		]).then(async () => {
			await fsp.rename(tmpPath, finalPath);
			const stat = await fsp.stat(finalPath);
			setJobState(job, {
				state: 'completed',
				message: 'Backup completed',
				bytesWritten: stat.size,
				finishedAt: now(),
			});
		}).catch(async error => {
			out.destroy();
			await fsp.rm(tmpPath, { force: true }).catch(() => {});
			setJobState(job, {
				state: 'failed',
				message: 'Backup failed',
				error: safeError(error),
				finishedAt: now(),
			});
		});
		job.promise = finished;
		return progressSnapshot(job);
	};

	const startRestoreJob = async fileName => {
		await ensureAvailable();
		if (isBusy()) throw new Error(`Another backup operation is already running (${currentJob.type})`);
		const selected = await backupPath(fileName);
		const job = {
			id: `job-${now()}`,
			type: 'restore',
			state: 'running',
			message: `Starting restore from ${selected.name}`,
			startedAt: now(),
			finishedAt: 0,
			fileName: selected.name,
			bytesWritten: selected.size,
			stderrTail: '',
			error: '',
		};
		currentJob = job;
		let child;
		try {
			child = spawnImpl('pg_restore', [
				'--clean',
				'--if-exists',
				'--no-owner',
				'--no-privileges',
				'--single-transaction',
				'--exit-on-error',
				'--dbname', `${postgresConfig.database || ''}`,
				selected.path,
			], {
				env: pgEnv(),
				stdio: ['ignore', 'ignore', 'pipe'],
			});
		} catch (error) {
			setJobState(job, { state: 'failed', message: 'Restore failed to start', error: safeError(error), finishedAt: now() });
			throw error;
		}
		child.stderr.on('data', chunk => {
			job.stderrTail = `${job.stderrTail}${chunk.toString('utf8')}`.slice(-4000);
			job.message = 'Running pg_restore';
		});
		const finished = new Promise((resolve, reject) => {
			child.on('error', reject);
			child.on('close', code => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(new Error(job.stderrTail.trim() || `pg_restore failed with exit code ${code}`));
			});
		}).then(() => {
			setJobState(job, {
				state: 'completed',
				message: 'Restore completed',
				finishedAt: now(),
			});
		}).catch(error => {
			setJobState(job, {
				state: 'failed',
				message: 'Restore failed',
				error: safeError(error),
				finishedAt: now(),
			});
		});
		job.promise = finished;
		return progressSnapshot(job);
	};

	const waitForIdle = async () => {
		if (!currentJob || !currentJob.promise) return currentStatus();
		await currentJob.promise;
		return currentStatus();
	};

	return {
		isConfigured,
		isBusy,
		activeOperation,
		listBackups,
		backupPath,
		startBackupJob,
		startRestoreJob,
		currentStatus,
		waitForIdle,
	};
};

module.exports = {
	BACKUP_EXT,
	VALID_NAME_RE,
	createBackupService,
	ensureWithinDir,
	timestampForFile,
};
