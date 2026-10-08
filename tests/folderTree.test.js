const test = require('node:test');
const assert = require('node:assert/strict');
const {
	buildFolderTree, flattenFolderTree, descendantIds, subtreeIds, ancestorIds,
	rollupCounts, canNestUnder, folderPathString, folderOptionLabel, MAX_DEPTH,
} = require('../app/items/folderTree');

const f = (id, parentId = '', title = id) => ({ id, parentId, title });

const sample = () => [
	f('work', '', 'Work'),
	f('home', '', 'Home'),
	f('proj', 'work', 'Projects'),
	f('alpha', 'proj', 'Alpha'),
	f('notes-w', 'work', 'Notes'),
	f('notes-h', 'home', 'Notes'),
];

test('flat lists come out unchanged and in input order', () => {
	const flat = [f('b'), f('a'), f('c')];
	const out = flattenFolderTree(flat);
	assert.deepEqual(out.map(x => x.id), ['b', 'a', 'c']);
	assert.ok(out.every(x => x.depth === 0 && !x.hasChildren && x.treeParentId === ''));
});

test('flattening is preorder with depth, path and hasChildren; siblings keep input order', () => {
	const out = flattenFolderTree(sample());
	assert.deepEqual(out.map(x => x.id), ['work', 'proj', 'alpha', 'notes-w', 'home', 'notes-h']);
	assert.deepEqual(out.map(x => x.depth), [0, 1, 2, 1, 0, 1]);
	const alpha = out.find(x => x.id === 'alpha');
	assert.deepEqual(alpha.path, ['Work', 'Projects', 'Alpha']);
	assert.deepEqual(alpha.pathIds, ['work', 'proj', 'alpha']);
	assert.equal(alpha.treeParentId, 'proj');
	assert.equal(alpha.hasChildren, false);
	assert.equal(out.find(x => x.id === 'work').hasChildren, true);
});

test('flattening keeps the other fields of the folder (vault flag, counts)', () => {
	const out = flattenFolderTree([{ id: 'v', parentId: '', title: 'V', isVault: true, noteCount: 3 }]);
	assert.equal(out[0].isVault, true);
	assert.equal(out[0].noteCount, 3);
});

test('a folder whose parent is missing is shown at the top level', () => {
	const out = flattenFolderTree([f('orphan', 'gone'), f('ok')]);
	assert.deepEqual(out.map(x => [x.id, x.depth, x.treeParentId]), [['orphan', 0, ''], ['ok', 0, '']]);
});

test('a parent cycle does not loop and does not hide the folders', () => {
	const out = flattenFolderTree([f('a', 'b'), f('b', 'a'), f('c')]);
	assert.deepEqual(out.map(x => x.id).sort(), ['a', 'b', 'c']);
	const a = out.find(x => x.id === 'a');
	assert.equal(a.depth, 0);
	assert.equal(a.treeParentId, '');
	assert.equal(out.find(x => x.id === 'b').depth, 1);
});

test('a folder that names itself as parent is a top-level folder', () => {
	const out = flattenFolderTree([f('x', 'x')]);
	assert.equal(out[0].depth, 0);
});

test('absurdly deep chains are capped but every folder still appears', () => {
	const chain = [];
	for (let i = 0; i < MAX_DEPTH + 30; i++) chain.push(f(`n${i}`, i ? `n${i - 1}` : ''));
	const out = flattenFolderTree(chain);
	assert.equal(out.length, chain.length);
	assert.ok(Math.max(...out.map(x => x.depth)) <= MAX_DEPTH);
});

test('buildFolderTree nests children and ignores null entries', () => {
	const tree = buildFolderTree([null, ...sample()]);
	assert.deepEqual(tree.map(n => n.id), ['work', 'home']);
	assert.deepEqual(tree[0].children.map(n => n.id), ['proj', 'notes-w']);
	assert.deepEqual(tree[0].children[0].children.map(n => n.id), ['alpha']);
});

test('descendantIds / subtreeIds / ancestorIds', () => {
	const folders = sample();
	assert.deepEqual(descendantIds(folders, 'work'), ['proj', 'alpha', 'notes-w']);
	assert.deepEqual(descendantIds(folders, 'alpha'), []);
	assert.deepEqual(subtreeIds(folders, 'proj'), ['proj', 'alpha']);
	assert.deepEqual(ancestorIds(folders, 'alpha'), ['work', 'proj']);
	assert.deepEqual(ancestorIds(folders, 'work'), []);
	assert.deepEqual(ancestorIds(folders, 'nope'), []);
});

test('descendantIds and ancestorIds terminate on cycles', () => {
	const cyc = [f('a', 'b'), f('b', 'a')];
	assert.deepEqual(descendantIds(cyc, 'a'), ['b']);
	assert.deepEqual(ancestorIds(cyc, 'a'), ['b']);
});

test('rollupCounts sums descendants into every ancestor', () => {
	const totals = rollupCounts(sample(), new Map([['work', 1], ['proj', 2], ['alpha', 4], ['home', 8]]));
	assert.equal(totals.get('alpha'), 4);
	assert.equal(totals.get('proj'), 6);
	assert.equal(totals.get('work'), 7);
	assert.equal(totals.get('notes-w'), 0);
	assert.equal(totals.get('home'), 8);
	assert.equal(rollupCounts(sample(), null).get('work'), 0);
});

test('canNestUnder: top level, siblings and unrelated targets are fine', () => {
	const folders = sample();
	assert.deepEqual(canNestUnder(folders, 'alpha', ''), { ok: true, reason: '' });
	assert.equal(canNestUnder(folders, 'alpha', 'home').ok, true);
	assert.equal(canNestUnder(folders, 'work', 'home').ok, true);
});

test('canNestUnder rejects self, own descendants and unknown ids', () => {
	const folders = sample();
	assert.equal(canNestUnder(folders, 'work', 'work').ok, false);
	assert.match(canNestUnder(folders, 'work', 'work').reason, /into itself/);
	assert.equal(canNestUnder(folders, 'work', 'alpha').ok, false);
	assert.match(canNestUnder(folders, 'work', 'alpha').reason, /sub-notebooks/);
	assert.equal(canNestUnder(folders, 'work', 'proj').ok, false);
	assert.equal(canNestUnder(folders, 'nope', 'home').ok, false);
	assert.match(canNestUnder(folders, 'work', 'nope').reason, /Target notebook not found/);
});

test('folderPathString and folderOptionLabel', () => {
	const out = flattenFolderTree(sample());
	const alpha = out.find(x => x.id === 'alpha');
	assert.equal(folderPathString(alpha), 'Work / Projects / Alpha');
	assert.equal(folderPathString(alpha.path, ' > '), 'Work > Projects > Alpha');
	assert.equal(folderOptionLabel(out.find(x => x.id === 'work')), 'Work');
	assert.equal(folderOptionLabel(alpha), '\u00a0\u00a0\u00a0\u00a0\u21b3\u00a0Alpha');
	assert.equal(folderOptionLabel({ title: '', depth: 0 }), 'Untitled');
	assert.ok(!/ {2}/.test(folderOptionLabel(alpha)), 'indent must not use collapsible ASCII spaces');
});
