'use strict';

// Joplin item serialization, mirroring BaseItem.serialize / serialize_format from
// the Joplin client so what Joplock writes is indistinguishable from what a Joplin
// app writes.
//
// The important property is PASS-THROUGH. Joplock edits only a handful of fields
// (title, body, parent, deleted time, sharing, timestamps). Everything else an item
// carries - to-do state, author, location, markup language, `order`, plugin data,
// fields newer Joplin versions added - comes from the item as stored on the server
// (`fields`) and is written back unchanged. Rebuilding items from hard-coded
// values used to turn to-dos into plain notes, wipe metadata and flip HTML notes
// to markdown on every save.
//
// `defaults` only apply to keys an item does not carry (brand new items).

const MODEL_TYPE_NOTE = 1;
const MODEL_TYPE_FOLDER = 2;
const MODEL_TYPE_RESOURCE = 4;

// Canonical key order (Joplin serializes in table-column order). Keys an item has
// that are not listed here are written after these, before `type_`.
const NOTE_KEYS = [
	'id', 'parent_id', 'created_time', 'updated_time', 'is_conflict', 'latitude', 'longitude', 'altitude',
	'author', 'source_url', 'is_todo', 'todo_due', 'todo_completed', 'source', 'source_application',
	'application_data', 'order', 'user_created_time', 'user_updated_time', 'encryption_cipher_text',
	'encryption_applied', 'markup_language', 'is_shared', 'share_id', 'conflict_original_id', 'master_key_id',
	'user_data', 'deleted_time',
];

const FOLDER_KEYS = [
	'id', 'created_time', 'updated_time', 'user_created_time', 'user_updated_time', 'encryption_cipher_text',
	'encryption_applied', 'parent_id', 'is_shared', 'share_id', 'master_key_id', 'icon', 'user_data', 'deleted_time',
];

const RESOURCE_KEYS = [
	'id', 'mime', 'filename', 'created_time', 'updated_time', 'user_created_time', 'user_updated_time',
	'file_extension', 'encryption_cipher_text', 'encryption_applied', 'encryption_blob_encrypted', 'size',
	'is_shared', 'share_id', 'master_key_id', 'user_data', 'blob_updated_time', 'ocr_text', 'ocr_details',
	'ocr_status', 'ocr_error', 'ocr_driver_id',
];

const KEYS_BY_TYPE = {
	[MODEL_TYPE_NOTE]: NOTE_KEYS,
	[MODEL_TYPE_FOLDER]: FOLDER_KEYS,
	[MODEL_TYPE_RESOURCE]: RESOURCE_KEYS,
};

const TIME_KEYS = new Set(['created_time', 'updated_time', 'user_created_time', 'user_updated_time', 'sync_time', 'blob_updated_time']);

// Never emitted as ordinary props: written by the layout itself.
const LAYOUT_KEYS = new Set(['title', 'body', 'type_']);

// Time values arrive as ms numbers from the item JSON the server stores; accept
// numeric strings and ISO strings too so a value is never lost to a type quirk.
const formatTime = value => {
	if (!value) return '';
	let ms = value;
	if (typeof value === 'string') {
		ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
	}
	if (typeof ms !== 'number' || !Number.isFinite(ms)) return `${value}`;
	return new Date(ms).toISOString();
};

// Same escaping as BaseItem.serialize_format: a prop value must stay on one line.
const escapeProp = text => text
	.replace(/\\n/g, '\\\\n')
	.replace(/\\r/g, '\\\\r')
	.replace(/\n/g, '\\n')
	.replace(/\r/g, '\\r');

const formatValue = (key, value) => {
	if (TIME_KEYS.has(key)) return formatTime(value);
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return escapeProp(JSON.stringify(value));
	return escapeProp(`${value}`);
};

// type: MODEL_TYPE_*
// title/body: layout parts (body only for notes)
// fields: the item as stored (may be undefined for new items)
// defaults: values for keys the item does not carry
// overrides: the values Joplock owns for this write; they win over `fields`
const serializeItem = ({ type, title, body, fields, defaults = {}, overrides = {} }) => {
	const known = KEYS_BY_TYPE[type];
	const merged = { ...defaults, ...(fields || {}), ...overrides };

	const props = known.map(key => `${key}: ${formatValue(key, merged[key])}`);
	const knownSet = new Set(known);
	for (const key of Object.keys(merged)) {
		if (knownSet.has(key) || LAYOUT_KEYS.has(key)) continue;
		props.push(`${key}: ${formatValue(key, merged[key])}`);
	}
	props.push(`type_: ${type}`);

	const parts = [];
	parts.push(title === undefined || title === null ? '' : `${title}`);
	if (type === MODEL_TYPE_NOTE && body) parts.push(`${body}`);
	parts.push(props.join('\n'));
	return parts.join('\n\n');
};

module.exports = {
	MODEL_TYPE_NOTE,
	MODEL_TYPE_FOLDER,
	MODEL_TYPE_RESOURCE,
	NOTE_KEYS,
	FOLDER_KEYS,
	RESOURCE_KEYS,
	formatTime,
	formatValue,
	escapeProp,
	serializeItem,
};
