// Client-side vault encryption for the seed scripts. Joplock encrypts vault notes in the browser and the
// server never sees a password, so seeding a vault means doing here what public/app.js does there:
// deriveKey, buildVaultVerify, encryptForVault and wrapCiphertext. The browser has to be able to unlock
// what this writes, so tests/seedVault.test.js pins every constant to public/app.js.
// Node 20+ (global WebCrypto), no dependencies.

export const PBKDF2_ITERATIONS = 210000;
export const ENCRYPTION_VERSION = 2;
export const VERIFY_PLAINTEXT = 'joplock_vault_check';
export const ENCRYPTED_START = '<!--joplock-encrypted-start-->';
export const ENCRYPTED_END = '<!--joplock-encrypted-end-->';
export const WRAPPER_HEAD = '> **🔒 This note is encrypted by Joplock**\n>\n> This note\'s content is encrypted and can only be viewed in Joplock.\n> Do not edit the data below — editing will permanently corrupt the encrypted content.\n\n';

const b64 = bytes => Buffer.from(bytes).toString('base64');
const unb64 = text => new Uint8Array(Buffer.from(text, 'base64'));

export const deriveVaultKey = async (password, salt) => {
	const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
	return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
};

// The check value stored beside the salt: decrypting it is how the browser tells a right password from a wrong one.
export const buildVerify = async key => {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(VERIFY_PLAINTEXT));
	return Buffer.from(JSON.stringify({ iv: b64(iv), ct: b64(ct) })).toString('base64');
};

export const checkVerify = async (key, verify) => {
	const { iv, ct } = JSON.parse(Buffer.from(verify, 'base64').toString('utf8'));
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
	return new TextDecoder().decode(plain) === VERIFY_PLAINTEXT;
};

// The note body Joplock stores: a readable notice plus the ciphertext. noteId binds it to one note.
export const encryptNoteBody = async ({ plaintext, vaultId, key, salt, noteId }) => {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
	const blob = { joplock_encrypted: 1, v: ENCRYPTION_VERSION, vault: vaultId, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
	if (noteId) blob.noteId = noteId;
	return `${WRAPPER_HEAD}${ENCRYPTED_START}\n${JSON.stringify(blob)}\n${ENCRYPTED_END}\n`;
};

export const decryptNoteBody = async (wrapped, key) => {
	const start = wrapped.indexOf(ENCRYPTED_START);
	const end = wrapped.indexOf(ENCRYPTED_END);
	if (start < 0 || end < start) throw new Error('no encrypted data in this body');
	const blob = JSON.parse(wrapped.slice(start + ENCRYPTED_START.length, end).trim());
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
	return new TextDecoder().decode(plain);
};

// Makes a top-level notebook into a vault. `api` is the client from seed-client.mjs.
export const createVaultNotebook = async (api, { title, password }) => {
	const folder = (await api.json('/api/web/folders', 'POST', { title, parentId: '' })).item;
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await deriveVaultKey(password, salt);
	await api.json('/api/web/vaults', 'POST', { folderId: folder.id, salt: b64(salt), verify: await buildVerify(key) });

	const encrypt = (plaintext, noteId) => encryptNoteBody({ plaintext, vaultId: folder.id, key, salt, noteId });
	return {
		folder,
		// Joplock refuses plaintext in a vault, and a note's id exists only once it is created. So the note
		// starts as an empty ciphertext and is rewritten with the real one, bound to its id like the browser's
		// own saves. The text is never stored unencrypted.
		addNote: async ({ title: noteTitle, body }) => {
			const created = (await api.json('/api/web/notes', 'POST', { title: noteTitle, body: await encrypt(''), parentId: folder.id })).item;
			return (await api.json(`/api/web/notes/${encodeURIComponent(created.id)}`, 'PUT', { title: noteTitle, body: await encrypt(body, created.id) })).item;
		},
	};
};
