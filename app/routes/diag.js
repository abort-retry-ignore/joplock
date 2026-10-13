'use strict';

const { redirect } = require('./_helpers');

// GET /diag: device diagnostics page (see app/templates/diag.js). Debug mode only, and only for
// a signed-in user (its reports go through the authenticated /api/web/client-log endpoint).
// With debug off the route does not exist (falls through to the normal 404).
const handle = async (url, request, response, ctx) => {
	if (url.pathname !== '/diag' || request.method !== 'GET') return false;
	const { sendHtml, authenticatedUser, templates, isDebug } = ctx;
	if (!(typeof isDebug === 'function' ? isDebug() : ctx.debug)) return false;
	const auth = await authenticatedUser(request);
	if (auth.error || !auth.user) { redirect(response, '/login'); return true; }
	sendHtml(response, 200, templates.diagPage({ query: url.searchParams }));
	return true;
};

module.exports = { handle };
