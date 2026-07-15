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
			const allowedKeys = ['theme', 'noteFontSize', 'mobileNoteFontSize', 'codeFontSize', 'markdownFontSize', 'noteMonospace', 'noteFontFamily', 'newlineBehavior', 'noteOpenMode', 'resumeLastNote', 'dateFormat', 'datetimeFormat', 'liveSearch', 'highlightActiveLine', 'confirmTrash', 'encryptionAutoLockMinutes', 'uiMode', 'proseAutocompleteSentenceCount', 'openRouterApiKey', 'openRouterModel', 'aiProfiles', 'textExpanders'];
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
			const minimalHeaders = headers.map(h => ({ id: h.id, title: h.title, parentId: h.parentId }));
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

// ---------------------------------------------------------------------------
// Server-side export handlers (DOCX and PDF via pandoc)
// ---------------------------------------------------------------------------

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { renderMarkdown } = require('../markdownRenderer');

const STYLES_CSS = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

// Extract complete top-level CSS rule blocks (selector text + braces body)
// where at least one comma-separated selector in the block starts with one
// of the given prefixes. Selectors may span multiple lines (e.g.
// ".editor-preview h1, .editor-preview h2 {"). This is a character-level
// brace-depth scanner — not a full CSS parser, but robust to comments,
// multi-line selectors, and nested @media blocks (matched as a single block).
const extractCssBlocks = (css, prefixes) => {
	// Strip comments first so `/* ... { ... } ... */` can't confuse brace counting.
	const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const out = [];
	let i = 0;
	const n = stripped.length;
	while (i < n) {
		const braceIdx = stripped.indexOf('{', i);
		if (braceIdx === -1) break;
		const selectorText = stripped.slice(i, braceIdx);
		// Find the matching closing brace via depth counting from braceIdx.
		let depth = 0;
		let j = braceIdx;
		for (; j < n; j++) {
			if (stripped[j] === '{') depth++;
			else if (stripped[j] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		const blockEnd = j < n ? j + 1 : n;
		const selectors = selectorText.split(',').map(s => s.trim()).filter(Boolean);
		const matches = selectors.some(sel => prefixes.some(p =>
			sel === p || sel.startsWith(p + ' ') || sel.startsWith(p + '[') ||
			sel.startsWith(p + ':') || sel.startsWith(p + '.') || sel.startsWith(p + '>')
		));
		if (matches) {
			out.push(`${selectorText.trim()} ${stripped.slice(braceIdx, blockEnd)}`.trim());
		}
		i = blockEnd;
	}
	return out.join('\n\n');
};

// Minimal base CSS for standalone HTML export — resets + body sizing that
// isn't already covered by the extracted theme/.editor-preview blocks.
const HTML_EXPORT_BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--bg); color: var(--text); }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}
`;

// Overrides applied AFTER the extracted .editor-preview CSS so they win the
// cascade. These mirror the TinyMCE rendered-mode content styles built by
// _tinyMCEContentFontStyle() in public/app.js — that live editor view (not
// the read-only .editor-preview rules in styles.css) is what users actually
// see while writing/reading a note, so the exported HTML should match it:
// headings and links share the theme's accent color, not --text-heading.
const HTML_EXPORT_PARITY_CSS = `
.editor-preview h1, .editor-preview h2, .editor-preview h3,
.editor-preview h4, .editor-preview h5, .editor-preview h6 { color: var(--accent); }
.editor-preview strong { color: var(--text-heading); }
.editor-preview a { color: var(--accent); }
.editor-preview blockquote { border-left: 3px solid var(--accent); color: var(--text-dim); }
.editor-preview th, .editor-preview td { border: 3px solid var(--border); }
.editor-preview th { background: var(--bg-hover); font-weight: bold; }
.editor-preview .md-checkbox::before { border-color: var(--accent); }
.editor-preview .md-checkbox.checked::before { background: var(--accent); border-color: var(--accent); }
`;

// Strip resource download links — href="/resources/<id>?download=1" is meaningless
// in an exported document (DOCX, PDF). Keep the visible link text, remove the anchor
// so it renders as plain text. Handles bare "resources/", "/resources/", and
// absolute "https://host/resources/" href forms (TinyMCE emits any of these).
const stripResourceLinks = (html) =>
	html.replace(/<a\b[^>]*\bhref="(?:https?:\/\/[^"]*)?\/?resources\/[0-9a-fA-F]{32}[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1');

// Inline all /resources/<id> image srcs as base64 data URIs so pandoc/weasyprint
// don't need to make authenticated HTTP requests. Handles bare "resources/",
// "/resources/", and absolute "https://host/resources/" src forms.
const inlineResourceImages = async (html, userId, itemService) => {
	const RESOURCE_RE = /src="(?:https?:\/\/[^"]*)?\/?resources\/([0-9a-fA-F]{32})(?:[^"]*)"/g;
	const ids = [];
	let m;
	while ((m = RESOURCE_RE.exec(html)) !== null) {
		if (!ids.includes(m[1])) ids.push(m[1]);
	}
	if (!ids.length) return html;

	// Fetch all resource blobs and meta in parallel
	const entries = await Promise.all(ids.map(async id => {
		try {
			const [blob, meta] = await Promise.all([
				itemService.resourceBlobByUserId(userId, id),
				itemService.resourceMetaByUserId(userId, id),
			]);
			if (!blob) return { id, dataUri: null };
			const mime = (meta && meta.mime) || 'application/octet-stream';
			return { id, dataUri: `data:${mime};base64,${blob.toString('base64')}` };
		} catch {
			return { id, dataUri: null };
		}
	}));

	const byId = {};
	for (const e of entries) byId[e.id] = e.dataUri;

	return html.replace(RESOURCE_RE, (match, id) => {
		const dataUri = byId[id];
		if (!dataUri) return 'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="'; // 1x1 transparent PNG placeholder
		// Preserve width/height/style attributes — only replace the src
		return match.replace(/src="[^"]*"/, `src="${dataUri}"`);
	});
};

// Rewrite attachment links (href="[/]resources/<id>?download=1") into
// data: URIs with a download="<filename>" attribute, so the exported HTML
// file carries every attachment inline and clicking the link downloads it
// straight from the browser with no server round-trip. Falls back to plain
// link text if the resource can't be resolved.
const inlineResourceLinks = async (html, userId, itemService) => {
	const RE = /<a\b([^>]*)\bhref="(?:https?:\/\/[^"]*)?\/?resources\/([0-9a-fA-F]{32})[^"]*"([^>]*)>([\s\S]*?)<\/a>/gi;
	const ids = [];
	let m;
	while ((m = RE.exec(html)) !== null) {
		if (!ids.includes(m[2])) ids.push(m[2]);
	}
	if (!ids.length) return html;

	const entries = await Promise.all(ids.map(async id => {
		try {
			const [blob, meta] = await Promise.all([
				itemService.resourceBlobByUserId(userId, id),
				itemService.resourceMetaByUserId(userId, id),
			]);
			if (!blob) return { id, dataUri: null, filename: null };
			const mime = (meta && meta.mime) || 'application/octet-stream';
			const filename = (meta && (meta.filename || meta.title)) || `attachment-${id}`;
			return { id, dataUri: `data:${mime};base64,${blob.toString('base64')}`, filename };
		} catch {
			return { id, dataUri: null, filename: null };
		}
	}));

	const byId = {};
	for (const e of entries) byId[e.id] = e;

	const stripAttr = (attrs, name) => attrs.replace(new RegExp(`\\s${name}(?:="[^"]*")?`, 'i'), '');

	return html.replace(RE, (match, preAttrs, id, postAttrs, label) => {
		const entry = byId[id];
		if (!entry || !entry.dataUri) return label;
		const cleanPre = stripAttr(stripAttr(preAttrs, 'href'), 'download');
		const cleanPost = stripAttr(stripAttr(postAttrs, 'href'), 'download');
		const safeFilename = `${entry.filename}`.replace(/"/g, '&quot;');
		return `<a${cleanPre} href="${entry.dataUri}" download="${safeFilename}"${cleanPost}>${label}</a>`;
	});
};

// POST /api/export/docx — server-side pandoc markdown/html→docx
const handleExportDocx = async (url, request, response, ctx) => {
	if (url.pathname !== '/api/export/docx' || request.method !== 'POST') return false;
	try {
		const auth = await ctx.authenticatedUser(request);
		if (auth.error) {
			response.writeHead(401, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: auth.error }));
			return true;
		}
		const body = await parseBody(request);
		const { content, format, title } = body;
		if (!content) {
			response.writeHead(400, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: 'content is required' }));
			return true;
		}
		const inputFormat = format === 'html' ? 'html' : 'markdown';

		// Pre-process HTML the same way as PDF: strip dead resource links and
		// inline resource images as base64 data URIs so pandoc can embed them.
		// Markdown input is left unchanged — pandoc handles it natively.
		let processedContent = content;
		if (inputFormat === 'html') {
			processedContent = stripResourceLinks(content);
			processedContent = await inlineResourceImages(processedContent, auth.user.id, ctx.itemService);
		}

		const filename = (title || 'note').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'note';
		const refDoc = path.join(__dirname, '../../public/reference.docx');
		const args = ['-f', inputFormat, '-t', 'docx', '--wrap=none', '--reference-doc', refDoc];
		const pandoc = spawn('pandoc', args, { stdio: ['pipe', 'pipe', 'pipe'] });
		pandoc.stdin.write(processedContent);
		pandoc.stdin.end();
		const chunks = [];
		const stderrChunks = [];
		pandoc.stdout.on('data', chunk => chunks.push(chunk));
		pandoc.stderr.on('data', chunk => stderrChunks.push(chunk));
		pandoc.on('close', code => {
			if (code !== 0) {
				const stderr = Buffer.concat(stderrChunks).toString();
				response.writeHead(500, { 'Content-Type': 'application/json' });
				response.end(JSON.stringify({ error: 'pandoc failed', code, stderr }));
				return;
			}
			const docx = Buffer.concat(chunks);
			response.writeHead(200, {
				'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'Content-Disposition': `attachment; filename="${filename}.docx"`,
				'Content-Length': docx.length,
			});
			response.end(docx);
		});
		pandoc.on('error', err => {
			response.writeHead(500, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: 'pandoc spawn failed', detail: err.message }));
		});
		return true;
	} catch (error) {
		response.writeHead(500, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: error.message || `${error}` }));
		return true;
	}
};

// ---------------------------------------------------------------------------
// POST /api/export/pdf — server-side pandoc html→pdf via weasyprint
// ---------------------------------------------------------------------------

const PDF_PRINT_CSS = `
@page {
  size: A4;
  margin: 2cm 2.2cm 2.5cm 2.2cm;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
/* Pandoc's own default HTML template CSS (max-width:36em, padding:50px on
   body) is injected before ours and has higher selector specificity than the
   universal reset above, so it survives unless explicitly overridden here. */
body { padding: 0; margin: 0; max-width: none; }
html, body {
  background: #fff;
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 10pt;
  line-height: 1.65;
}
h1, h2, h3, h4, h5, h6 {
  color: #111;
  line-height: 1.25;
  margin: 1.4em 0 0.5em;
  page-break-after: avoid;
}
h1 { font-size: 2em;   border-bottom: 1px solid #ddd; padding-bottom: 0.25em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.15em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1.1em; }
h5, h6 { font-size: 1em; }
p { margin: 0.6em 0; }
strong { font-weight: 700; }
em     { font-style: italic; }
u      { text-decoration: underline; }
s      { text-decoration: line-through; }
p.md-blank-line { margin: 0; padding: 0; line-height: 1; min-height: 0.8em; }
a { color: #0055cc; }
ul, ol { padding-left: 1.8em; margin: 0.5em 0; }
li { margin: 0.2em 0; }
blockquote {
  border-left: 3px solid #ccc;
  padding-left: 1em;
  color: #555;
  margin: 0.8em 0;
  font-style: italic;
}
hr { border: none; border-top: 1px solid #ccc; margin: 1.2em 0; }
code {
  background: #f3f3f3;
  color: #222;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'Cascadia Mono', 'Fira Mono', 'Menlo', 'Consolas', monospace;
  font-size: 0.88em;
}
pre {
  background: #f6f6f6;
  color: #222;
  padding: 0.9em 1em;
  border-radius: 4px;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  margin: 0.8em 0;
  font-size: 0.85em;
  page-break-inside: avoid;
}
pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }
.token.comment,.token.prolog,.token.doctype,.token.cdata { color: #6a737d; font-style: italic; }
.token.punctuation { color: #444; }
.token.property,.token.tag,.token.boolean,.token.number,.token.constant,.token.symbol,.token.deleted { color: #b31d28; }
.token.selector,.token.attr-name,.token.string,.token.char,.token.builtin,.token.inserted { color: #22863a; }
.token.operator,.token.entity,.token.url,.language-css .token.string,.style .token.string { color: #d73a49; }
.token.atrule,.token.attr-value,.token.keyword { color: #005cc5; }
.token.function,.token.class-name { color: #6f42c1; }
.token.regex,.token.important,.token.variable { color: #e36209; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 0.95em;
  page-break-inside: avoid;
}
th, td { border: 1px solid #888; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f0f0f0; font-weight: 600; border-bottom: 2px solid #444; }
tr:nth-child(even) td { background: #fafafa; }
img { max-width: 100%; height: auto; display: block; margin: 0.6em 0; }
.md-checkbox::before         { content: "\\2610  "; font-size: 1em; }
.md-checkbox.checked::before { content: "\\2611  "; font-size: 1em; }
.md-checkbox { margin: 0.25em 0; display: block; }
`;

const buildPdfHtmlDoc = (bodyHtml) =>
	`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n${bodyHtml}\n</body>\n</html>`;

const handleExportPdf = async (url, request, response, ctx) => {
	if (url.pathname !== '/api/export/pdf' || request.method !== 'POST') return false;
	try {
		const auth = await ctx.authenticatedUser(request);
		if (auth.error) {
			response.writeHead(401, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: auth.error }));
			return true;
		}
		const body = await parseBody(request);
		const { content, format, title } = body;
		if (!content) {
			response.writeHead(400, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: 'content is required' }));
			return true;
		}

		// Resolve to HTML — if sent as markdown (markdown mode active), render first
		const rawHtml = format === 'markdown' ? renderMarkdown(content) : content;

		// Strip resource download links (href is meaningless in PDF context)
		const strippedHtml = stripResourceLinks(rawHtml);

		// Inline resource images as base64 data URIs
		const inlinedHtml = await inlineResourceImages(strippedHtml, auth.user.id, ctx.itemService);

		const fullDoc = buildPdfHtmlDoc(inlinedHtml);
		const filename = (title || 'note').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'note';

		// IMPORTANT: pandoc's HTML reader parses only the <body> of the input
		// document into its AST — any <style> in <head> is silently dropped
		// before pandoc re-emits HTML for weasyprint. To make our print CSS
		// actually reach the PDF, we inject it via --include-in-header, which
		// pandoc inserts verbatim into the <head> of the HTML it *generates*
		// (post-AST), so it survives through to weasyprint.
		const cssHeaderFile = path.join(os.tmpdir(), `joplock-pdf-css-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
		fs.writeFileSync(cssHeaderFile, `<style>${PDF_PRINT_CSS}</style>`);
		const cleanupCssHeaderFile = () => { try { fs.unlinkSync(cssHeaderFile); } catch {} };

		const args = [
			'-f', 'html',
			'-t', 'pdf',
			'--pdf-engine=weasyprint',
			'--pdf-engine-opt=--presentational-hints',
			'--include-in-header', cssHeaderFile,
		];
		const pandocProc = spawn('pandoc', args, { stdio: ['pipe', 'pipe', 'pipe'] });
		pandocProc.stdin.write(fullDoc);
		pandocProc.stdin.end();
		const chunks = [];
		const stderrChunks = [];
		pandocProc.stdout.on('data', chunk => chunks.push(chunk));
		pandocProc.stderr.on('data', chunk => stderrChunks.push(chunk));
		pandocProc.on('close', code => {
			cleanupCssHeaderFile();
			if (code !== 0) {
				const stderr = Buffer.concat(stderrChunks).toString();
				response.writeHead(500, { 'Content-Type': 'application/json' });
				response.end(JSON.stringify({ error: 'pandoc failed', code, stderr }));
				return;
			}
			const pdf = Buffer.concat(chunks);
			response.writeHead(200, {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}.pdf"`,
				'Content-Length': pdf.length,
			});
			response.end(pdf);
		});
		pandocProc.on('error', err => {
			cleanupCssHeaderFile();
			response.writeHead(500, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: 'pandoc spawn failed', detail: err.message }));
		});
		return true;
	} catch (error) {
		response.writeHead(500, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: error.message || `${error}` }));
		return true;
	}
};

// ---------------------------------------------------------------------------
// POST /api/export/html — single self-contained HTML file: inlined theme CSS,
// base64 images, base64 attachment links. No pandoc needed — the source is
// already TinyMCE-rendered HTML.
// ---------------------------------------------------------------------------

const escapeHtmlAttr = value => `${value || ''}`
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;');

const handleExportHtml = async (url, request, response, ctx) => {
	if (url.pathname !== '/api/export/html' || request.method !== 'POST') return false;
	try {
		const auth = await ctx.authenticatedUser(request);
		if (auth.error) {
			response.writeHead(401, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: auth.error }));
			return true;
		}
		const body = await parseBody(request);
		const { content, title } = body;
		if (!content) {
			response.writeHead(400, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: 'content is required' }));
			return true;
		}
		const theme = /^[a-z0-9-]{1,40}$/.test(`${body.theme || ''}`) ? body.theme : 'earth';

		const imagedHtml = await inlineResourceImages(content, auth.user.id, ctx.itemService);
		const inlinedHtml = await inlineResourceLinks(imagedHtml, auth.user.id, ctx.itemService);

		const themeCss = extractCssBlocks(STYLES_CSS, [`.theme-${theme}`]);
		const previewCss = extractCssBlocks(STYLES_CSS, ['.editor-preview', '.md-blank-line', '.md-checkbox']);
		const fullCss = `${HTML_EXPORT_BASE_CSS}\n${themeCss}\n${previewCss}\n${HTML_EXPORT_PARITY_CSS}`;

		const safeTitle = escapeHtmlAttr(title || 'Note');
		const filename = (title || 'note').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'note';

		const doc = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${safeTitle}</title>\n<style>${fullCss}</style>\n</head>\n<body class="theme-${theme}">\n<div class="editor-preview">${inlinedHtml}</div>\n</body>\n</html>`;

		response.writeHead(200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}.html"`,
		});
		response.end(doc);
		return true;
	} catch (error) {
		response.writeHead(500, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: error.message || `${error}` }));
		return true;
	}
};

module.exports = { handle, handleExportDocx, handleExportPdf, handleExportHtml, inlineResourceImages, inlineResourceLinks, stripResourceLinks, extractCssBlocks };
