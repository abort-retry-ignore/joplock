// Settings page and admin user row
'use strict';

const {
	escapeHtml,
	appleSplashLinks,
	themeOptions,
	validDateFormats,
	validDatetimeFormats,
	passwordField,
} = require('./shared');

const adminUserRow = (u, currentUserId) => {
	const enabled = u.enabled !== false;
	const isSelf = u.id === currentUserId;
	const created = u.created_time ? new Date(u.created_time).toISOString().slice(0, 10) : '';
	const modalId = `user-modal-${u.id}`;
	const totpEnabled = !!u.totpEnabled;
	return `<tr>
		<td>${escapeHtml(u.email || '')}</td>
		<td>${escapeHtml(u.full_name || '')}</td>
		<td>
			<span class="badge ${enabled ? 'badge-ok' : 'badge-off'}">${enabled ? 'Enabled' : 'Disabled'}</span>
			${totpEnabled ? '<span class="badge badge-mfa">MFA</span>' : ''}
		</td>
		<td>${escapeHtml(created)}</td>
		<td class="admin-actions-cell">
			<button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('${modalId}').showModal()">Actions</button>
			<dialog id="${modalId}" class="admin-modal">
				<div class="admin-modal-content">
					<div class="admin-modal-header">
						<h3>Manage User</h3>
						<button type="button" class="admin-modal-close" onclick="this.closest('dialog').close()">&times;</button>
					</div>
					<div class="admin-modal-user">
						<strong>${escapeHtml(u.email || '')}</strong>
						${u.full_name ? `<span>${escapeHtml(u.full_name)}</span>` : ''}
						<span class="badge ${enabled ? 'badge-ok' : 'badge-off'}">${enabled ? 'Enabled' : 'Disabled'}</span>
						${totpEnabled ? '<span class="badge badge-mfa">MFA</span>' : ''}
					</div>
					<div class="admin-modal-actions">
						<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/password" class="admin-modal-form">
							<label class="admin-modal-label">Reset Password</label>
							<div class="admin-modal-row">
								<div class="login-password-wrap">
									${passwordField('password', { placeholder: 'New password' })}
								</div>
								<button type="submit" class="btn btn-primary">Reset</button>
							</div>
						</form>
						<div class="admin-modal-divider"></div>
						<div class="admin-modal-form">
							<label class="admin-modal-label">Two-Factor Authentication</label>
							${totpEnabled ? `
							<p class="admin-modal-hint">MFA is enabled for this user.</p>
							<details class="admin-totp-details">
								<summary class="btn btn-sm btn-secondary">Show TOTP Secret</summary>
								<div class="admin-totp-reveal">
									<img src="${u.totpQr || ''}" alt="TOTP QR" class="admin-totp-qr" />
									<code class="admin-totp-seed">${escapeHtml(u.totpSeed || '')}</code>
								</div>
							</details>
							<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/mfa/disable" style="margin-top:8px">
								<button type="submit" class="btn btn-secondary btn-block">Disable MFA</button>
							</form>
							` : `
							<p class="admin-modal-hint">MFA is not enabled. Generate a new TOTP seed for this user.</p>
							<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/mfa/enable">
								<button type="submit" class="btn btn-secondary btn-block">Enable MFA</button>
							</form>
							`}
						</div>
						${!isSelf ? `<div class="admin-modal-divider"></div>
						<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/${enabled ? 'disable' : 'enable'}" class="admin-modal-form">
							<label class="admin-modal-label">${enabled ? 'Disable Access' : 'Enable Access'}</label>
							<p class="admin-modal-hint">${enabled ? 'User will not be able to log in or sync.' : 'User will be able to log in and sync again.'}</p>
							<button type="submit" class="btn btn-secondary btn-block">${enabled ? 'Disable User' : 'Enable User'}</button>
						</form>
						<form method="POST" action="/admin/users/${encodeURIComponent(u.id)}/delete" class="admin-modal-form" onsubmit="return confirm('Delete user ${escapeHtml(u.email || '')} and all their data? This cannot be undone.')">
							<label class="admin-modal-label">Delete User</label>
							<p class="admin-modal-hint">Permanently delete this user and all their notes, folders, and resources.</p>
							<button type="submit" class="btn btn-danger btn-block">Delete User</button>
						</form>` : `<div class="admin-modal-divider"></div>
						<p class="admin-modal-hint">This is your admin account. You cannot disable or delete yourself.</p>`}
					</div>
					<div class="admin-modal-footer">
						<button type="button" class="btn btn-secondary btn-block" onclick="this.closest('dialog').close()">Cancel</button>
					</div>
				</div>
			</dialog>
		</td>
	</tr>`;
};

const settingsPage = (options = {}) => {
	const { user, settings = {}, userTotpEnabled = false, userTotpSetupSeed = '', userTotpSetupQr = '', isAdmin = false, isDockerAdmin = false, adminUsers = null, flash = '', flashError = '', activeTab = 'appearance' } = options;
	const validTabs = ['appearance', 'profile', 'security'];
	if (isAdmin) validTabs.push('admin');
	const tab = validTabs.includes(activeTab) ? activeTab : 'appearance';
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
	<meta name="theme-color" content="#08110b" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	${appleSplashLinks}
	<link rel="stylesheet" href="/styles.css" />
	<title>Joplock Settings</title>
</head>
<body class="theme-${escapeHtml(settings.theme || 'matrix')}">
	<div class="settings-page">
		<div class="settings-card">
			<div class="settings-header">
				<div>
					<h1 class="settings-title">Joplock Settings</h1>
					<p class="settings-sub">${escapeHtml(user.email)}</p>
				</div>
				<a href="/" class="btn btn-sm btn-secondary">Back to notes</a>
			</div>
			${flash ? `<div class="settings-flash settings-flash-ok">${escapeHtml(flash)}</div>` : ''}
			${flashError ? `<div class="settings-flash settings-flash-err">${escapeHtml(flashError)}</div>` : ''}
			<div class="settings-tabs" role="tablist">
				<button type="button" role="tab" class="settings-tab${tab === 'appearance' ? ' active' : ''}" data-tab="appearance" onclick="switchTab('appearance')">Appearance</button>
				<button type="button" role="tab" class="settings-tab${tab === 'profile' ? ' active' : ''}" data-tab="profile" onclick="switchTab('profile')">Profile</button>
				<button type="button" role="tab" class="settings-tab${tab === 'security' ? ' active' : ''}" data-tab="security" onclick="switchTab('security')">Security</button>
				${isAdmin ? `<button type="button" role="tab" class="settings-tab${tab === 'admin' ? ' active' : ''}" data-tab="admin" onclick="switchTab('admin')">Admin</button>` : ''}
			</div>

			<!-- Tab: Appearance -->
			<div class="settings-tab-panel${tab === 'appearance' ? ' active' : ''}" id="tab-appearance">
				<section class="settings-section">
					<h2 class="settings-section-title">Appearance</h2>
					<p class="settings-section-sub">Font and theme settings — changes are saved automatically.</p>
					<div class="settings-grid">
						<label class="settings-field">
							<span>Theme</span>
							<select id="settings-theme" class="login-input" onchange="saveSetting('theme',this.value)">
								${themeOptions.map(t => `<option value="${t[0]}"${(settings.theme || 'matrix') === t[0] ? ' selected' : ''}>${t[1]}</option>`).join('')}
							</select>
						</label>
						<label class="settings-field">
							<span>Note font size</span>
							<input type="range" min="12" max="24" value="${escapeHtml(settings.noteFontSize || 15)}" id="settings-note-font" onchange="saveSetting('noteFontSize',this.value)" />
							<output id="settings-note-font-value">${escapeHtml(settings.noteFontSize || 15)}px</output>
						</label>
						<label class="settings-field">
							<span>Mobile note font size</span>
							<input type="range" min="12" max="28" value="${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}" id="settings-mobile-note-font" onchange="saveSetting('mobileNoteFontSize',this.value)" />
							<output id="settings-mobile-note-font-value">${escapeHtml(settings.mobileNoteFontSize || ((settings.noteFontSize || 15) + 2))}px</output>
						</label>
						<label class="settings-field">
							<span>Code font size</span>
							<input type="range" min="10" max="22" value="${escapeHtml(settings.codeFontSize || 12)}" id="settings-code-font" onchange="saveSetting('codeFontSize',this.value)" />
							<output id="settings-code-font-value">${escapeHtml(settings.codeFontSize || 12)}px</output>
						</label>
						<label class="settings-field settings-checkbox">
							<span>Note body font</span>
							<label><input type="checkbox" id="settings-note-monospace" onchange="saveSetting('noteMonospace',this.checked?'1':'0')"${settings.noteMonospace ? ' checked' : ''} /> Use monospace for note text</label>
						</label>
						<label class="settings-field">
							<span>Open notes in</span>
							<select id="settings-note-open-mode" class="login-input" onchange="saveSetting('noteOpenMode',this.value)">
								<option value="preview"${(settings.noteOpenMode || 'preview') === 'preview' ? ' selected' : ''}>Rendered mode</option>
								<option value="markdown"${settings.noteOpenMode === 'markdown' ? ' selected' : ''}>Markdown mode</option>
							</select>
						</label>
						<label class="settings-field">
							<span>Display mode</span>
							<select id="settings-ui-mode" class="login-input" onchange="saveSetting('uiMode',this.value);setTimeout(function(){window.location.reload()},150)">
								<option value="auto"${(settings.uiMode || 'auto') === 'auto' ? ' selected' : ''}>Auto-detect</option>
								<option value="mobile"${settings.uiMode === 'mobile' ? ' selected' : ''}>Force mobile</option>
								<option value="desktop"${settings.uiMode === 'desktop' ? ' selected' : ''}>Force desktop</option>
							</select>
						</label>
						<label class="settings-field settings-checkbox">
							<span>Live search</span>
							<label><input type="checkbox" id="settings-live-search" onchange="saveSetting('liveSearch',this.checked?'1':'0')"${settings.liveSearch ? ' checked' : ''} /> Search as you type (≥3 chars)</label>
						</label>
						<label class="settings-field settings-checkbox">
							<span>Startup</span>
							<label><input type="checkbox" id="settings-resume-last-note" onchange="saveSetting('resumeLastNote',this.checked?'1':'0')"${settings.resumeLastNote ? ' checked' : ''} /> Reopen the last edited note on startup</label>
						</label>
					<label class="settings-field">
						<span>Date format</span>
						<select id="settings-date-format" class="login-input" onchange="saveSetting('dateFormat',this.value)">
								${validDateFormats.map(f => `<option value="${escapeHtml(f)}"${(settings.dateFormat || 'YYYY-MM-DD') === f ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('')}
							</select>
						</label>
						<label class="settings-field">
							<span>DateTime format</span>
							<select id="settings-datetime-format" class="login-input" onchange="saveSetting('datetimeFormat',this.value)">
								${validDatetimeFormats.map(f => `<option value="${escapeHtml(f)}"${(settings.datetimeFormat || 'YYYY-MM-DD HH:mm') === f ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('')}
							</select>
						</label>
					</div>
				</section>
			</div>

			<!-- Tab: Profile -->
			<div class="settings-tab-panel${tab === 'profile' ? ' active' : ''}" id="tab-profile">
				<form class="settings-form" method="POST" action="/settings/profile">
				<section class="settings-section">
					<h2 class="settings-section-title">Profile</h2>
					<p class="settings-section-sub">Update your name and email.</p>
					<div class="settings-grid">
						<label class="settings-field">
							<span>Full name</span>
							<input type="text" class="login-input" name="fullName" value="${escapeHtml(user.fullName || '')}" placeholder="Your name" />
						</label>
						<label class="settings-field">
							<span>Email</span>
							<input type="email" class="login-input" name="email" value="${escapeHtml(user.email || '')}" required />
						</label>
					</div>
				</section>
				<div class="settings-actions"><button type="submit" class="btn btn-primary">Save profile</button></div>
				</form>
			</div>

			<!-- Tab: Security -->
			<div class="settings-tab-panel${tab === 'security' ? ' active' : ''}" id="tab-security">
				<section class="settings-section">
					<h2 class="settings-section-title">Note Encryption</h2>
					<p class="settings-section-sub">Control auto-lock behavior for encrypted notes.</p>
					<div class="settings-grid">
						<label class="settings-field">
							<span>Auto-lock timeout (minutes)</span>
							<input type="number" class="login-input" min="0" max="480" value="${escapeHtml(settings.encryptionAutoLockMinutes != null ? settings.encryptionAutoLockMinutes : 5)}" id="settings-autolock-minutes" onchange="saveSetting('encryptionAutoLockMinutes',this.value)" />
							<span class="settings-field-hint">0 = never auto-lock (stay unlocked for session)</span>
						</label>
					</div>
				</section>
				<form class="settings-form" method="POST" action="/settings/security">
				<section class="settings-section">
					<h2 class="settings-section-title">Session Timeout</h2>
					<p class="settings-section-sub">When enabled, you are automatically logged out after a period of inactivity.</p>
					<div class="settings-grid">
						<label class="settings-field settings-checkbox">
							<span>Session timeout</span>
							<label><input type="checkbox" name="autoLogout" value="1"${settings.autoLogout ? ' checked' : ''} /> Expire session after inactivity</label>
						</label>
					<label class="settings-field">
						<span>Timeout (minutes)</span>
						<input type="number" class="login-input" name="autoLogoutMinutes" min="1" max="480" value="${escapeHtml(settings.autoLogoutMinutes || 15)}" />
					</label>
					<label class="settings-field settings-checkbox">
						<span>Confirmations</span>
						<label><input type="checkbox" id="settings-confirm-trash" onchange="saveSetting('confirmTrash',this.checked?'1':'0')"${settings.confirmTrash !== false ? ' checked' : ''} /> Confirm before moving notes to trash</label>
					</label>
				</div>
			</section>
				<div class="settings-actions"><button type="submit" class="btn btn-primary">Save session settings</button></div>
				</form>
				${isDockerAdmin ? `
				<section class="settings-section">
					<h2 class="settings-section-title">Change Password</h2>
					<p class="settings-section-sub">This account's password is managed via <code>JOPLOCK_ADMIN_PASSWORD</code> in the deployment configuration.</p>
				</section>
				` : `
				<section class="settings-section">
					<h2 class="settings-section-title">Change Password</h2>
					<p class="settings-section-sub">Enter your current password and a new password.</p>
					<form class="settings-form" method="POST" action="/settings/password">
					<div class="settings-grid">
						<label class="settings-field">
							<span>Current password</span>
							<div class="login-password-wrap">
								${passwordField('currentPassword', { autocomplete: 'current-password', placeholder: 'Required' })}
							</div>
						</label>
						<label class="settings-field">
							<span>New password</span>
							<div class="login-password-wrap">
								${passwordField('newPassword', { autocomplete: 'new-password', placeholder: 'New password' })}
							</div>
						</label>
						<label class="settings-field">
							<span>Confirm new password</span>
							<div class="login-password-wrap">
								${passwordField('confirmPassword', { autocomplete: 'new-password', placeholder: 'Repeat new password' })}
							</div>
						</label>
					</div>
					<div class="settings-actions"><button type="submit" class="btn btn-primary">Change password</button></div>
					</form>
				</section>
				`}
				<section class="settings-section">
					<h2 class="settings-section-title">Two-Factor Authentication</h2>
					<p class="settings-section-sub">Protect your account with a 6-digit code from your authenticator app.</p>
					${userTotpEnabled ? `
					<div class="settings-security-card settings-mfa-enabled">
						<p class="settings-mfa-status"><span class="badge badge-ok">Enabled</span> Two-factor authentication is active on your account.</p>
						<form method="POST" action="/settings/mfa/disable" class="settings-mfa-disable">
							<p class="settings-section-sub">To disable MFA, enter your current 6-digit code.</p>
							<div class="settings-mfa-row">
								<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" class="login-input" required pattern="[0-9]{6}" />
								<button type="submit" class="btn btn-danger">Disable MFA</button>
							</div>
						</form>
					</div>
					` : userTotpSetupSeed ? `
					<div class="settings-security-card settings-mfa-setup">
						<p class="settings-mfa-status"><span class="badge badge-warning">Setup in progress</span></p>
						<p>Scan this QR code with your authenticator app:</p>
						<img src="${userTotpSetupQr}" alt="MFA QR code" class="settings-qr" />
						<p class="settings-secret">Or enter manually: <code>${escapeHtml(userTotpSetupSeed)}</code></p>
						<form method="POST" action="/settings/mfa/verify" class="settings-mfa-verify">
							<input type="hidden" name="seed" value="${escapeHtml(userTotpSetupSeed)}" />
							<p>Enter the 6-digit code from your app to confirm setup:</p>
							<div class="settings-mfa-row">
								<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" class="login-input" required pattern="[0-9]{6}" autofocus />
								<button type="submit" class="btn btn-primary">Verify &amp; Enable</button>
							</div>
						</form>
						<form method="POST" action="/settings/mfa/cancel" class="settings-mfa-cancel">
							<button type="submit" class="btn btn-secondary">Cancel Setup</button>
						</form>
					</div>
					` : `
					<div class="settings-security-card">
						<p class="settings-mfa-status"><span class="badge badge-off">Disabled</span> Two-factor authentication is not enabled.</p>
						<form method="POST" action="/settings/mfa/setup">
							<button type="submit" class="btn btn-primary">Enable MFA</button>
						</form>
					</div>
					`}
				</section>
			</div>

			${isAdmin ? `<!-- Tab: Admin -->
			<div class="settings-tab-panel${tab === 'admin' ? ' active' : ''}" id="tab-admin">
				<section class="settings-section">
					<h2 class="settings-section-title">Create New User</h2>
					<form class="settings-form" method="POST" action="/admin/users">
					<div class="settings-grid">
						<label class="settings-field">
							<span>Email</span>
							<input type="email" class="login-input" name="email" required placeholder="user@example.com" />
						</label>
						<label class="settings-field">
							<span>Full name</span>
							<input type="text" class="login-input" name="fullName" placeholder="Full name" />
						</label>
						<label class="settings-field">
							<span>Password</span>
							<div class="login-password-wrap">
								${passwordField('password', { placeholder: 'Initial password' })}
							</div>
						</label>
					</div>
					<div class="settings-actions"><button type="submit" class="btn btn-primary">Create user</button></div>
					</form>
				</section>
				<section class="settings-section">
					<h2 class="settings-section-title">Users</h2>
					${adminUsers && adminUsers.length ? `<div class="admin-table-wrap"><table class="admin-table">
						<thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
						<tbody>${adminUsers.map(u => adminUserRow(u, user.id)).join('')}</tbody>
					</table></div>` : '<p class="settings-section-sub">No users found.</p>'}
				</section>
			</div>` : ''}
		</div>
	</div>
	<script>
	(function(){
		function bindRange(inputId,valueId,cssVar){var input=document.getElementById(inputId);var value=document.getElementById(valueId);if(!input||!value)return;document.body.style.setProperty(cssVar,input.value+'px');value.textContent=input.value+'px';input.addEventListener('input',function(){document.body.style.setProperty(cssVar,this.value+'px');value.textContent=this.value+'px'})}
		function bindMonospace(){var input=document.getElementById('settings-note-monospace');if(!input)return;document.body.classList.toggle('note-body-monospace',input.checked);input.addEventListener('change',function(){document.body.classList.toggle('note-body-monospace',this.checked)})}
		bindRange('settings-note-font','settings-note-font-value','--font-size-note');
		bindRange('settings-mobile-note-font','settings-mobile-note-font-value','--font-size-note-mobile');
		bindRange('settings-code-font','settings-code-font-value','--font-size-code');
		bindMonospace();
		window.saveSetting=function(key,value){
			var body=encodeURIComponent(key)+'='+encodeURIComponent(value);
			fetch('/api/web/settings',{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).catch(function(){});
			if(key==='theme'){
				document.body.classList.forEach(function(c){if(c.startsWith('theme-'))document.body.classList.remove(c)});
				document.body.classList.add('theme-'+value);
				try{localStorage.setItem('joplock-theme',value)}catch(e){}
			}
		};
		window.switchTab=function(name){
			document.querySelectorAll('.settings-tab').forEach(function(t){t.classList.toggle('active',t.dataset.tab===name)});
			document.querySelectorAll('.settings-tab-panel').forEach(function(p){p.classList.toggle('active',p.id==='tab-'+name)});
			try{localStorage.setItem('joplock-settings-tab',name)}catch(e){}
		};
		(function(){var saved=null;try{saved=localStorage.getItem('joplock-settings-tab')}catch(e){}var initial='${escapeHtml(tab)}';if(saved&&saved!==initial)switchTab(saved)})();
		document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.target.closest('dialog[open]')){window.location.href='/'}});
	})();
	</script>
</body>
</html>`;
};

module.exports = { adminUserRow, settingsPage };
