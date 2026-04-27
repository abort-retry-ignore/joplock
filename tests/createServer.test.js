const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('../app/createServer');

const request = (port, options = {}) => {
	const {
		path: requestPath = '/api/web/me',
		method = 'GET',
		headers = { Cookie: 'sessionId=test-session' },
		body = null,
		rawBody = null,
	} = options;

	return new Promise((resolve, reject) => {
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path: requestPath,
			method,
			headers,
		}, res => {
			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => {
				const buf = Buffer.concat(chunks);
				resolve({ statusCode: res.statusCode, body: buf.toString('utf8'), rawBody: buf, headers: res.headers });
	});
});
		if (rawBody) {
			req.write(rawBody);
		} else if (body) {
			req.write(body);
		}
		req.end();
	});
};

const makePublicDir = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	// Copy htmx.min.js stub so static file serving works
	fs.writeFileSync(path.join(dir, 'htmx.min.js'), '// stub');
	return dir;
};

const defaultMocks = (overrides = {}) => ({
	publicDir: overrides.publicDir || makePublicDir(),
	joplinPublicBasePath: overrides.joplinPublicBasePath !== undefined ? overrides.joplinPublicBasePath : '/joplin',
	joplinPublicBaseUrl: overrides.joplinPublicBaseUrl || 'http://localhost:5444',
	joplinServerPublicUrl: overrides.joplinServerPublicUrl || 'http://localhost:5444/joplin',
	joplinServerOrigin: overrides.joplinServerOrigin || 'http://server:22300',
	adminService: overrides.adminService || null,
	adminEmail: overrides.adminEmail || '',
	ignoreAdminMfa: overrides.ignoreAdminMfa || false,
	itemService: {
		foldersByUserId: async () => [],
		folderByUserIdAndJopId: async () => null,
		notesByUserId: async () => [],
		noteHeadersByUserId: async () => [],
		noteHeadersByFolder: async () => [],
		folderNoteCountsByUserId: async () => new Map([['__all__', 0], ['__trash__', 0]]),
		noteByUserIdAndJopId: async () => null,
		searchNotes: async () => [],
		resourceBlobByUserId: async () => null,
		resourceMetaByUserId: async () => null,
		...overrides.itemService,
	},
	itemWriteService: {
		createFolder: async () => ({ id: 'folder-created' }),
		deleteFolder: async () => {},
		updateFolder: async () => ({ id: 'folder-updated' }),
		createNote: async () => ({ id: 'note-created' }),
		deleteNote: async () => {},
		trashNote: async () => {},
		restoreNote: async () => {},
		updateNote: async () => ({ id: 'note-updated' }),
		createResource: async () => ({ id: 'res-created' }),
		...overrides.itemWriteService,
	},
	sessionService: {
		userBySessionId: async sessionId => {
			if (sessionId === 'test-session') return { id: 'user-1', email: 'user@example.com', sessionId };
			return null;
		},
		touchSession: async () => {},
		getLastSeen: async () => null,
		deleteSession: async () => {},
		...overrides.sessionService,
	},
	settingsService: {
		settingsByUserId: async () => ({ noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: false, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'MMM-DD-YY', datetimeFormat: 'YYYY-MM-DD HH:mm', autoLogout: false, autoLogoutMinutes: 15 }),
		saveSettings: async (_userId, settings) => settings,
		getTotpSeed: async () => null,
		setTotpSeed: async () => true,
		clearTotpSeed: async () => true,
		...overrides.settingsService,
	},
	historyService: {
		saveSnapshot: async () => {},
		listSnapshots: async () => [],
		getSnapshot: async () => null,
		...overrides.historyService,
	},
	database: overrides.database || { query: async () => ({ rows: [] }) },
});

const withServer = async (mocks, fn) => {
	const server = createServer(defaultMocks(mocks));
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	try {
		await fn(port);
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
};

// --- JSON API tests ---

test('GET /api/web/me returns current user for valid session', async () => {
	await withServer({}, async port => {
		const res = await request(port);
		assert.equal(res.statusCode, 200);
		const payload = JSON.parse(res.body);
		assert.equal(payload.user.email, 'user@example.com');
	});
});

test('GET /api/web/me returns 401 for invalid session', async () => {
	await withServer({}, async port => {
		const res = await request(port, { headers: { Cookie: 'sessionId=bad' } });
		assert.equal(res.statusCode, 401);
	});
});

test('GET /api/web/folders returns folders', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'Test', parentId: '', createdTime: 0, updatedTime: 0 }],
		},
	}, async port => {
		const res = await request(port, { path: '/api/web/folders' });
		assert.equal(res.statusCode, 200);
		const payload = JSON.parse(res.body);
		assert.equal(payload.items.length, 1);
		assert.equal(payload.items[0].id, 'f1');
	});
});

test('POST /api/web/folders creates folder', async () => {
	let createdFolder = null;
	await withServer({
		itemWriteService: {
			createFolder: async (_sid, folder) => { createdFolder = folder; return { id: 'f-new' }; },
		},
		itemService: {
			folderByUserIdAndJopId: async () => ({ id: 'f-new', title: 'New', parentId: '' }),
		},
	}, async port => {
		const res = await request(port, {
			path: '/api/web/folders',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New' }),
		});
		assert.equal(res.statusCode, 201);
		assert.equal(createdFolder.title, 'New');
	});
});

test('PUT /api/web/notes/:id updates note', async () => {
	const existing = { id: 'n1', title: 'Old', body: 'Old body', parentId: 'f1', createdTime: 1000 };
	let updateArgs = null;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => existing,
		},
		itemWriteService: {
			updateNote: async (_sid, ex, updates) => { updateArgs = { ex, updates }; return { id: ex.id }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/api/web/notes/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New', body: 'New body' }),
		});
		assert.equal(res.statusCode, 200);
		assert.equal(updateArgs.updates.title, 'New');
		assert.equal(updateArgs.updates.body, 'New body');
	});
});

test('PUT /api/web/notes/:id returns 404 for missing note', async () => {
	await withServer({
		itemService: { noteByUserIdAndJopId: async () => null },
	}, async port => {
		const res = await request(port, {
			path: '/api/web/notes/missing',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'X' }),
		});
		assert.equal(res.statusCode, 404);
	});
});

// --- htmx fragment tests ---

test('GET /fragments/nav returns HTML folder-note tree', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [
				{ id: 'f1', title: 'Folder 1', parentId: '', createdTime: 0, updatedTime: 0 },
			],
			noteHeadersByUserId: async () => [
				{ id: 'n1', title: 'Note 1', parentId: 'f1', updatedTime: 0 },
			],
			searchNotes: async () => [
				{ id: 'n1', title: 'Note 1', parentId: 'f1', updatedTime: 0 },
			],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/nav?q=Note' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.headers['content-type'].includes('text/html'));
		assert.ok(res.body.includes('Search Results'));
		assert.ok(!res.body.includes('All Notes'));
		assert.ok(!res.body.includes('Folder 1'));
		assert.ok(res.body.includes('Note 1'));
		assert.ok(res.body.includes('id="nav-search"'));
		assert.ok(res.body.includes('class="nav-search-form"'));
		assert.ok(res.body.includes('&#128269;'));
		assert.ok(res.body.includes('value="Note"'));
		assert.ok(res.body.includes('hx-get="/fragments/editor/n1?currentFolderId=__search_results__"'));
	});
});

test('GET /fragments/editor/:id preserves current folder context', async () => {
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Test Note', body: 'Hello world', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }),
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/editor/n1?currentFolderId=__all_notes__' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('name="currentFolderId" value="__all_notes__"'));
	});
});

test('GET /fragments/editor/:id returns HTML editor', async () => {
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Test Note', body: 'Hello world', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }),
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/editor/n1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('hx-put="/fragments/editor/n1"'));
		assert.ok(res.body.includes('Test Note'));
		assert.ok(res.body.includes('Hello world'));
		assert.ok(res.body.includes('hx-trigger="joplock:save"'));
		assert.ok(res.body.includes('name="baseUpdatedTime" value="2000"'));
	});
});

test('PUT /fragments/editor/:id autosaves and returns status', async () => {
	let savedUpdates = null;
	const existing = { id: 'n1', title: 'Old', body: 'Old', parentId: 'f1', createdTime: 1000, updatedTime: 1000 };
	let callCount = 0;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => { callCount += 1; return callCount === 1 ? existing : { ...existing, title: 'Updated Title', body: 'Updated body', updatedTime: 2000 }; },
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			updateNote: async (_sid, _ex, updates) => { savedUpdates = updates; return { id: 'n1' }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Updated+Title&body=Updated+body&baseUpdatedTime=1000&currentFolderId=__all_notes__',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Saved'));
		assert.ok(res.body.includes('id="nav-panel" hx-swap-oob="innerHTML"'), 'should refresh nav panel');
		assert.ok(res.body.includes('id="editor-sync-state" hx-swap-oob="outerHTML"'));
		assert.ok(res.body.includes('name="baseUpdatedTime" value="2000"'));
		// Nav now lazy-loads notes; folder rows are present but note items are fetched on demand
		assert.ok(res.body.includes('Folder 1'));
		assert.equal(savedUpdates.title, 'Updated Title');
		assert.equal(savedUpdates.body, 'Updated body');
	});
});

test('PUT /fragments/editor/:id returns conflict status fragment when note changed remotely', async () => {
	await withServer({
		itemService: { noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Remote', body: 'Remote body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }) },
		itemWriteService: {
			updateNote: async () => { throw new Error('should not save'); },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Updated+Title&body=Updated+body&baseUpdatedTime=1000',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Conflict'));
		assert.ok(res.body.includes('Overwrite'));
		assert.ok(res.body.includes('Create copy'));
	});
});

test('PUT /fragments/editor/:id can create copy on conflict', async () => {
	let createdArgs = null;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async (_uid, id) => id === 'n-copy' ? { id: 'n-copy', title: 'Updated Title-3', body: 'Updated body', parentId: 'f1', createdTime: 3000, updatedTime: 3000 } : { id: 'n1', title: 'Remote', body: 'Remote body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 },
			noteHeadersByFolder: async () => [
				{ id: 'n1', title: 'Updated Title', parentId: 'f1', updatedTime: 1000 },
				{ id: 'n2', title: 'Updated Title-1', parentId: 'f1', updatedTime: 1000 },
				{ id: 'n3', title: 'Updated Title-2', parentId: 'f1', updatedTime: 1000 },
			],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			createNote: async (_sid, note) => { createdArgs = note; return { id: 'n-copy' }; },
			updateNote: async () => { throw new Error('should not update'); },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Updated+Title&body=Updated+body&parentId=f1&baseUpdatedTime=1000&createCopy=1',
		});
		assert.equal(res.statusCode, 200);
		assert.equal(createdArgs.title, 'Updated Title-3');
		assert.equal(createdArgs.body, 'Updated body');
		assert.ok(res.body.includes('id="nav-panel" hx-swap-oob="innerHTML"'));
		// Nav lazy-loads notes; folder is present but individual note items are fetched on demand
		assert.ok(res.body.includes('Folder 1'));
		assert.ok(res.body.includes('hx-put="/fragments/editor/n-copy"'));
	});
});

test('POST /fragments/folders creates folder and returns list', async () => {
	let created = false;
	await withServer({
		itemWriteService: {
			createFolder: async () => { created = true; return { id: 'f-new' }; },
		},
		itemService: {
			foldersByUserId: async () => [{ id: 'f-new', title: 'New Folder', parentId: '' }],
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/folders',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=New+Folder',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(created);
		assert.ok(res.body.includes('New Folder'));
	});
});

test('PUT /fragments/folders/:id renames folder and returns list', async () => {
	let updated = false;
	await withServer({
		itemWriteService: {
			updateFolder: async () => { updated = true; return { id: 'f1' }; },
		},
		itemService: {
			folderByUserIdAndJopId: async () => ({ id: 'f1', title: 'Old Folder', parentId: '' }),
			foldersByUserId: async () => [{ id: 'f1', title: 'Renamed Folder', parentId: '' }],
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/folders/f1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Renamed+Folder',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(updated);
		assert.ok(res.body.includes('Renamed Folder'));
	});
});

test('POST /fragments/notes selects created note and loads editor', async () => {
	await withServer({
		itemWriteService: {
			createNote: async () => ({ id: 'n-new' }),
		},
		itemService: {
			noteByUserIdAndJopId: async (_uid, id) => ({ id, title: 'Untitled note', body: '', parentId: 'f1', updatedTime: Date.now() }),
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'parentId=f1',
		});
		assert.equal(res.statusCode, 200);
		// Nav lazy-loads notes; check folder is present and editor loaded for new note
		assert.ok(res.body.includes('Folder 1'));
		assert.ok(res.body.includes('id="editor-panel" hx-swap-oob="innerHTML"'));
		assert.ok(res.body.includes('hx-put="/fragments/editor/n-new"'));
	});
});

test('DELETE /fragments/notes/:id trashes note and shows trash folder', async () => {
	let trashed = false;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Note 1', body: 'body', parentId: 'f1', createdTime: 1000, updatedTime: 1000, deletedTime: 0 }),
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [{ id: 'n1', title: 'Note 1', parentId: 'f1', updatedTime: 1000, deletedTime: 2000 }] : [],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			trashNote: async () => { trashed = true; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes/n1',
			method: 'DELETE',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.ok(trashed);
		assert.ok(res.body.includes('Trash'));
		assert.ok(res.body.includes('id="editor-panel" hx-swap-oob="innerHTML"'));
	});
});

test('DELETE /fragments/notes/:id permanently deletes trashed note', async () => {
	let deleted = false;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async (_uid, _id, options = {}) => options.deleted === 'only' ? { id: 'n1', title: 'Note 1', body: 'body', parentId: 'f1', createdTime: 1000, updatedTime: 1000, deletedTime: 2000 } : null,
			noteHeadersByUserId: async () => [],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			deleteNote: async () => { deleted = true; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes/n1',
			method: 'DELETE',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.ok(deleted);
	});
});

test('POST /fragments/notes/:id/restore restores trashed note', async () => {
	let restoreArgs = null;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async (_uid, id, options = {}) => {
				if (options.deleted === 'only') return { id, title: 'Deleted Note', body: 'body', parentId: 'f2', createdTime: 1000, updatedTime: 2000, deletedTime: 2000 };
				return { id, title: 'Deleted Note', body: 'body', parentId: 'f2', createdTime: 1000, updatedTime: 3000, deletedTime: 0 };
			},
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [] : [{ id: 'n1', title: 'Deleted Note', parentId: 'f2', updatedTime: 3000, deletedTime: 0 }],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }, { id: 'f2', title: 'Folder 2', parentId: '' }],
		},
		itemWriteService: {
			restoreNote: async (_sid, note, parentId) => { restoreArgs = { note, parentId }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes/n1/restore',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(restoreArgs.parentId, 'f2');
		assert.ok(res.body.includes('hx-put="/fragments/editor/n1"'));
	});
});

test('POST /fragments/trash/empty permanently deletes trashed notes', async () => {
	const deletedIds = [];
	await withServer({
		itemService: {
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [{ id: 'n1', title: 'Deleted Note', parentId: 'f1', updatedTime: 1000, deletedTime: 2000 }] : [],
			foldersByUserId: async () => [],
		},
		itemWriteService: {
			deleteNote: async (_sid, id) => { deletedIds.push(id); },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/trash/empty',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.deepEqual(deletedIds, ['n1']);
	});
});

test('GET / returns full SSR page for logged-in user', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'My Folder', parentId: '' }],
			noteHeadersByUserId: async () => [],
		},
	}, async port => {
		const res = await request(port, { path: '/' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('<!DOCTYPE html>'));
		assert.ok(res.body.includes('Joplock'));
		assert.ok(res.body.includes('My Folder'));
		assert.ok(res.body.includes('Trash'));
		assert.ok(res.body.includes('htmx.min.js'));
		assert.ok(res.body.includes('apple-touch-icon.png'));
		assert.ok(res.body.includes('apple-touch-startup-image'));
	});
});

test('GET / resumes last edited note from server-side settings when enabled', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ noteFontSize: 15, codeFontSize: 12, noteMonospace: false, noteOpenMode: 'preview', resumeLastNote: true, lastNoteId: 'n1', lastNoteFolderId: '__all_notes__', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
			saveSettings: async (_userId, settings) => settings,
			getTotpSeed: async () => null,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'My Folder', parentId: '' }],
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: '# **Hello**', body: 'Body', parentId: 'f1', createdTime: 1000, updatedTime: 1000, deletedTime: 0 }),
		},
	}, async port => {
		const res = await request(port, { path: '/' });
		assert.equal(res.statusCode, 200);
		// Nav lazy-loads notes; folder is present but note items are fetched on demand
		assert.ok(res.body.includes('My Folder'));
		assert.ok(res.body.includes('hx-put="/fragments/editor/n1"'));
		assert.ok(res.body.includes('data-placeholder="Note title">Hello</div>'));
		assert.ok(!res.body.includes('<strong>Hello</strong>'));
	});
});

test('GET / includes mobile startup resume payload for resumed note', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ noteFontSize: 15, codeFontSize: 12, noteMonospace: false, noteOpenMode: 'preview', resumeLastNote: true, lastNoteId: 'n1', lastNoteFolderId: '__all_notes__', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
			saveSettings: async (_userId, settings) => settings,
			getTotpSeed: async () => null,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'My Folder', parentId: '' }],
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [] : [{ id: 'n1', title: '# **Hello**', parentId: 'f1', updatedTime: 1000, deletedTime: 0 }],
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: '# **Hello**', body: 'Body', parentId: 'f1', createdTime: 1000, updatedTime: 1000, deletedTime: 0 }),
		},
	}, async port => {
		const res = await request(port, { path: '/' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('mobileStartup:{"folderId":"f1","folderTitle":"My Folder","noteId":"n1","noteTitle":"Hello"}'));
		assert.ok(res.body.includes('<div class="mobile-screen-body mobile-editor-body" id="mobile-editor-body">'));
		assert.ok(res.body.includes('hx-put="/fragments/editor/n1"'));
		assert.ok(!res.body.includes('<div class="mobile-screen-body mobile-editor-body" id="mobile-editor-body">\n\t\t\t\t<div class="editor-empty">Select a note</div>'));
	});
});

test('GET / creates starter content when user has no real folders', async () => {
	let folderCreates = 0;
	let noteCreates = 0;
	await withServer({
		itemService: {
			foldersByUserId: async () => folderCreates > 0 ? [{ id: 'examples', title: 'Examples', parentId: '' }] : [],
			noteHeadersByUserId: async () => [],
		},
		itemWriteService: {
			createFolder: async () => { folderCreates += 1; return { id: 'examples' }; },
			createNote: async () => { noteCreates += 1; return { id: 'start-here' }; },
		},
	}, async port => {
		const res = await request(port, { path: '/' });
		assert.equal(res.statusCode, 200);
		assert.equal(folderCreates, 1);
		assert.equal(noteCreates, 1);
		assert.ok(res.body.includes('Examples'));
	});
});

test('GET / redirects unauthenticated user to /login', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/', headers: {} });
		assert.equal(res.statusCode, 302);
		assert.equal(res.headers.location, '/login');
	});
});

test('GET /login returns login page for unauthenticated user', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/login', headers: {} });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Login'));
		assert.ok(!res.body.includes('Authentication code'));
		assert.ok(!res.body.includes('NOTEBOOKS'));
	});
});

test('POST /login skips per-user MFA for admin when IGNORE_ADMIN_MFA is set', async () => {
	await withServer({
		adminEmail: 'admin@example.com',
		ignoreAdminMfa: true,
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_userId, s) => s,
			getTotpSeed: async () => 'TESTSEEDNEVERUSED',
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
		sessionService: {
			userBySessionId: async sessionId => {
				if (sessionId === 'admin-sess') return { id: 'admin-1', email: 'admin@example.com', sessionId };
				return null;
			},
		},
	}, async port => {
		// Mock Joplin Server login succeeds by relying on test mock
		// The test verifies the MFA bypass path; Joplin login is mocked upstream
		const res = await request(port, {
			path: '/login',
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'email=admin%40example.com&password=test',
		});
		// Without the bypass, this would redirect to /login/mfa since getTotpSeed returns a seed
		// With bypass, it should either set session or fail at Joplin login (302 to / or /login?error=)
		assert.equal(res.statusCode, 302);
		// Should NOT redirect to MFA page
		assert.ok(!res.headers.location.includes('/login/mfa'));
	});
});

test('POST /login creates starter content for user with no real folders', async () => {
	const upstream = http.createServer((req, res) => {
		if (req.method === 'POST' && req.url === '/api/sessions') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id: 'fresh-session' }));
			return;
		}
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'not found' }));
	});
	await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
	const upstreamPort = upstream.address().port;
	let folderCreates = 0;
	let noteCreates = 0;
	try {
		await withServer({
			joplinServerOrigin: `http://127.0.0.1:${upstreamPort}`,
			joplinServerPublicUrl: `http://127.0.0.1:${upstreamPort}`,
			sessionService: {
				userBySessionId: async sessionId => {
					if (sessionId === 'test-session') return { id: 'user-1', email: 'user@example.com', sessionId };
					if (sessionId === 'fresh-session') return { id: 'user-1', email: 'user@example.com', sessionId };
					return null;
				},
			},
			itemService: {
				foldersByUserId: async () => folderCreates > 0 ? [{ id: 'examples', title: 'Examples', parentId: '' }] : [],
				noteHeadersByUserId: async () => [],
			},
			itemWriteService: {
				createFolder: async () => { folderCreates += 1; return { id: 'examples' }; },
				createNote: async () => { noteCreates += 1; return { id: 'start-here' }; },
			},
		}, async port => {
			const res = await request(port, {
				path: '/login',
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'email=user%40example.com&password=UserPass123%21',
			});
			assert.equal(res.statusCode, 302);
			assert.equal(res.headers.location, '/');
			assert.equal(folderCreates, 1);
			assert.equal(noteCreates, 1);
		});
	} finally {
		await new Promise(resolve => upstream.close(resolve));
	}
});

test('GET /settings redirects unauthenticated user to login', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/settings', headers: {} });
		assert.equal(res.statusCode, 302);
		assert.equal(res.headers.location, '/login');
	});
});

test('GET /settings shows font controls and per-user MFA section', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ noteFontSize: 17, codeFontSize: 13, noteMonospace: true, resumeLastNote: true, dateFormat: 'DD/MM/YYYY', datetimeFormat: 'DD/MM/YYYY HH:mm' }),
			getTotpSeed: async () => null,
		},
	}, async port => {
		const res = await request(port, { path: '/settings' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Joplock Settings'));
		assert.ok(res.body.includes('settings-note-font'));
		assert.ok(res.body.includes('value="17"'));
		assert.ok(res.body.includes('Use monospace for note text'));
		assert.ok(res.body.includes('Reopen the last edited note on startup'));
		assert.ok(res.body.includes('Two-Factor Authentication'));
	});
});

test('PUT /api/web/settings saves individual settings', async () => {
	let saved = null;
	await withServer({
		settingsService: {
		settingsByUserId: async () => ({ noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: false, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm', autoLogout: false, autoLogoutMinutes: 15, theme: 'matrix' }),
			saveSettings: async (_userId, settings) => { saved = settings; return settings; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/api/web/settings',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'theme=nord',
		});
		assert.equal(res.statusCode, 204);
		assert.equal(saved.theme, 'nord');
		assert.equal(saved.noteFontSize, 15); // unchanged
	});
});

test('PUT /api/web/settings accepts resumeLastNote preference', async () => {
	let saved = null;
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: false, lastNoteId: 'n1', lastNoteFolderId: 'f1', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm', autoLogout: false, autoLogoutMinutes: 15, theme: 'matrix' }),
			saveSettings: async (_userId, settings) => { saved = settings; return settings; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/api/web/settings',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'resumeLastNote=1',
		});
		assert.equal(res.statusCode, 204);
		assert.equal(saved.resumeLastNote, '1');
		assert.equal(saved.lastNoteId, 'n1');
	});
});

test('GET /fragments/editor/:id stores last note state on the server', async () => {
	let savedSettings = null;
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: true, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
			saveSettings: async (_userId, settings) => { savedSettings = settings; return settings; },
			getTotpSeed: async () => null,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: '# Title', body: 'Body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }),
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/editor/n1?currentFolderId=__all_notes__' });
		assert.equal(res.statusCode, 200);
		assert.equal(savedSettings.lastNoteId, 'n1');
		assert.equal(savedSettings.lastNoteFolderId, '__all_notes__');
		assert.ok(res.body.includes('data-placeholder="Note title">Title</div>'));
	});
});

test('PUT /fragments/editor/:id saves plain title and last note state on the server', async () => {
	let savedUpdates = null;
	let savedSettings = null;
	const existing = { id: 'n1', title: 'Old', body: 'Old', parentId: 'f1', createdTime: 1000, updatedTime: 1000 };
	let callCount = 0;
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: true, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
			saveSettings: async (_userId, settings) => { savedSettings = settings; return settings; },
			getTotpSeed: async () => null,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
		itemService: {
			noteByUserIdAndJopId: async () => { callCount += 1; return callCount === 1 ? existing : { ...existing, title: 'Hello world', body: 'Updated body', updatedTime: 2000 }; },
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [] : [{ id: 'n1', title: 'Hello world', parentId: 'f1', updatedTime: 2000, deletedTime: 0 }],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			updateNote: async (_sid, _ex, updates) => { savedUpdates = updates; return { id: 'n1' }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=%23+**Hello**+%5Bworld%5D(https%3A%2F%2Fexample.com)&body=Updated+body&baseUpdatedTime=1000&currentFolderId=__all_notes__',
		});
		assert.equal(res.statusCode, 200);
		assert.equal(savedUpdates.title, 'Hello world');
		assert.equal(savedSettings.lastNoteId, 'n1');
		assert.equal(savedSettings.lastNoteFolderId, '__all_notes__');
	});
});

test('GET /fragments/search returns matching notes', async () => {
	await withServer({
		itemService: {
			searchNotes: async (_uid, query) => {
				if (query === 'hello') {
					return [{ id: 'n1', title: 'Hello World', body: 'content', bodyPreview: 'content', parentId: 'f1' }];
				}
				return [];
			},
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/search?q=hello' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Hello World'));
		assert.ok(res.body.includes('hx-get="/fragments/editor/n1?currentFolderId=search"'));

		const empty = await request(port, { path: '/fragments/search?q=' });
		assert.equal(empty.statusCode, 200);
		assert.equal(empty.body, '');
	});
});

test('GET /fragments/search shows Load more when exactly 50 results returned', async () => {
	await withServer({
		itemService: {
			searchNotes: async (_uid, _query, limit, offset) => {
				assert.equal(limit, 50);
				assert.equal(offset, 0);
				return Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, body: '', bodyPreview: '', parentId: 'f1' }));
			},
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/search?q=test' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('notelist-load-more'), 'should include Load more button');
		assert.ok(res.body.includes('/fragments/search?q=test&offset=50'), 'Load more URL should have offset=50');
	});
});

test('GET /fragments/search passes offset to searchNotes', async () => {
	let receivedOffset;
	await withServer({
		itemService: {
			searchNotes: async (_uid, _query, _limit, offset) => {
				receivedOffset = offset;
				return [{ id: 'n1', title: 'Note', body: '', bodyPreview: '', parentId: 'f1' }];
			},
		},
	}, async port => {
		await request(port, { path: '/fragments/search?q=test&offset=50' });
		assert.equal(receivedOffset, 50);
	});
});

// --- Resource tests ---

test('GET /resources/:id serves binary blob with correct content-type', async () => {
	const blobData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // fake PNG header
	await withServer({
		itemService: {
			resourceMetaByUserId: async (_uid, rid) => {
				if (rid === 'abcdef01234567890abcdef012345678') return { id: rid, mime: 'image/png', title: 'test.png', filename: 'test.png' };
				return null;
			},
			resourceBlobByUserId: async (_uid, rid) => {
				if (rid === 'abcdef01234567890abcdef012345678') return blobData;
				return null;
			},
		},
	}, async port => {
		const res = await request(port, { path: '/resources/abcdef01234567890abcdef012345678' });
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['cache-control'], 'no-store');
		assert.equal(res.headers['content-type'], 'image/png');
		assert.equal(res.headers['content-disposition'], 'inline; filename="test.png"');
		assert.ok(res.rawBody.equals(blobData));
	});
});

test('GET /resources/:id forces attachment download when requested', async () => {
	const blobData = Buffer.from('%PDF-1.7');
	await withServer({
		itemService: {
			resourceMetaByUserId: async (_uid, rid) => rid === 'abcdef01234567890abcdef012345678' ? { id: rid, mime: 'application/pdf', title: 'manual.pdf', filename: 'manual.pdf' } : null,
			resourceBlobByUserId: async (_uid, rid) => rid === 'abcdef01234567890abcdef012345678' ? blobData : null,
		},
	}, async port => {
		const res = await request(port, { path: '/resources/abcdef01234567890abcdef012345678?download=1' });
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['content-disposition'], 'attachment; filename="manual.pdf"');
		assert.ok(res.rawBody.equals(blobData));
	});
});

test('GET /api/web/notes returns all notes for virtual all notes folder', async () => {
	let receivedOptions = null;
	await withServer({
		itemService: {
			notesByUserId: async (_uid, options = {}) => {
				receivedOptions = options;
				return [{ id: 'n1', title: 'Note 1', parentId: 'f1' }];
			},
		},
	}, async port => {
		const res = await request(port, { path: '/api/web/notes?folderId=__all_notes__' });
		assert.equal(res.statusCode, 200);
		assert.deepEqual(receivedOptions, {});
		const payload = JSON.parse(res.body);
		assert.equal(payload.items.length, 1);
		assert.equal(payload.items[0].id, 'n1');
	});
});

test('POST /logout returns logged-out page and clears client state', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/logout',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['cache-control'], 'no-store');
		assert.ok(!res.headers['clear-site-data'], 'should not send Clear-Site-Data (client-side cleanup instead)');
		const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : res.headers['set-cookie'];
		assert.ok(setCookie.includes('sessionId='));
		assert.ok(setCookie.includes('Max-Age=0'));
		assert.ok(res.body.includes('Cleanup complete'));
		assert.ok(res.body.includes('Go to login'));
	});
});

// --- Heartbeat ---

test('POST /heartbeat returns 204 for valid session and does not touch session', async () => {
	let touched = false;
	await withServer({
		sessionService: { touchSession: async () => { touched = true; } },
	}, async port => {
		const res = await request(port, { path: '/heartbeat', method: 'POST', headers: { Cookie: 'sessionId=test-session' } });
		assert.equal(res.statusCode, 204);
		assert.equal(touched, false, 'heartbeat should not touch session (liveness check only)');
	});
});

test('POST /heartbeat returns 401 for missing session', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/heartbeat', method: 'POST', headers: {} });
		assert.equal(res.statusCode, 401);
	});
});

test('POST /heartbeat returns 401 for invalid session', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/heartbeat', method: 'POST', headers: { Cookie: 'sessionId=bad-session' } });
		assert.equal(res.statusCode, 401);
	});
});

test('authenticatedUser enforces heartbeat timeout when autoLogout enabled', async () => {
	const staleLastSeen = Date.now() - (20 * 60 * 1000); // 20 min ago
	let deleted = null;
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ autoLogout: true, autoLogoutMinutes: 15, noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: false, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
		},
		sessionService: {
			getLastSeen: async () => staleLastSeen,
			deleteSession: async id => { deleted = id; },
		},
	}, async port => {
		const res = await request(port, { path: '/api/web/me', headers: { Cookie: 'sessionId=test-session' } });
		assert.equal(res.statusCode, 401);
		assert.equal(deleted, 'test-session');
	});
});

test('authenticatedUser allows request when lastSeen is within timeout', async () => {
	const recentLastSeen = Date.now() - (5 * 60 * 1000); // 5 min ago
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ autoLogout: true, autoLogoutMinutes: 15, noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: false, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
		},
		sessionService: {
			getLastSeen: async () => recentLastSeen,
			deleteSession: async () => {},
		},
	}, async port => {
		const res = await request(port, { path: '/api/web/me', headers: { Cookie: 'sessionId=test-session' } });
		assert.notEqual(res.statusCode, 401);
	});
});

test('authenticatedUser skips timeout check when autoLogout disabled', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ autoLogout: false, autoLogoutMinutes: 15, noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: false, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
		},
		sessionService: {
			getLastSeen: async () => 0,
			deleteSession: async () => {},
		},
	}, async port => {
		const res = await request(port, { path: '/api/web/me', headers: { Cookie: 'sessionId=test-session' } });
		assert.notEqual(res.statusCode, 401);
	});
});

test('authenticatedUser allows request when lastSeen is null (no heartbeat yet)', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ autoLogout: true, autoLogoutMinutes: 15, noteFontSize: 15, codeFontSize: 12, noteMonospace: false, resumeLastNote: false, lastNoteId: '', lastNoteFolderId: '', dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm' }),
		},
		sessionService: {
			getLastSeen: async () => null,
			deleteSession: async () => {},
		},
	}, async port => {
		const res = await request(port, { path: '/api/web/me', headers: { Cookie: 'sessionId=test-session' } });
		assert.notEqual(res.statusCode, 401);
	});
});

test('GET /logout returns logged-out page and clears client state', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/logout',
			method: 'GET',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['cache-control'], 'no-store');
		assert.ok(!res.headers['clear-site-data'], 'should not send Clear-Site-Data (client-side cleanup instead)');
		const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : res.headers['set-cookie'];
		assert.ok(setCookie.includes('sessionId='));
		assert.ok(setCookie.includes('Max-Age=0'));
		assert.ok(res.body.includes('Cleanup complete'));
		assert.ok(res.body.includes('Go to login'));
	});
});

test('GET /resources/:id returns 404 for missing resource', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/resources/abcdef01234567890abcdef012345678' });
		assert.equal(res.statusCode, 404);
	});
});

test('GET /resources/:id returns 400 for invalid resource ID', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/resources/not-valid' });
		assert.equal(res.statusCode, 400);
	});
});

test('POST /fragments/upload creates resource and returns markdown', async () => {
	let createdResource = null;
	let createdBuffer = null;
	await withServer({
		itemWriteService: {
			createResource: async (_sid, resource, buffer) => {
				createdResource = resource;
				createdBuffer = buffer;
				return { id: 'newresource01234567890abcdef01234' };
			},
		},
	}, async port => {
		const boundary = '----testboundary';
		const fileContent = Buffer.from('fake image data');
		const body = Buffer.concat([
			Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
			fileContent,
			Buffer.from(`\r\n--${boundary}--\r\n`),
		]);

		const res = await request(port, {
			path: '/fragments/upload',
			method: 'POST',
			headers: {
				Cookie: 'sessionId=test-session',
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Content-Length': body.length,
			},
			rawBody: body,
		});
		assert.equal(res.statusCode, 200);
		const payload = JSON.parse(res.body);
		assert.equal(payload.resourceId, 'newresource01234567890abcdef01234');
		assert.ok(payload.markdown.includes('![photo.png](:/')); // image markdown
		assert.equal(createdResource.mime, 'image/png');
		assert.equal(createdResource.filename, 'photo.png');
		assert.equal(createdResource.fileExtension, 'png');
		assert.ok(createdBuffer.equals(fileContent));
	});
});

test('POST /fragments/upload returns 401 for unauthenticated user', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/fragments/upload',
			method: 'POST',
			headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
		});
		assert.equal(res.statusCode, 401);
	});
});

test('GET /fragments/editor/:id includes folder dropdown', async () => {
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'My Note', body: 'text', parentId: 'f2', updatedTime: Date.now() }),
			foldersByUserId: async () => [
				{ id: 'f1', title: 'Work', parentId: '' },
				{ id: 'f2', title: 'Personal', parentId: '' },
			],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/editor/n1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('<select name="parentId"'));
		assert.ok(res.body.includes('Work'));
		assert.ok(res.body.includes('Personal'));
		// f2 should be selected
		assert.ok(res.body.includes('value="f2" selected'));
	});
});

test('POST /fragments/preview renders markdown to HTML', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/fragments/preview',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'body=**bold**+and+*italic*',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('<strong>bold</strong>'));
		assert.ok(res.body.includes('<em>italic</em>'));
	});
});

test('POST /fragments/preview renders Joplin resource images', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/fragments/preview',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'body=!%5Bphoto%5D(%3A%2Fabcdef01234567890abcdef012345678)',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('src="/resources/abcdef01234567890abcdef012345678"'));
		assert.ok(res.body.includes('class="preview-img"'));
	});
});

test('PUT /fragments/editor/:id skips nav refresh on body-only save', async () => {
	const existing = { id: 'n1', title: 'Same Title', body: 'Old body', parentId: 'f1', createdTime: 1000, updatedTime: 1000 };
	let callCount = 0;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => { callCount += 1; return callCount === 1 ? existing : { ...existing, body: 'New body', updatedTime: 2000 }; },
			noteHeadersByUserId: async () => { throw new Error('should not fetch nav data'); },
			foldersByUserId: async () => { throw new Error('should not fetch nav data'); },
		},
		itemWriteService: {
			updateNote: async () => ({ id: 'n1' }),
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Same+Title&body=New+body&parentId=f1&baseUpdatedTime=1000&currentFolderId=f1',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Saved'));
		assert.ok(!res.body.includes('id="nav-panel"'), 'should NOT include nav panel OOB swap');
		assert.ok(res.body.includes('id="editor-sync-state" hx-swap-oob="outerHTML"'));
		assert.ok(res.body.includes('name="baseUpdatedTime" value="2000"'));
	});
});

test('PUT /fragments/editor/:id preserves every printable ASCII character in body', async () => {
	const savedBodies = [];
	const existing = { id: 'n1', title: 'T', body: '', parentId: 'f1', createdTime: 1000, updatedTime: 1000 };
	let callCount = 0;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => { callCount += 1; return callCount % 2 === 1 ? existing : { ...existing, updatedTime: 2000 }; },
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [] : [{ id: 'n1', title: 'T', parentId: 'f1', updatedTime: 2000, deletedTime: 0 }],
			foldersByUserId: async () => [{ id: 'f1', title: 'F', parentId: '' }],
		},
		itemWriteService: {
			updateNote: async (_sid, _ex, updates) => { savedBodies.push(updates.body); return { id: 'n1' }; },
		},
	}, async port => {
		for (let code = 32; code <= 126; code++) {
			callCount = 0;
			const ch = String.fromCharCode(code);
			const bodyText = `before${ch}after`;
			const res = await request(port, {
				path: '/fragments/editor/n1',
				method: 'PUT',
				headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `title=T&body=${encodeURIComponent(bodyText)}&baseUpdatedTime=1000&currentFolderId=f1`,
			});
			assert.equal(res.statusCode, 200, `status for char ${code} (${ch})`);
			const saved = savedBodies[savedBodies.length - 1];
			assert.equal(saved, bodyText, `body mismatch for char ${code} (${JSON.stringify(ch)}): got ${JSON.stringify(saved)}`);
		}
	});
});

test('PUT /fragments/editor/:id preserves space-only and space-leading body lines', async () => {
	const savedBodies = [];
	const existing = { id: 'n1', title: 'T', body: '', parentId: 'f1', createdTime: 1000, updatedTime: 1000 };
	let callCount = 0;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => { callCount += 1; return callCount % 2 === 1 ? existing : { ...existing, updatedTime: 2000 }; },
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [] : [{ id: 'n1', title: 'T', parentId: 'f1', updatedTime: 2000, deletedTime: 0 }],
			foldersByUserId: async () => [{ id: 'f1', title: 'F', parentId: '' }],
		},
		itemWriteService: {
			updateNote: async (_sid, _ex, updates) => { savedBodies.push(updates.body); return { id: 'n1' }; },
		},
	}, async port => {
		const cases = [
			{ label: 'single space', body: ' ' },
			{ label: 'multiple spaces', body: '   ' },
			{ label: 'space then text', body: ' hello' },
			{ label: 'blank line with spaces', body: 'line one\n   \nline three' },
			{ label: 'trailing spaces on line', body: 'hello   \nworld' },
			{ label: 'leading spaces on line', body: '   hello\nworld' },
			{ label: 'only spaces on multiple lines', body: ' \n  \n   ' },
			{ label: 'tab character', body: '\there' },
			{ label: 'space before newline', body: 'a \nb' },
			{ label: 'spaces between blank lines', body: 'a\n \n \nb' },
		];
		for (const { label, body: bodyText } of cases) {
			callCount = 0;
			const res = await request(port, {
				path: '/fragments/editor/n1',
				method: 'PUT',
				headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `title=T&body=${encodeURIComponent(bodyText)}&baseUpdatedTime=1000&currentFolderId=f1`,
			});
			assert.equal(res.statusCode, 200, `status for "${label}"`);
			const saved = savedBodies[savedBodies.length - 1];
			assert.equal(saved, bodyText, `body mismatch for "${label}": expected ${JSON.stringify(bodyText)}, got ${JSON.stringify(saved)}`);
		}
	});
});

// --- Admin routes ---

const makeAdminMocks = (overrides = {}) => ({
	sessionService: {
		userBySessionId: async sessionId => {
			if (sessionId === 'admin-session') return { id: 'admin-1', email: 'admin@example.com', sessionId, isAdmin: true };
			if (sessionId === 'test-session') return { id: 'user-1', email: 'user@example.com', sessionId, isAdmin: false };
			return null;
		},
	},
	adminService: {
		listUsers: async () => [{ id: 'user-1', email: 'user@example.com', full_name: '', enabled: true, created_time: 0 }],
		createUser: async (email, fullName, password) => ({ id: 'new-1', email, full_name: fullName }),
		resetPassword: async () => {},
		setEnabled: async () => {},
		deleteUser: async () => {},
		updateProfile: async () => ({}),
		verifyPassword: async () => 'some-token',
		changePassword: async () => {},
		adminEmail: 'admin@example.com',
	},
	adminEmail: 'admin@example.com',
	...overrides,
});

test('GET /settings shows admin tab for admin user', async () => {
	await withServer(makeAdminMocks(), async port => {
		const res = await request(port, {
			path: '/settings',
			headers: { Cookie: 'sessionId=admin-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('tab-admin'), 'should include admin tab panel');
		assert.ok(res.body.includes('Create New User'), 'should include create user form');
	});
});

test('GET /settings does not show admin tab for non-admin user', async () => {
	await withServer(makeAdminMocks(), async port => {
		const res = await request(port, {
			path: '/settings',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.ok(!res.body.includes('tab-admin'), 'should not include admin tab panel');
	});
});

test('POST /admin/users creates user and redirects', async () => {
	let created = null;
	await withServer(makeAdminMocks({
		adminService: {
			listUsers: async () => [],
			createUser: async (email, fullName, password) => { created = { email, fullName, password }; return { id: 'new-1' }; },
			updateProfile: async () => ({}),
			verifyPassword: async () => null,
			changePassword: async () => {},
			adminEmail: 'admin@example.com',
		},
	}), async port => {
		const res = await request(port, {
			path: '/admin/users',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'email=new%40example.com&fullName=New+User&password=secret123',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('saved=1'));
		assert.equal(created && created.email, 'new@example.com');
	});
});

test('POST /admin/users redirects non-admin to /', async () => {
	await withServer(makeAdminMocks(), async port => {
		const res = await request(port, {
			path: '/admin/users',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'email=bad%40example.com&password=secret123',
		});
		assert.equal(res.statusCode, 302);
		assert.equal(res.headers.location, '/');
	});
});

test('POST /admin/users/:id/password resets password', async () => {
	let resetId = null;
	await withServer(makeAdminMocks({
		adminService: {
			listUsers: async () => [],
			createUser: async () => {},
			resetPassword: async (userId) => { resetId = userId; },
			setEnabled: async () => {},
			deleteUser: async () => {},
			updateProfile: async () => ({}),
			verifyPassword: async () => null,
			changePassword: async () => {},
			adminEmail: 'admin@example.com',
		},
	}), async port => {
		const res = await request(port, {
			path: '/admin/users/user-1/password',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'password=newpass123',
		});
		assert.equal(res.statusCode, 302);
		assert.equal(resetId, 'user-1');
	});
});

test('POST /admin/users/:id/disable disables user', async () => {
	let disabledId = null, disabledVal = null;
	await withServer(makeAdminMocks({
		adminService: {
			listUsers: async () => [],
			createUser: async () => {},
			resetPassword: async () => {},
			setEnabled: async (id, val) => { disabledId = id; disabledVal = val; },
			deleteUser: async () => {},
			updateProfile: async () => ({}),
			verifyPassword: async () => null,
			changePassword: async () => {},
			adminEmail: 'admin@example.com',
		},
	}), async port => {
		const res = await request(port, {
			path: '/admin/users/user-1/disable',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session' },
		});
		assert.equal(res.statusCode, 302);
		assert.equal(disabledId, 'user-1');
		assert.equal(disabledVal, false);
	});
});

test('POST /settings/profile updates profile', async () => {
	let dbUpdated = false;
	await withServer(makeAdminMocks({
		adminService: {
			listUsers: async () => [],
			createUser: async () => {},
			resetPassword: async () => {},
			setEnabled: async () => {},
			deleteUser: async () => {},
			updateProfile: async () => {},
			verifyPassword: async () => null,
			changePassword: async () => {},
			adminEmail: 'admin@example.com',
		},
		database: {
			query: async (sql, params) => {
				if (sql.includes('UPDATE users SET full_name')) {
					dbUpdated = true;
					assert.equal(params[0], 'Test User');
					return { rows: [] };
				}
				return { rows: [{ session_id: 'test-session', id: 'user1', email: 'user@example.com', full_name: '', is_admin: 1, can_upload: 1, email_confirmed: 1, account_type: 0, created_time: Date.now(), updated_time: Date.now(), enabled: 1, session_created_time: Date.now() }] };
			},
		},
	}), async port => {
		const res = await request(port, {
			path: '/settings/profile',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'fullName=Test+User&email=user%40example.com',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('saved=1'));
		assert.ok(dbUpdated);
	});
});

test('GET /fragments/folder-notes with __all_notes__ returns all notes', async () => {
	await withServer({
		itemService: {
			noteHeadersByFolder: async (_uid, folderId) => folderId === '__all__' ? [
				{ id: 'n1', title: 'Note 1', parentId: 'f1', updatedTime: 0 },
				{ id: 'n2', title: 'Note 2', parentId: 'f2', updatedTime: 0 },
			] : [],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/folder-notes?folderId=__all_notes__' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Note 1'));
		assert.ok(res.body.includes('Note 2'));
	});
});

// --- Health check ---

test('GET /health returns ok', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/health', headers: {} });
		assert.equal(res.statusCode, 200);
		assert.equal(res.body, 'ok');
	});
});

// --- Settings security ---

test('POST /settings/security saves auto-logout settings', async () => {
	let saved = null;
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({ noteFontSize: 15 }),
			saveSettings: async (_id, s) => { saved = s; return s; },
			getTotpSeed: async () => null,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
	}, async port => {
		const res = await request(port, {
			path: '/settings/security',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'autoLogout=true&autoLogoutMinutes=30',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('tab=security'));
		assert.equal(saved.autoLogout, 'true');
	});
});

// --- Settings password ---

test('POST /settings/password blocks docker admin', async () => {
	await withServer(makeAdminMocks(), async port => {
		const res = await request(port, {
			path: '/settings/password',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'currentPassword=old&newPassword=new&confirmPassword=new',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('managed+via+deployment'));
	});
});

test('POST /settings/password rejects missing current password', async () => {
	await withServer(makeAdminMocks({
		sessionService: {
			userBySessionId: async sessionId => sessionId === 'test-session' ? { id: 'user-1', email: 'user@example.com', sessionId, isAdmin: false } : null,
		},
	}), async port => {
		const res = await request(port, {
			path: '/settings/password',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'newPassword=abc&confirmPassword=abc',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('Current+password+required'));
	});
});

test('POST /settings/password rejects mismatched passwords', async () => {
	await withServer(makeAdminMocks({
		sessionService: {
			userBySessionId: async sessionId => sessionId === 'test-session' ? { id: 'user-1', email: 'user@example.com', sessionId, isAdmin: false } : null,
		},
	}), async port => {
		const res = await request(port, {
			path: '/settings/password',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'currentPassword=old&newPassword=abc&confirmPassword=xyz',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('Passwords+do+not+match'));
	});
});

// --- MFA settings routes ---

test('POST /settings/mfa/setup generates seed and redirects', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => null,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
	}, async port => {
		const res = await request(port, {
			path: '/settings/mfa/setup',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: '',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('mfaSetup='));
	});
});

test('POST /settings/mfa/setup rejects when already enabled', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => 'EXISTINGSEED',
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
	}, async port => {
		const res = await request(port, {
			path: '/settings/mfa/setup',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: '',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('MFA+already+enabled'));
	});
});

test('POST /settings/mfa/verify saves seed on valid code', async () => {
	const { hotp, base32Decode } = require('../app/auth/mfaService');
	const seed = 'JBSWY3DPEHPK3PXP';
	const now = Date.now();
	const code = hotp(base32Decode(seed), Math.floor(now / 30000));
	let savedSeed = null;
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => null,
			setTotpSeed: async (_id, s) => { savedSeed = s; return true; },
			clearTotpSeed: async () => true,
		},
	}, async port => {
		const res = await request(port, {
			path: '/settings/mfa/verify',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: `seed=${seed}&totp=${code}`,
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('mfaEnabled=1'));
		assert.equal(savedSeed, seed);
	});
});

test('POST /settings/mfa/verify rejects invalid code', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => null,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
	}, async port => {
		const res = await request(port, {
			path: '/settings/mfa/verify',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'seed=JBSWY3DPEHPK3PXP&totp=000000',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('Invalid+code'));
	});
});

test('POST /settings/mfa/cancel redirects to settings', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/settings/mfa/cancel',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: '',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('tab=security'));
	});
});

test('POST /settings/mfa/disable clears seed on valid code', async () => {
	const { hotp, base32Decode } = require('../app/auth/mfaService');
	const seed = 'JBSWY3DPEHPK3PXP';
	const now = Date.now();
	const code = hotp(base32Decode(seed), Math.floor(now / 30000));
	let cleared = false;
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => seed,
			setTotpSeed: async () => true,
			clearTotpSeed: async () => { cleared = true; return true; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/settings/mfa/disable',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: `totp=${code}`,
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('saved=1'));
		assert.ok(cleared);
	});
});

test('POST /settings/mfa/disable rejects invalid code', async () => {
	await withServer({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => 'JBSWY3DPEHPK3PXP',
			setTotpSeed: async () => true,
			clearTotpSeed: async () => true,
		},
	}, async port => {
		const res = await request(port, {
			path: '/settings/mfa/disable',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'totp=000000',
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('Invalid+code'));
	});
});

// --- Admin enable / delete / MFA ---

test('POST /admin/users/:id/enable enables user', async () => {
	let enabledId = null, enabledVal = null;
	await withServer(makeAdminMocks({
		adminService: {
			listUsers: async () => [],
			createUser: async () => {},
			resetPassword: async () => {},
			setEnabled: async (id, val) => { enabledId = id; enabledVal = val; },
			deleteUser: async () => {},
			updateProfile: async () => ({}),
			verifyPassword: async () => null,
			changePassword: async () => {},
			adminEmail: 'admin@example.com',
		},
	}), async port => {
		const res = await request(port, {
			path: '/admin/users/user-1/enable',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session' },
		});
		assert.equal(res.statusCode, 302);
		assert.equal(enabledId, 'user-1');
		assert.equal(enabledVal, true);
	});
});

test('POST /admin/users/:id/delete deletes user', async () => {
	let deletedId = null;
	await withServer(makeAdminMocks({
		adminService: {
			listUsers: async () => [],
			createUser: async () => {},
			resetPassword: async () => {},
			setEnabled: async () => {},
			deleteUser: async (id) => { deletedId = id; },
			updateProfile: async () => ({}),
			verifyPassword: async () => null,
			changePassword: async () => {},
			adminEmail: 'admin@example.com',
		},
	}), async port => {
		const res = await request(port, {
			path: '/admin/users/user-1/delete',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session' },
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('saved=1'));
		assert.equal(deletedId, 'user-1');
	});
});

test('POST /admin/users/:id/mfa/enable sets TOTP seed', async () => {
	let seedUserId = null;
	await withServer(makeAdminMocks({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => null,
			setTotpSeed: async (id) => { seedUserId = id; return true; },
			clearTotpSeed: async () => true,
		},
	}), async port => {
		const res = await request(port, {
			path: '/admin/users/user-1/mfa/enable',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session' },
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('saved=1'));
		assert.equal(seedUserId, 'user-1');
	});
});

test('POST /admin/users/:id/mfa/disable clears TOTP seed', async () => {
	let clearedId = null;
	await withServer(makeAdminMocks({
		settingsService: {
			settingsByUserId: async () => ({}),
			saveSettings: async (_id, s) => s,
			getTotpSeed: async () => 'SEED',
			setTotpSeed: async () => true,
			clearTotpSeed: async (id) => { clearedId = id; return true; },
		},
	}), async port => {
		const res = await request(port, {
			path: '/admin/users/user-1/mfa/disable',
			method: 'POST',
			headers: { Cookie: 'sessionId=admin-session' },
		});
		assert.equal(res.statusCode, 302);
		assert.ok(res.headers.location.includes('saved=1'));
		assert.equal(clearedId, 'user-1');
	});
});

// --- History routes ---

test('GET /fragments/history/:noteId returns history modal', async () => {
	await withServer({
		historyService: {
			saveSnapshot: async () => {},
			listSnapshots: async (noteId) => [{ id: 's1', noteId, savedTime: Date.now(), title: 'Test' }],
			getSnapshot: async () => null,
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/history/n1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('data-snapshot-id="s1"'));
		assert.ok(res.body.includes('history-list'));
	});
});

test('GET /fragments/history-snapshot/:id returns snapshot preview', async () => {
	await withServer({
		historyService: {
			saveSnapshot: async () => {},
			listSnapshots: async () => [],
			getSnapshot: async (id) => id === 's1' ? { id: 's1', body: 'Snapshot body' } : null,
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/history-snapshot/s1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Snapshot body'));
	});
});

test('GET /fragments/history-snapshot/:id returns 404 for missing snapshot', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/fragments/history-snapshot/missing' });
		assert.equal(res.statusCode, 404);
	});
});

// --- Folder delete ---

test('DELETE /fragments/folders/:id deletes folder and returns nav', async () => {
	let deletedId = null;
	await withServer({
		itemWriteService: {
			deleteFolder: async (_sess, id) => { deletedId = id; },
			createFolder: async () => ({}),
			updateFolder: async () => ({}),
			createNote: async () => ({}),
			deleteNote: async () => {},
			trashNote: async () => {},
			restoreNote: async () => {},
			updateNote: async () => ({}),
			createResource: async () => ({}),
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/folders/f1',
			method: 'DELETE',
		});
		assert.equal(res.statusCode, 200);
		assert.equal(deletedId, 'f1');
	});
});

// --- Mobile routes ---

test('GET /fragments/mobile/folders returns mobile folder list', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'Work' }],
			folderNoteCountsByUserId: async () => new Map([['__all__', 3], ['f1', 2], ['__trash__', 0]]),
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/mobile/folders' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('All Notes'));
		assert.ok(res.body.includes('Work'));
	});
});

test('GET /fragments/mobile/notes returns mobile note list', async () => {
	await withServer({
		itemService: {
			noteHeadersByFolder: async () => [{ id: 'n1', title: 'Note 1', parentId: 'f1' }],
			folderNoteCountsByUserId: async () => new Map([['__all__', 1], ['f1', 1], ['__trash__', 0]]),
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/mobile/notes?folderId=f1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Note 1'));
	});
});

test('POST /fragments/mobile/notes/new creates note and returns X-Mobile-Note-Id', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'General' }],
			noteHeadersByFolder: async () => [{ id: 'note-created', title: 'Untitled note', parentId: 'f1' }],
			folderNoteCountsByUserId: async () => new Map([['__all__', 1], ['f1', 1], ['__trash__', 0]]),
		},
		itemWriteService: {
			createNote: async () => ({ id: 'note-created' }),
			createFolder: async () => ({}),
			deleteFolder: async () => {},
			updateFolder: async () => ({}),
			deleteNote: async () => {},
			trashNote: async () => {},
			restoreNote: async () => {},
			updateNote: async () => ({}),
			createResource: async () => ({}),
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/mobile/notes/new',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'folderId=__all__',
		});
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['x-mobile-note-id'], 'note-created');
	});
});

test('GET /fragments/mobile/search returns search results', async () => {
	await withServer({
		itemService: {
			searchNotes: async () => [{ id: 'n1', title: 'Found', parentId: 'f1' }],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/mobile/search?q=test' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Found'));
	});
});

test('GET /fragments/mobile/search returns empty for no query', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/fragments/mobile/search?q=' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('No results'));
	});
});
