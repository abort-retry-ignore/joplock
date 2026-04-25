const parseCookies = cookieHeader => {
	if (!cookieHeader) return {};

	const output = {};
	for (const part of cookieHeader.split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const separatorIndex = trimmed.indexOf('=');
		if (separatorIndex < 0) continue;
		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed.slice(separatorIndex + 1).trim();
		if (!key) continue;
		output[key] = decodeURIComponent(value);
	}

	return output;
};

const sessionIdFromHeaders = (headers, cookieName = 'sessionId') => {
	const cookies = parseCookies(headers.cookie || '');
	return cookies[cookieName] || '';
};

module.exports = {
	parseCookies,
	sessionIdFromHeaders,
};
