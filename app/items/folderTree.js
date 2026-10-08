'use strict';

// Pure helpers for Joplin's nested notebooks (a notebook is nested when its
// `parent_id` points at another notebook).
//
// Everything here works on the flat folder list the item service returns
// (`[{ id, parentId, title, ... }]`). No I/O, no DOM, no ordering of its own:
// siblings keep the order of the input list, so the SQL ordering (case-folded
// title, then creation time) and the virtual "All Notes" / "Trash" rows that
// the nav wraps around the real folders both survive unchanged.
//
// The data comes from sync clients we do not control, so the helpers are
// defensive in the same way Joplin's own `Folder.buildTree` is:
//   - a folder whose parent is not in the list (not visible to this user, or
//     deleted) is shown at the top level instead of disappearing;
//   - a parent cycle (A under B under A) never loops; the first folder of the
//     cycle in list order becomes a top-level folder.

const MAX_DEPTH = 100;

// Folder whose parent is usable, else '' (top level).
const effectiveParentOf = (folder, byId) => {
	const parentId = folder.parentId || '';
	if (!parentId || parentId === folder.id) return '';
	return byId.has(parentId) ? parentId : '';
};

const indexFolders = folders => {
	const list = (folders || []).filter(f => f && f.id);
	const byId = new Map();
	for (const folder of list) byId.set(folder.id, folder);
	const childrenOf = new Map();
	for (const folder of list) {
		const parent = effectiveParentOf(folder, byId);
		if (!childrenOf.has(parent)) childrenOf.set(parent, []);
		childrenOf.get(parent).push(folder);
	}
	return { list, byId, childrenOf };
};

// Nested tree: [{ folder, id, depth, path, pathIds, treeParentId, hasChildren, children }]
const buildFolderTree = folders => {
	const { list, childrenOf } = indexFolders(folders);
	const seen = new Set();

	const build = (folder, depth, treeParentId, pathTitles, pathIds) => {
		seen.add(folder.id);
		const path = pathTitles.concat(folder.title || 'Untitled');
		const ids = pathIds.concat(folder.id);
		const node = {
			folder, id: folder.id, depth, path, pathIds: ids, treeParentId, hasChildren: false, children: [],
		};
		if (depth >= MAX_DEPTH) return node;
		for (const child of childrenOf.get(folder.id) || []) {
			if (seen.has(child.id)) continue;
			node.children.push(build(child, depth + 1, folder.id, path, ids));
		}
		node.hasChildren = node.children.length > 0;
		return node;
	};

	const roots = [];
	for (const folder of childrenOf.get('') || []) {
		if (!seen.has(folder.id)) roots.push(build(folder, 0, '', [], []));
	}
	// Anything never reached is part of a cycle (or below the depth cap):
	// surface it at the top level rather than hiding the notebook.
	for (const folder of list) {
		if (!seen.has(folder.id)) roots.push(build(folder, 0, '', [], []));
	}
	return roots;
};

// Preorder flattening of the tree. Each entry is the original folder object
// plus { depth, path, pathIds, treeParentId, hasChildren }.
const flattenFolderTree = folders => {
	const out = [];
	const visit = node => {
		out.push(Object.assign({}, node.folder, {
			depth: node.depth,
			path: node.path,
			pathIds: node.pathIds,
			treeParentId: node.treeParentId,
			hasChildren: node.hasChildren,
		}));
		for (const child of node.children) visit(child);
	};
	for (const root of buildFolderTree(folders)) visit(root);
	return out;
};

// Ids of every folder below `folderId` (not including it), preorder.
const descendantIds = (folders, folderId) => {
	const { childrenOf } = indexFolders(folders);
	const out = [];
	const seen = new Set([folderId]);
	const stack = (childrenOf.get(folderId) || []).slice().reverse();
	while (stack.length) {
		const folder = stack.pop();
		if (seen.has(folder.id)) continue;
		seen.add(folder.id);
		out.push(folder.id);
		const kids = childrenOf.get(folder.id) || [];
		for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
	}
	return out;
};

// `folderId` plus every folder below it.
const subtreeIds = (folders, folderId) => [folderId].concat(descendantIds(folders, folderId));

// Ancestor ids, top level first, excluding `folderId` itself.
const ancestorIds = (folders, folderId) => {
	const { byId } = indexFolders(folders);
	const out = [];
	const seen = new Set([folderId]);
	let current = byId.get(folderId);
	while (current) {
		const parent = effectiveParentOf(current, byId);
		if (!parent || seen.has(parent)) break;
		seen.add(parent);
		out.unshift(parent);
		current = byId.get(parent);
	}
	return out;
};

// Total note count per folder including every descendant.
//   directCounts: Map(folderId -> notes directly in that folder)
const rollupCounts = (folders, directCounts) => {
	const totals = new Map();
	const direct = directCounts || new Map();
	const visit = node => {
		let total = Number(direct.get(node.id) || 0);
		for (const child of node.children) total += visit(child);
		totals.set(node.id, total);
		return total;
	};
	for (const root of buildFolderTree(folders)) visit(root);
	return totals;
};

// Mirror of Joplin's Folder.canNestUnder (structure only). Share/vault rules
// need services and live in the route layer.
//   targetId '' means "top level".
const canNestUnder = (folders, folderId, targetId) => {
	const { byId } = indexFolders(folders);
	const target = `${targetId || ''}`;
	if (!folderId || !byId.has(folderId)) return { ok: false, reason: 'Notebook not found' };
	if (!target) return { ok: true, reason: '' };
	if (!byId.has(target)) return { ok: false, reason: 'Target notebook not found' };
	if (target === folderId) return { ok: false, reason: 'Cannot move a notebook into itself' };
	if (descendantIds(folders, folderId).includes(target)) {
		return { ok: false, reason: 'Cannot move a notebook into one of its own sub-notebooks' };
	}
	return { ok: true, reason: '' };
};

// "Work / Projects / Alpha"
const folderPathString = (entryOrPath, separator = ' / ') => {
	const path = Array.isArray(entryOrPath) ? entryOrPath : (entryOrPath && entryOrPath.path) || [];
	return path.join(separator);
};

// Label for flat controls (a <select>, the mobile move sheet). Nesting is shown
// with non-breaking indentation because <option> cannot nest, and plain spaces
// would be collapsed.
const INDENT_UNIT = '\u00a0\u00a0';
const folderOptionLabel = entry => {
	const title = (entry && entry.title) || 'Untitled';
	const depth = Math.min(Math.max(Number(entry && entry.depth) || 0, 0), 8);
	if (!depth) return title;
	return `${INDENT_UNIT.repeat(depth)}\u21b3\u00a0${title}`;
};

module.exports = {
	MAX_DEPTH,
	buildFolderTree,
	flattenFolderTree,
	descendantIds,
	subtreeIds,
	ancestorIds,
	rollupCounts,
	canNestUnder,
	folderPathString,
	folderOptionLabel,
};
