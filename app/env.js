'use strict';

const normalizeEnvValue = value => {
	if (typeof value !== 'string') return '';
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
			return value.slice(1, -1);
		}
	}
	return value;
};

module.exports = { normalizeEnvValue };
