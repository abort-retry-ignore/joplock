'use strict';

const { sendJson, parseBody, normalizeStoredFolderId, assertVaultNoteBodyEncrypted } = require('./_helpers');
const templates = require('../templates');
const { AI_PROVIDERS } = require('../settingsService');

const notesForFolder = async (itemService, userId, folderId) => {
	const { VIRTUAL_ALL_NOTES_ID, VIRTUAL_TRASH_ID } = require('../items/itemService');
	const ALL_NOTES_FOLDER_ID = '__all_notes__';
	const TRASH_FOLDER_ID = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';
	if (!folderId || folderId === ALL_NOTES_FOLDER_ID) return itemService.notesByUserId(userId);
	if (folderId === TRASH_FOLDER_ID) return itemService.notesByUserId(userId, { deleted: 'only' });
	return itemService.notesByUserId(userId, { folderId });
};

const moveFolderNotesToGeneral = async (userId, sessionId, folderId, itemService, itemWriteService, requestContext) => {
	const sourceFolder = await itemService.folderByUserIdAndJopId(userId, folderId);
	if (!sourceFolder) {
		const error = new Error('Notebook not found');
		error.statusCode = 404;
		throw error;
	}
	let generalFolder = (await itemService.foldersByUserId(userId)).find(f => !f.deletedTime && f.id !== folderId && f.title === 'General');
	if (!generalFolder) {
		const created = await itemWriteService.createFolder(sessionId, { title: 'General', parentId: '' }, requestContext);
		generalFolder = { id: created.id, title: 'General' };
	}
	const notes = await itemService.notesByUserId(userId, { folderId });
	for (const note of notes) {
		await itemWriteService.updateNote(sessionId, note, { parentId: generalFolder.id }, requestContext);
	}
	return { sourceFolder, generalFolder, movedCount: notes.length };
};

const handle = async (url, request, response, ctx) => {
	const { authenticatedUser, itemService, itemWriteService, settingsService, upstreamRequestContext, plainNoteTitle, vaultService } = ctx;
	const normalizeOpenRouterModel = model => `${model || ''}`.trim().replace(/^x-ai\/grok-4-20(?=$|-)/, 'x-ai/grok-4.20');
	const proseDebugEnabled = `${process.env.DEBUG || ''}`.toLowerCase() === 'true';
	const getActiveProfileFromSettings = (settings, profileId = '') => {
		if (Array.isArray(settings.aiProfiles) && settings.aiProfiles.length > 0) {
			const requested = `${profileId || ''}`.trim();
			const active = (requested ? settings.aiProfiles.find(p => p.id === requested && p.apiKey) : null) || settings.aiProfiles.find(p => p.active && p.apiKey) || settings.aiProfiles.find(p => p.apiKey);
			if (active) {
				const provider = AI_PROVIDERS.find(p => p.id === active.providerId);
				const url = (active.url || (provider && provider.url) || '').trim();
				const model = (active.model || (provider && provider.defaultModel) || 'openai/gpt-4o-mini').trim();
				const temperature = Number.isFinite(Number(active.temperature)) ? Math.max(0, Math.min(2, Number(active.temperature))) : 0.7;
				if (url) return { url, apiKey: active.apiKey.trim(), model, temperature, profileId: active.id };
			}
		}
		// Fallback to legacy openRouter settings
		return {
			url: 'https://openrouter.ai/api/v1/chat/completions',
			apiKey: `${settings.openRouterApiKey || ''}`.trim(),
			model: normalizeOpenRouterModel(settings.openRouterModel) || 'openai/gpt-4o-mini',
			temperature: 0.7,
			profileId: 'legacy-openrouter',
		};
	};
	const extractProseInstructions = prompt => {
		const instructions = [];
		const body = `${prompt || ''}`.replace(/(^|\n)[ \t]*#![ \t]*(.*)(?=\n|$)/g, (match, lineStart, instruction) => {
			const text = `${instruction || ''}`.trim();
			if (text) instructions.push(text);
			return lineStart;
		});
		return { body, instructions };
	};
	const normalizeAutocompleteToken = value => `${value || ''}`
		.toLowerCase()
		.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
		.replace(/\u00a0/g, ' ')
		.replace(/[\u2018\u2019\u2032]/g, "'")
		.replace(/[\u201c\u201d\u2033]/g, '"')
		.replace(/[\u2013\u2014]/g, '-')
		.trim();
	const inferProseStyle = promptContext => {
		const instructionsText = (promptContext.instructions || []).join(' ').toLowerCase();
		const bodyText = `${promptContext.body || ''}`.toLowerCase();
		if (/(technical|documentation|document|solution architect|architecture|reference|spec|specification|api|aws|cloud|s3|terraform|kubernetes)/.test(instructionsText)) {
			return {
				mode: 'technical',
				guidance: 'Write like concise technical documentation: factual, precise, non-fictional, and directly useful. Prefer clear statements over flourish. Avoid scene-setting, emotional language, storytelling cadence, and generic inspirational prose. Start immediately with the next word.',
			};
		}
		if (/(story|fiction|narrative|novel|chapter|scene|character|plot|fantasy|dialogue)/.test(instructionsText)) {
			return {
				mode: 'story',
				guidance: 'Write like narrative prose that continues the story naturally, preserving viewpoint, pacing, and voice.',
			};
		}
		if (/(api|sdk|endpoint|configuration|infrastructure|architecture|latency|throughput|consistency|durability|availability|bucket|object storage|iam|vpc|ec2|lambda|database|schema|service)/.test(bodyText)) {
			return {
				mode: 'technical',
				guidance: 'Write like concise technical documentation: factual, precise, non-fictional, and directly useful. Prefer clear statements over flourish. Avoid scene-setting, emotional language, storytelling cadence, and generic inspirational prose. Start immediately with the next word.',
			};
		}
		if (/(chapter|character|dialogue|she said|he said|they said|once|suddenly|meanwhile|looked at|walked toward)/.test(bodyText)) {
			return {
				mode: 'story',
				guidance: 'Write like narrative prose that continues the story naturally, preserving viewpoint, pacing, and voice. Start immediately with the next word.',
			};
		}
		return {
			mode: 'general',
			guidance: 'Continue in the same style, purpose, and level of formality already present in the note. Start immediately with the next word.',
		};
	};
	const buildProseRoleInstruction = (promptContext, proseStyle) => {
		if ((promptContext.instructions || []).length) return promptContext.instructions.join('\n');
		return `You continue notes by writing the next text in the same kind of document already being written. Match the note's existing genre, purpose, tone, audience, structure, and level of technical detail. If the note reads like a story, continue the story. If it reads like technical documentation, continue it as technical documentation. ${proseStyle.guidance}`;
	};
	const buildProseCompletionInstruction = (sentenceCount, sentenceWord) => `Continue the note from its exact ending, preserving the meaning of the final unfinished fragment if there is one. Return only the new text to append after the current final character, with no quotes, bullets, headings, preamble, or explanation unless the note itself is already using that structure at the cursor. Do not repeat or include any text that is already present in the note. Do not repeat words or phrases back-to-back. Do not return a single word or phrase. Write exactly ${sentenceCount} complete ${sentenceWord} total from this point. If the note ends mid-sentence, complete that current sentence and count it as the first sentence. Stop immediately after the ${sentenceWord}. Use proper ending punctuation.`;
	const previewText = value => `${value || ''}`.replace(/\s+/g, ' ').trim().slice(0, 220);
	const trimRepeatedPromptSuffix = (prompt, completion) => {
		const promptText = `${prompt || ''}`;
		const completionText = `${completion || ''}`.trim();
		const promptChars = Array.from(promptText);
		const completionChars = Array.from(completionText);
		const maxChars = Math.min(promptChars.length, completionChars.length, 120);
		for (let count = maxChars; count >= 3; count--) {
			const promptSuffix = normalizeAutocompleteToken(promptChars.slice(-count).join(''));
			const completionPrefix = normalizeAutocompleteToken(completionChars.slice(0, count).join(''));
			if (!promptSuffix || promptSuffix !== completionPrefix) continue;
			return completionChars.slice(count).join('').trimStart();
		}
		const promptWords = promptText.match(/\S+/g) || [];
		const completionWords = completionText.match(/\S+/g) || [];
		const maxWords = Math.min(promptWords.length, completionWords.length, 16);
		for (let count = maxWords; count >= 1; count--) {
			const promptSuffix = normalizeAutocompleteToken(promptWords.slice(-count).join(' '));
			const completionPrefix = normalizeAutocompleteToken(completionWords.slice(0, count).join(' '));
			if (promptSuffix !== completionPrefix) continue;
			let idx = 0;
			for (let i = 0; i < count; i++) {
				const found = completionText.indexOf(completionWords[i], idx);
				if (found === -1) return completionText;
				idx = found + completionWords[i].length;
			}
			return completionText.slice(idx).trimStart();
		}
		return completionText;
	};
	const collapseAdjacentRepeatedPhrases = text => {
		const current = `${text || ''}`.trim();
		const words = current.match(/\S+/g) || [];
		for (let count = 6; count >= 2; count--) {
			if (words.length < count * 2) continue;
			const first = words.slice(0, count).map(normalizeAutocompleteToken).join(' ');
			const second = words.slice(count, count * 2).map(normalizeAutocompleteToken).join(' ');
			if (first !== second) continue;
			let idx = 0;
			for (let i = 0; i < count; i++) {
				const found = current.indexOf(words[i], idx);
				if (found === -1) return current;
				idx = found + words[i].length;
			}
			let secondIdx = idx;
			for (let i = count; i < count * 2; i++) {
				const found = current.indexOf(words[i], secondIdx);
				if (found === -1) return current;
				secondIdx = found + words[i].length;
			}
			return `${current.slice(0, idx)}${current.slice(secondIdx)}`.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
		}
		return current;
	};
	const stripJoplinAttachments = text => `${text || ''}`
		.replace(/!?\[[^\]]*\]\(:\/[0-9a-f]{10,}\)/gi, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	const trimToCompleteSentenceEnd = text => {
		const current = `${text || ''}`.trim();
		if (!current) return '';
		if (/[.!?](?:["')\]]+)?$/.test(current)) return current;
		const words = current.match(/\b[\p{L}'’-]+\b/gu) || [];
		const lastWord = words.length ? words[words.length - 1].toLowerCase() : '';
		const likelyIncompleteTailWords = new Set(['a', 'an', 'and', 'as', 'at', 'because', 'before', 'between', 'but', 'by', 'for', 'from', 'if', 'in', 'into', 'of', 'on', 'or', 'since', 'so', 'than', 'that', 'the', 'then', 'through', 'to', 'under', 'until', 'when', 'where', 'which', 'while', 'with', 'without']);
		if (!likelyIncompleteTailWords.has(lastWord) && /[\p{L}\d"')\]]$/u.test(current)) return `${current}.`;
		const matches = Array.from(current.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g));
		if (!matches.length) return '';
		const last = matches[matches.length - 1];
		return current.slice(0, last.index + last[0].length).trim();
	};
	const trimToSentenceCount = (text, sentenceCount) => {
		const current = trimToCompleteSentenceEnd(text);
		if (!current || sentenceCount < 1) return current;
		const matches = Array.from(current.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g));
		if (matches.length <= sentenceCount) return current;
		const last = matches[sentenceCount - 1];
		return current.slice(0, last.index + last[0].length).trim();
	};

	// POST /api/web/client-log
	if (url.pathname === '/api/web/client-log' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) { response.writeHead(401); response.end(); return true; }
			const body = await parseBody(request);
			const event = `${body.event || ''}`.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80) || 'client-log';
			let data = {};
			try { data = JSON.parse(`${body.data || '{}'}`); } catch { data = {}; }
			const safe = {};
			for (const [key, value] of Object.entries(data || {})) {
				if (/text|body|content|password|key|secret|token/i.test(key)) continue;
				if (typeof value === 'string') safe[key] = value.slice(0, 120);
				else if (typeof value === 'number' || typeof value === 'boolean' || value === null) safe[key] = value;
			}
			console.info('[joplock client]', event, { userId: auth.user.id, ua: (request.headers['user-agent'] || '').slice(0, 160), ...safe });
			response.writeHead(204);
			response.end();
		} catch {
			response.writeHead(500);
			response.end();
		}
		return true;
	}

	// PUT /api/web/settings
	if (url.pathname === '/api/web/settings' && request.method === 'PUT') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) { response.writeHead(401); response.end(); return true; }
			const body = await parseBody(request);
			const current = await settingsService.settingsByUserId(auth.user.id);
			const updates = {};
			const allowedKeys = ['theme', 'noteFontSize', 'mobileNoteFontSize', 'codeFontSize', 'noteMonospace', 'noteOpenMode', 'resumeLastNote', 'dateFormat', 'datetimeFormat', 'liveSearch', 'confirmTrash', 'encryptionAutoLockMinutes', 'uiMode', 'proseAutocompleteSentenceCount', 'openRouterApiKey', 'openRouterModel', 'aiProfiles', 'textExpanders'];
			for (const key of allowedKeys) {
				if (body[key] !== undefined) updates[key] = body[key];
			}
			if (Object.keys(updates).length > 0) {
				await settingsService.saveSettings(auth.user.id, { ...current, ...updates });
			}
			response.writeHead(204);
			response.end();
		} catch {
			response.writeHead(500);
			response.end();
		}
		return true;
	}

	// PUT /api/web/theme (legacy)
	if (url.pathname === '/api/web/theme' && request.method === 'PUT') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) { response.writeHead(401); response.end(); return true; }
			const body = await parseBody(request);
			const current = await settingsService.settingsByUserId(auth.user.id);
			await settingsService.saveSettings(auth.user.id, { ...current, theme: body.theme });
			response.writeHead(204);
			response.end();
		} catch {
			response.writeHead(500);
			response.end();
		}
		return true;
	}

	// GET /api/web/me
	if (url.pathname === '/api/web/me') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			sendJson(response, 200, { user: auth.user });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// /api/web/folders
	if (url.pathname === '/api/web/folders') {
		if (request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				const body = await parseBody(request);
				const title = `${body.title || ''}`.trim();
				if (!title) { sendJson(response, 400, { error: 'Folder title is required' }); return true; }
				const created = await itemWriteService.createFolder(auth.user.sessionId, { title, parentId: body.parentId || '' }, upstreamRequestContext(request));
				const folder = await itemService.folderByUserIdAndJopId(auth.user.id, created.id);
				sendJson(response, 201, { item: folder });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folders = await itemService.foldersByUserId(auth.user.id);
			sendJson(response, 200, { items: folders });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// DELETE /api/web/folders/:id
	if (url.pathname.startsWith('/api/web/folders/') && request.method === 'DELETE') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folderId = decodeURIComponent(url.pathname.slice('/api/web/folders/'.length));
			if (!folderId) { sendJson(response, 404, { error: 'Folder not found' }); return true; }
			await moveFolderNotesToGeneral(auth.user.id, auth.user.sessionId, folderId, itemService, itemWriteService, upstreamRequestContext(request));
			await itemWriteService.deleteFolder(auth.user.sessionId, folderId, upstreamRequestContext(request));
			sendJson(response, 204, {});
		} catch (error) {
			sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// GET /api/web/notes/headers
	if (url.pathname === '/api/web/notes/headers' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const headers = await itemService.noteHeadersByUserId(auth.user.id);
			const minimalHeaders = headers.map(h => ({ id: h.id, title: h.title }));
			sendJson(response, 200, { items: minimalHeaders });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// GET /api/web/notes/:id/freshness — cheap probe used by cross-browser
	// sync polling. Returns {updatedTime, deletedTime} or 404 if the note no
	// longer exists. Uses isHeartbeat:true so polling does not reset the
	// session activity timer.
	{
		const freshnessMatch = url.pathname.match(/^\/api\/web\/notes\/([0-9a-zA-Z]{32})\/freshness$/);
		if (freshnessMatch && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request, { isHeartbeat: true });
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				const freshness = await itemService.noteFreshnessByUserIdAndJopId(auth.user.id, freshnessMatch[1]);
				if (!freshness) { sendJson(response, 404, { error: 'Not found' }); return true; }
				sendJson(response, 200, freshness);
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return true;
		}
	}

	// POST /api/web/ai/prose-complete
	if (url.pathname === '/api/web/ai/prose-complete' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) { sendJson(response, 401, { error: auth.error || 'Unauthorized' }); return true; }
			const body = await parseBody(request);
			const settings = await settingsService.settingsByUserId(auth.user.id);
			const activeProfile = getActiveProfileFromSettings(settings, body.profileId);
			const apiKey = activeProfile.apiKey;
			const model = normalizeOpenRouterModel(activeProfile.model) || 'openai/gpt-4o-mini';
			const temperature = Number.isFinite(Number(activeProfile.temperature)) ? Math.max(0, Math.min(2, Number(activeProfile.temperature))) : 0.7;
			const providerUrl = activeProfile.url;
			const prompt = `${body.prompt || ''}`;
			const promptContext = extractProseInstructions(prompt);
			const cleanBody = stripJoplinAttachments(promptContext.body);
			const contextChars = cleanBody.length;
			const proseStyle = inferProseStyle(promptContext);
			const sentenceCount = Math.max(1, Math.min(8, Number.parseInt(`${settings.proseAutocompleteSentenceCount || 1}`, 10) || 1));
			const sentenceWord = sentenceCount === 1 ? 'sentence' : 'sentences';
			const roleInstruction = buildProseRoleInstruction(promptContext, proseStyle);
			const completionInstruction = buildProseCompletionInstruction(sentenceCount, sentenceWord);
			if (!apiKey) { sendJson(response, 400, { error: 'No AI provider API key is configured. Set one in Settings → AI.' }); return true; }
			if (!cleanBody) { sendJson(response, 400, { error: 'Prompt is required' }); return true; }
			if (proseDebugEnabled) {
				console.info('[joplock] prose autocomplete context', JSON.stringify({
					model,
					sentenceCount,
					temperature,
					style: proseStyle.mode,
					contextChars,
					instructions: promptContext.instructions,
					bodyPreview: previewText(cleanBody),
				}));
			}
			const payload = {
				model,
				messages: [
					{ role: 'system', content: roleInstruction },
					{ role: 'system', content: completionInstruction },
					{ role: 'user', content: `NOTE BODY:\n${cleanBody}` },
				],
				temperature,
				frequency_penalty: 0.4,
				presence_penalty: 0.2,
				max_tokens: Math.max(16, sentenceCount * 32),
			};
			const upstream = await fetch(providerUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
					'HTTP-Referer': `${request.headers.origin || ''}`,
					'X-Title': 'Joplock',
				},
				body: JSON.stringify(payload),
			});
			if (!upstream.ok) {
				const errorText = await upstream.text().catch(() => '');
				const providerError = errorText.slice(0, 2000);
				console.warn('[joplock] AI prose completion failed', upstream.status, providerError);
				let errorMessage = errorText;
				try {
					const parsedError = JSON.parse(errorText);
					errorMessage = parsedError && parsedError.error && parsedError.error.message ? parsedError.error.message : errorMessage;
				} catch (_) {}
				sendJson(response, upstream.status, { error: errorMessage || `AI provider request failed (${upstream.status})`, providerStatus: upstream.status, providerError, contextChars });
				return true;
			}
			const data = await upstream.json();
			const choice = data && data.choices && data.choices[0] ? data.choices[0] : null;
			const text = choice && choice.message && choice.message.content ? `${choice.message.content}` : '';
			const suffixTrimmedText = trimRepeatedPromptSuffix(cleanBody, text);
			const repeatedPhraseTrimmedText = collapseAdjacentRepeatedPhrases(suffixTrimmedText);
			const trimmedText = trimToSentenceCount(repeatedPhraseTrimmedText, sentenceCount);
			let emptyReason = '';
			if (!trimmedText) {
				if (!`${text || ''}`.trim()) emptyReason = 'provider-empty';
				else if (!suffixTrimmedText) emptyReason = 'provider-repeated-existing-text';
				else emptyReason = 'trimmed-no-complete-sentence';
			}
			if (proseDebugEnabled) {
				console.info('[joplock] prose autocomplete result', JSON.stringify({
					style: proseStyle.mode,
					rawPreview: previewText(text),
					trimmedPreview: previewText(trimmedText),
					trimmedRepeatedPrefix: trimmedText !== `${text || ''}`.trim(),
					emptyReason,
				}));
			}
			sendJson(response, 200, {
				text: trimmedText,
				contextChars,
				...(emptyReason ? {
					emptyReason,
					rawChars: `${text || ''}`.trim().length,
					suffixTrimmedChars: suffixTrimmedText.length,
					trimmedChars: trimmedText.length,
					finishReason: choice && choice.finish_reason ? `${choice.finish_reason}` : '',
				} : {}),
			});
		} catch (error) {
			sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// POST /api/web/ai/test-profile
	if (url.pathname === '/api/web/ai/test-profile' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) { sendJson(response, 401, { error: auth.error || 'Unauthorized' }); return true; }
			const body = await parseBody(request);
			const profileId = `${body.profileId || ''}`.trim();
			const settings = await settingsService.settingsByUserId(auth.user.id);
			let profile = null;
			if (profileId && Array.isArray(settings.aiProfiles)) {
				const found = settings.aiProfiles.find(p => p.id === profileId);
				if (found) {
					const provider = AI_PROVIDERS.find(p => p.id === found.providerId);
					const profileUrl = (found.url || (provider && provider.url) || '').trim();
					const model = (found.model || (provider && provider.defaultModel) || 'openai/gpt-4o-mini').trim();
					if (profileUrl && found.apiKey) profile = { url: profileUrl, apiKey: found.apiKey, model };
				}
			}
			if (!profile) {
				const active = getActiveProfileFromSettings(settings);
				if (active.apiKey) profile = { url: active.url, apiKey: active.apiKey, model: active.model };
			}
			if (!profile || !profile.apiKey) { sendJson(response, 400, { error: 'No API key configured for this profile' }); return true; }
			const testPayload = {
				model: normalizeOpenRouterModel(profile.model) || 'openai/gpt-4o-mini',
				messages: [{ role: 'user', content: 'Complete this sequence with only the next word, nothing else: one, two,' }],
				temperature: 0,
				max_tokens: 16,
			};
			const t0 = Date.now();
			const testUpstream = await fetch(profile.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${profile.apiKey}`,
					'HTTP-Referer': `${request.headers.origin || ''}`,
					'X-Title': 'Joplock',
				},
				body: JSON.stringify(testPayload),
			});
			const ms = Date.now() - t0;
			if (!testUpstream.ok) {
				const errText = await testUpstream.text().catch(() => '');
				const providerError = errText.slice(0, 2000);
				console.warn('[joplock] AI profile test failed', testUpstream.status, providerError);
				let errMsg = errText;
				try { const parsed = JSON.parse(errText); errMsg = (parsed && parsed.error && parsed.error.message) || errMsg; } catch (_) {}
				sendJson(response, 200, { ok: false, response: errMsg.slice(0, 200), providerStatus: testUpstream.status, providerError, ms });
				return true;
			}
			const testData = await testUpstream.json();
			const testText = testData && testData.choices && testData.choices[0] && testData.choices[0].message ? `${testData.choices[0].message.content || ''}`.trim() : '';
			const ok = /three/i.test(testText);
			sendJson(response, 200, { ok, response: testText.slice(0, 200), ms });
		} catch (error) {
			sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// /api/web/notes
	if (url.pathname === '/api/web/notes') {
		if (request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				const body = await parseBody(request);
				const parentId = `${body.parentId || ''}`;
				if (!parentId) { sendJson(response, 400, { error: 'Note parentId is required' }); return true; }
				await assertVaultNoteBodyEncrypted(vaultService, auth.user.id, '', parentId, body.body);
				const created = await itemWriteService.createNote(auth.user.sessionId, {
					title: plainNoteTitle(body.title),
					body: `${body.body || ''}`,
					parentId,
				}, upstreamRequestContext(request));
				const note = await itemService.noteByUserIdAndJopId(auth.user.id, created.id);
				sendJson(response, 201, { item: note });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folderId = url.searchParams.get('folderId') || '';
			const notes = await notesForFolder(itemService, auth.user.id, folderId);
			sendJson(response, 200, { items: notes });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// /api/web/notes/:id
	if (url.pathname.startsWith('/api/web/notes/')) {
		const noteId = decodeURIComponent(url.pathname.slice('/api/web/notes/'.length));
		if (request.method === 'PUT') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return true; }
				const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!existing) { sendJson(response, 404, { error: 'Note not found' }); return true; }
				const body = await parseBody(request);
				await assertVaultNoteBodyEncrypted(vaultService, auth.user.id, existing.parentId, body.parentId !== undefined ? body.parentId : existing.parentId, body.body);
				const updated = await itemWriteService.updateNote(auth.user.sessionId, existing, {
					title: plainNoteTitle(body.title), body: body.body, parentId: body.parentId,
				}, upstreamRequestContext(request));
				const note = await itemService.noteByUserIdAndJopId(auth.user.id, updated.id);
				sendJson(response, 200, { item: note });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		if (request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
				if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return true; }
				await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
				sendJson(response, 204, {});
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return true;
		}
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return true; }
			const note = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
			if (!note) { sendJson(response, 404, { error: 'Note not found' }); return true; }
			sendJson(response, 200, { item: note });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// --- Vault API ---

	// GET /api/web/vaults — list vaults for current user
	if (url.pathname === '/api/web/vaults' && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			if (!vaultService) { sendJson(response, 200, { items: [] }); return true; }
			const vaults = await vaultService.getVaultsByUserId(auth.user.id);
			// Return folderId, salt, createdAt — no verify blob in list response
			sendJson(response, 200, { items: vaults.map(v => ({ folderId: v.folderId, salt: v.salt, createdAt: v.createdAt })) });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// GET /api/web/vaults/:folderId — get single vault (salt + verify for unlock)
	if (url.pathname.startsWith('/api/web/vaults/') && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folderId = decodeURIComponent(url.pathname.slice('/api/web/vaults/'.length));
			if (!folderId) { sendJson(response, 404, { error: 'Vault not found' }); return true; }
			if (!vaultService) { sendJson(response, 404, { error: 'Vault not found' }); return true; }
			const vault = await vaultService.getVaultByFolderId(auth.user.id, folderId);
			if (!vault) { sendJson(response, 404, { error: 'Vault not found' }); return true; }
			sendJson(response, 200, { item: { folderId: vault.folderId, salt: vault.salt, verify: vault.verify, createdAt: vault.createdAt } });
		} catch (error) {
			sendJson(response, 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// POST /api/web/vaults — create vault
	if (url.pathname === '/api/web/vaults' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const body = await parseBody(request);
			const { folderId, salt, verify } = body;
			if (!folderId || !salt || !verify) { sendJson(response, 400, { error: 'folderId, salt, and verify are required' }); return true; }
			// Verify folder belongs to this user
			const folder = await itemService.folderByUserIdAndJopId(auth.user.id, folderId);
			if (!folder) { sendJson(response, 404, { error: 'Folder not found' }); return true; }
			if (!vaultService) { sendJson(response, 503, { error: 'Vault service unavailable' }); return true; }
			await vaultService.createVault(auth.user.id, folderId, salt, verify);
			sendJson(response, 201, { item: { folderId, salt } });
		} catch (error) {
			sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
		}
		return true;
	}

	// DELETE /api/web/vaults/:folderId — remove vault metadata
	if (url.pathname.startsWith('/api/web/vaults/') && request.method === 'DELETE') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: auth.error }); return true; }
			const folderId = decodeURIComponent(url.pathname.slice('/api/web/vaults/'.length));
			if (!folderId) { sendJson(response, 404, { error: 'Vault not found' }); return true; }
			if (!vaultService) { sendJson(response, 503, { error: 'Vault service unavailable' }); return true; }
			await vaultService.deleteVault(auth.user.id, folderId);
			sendJson(response, 204, {});
		} catch (error) {
			sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
		}
		return true;
	}

	return false;
};

module.exports = { handle };
