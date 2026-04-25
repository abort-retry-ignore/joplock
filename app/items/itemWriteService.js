const http = require('http');
const { randomBytes } = require('crypto');

const notePath = noteId => `root:/${noteId}.md:`;
const folderPath = folderId => `root:/${folderId}.md:`;
const resourceMetaPath = resourceId => `root:/${resourceId}.md:`;
const resourceBlobPath = resourceId => `root:/.resource/${resourceId}:`;

const itemId = suffix => {
	const token = randomBytes(16).toString('hex').slice(0, 31);
	return `${token}${suffix}`;
};

const formatTimestamp = timestamp => new Date(timestamp).toISOString();

const serializeNote = note => {
	const now = Date.now();
	const noteId = note.id || itemId('1');
	const parentId = note.parentId || '';
	const createdTime = note.createdTime || now;
	const deletedTime = note.deletedTime || 0;

	return {
		id: noteId,
		path: notePath(noteId),
		body: `${note.title || 'Untitled note'}

${note.body || ''}

id: ${noteId}
parent_id: ${parentId}
created_time: ${formatTimestamp(createdTime)}
updated_time: ${formatTimestamp(now)}
is_conflict: 0
latitude: 0.00000000
longitude: 0.00000000
altitude: 0.0000
author: 
source_url: 
is_todo: 0
todo_due: 0
todo_completed: 0
source: joplock-web
source_application: net.cozic.joplock-web
application_data: 
order: 0
user_created_time: ${formatTimestamp(createdTime)}
user_updated_time: ${formatTimestamp(now)}
encryption_cipher_text: 
encryption_applied: 0
markup_language: 1
is_shared: 0
share_id: 
conflict_original_id: 
master_key_id: 
user_data: 
deleted_time: ${deletedTime}
type_: 1`,
	};
};

const serializeFolder = folder => {
	const now = Date.now();
	const folderId = folder.id || itemId('2');
	const parentId = folder.parentId || '';

	return {
		id: folderId,
		path: folderPath(folderId),
		body: `${folder.title || 'Untitled folder'}

id: ${folderId}
created_time: ${formatTimestamp(now)}
updated_time: ${formatTimestamp(now)}
user_created_time: ${formatTimestamp(now)}
user_updated_time: ${formatTimestamp(now)}
encryption_cipher_text:
encryption_applied: 0
parent_id: ${parentId}
is_shared: 0
share_id: 
user_data: 
type_: 2`,
	};
};

const serializeResource = resource => {
	const now = Date.now();
	const resourceId = resource.id || itemId('4');
	const mime = resource.mime || 'application/octet-stream';
	const filename = resource.filename || '';
	const fileExtension = resource.fileExtension || '';
	const size = resource.size || 0;

	return {
		id: resourceId,
		metaPath: resourceMetaPath(resourceId),
		blobPath: resourceBlobPath(resourceId),
		body: `${resource.title || filename || 'Untitled resource'}

id: ${resourceId}
mime: ${mime}
filename: ${filename}
created_time: ${formatTimestamp(now)}
updated_time: ${formatTimestamp(now)}
user_created_time: ${formatTimestamp(now)}
user_updated_time: ${formatTimestamp(now)}
file_extension: ${fileExtension}
encryption_cipher_text: 
encryption_applied: 0
encryption_blob_encrypted: 0
size: ${size}
is_shared: 0
share_id: 
master_key_id: 
user_data: 
blob_updated_time: ${formatTimestamp(now)}
type_: 4`,
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
			const serialized = serializeFolder({
				id: existingFolder.id,
				title: updates.title !== undefined ? updates.title : existingFolder.title,
				parentId: updates.parentId !== undefined ? updates.parentId : existingFolder.parentId,
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
			const serialized = serializeNote({
				id: existingNote.id,
				title: updates.title !== undefined ? updates.title : existingNote.title,
				body: updates.body !== undefined ? updates.body : existingNote.body,
				parentId: updates.parentId !== undefined ? updates.parentId : existingNote.parentId,
				createdTime: existingNote.createdTime,
				deletedTime: updates.deletedTime !== undefined ? updates.deletedTime : existingNote.deletedTime,
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
	};
};

module.exports = {
	createItemWriteService,
	serializeFolder,
	serializeNote,
	serializeResource,
};
