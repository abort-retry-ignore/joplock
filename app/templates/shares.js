'use strict';

const { escapeHtml } = require('./shared');

const shareDialog = (notebookId, notebookTitle, isOwner = true, shareId = '') => {
	return `<div class="folder-modal-backdrop" id="share-modal-backdrop" hidden onclick="closeShareDialog()"></div>
<div class="folder-modal" id="share-modal" hidden data-share-owner="${isOwner ? '1' : '0'}" data-share-id="${escapeHtml(shareId)}">
	<div class="folder-modal-card" style="min-width:min(420px,92vw)">
		<h3 class="folder-modal-title">Share &ldquo;${escapeHtml(notebookTitle || 'Untitled')}&rdquo;</h3>
		${isOwner ? `<p class="lock-modal-warning" style="margin:0 0 12px;opacity:.85">Invite a user by email. Access is granted immediately (no confirmation required).</p>
		<div class="share-invite-form" style="display:flex;gap:8px;margin-bottom:10px">
			<input type="email" id="share-invite-email" class="login-input" placeholder="user@example.com" style="flex:1" />
			<button type="button" class="btn btn-sm btn-primary" id="share-invite-btn" onclick="inviteToShare('${escapeHtml(notebookId)}')">Share</button>
		</div>
		<div class="share-invite-error" id="share-invite-error" style="display:none;color:var(--danger,#f87171);margin-bottom:10px;font-size:13px"></div>` : ''}
		<div class="share-people-list" id="share-people-list"><div class="empty-hint">Loading&hellip;</div></div>
		<div class="folder-modal-actions" style="margin-top:16px">
			<button type="button" class="btn btn-sm btn-secondary" onclick="closeShareDialog()">Close</button>
			${isOwner
				? `<button type="button" class="btn btn-sm btn-danger" id="share-stop-btn" onclick="stopSharingNotebook('${escapeHtml(notebookId)}')" hidden>Stop sharing</button>`
				: `<button type="button" class="btn btn-sm btn-danger" id="share-leave-btn" onclick="leaveShareNotebook('${escapeHtml(notebookId)}')">Leave notebook</button>`}
		</div>
		<input type="hidden" id="share-notebook-id" value="${escapeHtml(notebookId)}" />
		<input type="hidden" id="share-notebook-title" value="${escapeHtml(notebookTitle || 'Untitled')}" />
	</div>
</div>`;
};

const shareInviteesList = invitees => {
	if (!invitees || !invitees.length) return '<div class="empty-hint">No people with access yet</div>';
	return invitees.map(inv => {
		const status = Number(inv.status);
		const statusLabel = status === 1 ? 'Has access' : (status === 0 ? 'Pending' : 'Rejected');
		const role = inv.can_write || inv.canWrite ? 'Editor' : 'Viewer';
		const email = inv.email || inv.user_email || inv.user_id || 'Unknown';
		const id = inv.id || '';
		return `<div class="share-person-row" data-invite-id="${escapeHtml(id)}" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,rgba(255,255,255,.08))">
			<span class="share-person-email" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(email)}</span>
			<span class="share-person-role" style="opacity:.75;font-size:12px">${escapeHtml(role)}</span>
			<span class="share-person-status" style="opacity:.75;font-size:12px">${escapeHtml(statusLabel)}</span>
			${id ? `<button type="button" class="btn btn-sm btn-secondary" onclick="removeShareUser('${escapeHtml(id)}')" title="Remove">Remove</button>` : ''}
		</div>`;
	}).join('');
};

const shareInboxBadge = count => {
	if (!count) return '';
	return `<span id="share-inbox-badge" class="share-inbox-badge" onclick="openShareInbox()" title="${count} pending share invitation${count !== 1 ? 's' : ''}">${count}</span>`;
};

const shareInboxModal = invites => {
	const body = (!invites || !invites.length)
		? '<div class="empty-hint">No pending invitations</div>'
		: invites.map(inv => `<div class="share-inbox-item" data-invite-id="${escapeHtml(inv.id)}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,rgba(255,255,255,.08))">
			<div style="flex:1;min-width:0">
				<div>${escapeHtml(inv.notebook_title || inv.notebook_id || 'Notebook')}</div>
				<div style="opacity:.7;font-size:12px">from ${escapeHtml(inv.owner_email || 'someone')}</div>
			</div>
			<button type="button" class="btn btn-sm btn-primary" onclick="acceptShareInvite('${escapeHtml(inv.id)}')">Accept</button>
			<button type="button" class="btn btn-sm btn-secondary" onclick="rejectShareInvite('${escapeHtml(inv.id)}')">Reject</button>
		</div>`).join('');
	return `<div class="folder-modal-backdrop" id="share-inbox-backdrop" hidden onclick="closeShareInbox()"></div>
<div class="folder-modal" id="share-inbox-modal" hidden>
	<div class="folder-modal-card">
		<h3 class="folder-modal-title">Share invitations</h3>
		<div class="share-inbox-body" id="share-inbox-body">${body}</div>
		<div class="folder-modal-actions">
			<button type="button" class="btn btn-sm btn-secondary" onclick="closeShareInbox()">Close</button>
		</div>
	</div>
</div>`;
};

module.exports = { shareDialog, shareInviteesList, shareInboxBadge, shareInboxModal };
