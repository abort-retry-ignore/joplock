'use strict';

// <meta name="theme-color"> per theme, read from the same --theme-color custom properties the
// stylesheet declares (app.js syncThemeColor() applies them at runtime). The server uses this so
// the first paint of the status bar / title bar already matches the user's theme instead of a
// fixed green until JavaScript runs.

const fs = require('fs');
const path = require('path');

const DEFAULT_THEME = 'earth';
const defaultStylesPath = path.join(__dirname, '..', 'public', 'styles.css');

const parseThemeColors = css => {
	const colors = {};
	for (const match of `${css}`.matchAll(/^\.theme-([a-z0-9-]+)\s*\{([^}]*)\}/gm)) {
		const color = /--theme-color:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(match[2]);
		if (color) colors[match[1]] = color[1].toLowerCase();
	}
	return colors;
};

let cached = null;
const loadThemeColors = (stylesPath = defaultStylesPath) => {
	try {
		return parseThemeColors(fs.readFileSync(stylesPath, 'utf8'));
	} catch {
		return {};
	}
};

const themeColor = theme => {
	if (!cached) cached = loadThemeColors();
	return cached[theme] || cached[DEFAULT_THEME] || '#1e1a12';
};

module.exports = { themeColor, parseThemeColors, loadThemeColors, DEFAULT_THEME };
