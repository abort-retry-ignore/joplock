'use strict';

// Notebook operations that must be consistent across every entry point (the
// htmx fragment routes, the JSON API and, on mobile, the same routes again).
//
// Rules enforced here, server side, whatever the UI does:
//   structure  a notebook cannot go under itself or one of its own descendants
//   vaults     a vault is a top-level leaf: it cannot contain notebooks, be moved,
//              or end up inside a shared notebook
//   sharing    only the owner creates, moves or deletes inside a share; moving a
//              notebook across a share boundary re-stamps the whole subtree and
//              grants/revokes recipient access; a share root cannot be nested
//              (Joplin's own rule: shared notebooks stay at the top level)
//   delete     promotes: sub-notebooks move up to the deleted notebook's parent,
//              its notes move to that parent (or to "General" at the top level),
//              so deleting a notebook never deletes notes or sub-notebooks
//
// Collaborators are injected so the rules are unit-testable with fakes:
//   itemService, itemWriteService, vaultService (optional),
//   shareSync (optional; see createShareSync in routes/shares.js)

const { flattenFolderTree, canNestUnder, subtreeIds } = require('./folderTree');
const { resolveFolderShareState, deriveShareFieldsForMove } = require('./shareAccess');

const fail = (statusCode, message) => {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
};

const GENERAL_TITLE = 'General';

const createFolderOps = ({ itemService, itemWriteService, vaultService, shareSync }) => {
	const vaultIdSet = async userId => {
		if (!vaultService) return new Set();
		return vaultService.getVaultFolderIdSet(userId).catch(() => new Set());
	};

	const requireFolder = async (userId, folderId, message = 'Notebook not found') => {
		const state = await resolveFolderShareState(itemService, userId, folderId);
		if (!state) throw fail(404, message);
		return state;
	};

	// Share id a notebook's children inherit.
	const shareOf = state => (state && state.shareId) || '';

	// Parent of `folder` as the tree sees it ('' when top level or its parent is
	// not visible), so deleting under an orphaned/unknown parent still works.
	const treeParent = (folders, folderId) => {
		const entry = flattenFolderTree(folders).find(f => f.id === folderId);
		return entry ? entry.treeParentId : '';
	};

	// What sharing a notebook means for the tree. Joplin only shares from the top
	// level: its own client moves a nested notebook to the top before sharing, and
	// so do we. A notebook inside an existing share is already shared with it.
	const shareEligibility = async ({ user, folderId }) => {
		const state = await requireFolder(user.id, folderId);
		const folders = await itemService.foldersByUserId(user.id);
		const parentId = treeParent(folders, folderId);
		const parent = parentId ? folders.find(f => f.id === parentId) : null;
		const vaults = await vaultIdSet(user.id);
		return {
			folder: state.folder,
			isOwner: state.isOwner,
			nested: !!parentId,
			insideShare: !!(state.shareId && parent && (parent.shareId || '') === state.shareId),
			containsVault: subtreeIds(folders, folderId).some(id => vaults.has(id)),
		};
	};

	return {
		shareEligibility,

		// Run before creating a share: validates, then lifts a nested notebook to
		// the top level (the share root must be top level).
		async prepareForShare({ user, folderId, requestContext }) {
			const e = await shareEligibility({ user, folderId });
			if (!e.isOwner) throw fail(403, 'Only the owner can share this notebook');
			if (e.containsVault) throw fail(400, 'Notebooks containing a vault cannot be shared');
			if (e.insideShare) throw fail(400, 'This notebook is inside a shared notebook, so it is already shared with it');
			if (e.nested) await itemWriteService.updateFolder(user.sessionId, e.folder, { parentId: '' }, requestContext);
			return { liftedToTopLevel: e.nested };
		},

		// ── create ────────────────────────────────────────────────────────────
		async createFolder({ user, title, parentId = '', requestContext }) {
			const cleanTitle = `${title || ''}`.trim();
			if (!cleanTitle) throw fail(400, 'Folder title is required');
			const parent = `${parentId || ''}`;
			let shareFields = { shareId: '', isShared: false };
			if (parent) {
				const parentState = await requireFolder(user.id, parent, 'Parent notebook not found');
				if ((await vaultIdSet(user.id)).has(parent)) {
					throw fail(400, 'Vault notebooks cannot contain notebooks');
				}
				if (parentState.shareId && !parentState.isOwner) throw fail(403, 'Shared items are read-only');
				shareFields = deriveShareFieldsForMove(parentState.folder);
			}
			const created = await itemWriteService.createFolder(user.sessionId, {
				title: cleanTitle, parentId: parent, ...shareFields,
			}, requestContext);
			if (shareFields.shareId && shareSync) {
				await shareSync.setSubtreeShare({
					ownerId: user.id, folderId: created.id, shareId: shareFields.shareId, previousShareId: '',
				});
			}
			return { id: created.id, parentId: parent, ...shareFields };
		},

		// ── move ──────────────────────────────────────────────────────────────
		// targetParentId '' = top level.
		//   title (optional) renames in the same write, so a rename+move is one save.
		async moveFolder({ user, folderId, targetParentId = '', title, requestContext }) {
			const target = `${targetParentId || ''}`;
			const state = await requireFolder(user.id, folderId);
			const folders = await itemService.foldersByUserId(user.id);
			const current = treeParent(folders, folderId);
			const newTitle = title !== undefined ? `${title}`.trim() : undefined;
			if (current === target) {
				if (newTitle && newTitle !== state.folder.title) {
					await itemWriteService.updateFolder(user.sessionId, state.folder, { title: newTitle }, requestContext);
					return { changed: true, folder: state.folder, shareChanged: false };
				}
				return { changed: false, folder: state.folder };
			}

			const nest = canNestUnder(folders, folderId, target);
			if (!nest.ok) throw fail(nest.reason === 'Notebook not found' || nest.reason === 'Target notebook not found' ? 404 : 400, nest.reason);

			const vaults = await vaultIdSet(user.id);
			if (vaults.has(folderId)) throw fail(400, 'Vault notebooks stay at the top level');
			if (target && vaults.has(target)) throw fail(400, 'Vault notebooks cannot contain notebooks');

			const oldShareId = shareOf(state);
			if (oldShareId && !state.isOwner) throw fail(403, 'Only the owner can move this item');

			let newShareId = '';
			if (target) {
				const targetState = await requireFolder(user.id, target, 'Target notebook not found');
				if (targetState.shareId && !targetState.isOwner) throw fail(403, 'Shared items are read-only');
				newShareId = shareOf(targetState);
			}

			// A share root keeps its place at the top level (Joplin's rule): moving it
			// under anything would turn the share root into a nested folder.
			const currentParent = current ? folders.find(f => f.id === current) : null;
			const isShareRoot = !!oldShareId && (!currentParent || (currentParent.shareId || '') !== oldShareId);
			if (isShareRoot && target) {
				throw fail(400, 'Stop sharing this notebook before moving it into another notebook');
			}

			const shareChanges = oldShareId !== newShareId;
			if (shareChanges && newShareId) {
				const subtree = subtreeIds(folders, folderId);
				if (subtree.some(id => vaults.has(id))) throw fail(400, 'Vault notebooks cannot be shared');
			}

			const updates = { parentId: target };
			if (newTitle) updates.title = newTitle;
			if (shareChanges) {
				updates.shareId = newShareId;
				updates.isShared = !!newShareId;
			}
			await itemWriteService.updateFolder(user.sessionId, state.folder, updates, requestContext);
			if (shareChanges && shareSync) {
				await shareSync.setSubtreeShare({
					ownerId: user.id, folderId, shareId: newShareId, previousShareId: oldShareId,
				});
			}
			return { changed: true, folder: state.folder, shareChanged: shareChanges };
		},

		// ── delete (promote) ──────────────────────────────────────────────────
		async deleteFolder({ user, folderId, requestContext }) {
			const state = await requireFolder(user.id, folderId);
			const oldShareId = shareOf(state);
			if (oldShareId && !state.isOwner) throw fail(403, 'Only the owner can move or delete this item');

			const folders = await itemService.foldersByUserId(user.id);
			const parentId = treeParent(folders, folderId);
			const children = flattenFolderTree(folders).filter(f => f.treeParentId === folderId);

			// Where promoted things end up, and which share that is.
			let destinationId = parentId;
			let destinationShareId = '';
			if (parentId) {
				destinationShareId = shareOf(await requireFolder(user.id, parentId, 'Parent notebook not found'));
			} else {
				let general = folders.find(f => !f.deletedTime && f.id !== folderId && f.title === GENERAL_TITLE && !f.parentId);
				if (!general) {
					const created = await itemWriteService.createFolder(user.sessionId, { title: GENERAL_TITLE, parentId: '' }, requestContext);
					general = { id: created.id, title: GENERAL_TITLE };
				}
				destinationId = general.id;
				destinationShareId = shareOf(await requireFolder(user.id, general.id).catch(() => null));
			}

			// 1. sub-notebooks move up one level (their subtrees come with them)
			for (const child of children) {
				const childState = await requireFolder(user.id, child.id);
				const childShareId = shareOf(childState);
				const newShareId = parentId ? destinationShareId : '';
				const updates = { parentId };
				if (childShareId !== newShareId) { updates.shareId = newShareId; updates.isShared = !!newShareId; }
				await itemWriteService.updateFolder(user.sessionId, childState.folder, updates, requestContext);
				if (childShareId !== newShareId && shareSync) {
					await shareSync.setSubtreeShare({
						ownerId: user.id, folderId: child.id, shareId: newShareId, previousShareId: childShareId,
					});
				}
			}

			// 2. its own notes move to the parent (or General)
			const notes = await itemService.notesByUserId(user.id, { folderId });
			const noteShareUpdates = [];
			for (const note of notes) {
				const noteShareId = note.shareId || '';
				const updates = { parentId: destinationId };
				if (noteShareId !== destinationShareId) {
					updates.shareId = destinationShareId;
					updates.isShared = !!destinationShareId;
					noteShareUpdates.push({ id: note.id, previousShareId: noteShareId });
				}
				await itemWriteService.updateNote(user.sessionId, note, updates, requestContext);
			}
			if (shareSync) {
				const byPrevious = new Map();
				for (const u of noteShareUpdates) {
					if (!byPrevious.has(u.previousShareId)) byPrevious.set(u.previousShareId, []);
					byPrevious.get(u.previousShareId).push(u.id);
				}
				for (const [previousShareId, itemIds] of byPrevious) {
					await shareSync.setItemsShare({
						ownerId: user.id, itemIds, shareId: destinationShareId, previousShareId, rootFolderId: destinationId,
					});
				}
			}

			// 3. finally the notebook itself
			await itemWriteService.deleteFolder(user.sessionId, folderId, requestContext);
			return {
				deleted: folderId,
				promotedFolders: children.map(c => c.id),
				movedNotes: notes.length,
				destinationId,
			};
		},

		// Notebook choices for pickers, in tree order. `exclude` greys out a
		// notebook and its descendants (a move cannot target those); vaults and
		// (for recipients) read-only shared notebooks cannot take children either.
		async pickerEntries({ user, excludeId = '' }) {
			const folders = await itemService.foldersByUserId(user.id);
			const vaults = await vaultIdSet(user.id);
			const blocked = new Set(excludeId ? subtreeIds(folders, excludeId) : []);
			return flattenFolderTree(folders).map(f => ({
				id: f.id,
				title: f.title || 'Untitled',
				depth: f.depth,
				path: f.path,
				disabled: blocked.has(f.id) || vaults.has(f.id) || (!!f.shareId && !!f.ownerId && f.ownerId !== user.id),
				isVault: vaults.has(f.id),
			}));
		},
	};
};

module.exports = { createFolderOps };
