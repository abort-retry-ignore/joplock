const http = require('http');
const { randomBytes } = require('crypto');
const { serializeItem, MODEL_TYPE_NOTE, MODEL_TYPE_FOLDER, MODEL_TYPE_RESOURCE } = require('./joplinItem');

const notePath = noteId => `root:/${noteId}.md:`;
const folderPath = folderId => `root:/${folderId}.md:`;
const resourceMetaPath = resourceId => `root:/${resourceId}.md:`;
const resourceBlobPath = resourceId => `root:/.resource/${resourceId}:`;

const itemId = suffix => {
	const token = randomBytes(16).toString('hex').slice(0, 31);
	return `${token}${suffix}`;
};

const httpError = (statusCode, message) => {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
};

// Values for items that have no stored fields (brand new items). Existing items
// never use these: their stored fields are written back (see joplinItem.js).
const noteDefaults = now => ({
	is_conflict: 0,
	latitude: '0.00000000',
	longitude: '0.00000000',
	altitude: '0.0000',
	author: '',
	source_url: '',
	is_todo: 0,
	todo_due: 0,
	todo_completed: 0,
	source: 'joplock-web',
	source_application: 'net.cozic.joplock-web',
	application_data: '',
	order: now, // Joplin orders new notes by creation time
	encryption_cipher_text: '',
	encryption_applied: 0,
	markup_language: 1,
	conflict_original_id: '',
	master_key_id: '',
	user_data: '',
});

const serializeNote = note => {
	const now = Date.now();
	const noteId = note.id || itemId('1');
	const fields = note.fields || null;
	const createdTime = note.createdTime || (fields && fields.created_time) || now;

	const overrides = {
		id: noteId,
		parent_id: note.parentId || '',
		created_time: createdTime,
		updated_time: now,
		user_created_time: (fields && fields.user_created_time) || createdTime,
		user_updated_time: note.userUpdatedTime !== undefined ? note.userUpdatedTime : now,
		is_shared: note.isShared ? 1 : 0,
		share_id: note.shareId || '',
		deleted_time: note.deletedTime || 0,
	};
	if (note.masterKeyId !== undefined) overrides.master_key_id = note.masterKeyId;

	return {
		id: noteId,
		path: notePath(noteId),
		body: serializeItem({
			type: MODEL_TYPE_NOTE,
			title: note.title || 'Untitled note',
			body: note.body || '',
			fields,
			defaults: noteDefaults(now),
			overrides,
		}),
	};
};

const serializeFolder = folder => {
	const now = Date.now();
	const folderId = folder.id || itemId('2');
	const fields = folder.fields || null;
	const createdTime = folder.createdTime || (fields && fields.created_time) || now;

	const overrides = {
		id: folderId,
		parent_id: folder.parentId || '',
		created_time: createdTime,
		updated_time: now,
		user_created_time: folder.userCreatedTime || (fields && fields.user_created_time) || createdTime,
		user_updated_time: folder.userUpdatedTime !== undefined ? folder.userUpdatedTime : now,
		is_shared: folder.isShared ? 1 : 0,
		share_id: folder.shareId || '',
	};

	return {
		id: folderId,
		path: folderPath(folderId),
		body: serializeItem({
			type: MODEL_TYPE_FOLDER,
			title: folder.title || 'Untitled folder',
			fields,
			// icon / master key / deleted time come from the stored item when there is one;
			// these only matter for objects built without it.
			defaults: {
				encryption_cipher_text: '',
				encryption_applied: 0,
				master_key_id: folder.masterKeyId || '',
				icon: folder.icon || '',
				user_data: '',
				deleted_time: 0,
			},
			overrides,
		}),
	};
};

const serializeResource = resource => {
	const now = Date.now();
	const resourceId = resource.id || itemId('4');
	const filename = resource.filename || '';
	const overrides = {
		id: resourceId,
		mime: resource.mime || 'application/octet-stream',
		filename,
		created_time: now,
		updated_time: now,
		user_created_time: now,
		user_updated_time: now,
		file_extension: resource.fileExtension || '',
		size: resource.size || 0,
		is_shared: resource.isShared ? 1 : 0,
		share_id: resource.shareId || '',
		master_key_id: resource.masterKeyId || '',
		blob_updated_time: now,
	};

	return {
		id: resourceId,
		metaPath: resourceMetaPath(resourceId),
		blobPath: resourceBlobPath(resourceId),
		body: serializeItem({
			type: MODEL_TYPE_RESOURCE,
			title: resource.title || filename || 'Untitled resource',
			defaults: {
				encryption_cipher_text: '',
				encryption_applied: 0,
				encryption_blob_encrypted: 0,
				user_data: '',
				ocr_text: '',
				ocr_details: '',
				ocr_status: 0,
				ocr_error: '',
				ocr_driver_id: 0,
			},
			overrides,
		}),
	};
};

const requestUpstream = (origin, options = {}, body = null) => {
	const target = new URL(origin);
	const requestHeaders = { ...(options.headers || {}) };
	requestHeaders.host = options.publicHost || requestHeaders.host || '';
	requestHeaders['x-forwarded-host'] = options.publicHost || requestHeaders.host || '';
	requestHeaders['x-forwarded-proto'] = options.publicProtocol || 'http';
	delete requestHeaders.origin;
	delete requestHeaders.referer;
	if (body !== null && !requestHeaders['content-length']) {
		requestHeaders['content-length'] = Buffer.byteLength(body);
	}

	return new Promise((resolve, reject) => {
		const request = http.request({
			hostname: target.hostname,
			port: target.port,
			path: options.path || '/',
			method: options.method || 'GET',
			headers: requestHeaders,
		}, response => {
			const chunks = [];
			response.on('data', chunk => {
				chunks.push(chunk);
			});
			response.on('end', () => {
				resolve({
					statusCode: response.statusCode || 500,
					body: Buffer.concat(chunks),
					headers: response.headers,
				});
			});
		});

		request.on('error', reject);

		if (body !== null) request.write(body);
		request.end();
	});
};

const checkUpstreamResponse = response => {
	if (response.statusCode >= 200 && response.statusCode < 300) return;
	const message = response.body.toString('utf8') || `Upstream request failed: ${response.statusCode}`;
	const error = new Error(message);
	error.statusCode = response.statusCode;
	throw error;
};

const MARKUP_HTML = 2;

const normalizeNewlines = text => `${text === undefined || text === null ? '' : text}`.replace(/\r\n?/g, '\n');

// Joplin end-to-end encrypted items hold ciphertext; rewriting one from here
// would replace it with plaintext. They are shown as locked placeholders only.
const assertNotE2ee = (item, noun) => {
	if (item && item.e2ee) throw httpError(403, `This ${noun} is end-to-end encrypted by Joplin and cannot be changed in Joplock.`);
};

// `user_updated_time` as stored; undefined when the item has none (serializer then
// stamps "now", the behaviour for items that were never read from the server).
const preservedUserUpdatedTime = item => {
	const stored = item && item.fields ? item.fields.user_updated_time : undefined;
	return stored || undefined;
};

const createItemWriteService = options => {
	const { joplinServerOrigin, joplinServerPublicUrl } = options;
	const configuredPublicUrl = new URL(joplinServerPublicUrl);

	const putSerializedItem = async (sessionId, serializedItem, requestContext = {}) => {
		const response = await requestUpstream(joplinServerOrigin, {
			method: 'PUT',
			path: `/api/items/${serializedItem.path}/content`,
			publicHost: requestContext.host || configuredPublicUrl.host,
			publicProtocol: requestContext.protocol || configuredPublicUrl.protocol.replace(':', ''),
			headers: {
				'content-type': 'multipart/form-data; boundary=----joplockboundary',
				'x-api-auth': sessionId,
			},
		}, `------joplockboundary\r\nContent-Disposition: form-data; name="file"; filename="item.md"\r\nContent-Type: text/markdown\r\n\r\n${serializedItem.body}\r\n------joplockboundary--\r\n`);

		checkUpstreamResponse(response);
		return serializedItem.id;
	};

	const putBinaryItem = async (sessionId, itemPath, binaryBuffer, contentType, requestContext = {}) => {
		const boundary = '----joplockblobbound';
		const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: ${contentType}\r\n\r\n`;
		const footer = `\r\n--${boundary}--\r\n`;
		const body = Buffer.concat([
			Buffer.from(header, 'utf8'),
			binaryBuffer,
			Buffer.from(footer, 'utf8'),
		]);

		const response = await requestUpstream(joplinServerOrigin, {
			method: 'PUT',
			path: `/api/items/${itemPath}/content`,
			publicHost: requestContext.host || configuredPublicUrl.host,
			publicProtocol: requestContext.protocol || configuredPublicUrl.protocol.replace(':', ''),
			headers: {
				'content-type': `multipart/form-data; boundary=${boundary}`,
				'x-api-auth': sessionId,
			},
		}, body);

		checkUpstreamResponse(response);
	};

	const deleteItem = async (sessionId, itemPath, requestContext = {}) => {
		const response = await requestUpstream(joplinServerOrigin, {
			method: 'DELETE',
			path: `/api/items/${itemPath}`,
			publicHost: requestContext.host || configuredPublicUrl.host,
			publicProtocol: requestContext.protocol || configuredPublicUrl.protocol.replace(':', ''),
			headers: {
				'x-api-auth': sessionId,
			},
		});

		checkUpstreamResponse(response);
	};

	return {
		async createFolder(sessionId, folder, requestContext) {
			const serialized = serializeFolder(folder);
			await putSerializedItem(sessionId, serialized, requestContext);
			return { id: serialized.id };
		},

		async deleteFolder(sessionId, folderId, requestContext) {
			await deleteItem(sessionId, folderPath(folderId), requestContext);
		},

		async updateFolder(sessionId, existingFolder, updates, requestContext) {
			assertNotE2ee(existingFolder, 'notebook');
			const titleChanged = updates.title !== undefined && updates.title !== existingFolder.title;
			const serialized = serializeFolder({
				id: existingFolder.id,
				title: updates.title !== undefined ? updates.title : existingFolder.title,
				parentId: updates.parentId !== undefined ? updates.parentId : existingFolder.parentId,
				isShared: updates.isShared !== undefined ? updates.isShared : (existingFolder.isShared || false),
				shareId: updates.shareId !== undefined ? updates.shareId : (existingFolder.shareId || ''),
				createdTime: existingFolder.createdTime,
				userCreatedTime: existingFolder.userCreatedTime,
				// A rename is an edit; moves and share changes keep the user-visible
				// "modified" time, like Joplin's own Folder.moveToFolder.
				userUpdatedTime: titleChanged ? Date.now() : preservedUserUpdatedTime(existingFolder),
				icon: existingFolder.icon,
				masterKeyId: existingFolder.masterKeyId,
				fields: existingFolder.fields,
			});
			await putSerializedItem(sessionId, serialized, requestContext);
			return { id: serialized.id };
		},

		async createNote(sessionId, note, requestContext) {
			const serialized = serializeNote(note);
			await putSerializedItem(sessionId, serialized, requestContext);
			return { id: serialized.id };
		},

		async updateNote(sessionId, existingNote, updates, requestContext) {
			assertNotE2ee(existingNote, 'note');
			const isHtml = existingNote.markupLanguage === MARKUP_HTML;
			// HTML notes are read-only in Joplock: converting them to markdown would
			// destroy them. Moving, trashing and restoring (no content change) is fine.
			if (isHtml && updates.body !== undefined && normalizeNewlines(updates.body) !== normalizeNewlines(existingNote.body)) {
				throw httpError(403, 'HTML notes are read-only in Joplock. Edit them in a Joplin app.');
			}
			const title = isHtml || updates.title === undefined ? existingNote.title : updates.title;
			const body = isHtml || updates.body === undefined ? existingNote.body : updates.body;
			const contentChanged = title !== existingNote.title || normalizeNewlines(body) !== normalizeNewlines(existingNote.body);
			const serialized = serializeNote({
				id: existingNote.id,
				title,
				body,
				parentId: updates.parentId !== undefined ? updates.parentId : existingNote.parentId,
				createdTime: existingNote.createdTime,
				deletedTime: updates.deletedTime !== undefined ? updates.deletedTime : existingNote.deletedTime,
				isShared: updates.isShared !== undefined ? updates.isShared : (existingNote.isShared || false),
				shareId: updates.shareId !== undefined ? updates.shareId : (existingNote.shareId || ''),
				// Only a real title/body edit moves the user-visible "modified" time;
				// move / trash / restore / share changes leave it alone (Joplin semantics).
				userUpdatedTime: contentChanged ? Date.now() : preservedUserUpdatedTime(existingNote),
				fields: existingNote.fields,
			});
			await putSerializedItem(sessionId, serialized, requestContext);
			return { id: serialized.id };
		},

		async deleteNote(sessionId, noteId, requestContext) {
			await deleteItem(sessionId, notePath(noteId), requestContext);
		},

		async trashNote(sessionId, existingNote, requestContext) {
			return this.updateNote(sessionId, existingNote, { deletedTime: Date.now() }, requestContext);
		},

		async restoreNote(sessionId, existingNote, restoreParentId, requestContext) {
			return this.updateNote(sessionId, existingNote, { deletedTime: 0, parentId: restoreParentId }, requestContext);
		},

		async createResource(sessionId, resource, binaryBuffer, requestContext) {
			const serialized = serializeResource(resource);
			// Upload metadata .md first, then binary blob
			await putSerializedItem(sessionId, { id: serialized.id, path: serialized.metaPath, body: serialized.body }, requestContext);
			await putBinaryItem(sessionId, serialized.blobPath, binaryBuffer, resource.mime || 'application/octet-stream', requestContext);
			return { id: serialized.id };
		},

		async deleteResource(sessionId, resourceId, requestContext) {
			await deleteItem(sessionId, resourceMetaPath(resourceId), requestContext);
			await deleteItem(sessionId, resourceBlobPath(resourceId), requestContext);
		},
	};
};

module.exports = {
	createItemWriteService,
	assertNotE2ee,
	serializeFolder,
	serializeNote,
	serializeResource,
	requestUpstream,
};
