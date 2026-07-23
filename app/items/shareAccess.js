'use strict';

const deriveShareFieldsForMove = (targetFolder) => {
  const shareId = (targetFolder && targetFolder.shareId) ? targetFolder.shareId : '';
  return { shareId, isShared: !!shareId };
};

const resolveItemShareAccess = async (itemService, userId, itemId, options = {}) => {
  const item = await itemService.noteByUserIdAndJopId(userId, itemId, options).catch(() => null);
  if (!item) return null;
  const ownerId = item.ownerId || '';
  const shareId = item.shareId || '';
  const isOwner = !ownerId || ownerId === userId;
  const isShared = !!(item.isShared || shareId);
  let canWrite = isOwner;
  if (!isOwner && shareId && itemService.database) {
    const su = await itemService.database.query(
      `SELECT can_write FROM share_users WHERE share_id = $1 AND user_id = $2 AND status = 1 LIMIT 1`,
      [shareId, userId],
    ).catch(() => ({ rows: [] }));
    if (su.rows && su.rows[0]) canWrite = !!(Number(su.rows[0].can_write));
  }
  return { item, ownerId, shareId, isShared, isOwner, canRead: true, canWrite };
};

const resolveFolderShareState = async (itemService, userId, folderId) => {
  const folder = await itemService.folderByUserIdAndJopId(userId, folderId).catch(() => null);
  if (!folder) return null;
  const ownerId = folder.ownerId || '';
  const shareId = folder.shareId || '';
  const isOwner = !ownerId || ownerId === userId;
  const isShared = !!(folder.isShared || shareId);
  let canWrite = isOwner;
  if (!isOwner && shareId && itemService.database) {
    const su = await itemService.database.query(
      `SELECT can_write FROM share_users WHERE share_id = $1 AND user_id = $2 AND status = 1 LIMIT 1`,
      [shareId, userId],
    ).catch(() => ({ rows: [] }));
    if (su.rows && su.rows[0]) canWrite = !!(Number(su.rows[0].can_write));
  }
  return { folder, ownerId, shareId, isShared, isOwner, canWrite };
};

const assertCanWrite = (access) => {
  if (!access) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  if (!access.canWrite) {
    const err = new Error('Shared items are read-only');
    err.statusCode = 403;
    throw err;
  }
};

const assertOwnerForDestructive = (access) => {
  if (!access) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  if (!access.isOwner) {
    const err = new Error('Only the owner can move or delete this item');
    err.statusCode = 403;
    throw err;
  }
};

module.exports = {
  deriveShareFieldsForMove,
  resolveItemShareAccess,
  resolveFolderShareState,
  assertCanWrite,
  assertOwnerForDestructive,
};
