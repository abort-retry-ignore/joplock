'use strict';

// One version string for every shipped static asset, computed from the files themselves so that
// nobody has to remember to bump it. It is the ?v= on the script/stylesheet URLs (which the server
// then serves as immutable), the service worker's cache name, and what app.js registers the
// worker with. Any change to a shipped file changes it; a restart of an unchanged deployment
// does not.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const defaultPublicDir = path.join(__dirname, '..', 'public');

// Hashed: every file directly in public/ (app.js, styles.css, icons, manifest, the service worker
// template, ...) plus TinyMCE's entry point. The rest of tinymce/ is vendor code its own loader
// requests; fonts and splash images change with the files above or not at all.
const computeAssetVersion = (publicDir = defaultPublicDir) => {
	const hash = crypto.createHash('sha1');
	let names = [];
	try {
		names = fs.readdirSync(publicDir).sort();
	} catch { /* a missing public dir hashes to the empty version */ }
	const files = names.map(name => path.join(publicDir, name));
	files.push(path.join(publicDir, 'tinymce', 'tinymce.min.js'));
	for (const file of files) {
		try {
			if (!fs.statSync(file).isFile()) continue;
			hash.update(path.relative(publicDir, file));
			hash.update('\0');
			hash.update(fs.readFileSync(file));
			hash.update('\0');
		} catch { /* unreadable file: skip */ }
	}
	return hash.digest('hex').slice(0, 10);
};

let cached = null;
const assetVersion = () => {
	if (!cached) cached = computeAssetVersion();
	return cached;
};

module.exports = { assetVersion, computeAssetVersion };
