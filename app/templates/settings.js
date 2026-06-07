// Settings page and admin user row
'use strict';

const {
	escapeHtml,
	escapeJsString,
	appleSplashLinks,
	themeOptions,
	validDateFormats,
	validDatetimeFormats,
	passwordField,
} = require('./shared');
const { AI_PROVIDERS } = require('../settingsService');

const ASSET_VERSION = '20260519pwa22';

const formatBytes = value => {
	const bytes = Number(value || 0);
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let amount = bytes;
	let index = 0;
	while (amount >= 1024 && index < units.length - 1) {
		amount /= 1024;
		index += 1;
	}
	const digits = amount >= 10 || index === 0 ? 0 : 1;
	return `${amount.toFixed(digits)} ${units[index]}`;
};

const compressionUsageRows = usage => {
	const rows = usage && Array.isArray(usage.rows) ? usage.rows.filter(row => row.rowCount > 0) : [];
	if (!rows.length) return '<p class="settings-section-sub">No rows found.</p>';
	return `<div class="admin-table-wrap"><table class="admin-table">
		<thead><tr><th>Compression</th><th>Rows</th><th>Content bytes</th></tr></thead>
		<tbody>${rows.map(row => `<tr>
			<td><code>${escapeHtml(row.compression || 'none')}</code></td>
			<td>${escapeHtml(String(row.rowCount || 0))}</td>
			<td>${escapeHtml(formatBytes(row.totalBytes || 0))}</td>
		</tr>`).join('')}</tbody>
	</table></div>`;
};

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
	const { user, settings = {}, appSettings = {}, userTotpEnabled = false, userTotpSetupSeed = '', userTotpSetupQr = '', isAdmin = false, isDockerAdmin = false, adminUsers = null, backups = [], backupEnabled = false, backupBusy = false, maintenanceMode = false, activeOperation = '', dbCompression = null, flash = '', flashError = '', activeTab = 'appearance', hasExplicitTab = false } = options;
	const validTabs = ['appearance', 'ai', 'expander', 'profile', 'security'];
	if (isAdmin) validTabs.push('admin');
	const tab = validTabs.includes(activeTab) ? activeTab : 'appearance';
	const initialJob = JSON.stringify({
		state: backupBusy ? 'running' : 'idle',
		type: activeOperation || '',
		message: maintenanceMode ? `Maintenance mode active${activeOperation ? ` (${activeOperation})` : ''}` : '',
		fileName: '',
		bytesWritten: 0,
		error: '',
		stderrTail: '',
	});
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
	<meta name="theme-color" content="#08110b" />
	<link rel="manifest" href="/manifest.webmanifest?v=${ASSET_VERSION}" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	${appleSplashLinks}
	<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}" />
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
			${maintenanceMode ? `<div class="settings-flash settings-flash-err">Maintenance mode is active${activeOperation ? ` (${escapeHtml(activeOperation)})` : ''}.</div>` : ''}
			<div class="settings-tabs" role="tablist">
				<button type="button" role="tab" class="settings-tab${tab === 'appearance' ? ' active' : ''}" data-tab="appearance" onclick="switchTab('appearance')">Appearance</button>
				<button type="button" role="tab" class="settings-tab${tab === 'ai' ? ' active' : ''}" data-tab="ai" onclick="switchTab('ai')">AI</button>
				<button type="button" role="tab" class="settings-tab${tab === 'expander' ? ' active' : ''}" data-tab="expander" onclick="switchTab('expander')">Expander</button>
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

			<!-- Tab: AI -->
			<div class="settings-tab-panel${tab === 'ai' ? ' active' : ''}" id="tab-ai">
				<section class="settings-section">
					<h2 class="settings-section-title">AI Autocomplete</h2>
					<p class="settings-section-sub">Multi-provider AI prose and note suggestions — changes are saved automatically.</p>
					<div class="settings-grid">
					<div class="settings-field">
							<span>Autocomplete triggers</span>
							<span class="settings-field-hint">Configure AI autocomplete triggers in the Expander tab by setting an entry action to <strong>AI autocomplete</strong>.</span>
						</div>
					<label class="settings-field">
							<span>Sentences to complete</span>
							<input type="number" class="login-input" id="settings-prose-sentences" min="1" max="8" step="1" value="${escapeHtml(settings.proseAutocompleteSentenceCount || 1)}" onchange="saveSetting('proseAutocompleteSentenceCount',this.value)" />
							<span class="settings-field-hint">Total complete sentences to produce from the cursor. If you are mid-sentence, finishing it counts as 1.</span>
						</label>
						<div class="settings-field">
							<span>Note AI instructions</span>
							<span class="settings-field-hint">Add note-local guidance on its own line with <code>#! mention dogs in each paragraph once.</code></span>
						</div>
					</div>
				</section>
				<section class="settings-section">
					<h2 class="settings-section-title">AI Provider Profiles</h2>
					<p class="settings-section-sub">Add one or more named profiles — use the same provider multiple times with different models. The active profile is used for autocomplete. Keys are stored server-side only.</p>
					<div class="ai-profiles-bar">
						<label class="ai-profiles-bar-label">Active:
							<select id="ai-active-select" class="login-input ai-active-select" onchange="setActiveAiProfile(this.value)"></select>
						</label>
						<button type="button" class="btn btn-sm btn-secondary" onclick="addAiProfile()">+ Add Profile</button>
						<button type="button" class="btn btn-sm btn-primary" onclick="saveAiProfiles()">Save</button>
					</div>
					<div class="ai-profiles" id="ai-profiles-list"></div>
				</section>
			</div>

			<!-- Tab: Expander -->
			<div class="settings-tab-panel${tab === 'expander' ? ' active' : ''}" id="tab-expander">
				<section class="settings-section">
					<h2 class="settings-section-title">Text Expander</h2>
					<p class="settings-section-sub">Create plaintext triggers that expand while writing notes. Changes are saved automatically.</p>
					<div class="ai-profiles-bar">
						<button type="button" class="btn btn-sm btn-secondary" onclick="addTextExpander()">+ Add Entry</button>
					</div>
					<div class="ai-profiles" id="text-expanders-list"></div>
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
					<h2 class="settings-section-title">Login Security</h2>
					<p class="settings-section-sub">Allow this many failed login or MFA attempts from the same source within 15 minutes before blocking with HTTP 429.</p>
					<form class="settings-form" method="POST" action="/admin/security">
						<div class="settings-grid">
							<label class="settings-field">
								<span>Allowed attempts per 15 minutes</span>
								<input type="number" class="login-input" name="authRateLimitAttempts" min="1" max="1000" value="${escapeHtml(appSettings.authRateLimitAttempts != null ? appSettings.authRateLimitAttempts : 20)}" />
							</label>
						</div>
						<div class="settings-actions"><button type="submit" class="btn btn-primary">Save security settings</button></div>
					</form>
				</section>
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
				<section class="settings-section">
					<h2 class="settings-section-title">Database Compression</h2>
					<p class="settings-section-sub">Live Postgres compression usage from the database. Changing the default affects new rows only.</p>
					<section class="settings-security-card" style="margin-bottom:16px">
						<p class="settings-mfa-status"><span class="badge badge-off">PostgreSQL version</span> <code>${escapeHtml(dbCompression && dbCompression.pgVersion ? dbCompression.pgVersion : 'unknown')}</code></p>
						${dbCompression && dbCompression.supported === false ? `<p class="settings-section-sub">Toast compression settings require PostgreSQL 14 or later.</p>` : `
						<p class="settings-mfa-status"><span class="badge badge-off">Default for new rows</span> <code>${escapeHtml(dbCompression && dbCompression.current ? dbCompression.current : 'unknown')}</code></p>
						<form method="POST" action="/admin/db-compression" class="settings-form" style="margin-top:12px">
							<div class="settings-grid">
								<label class="settings-field">
									<span>Default compression</span>
									<select class="login-input" name="defaultToastCompression" required>
										${(dbCompression && Array.isArray(dbCompression.available) ? dbCompression.available : []).map(mode => `<option value="${escapeHtml(mode)}"${dbCompression && dbCompression.current === mode ? ' selected' : ''}>${escapeHtml(mode)}</option>`).join('')}
									</select>
								</label>
							</div>
							<div class="settings-actions"><button type="submit" class="btn btn-primary">Apply for new items</button></div>
						</form>`}
					</section>
					${dbCompression && dbCompression.supported === false ? '' : `
					<section class="settings-security-card" style="margin-bottom:16px">
						<h3 class="settings-section-title" style="font-size:15px">Notes</h3>
						<p class="settings-mfa-status"><span class="badge badge-off">Current usage</span> <code>${escapeHtml(dbCompression && dbCompression.usage && dbCompression.usage.notes ? dbCompression.usage.notes.current : 'unknown')}</code></p>
						${compressionUsageRows(dbCompression && dbCompression.usage ? dbCompression.usage.notes : null)}
					</section>
					<section class="settings-security-card" style="margin-bottom:16px">
						<h3 class="settings-section-title" style="font-size:15px">Attachments</h3>
						<p class="settings-mfa-status"><span class="badge badge-off">Current usage</span> <code>${escapeHtml(dbCompression && dbCompression.usage && dbCompression.usage.attachments ? dbCompression.usage.attachments.current : 'unknown')}</code></p>
						${compressionUsageRows(dbCompression && dbCompression.usage ? dbCompression.usage.attachments : null)}
					</section>`}
				</section>
				<section class="settings-section">
					<h2 class="settings-section-title">Backup &amp; Restore</h2>
					<p class="settings-section-sub">Create and restore full Postgres backups for Joplin and Joplock.</p>
					${backupEnabled ? `
					<div class="settings-security-card" id="admin-backup-status" data-initial='${escapeHtml(initialJob)}' style="margin-bottom:16px">
						<p class="settings-mfa-status"><span class="badge ${backupBusy ? 'badge-warning' : 'badge-off'}" id="admin-backup-badge">${backupBusy ? 'Running' : 'Idle'}</span> <span id="admin-backup-message">${maintenanceMode ? escapeHtml(`Maintenance mode active${activeOperation ? ` (${activeOperation})` : ''}`) : 'No backup job running.'}</span></p>
						<pre id="admin-backup-log" class="settings-section-sub" style="white-space:pre-wrap;display:none"></pre>
					</div>
					<form method="POST" action="/admin/backups" style="margin-bottom:16px" data-backup-form="admin">
						<label class="settings-field" style="margin-bottom:12px;display:block">
							<span>Compression</span>
							<select class="login-input" name="compressionMode" data-backup-mode>
								<option value="zstd" selected>Zstd (zstd:3)</option>
								<option value="fast">Fast (gzip:1)</option>
								<option value="uncompressed">Uncompressed</option>
							</select>
						</label>
						<button type="submit" class="btn btn-primary"${backupBusy ? ' disabled' : ''}>Create backup</button>
					</form>
					${backups.length ? `<div class="admin-table-wrap"><table class="admin-table">
						<thead><tr><th>File</th><th>Created</th><th>Size</th><th>Actions</th></tr></thead>
						<tbody>${backups.map(b => `<tr>
							<td><code>${escapeHtml(b.name)}</code></td>
							<td>${escapeHtml(new Date(b.createdTime).toISOString())}</td>
							<td>${escapeHtml(formatBytes(b.size))}</td>
							<td class="admin-actions-cell"><div class="admin-backup-actions"><a class="btn btn-icon btn-icon-compact btn-secondary" href="/admin/backups/${encodeURIComponent(b.name)}/download" title="Download backup" aria-label="Download backup ${escapeHtml(b.name)}">&#8595;</a><form method="POST" action="/admin/backups/${encodeURIComponent(b.name)}/delete" class="admin-inline-form" onsubmit="return confirm('Delete backup ${escapeJsString(b.name)}? This cannot be undone.')"><button type="submit" class="btn btn-icon btn-icon-compact btn-danger-soft" title="Delete backup" aria-label="Delete backup ${escapeHtml(b.name)}">&#128465;</button></form></div></td>
						</tr>`).join('')}</tbody>
					</table></div>` : '<p class="settings-section-sub">No backups found yet.</p>'}
					<form class="settings-form" method="POST" action="/admin/restore" style="margin-top:16px">
						<div class="settings-grid">
							<label class="settings-field">
								<span>Backup file</span>
								<select class="login-input" name="backupName" required>
									<option value="">Select backup</option>
									${backups.map(b => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('')}
								</select>
							</label>
							<label class="settings-field">
								<span>Confirmation</span>
								<input type="text" class="login-input" name="confirm" placeholder="Type RESTORE" required />
							</label>
						</div>
						<div class="settings-actions"><button type="submit" class="btn btn-danger"${backupBusy ? ' disabled' : ''}>Restore backup</button></div>
					</form>
					<p class="settings-section-sub" style="margin-top:12px">If normal login is unavailable, use <code>/recovery</code> with the deployment recovery password.</p>
					` : `<p class="settings-section-sub">Backups are not configured. Set <code>JOPLOCK_BACKUP_DIR</code> in deployment config.</p>`}
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
		(function(){
			var _expanderProfiles=${JSON.stringify((Array.isArray(settings.aiProfiles) ? settings.aiProfiles : []).map(p => ({ id: p.id, name: p.name || p.model || p.providerId || 'AI profile', hasKey: !!p.apiKey })))};
			var _expanders=${JSON.stringify(Array.isArray(settings.textExpanders) ? settings.textExpanders : [])};
			function _escExp(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
			function _genExpId(){return'te-'+Math.random().toString(36).slice(2,9)+Date.now().toString(36)}
			function _readExpanders(){var list=document.getElementById('text-expanders-list');if(!list)return _expanders.slice();var out=[];list.querySelectorAll('[data-expander-id]').forEach(function(card){var id=card.dataset.expanderId||_genExpId();var trigger=card.querySelector('[data-field="trigger"]');var action=card.querySelector('[data-field="action"]');var profileId=card.querySelector('[data-field="profileId"]');var text=card.querySelector('[data-field="text"]');out.push({id:id,trigger:trigger?trigger.value:'',action:action?action.value:'text',profileId:profileId?profileId.value:'',text:text?text.value:''})});return out}
			function _profileOptions(selected){var opts='<option value="">Active AI profile</option>';opts+=_expanderProfiles.map(function(p){return'<option value="'+_escExp(p.id)+'"'+(selected===p.id?' selected':'')+'>'+_escExp(p.name)+(p.hasKey?'':' (no key)')+'</option>'}).join('');return opts}
			function _renderExpander(entry){var action=entry.action==='ai'?'ai':'text';return'<div class="ai-profile-card" data-expander-id="'+_escExp(entry.id||_genExpId())+'"><div class="ai-profile-header"><input type="text" class="login-input ai-profile-name-input" data-field="trigger" value="'+_escExp(entry.trigger)+'" maxlength="15" placeholder="Trigger, e.g. ;sig" /><select class="login-input" data-field="action"><option value="text"'+(action==='text'?' selected':'')+'>Expand text</option><option value="ai"'+(action==='ai'?' selected':'')+'>AI autocomplete</option></select><button type="button" class="btn btn-sm btn-secondary" data-remove-expander>Remove</button></div><div class="ai-profile-body"><label class="ai-profile-field" data-expander-text-field style="grid-column:1/-1;display:'+(action==='ai'?'none':'block')+'"><span>Expand into</span><textarea class="login-input" data-field="text" rows="4" placeholder="Replacement text">'+_escExp(entry.text)+'</textarea></label><label class="ai-profile-field" data-expander-ai-field style="grid-column:1/-1;display:'+(action==='ai'?'block':'none')+'"><span>AI profile</span><select class="login-input" data-field="profileId">'+_profileOptions(entry.profileId||'')+'</select><span class="settings-field-hint">Runs prose autocomplete using this profile, or the active profile if blank.</span></label></div></div>'}
			function _renderExpanders(){var list=document.getElementById('text-expanders-list');if(!list)return;list.innerHTML=_expanders.length===0?'<p class="settings-section-sub" style="margin-top:8px">No entries yet. Click <strong>+ Add Entry</strong> to create one.</p>':_expanders.map(_renderExpander).join('')}
			var _expanderSaveTimer=null;
			function _saveExpandersSoon(){clearTimeout(_expanderSaveTimer);_expanderSaveTimer=setTimeout(function(){_expanders=_readExpanders();saveSetting('textExpanders',JSON.stringify(_expanders))},250)}
			window.addTextExpander=function(){_expanders=_readExpanders();_expanders.push({id:_genExpId(),trigger:'',text:''});_renderExpanders();_saveExpandersSoon()};
			document.addEventListener('input',function(e){if(e.target&&e.target.closest&&e.target.closest('#text-expanders-list'))_saveExpandersSoon()});
			document.addEventListener('change',function(e){var card=e.target&&e.target.closest?e.target.closest('[data-expander-id]'):null;if(!card)return;var action=card.querySelector('[data-field="action"]');var textField=card.querySelector('[data-expander-text-field]');var aiField=card.querySelector('[data-expander-ai-field]');var isAi=action&&action.value==='ai';if(textField)textField.style.display=isAi?'none':'block';if(aiField)aiField.style.display=isAi?'block':'none';_saveExpandersSoon()});
			document.addEventListener('click',function(e){var btn=e.target&&e.target.closest?e.target.closest('[data-remove-expander]'):null;if(!btn)return;var card=btn.closest('[data-expander-id]');if(card)card.remove();_expanders=_readExpanders();_renderExpanders();_saveExpandersSoon()});
			_renderExpanders();
		})();
		(function(){
			var _providerList=${JSON.stringify(AI_PROVIDERS)};
			var _providerMap={};_providerList.forEach(function(p){_providerMap[p.id]=p});
			var _profiles=${JSON.stringify(Array.isArray(settings.aiProfiles) ? settings.aiProfiles : [])};
			function _esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
			function _genId(){return'p-'+Math.random().toString(36).slice(2,9)+Date.now().toString(36)}
			function _readProfiles(){var list=document.getElementById('ai-profiles-list');if(!list)return _profiles.slice();var updated=_profiles.map(function(p){return Object.assign({},p)});list.querySelectorAll('[data-pid][data-field]').forEach(function(el){var id=el.dataset.pid;var field=el.dataset.field;var entry=updated.find(function(p){return p.id===id});if(entry)entry[field]=el.value});return updated}
			function _updateActiveSelect(){var sel=document.getElementById('ai-active-select');if(!sel)return;sel.innerHTML=_profiles.length===0?'<option value="">\u2014 no profiles \u2014</option>':_profiles.map(function(p){return'<option value="'+_esc(p.id)+'"'+(p.active?' selected':'')+'>'+_esc(p.name||'(unnamed)')+'</option>'}).join('')}
			function _renderCard(p){var prov=_providerMap[p.providerId]||_providerMap['openrouter']||{};var isCustom=!prov.url;var temp=p.temperature!=null?p.temperature:0.7;return'<div class="ai-profile-card'+(p.active?' ai-profile-card-active':'')+'" id="ai-profile-card-'+_esc(p.id)+'"><div class="ai-profile-header"><input type="text" class="login-input ai-profile-name-input" data-pid="'+_esc(p.id)+'" data-field="name" value="'+_esc(p.name)+'" placeholder="Profile name" /><select class="login-input ai-profile-provider-select" data-pid="'+_esc(p.id)+'" data-field="providerId" onchange="onAiProviderChange()">'+_providerList.map(function(pv){return'<option value="'+_esc(pv.id)+'"'+(p.providerId===pv.id?' selected':'')+'>'+_esc(pv.name)+'</option>'}).join('')+'</select>'+(p.active?'<span class="badge badge-ok">Active</span>':'')+'<button type="button" class="btn btn-sm btn-secondary" data-remove-pid="'+_esc(p.id)+'">Remove</button></div><div class="ai-profile-body"><label class="ai-profile-field"><span>API Key</span><input type="text" class="login-input" data-pid="'+_esc(p.id)+'" data-field="apiKey" value="'+_esc(p.apiKey)+'" placeholder="API key" autocomplete="off" /></label><label class="ai-profile-field"><span>Model</span><input type="text" class="login-input" data-pid="'+_esc(p.id)+'" data-field="model" value="'+_esc(p.model)+'" placeholder="'+_esc(prov.defaultModel||'model slug')+'" /></label><label class="ai-profile-field"><span>Temperature</span><input type="number" class="login-input" data-pid="'+_esc(p.id)+'" data-field="temperature" value="'+_esc(temp)+'" min="0" max="2" step="0.1" /></label>'+(isCustom?'<label class="ai-profile-field"><span>API URL</span><input type="text" class="login-input" data-pid="'+_esc(p.id)+'" data-field="url" value="'+_esc(p.url)+'" placeholder="https://api.example.com/v1/chat/completions" /></label>':'<div class="ai-profile-field"><span>API URL</span><span class="settings-field-hint"><code>'+_esc(prov.url)+'</code></span></div>')+'<div class="ai-profile-actions"><button type="button" class="btn btn-sm btn-secondary" data-test-pid="'+_esc(p.id)+'">Test</button><span class="ai-test-result" id="ai-test-result-'+_esc(p.id)+'"></span></div></div></div>'}
			function _render(){var list=document.getElementById('ai-profiles-list');if(!list)return;list.innerHTML=_profiles.length===0?'<p class="settings-section-sub" style="margin-top:8px">No profiles yet. Click <strong>+ Add Profile</strong> to create one.</p>':_profiles.map(_renderCard).join('');_updateActiveSelect()}
			window.addAiProfile=function(){_profiles=_readProfiles();_profiles.push({id:_genId(),name:'',providerId:'openrouter',apiKey:'',model:'',url:'',temperature:0.7,active:_profiles.length===0});_render()};
			window.removeAiProfile=function(profileId){_profiles=_readProfiles().filter(function(p){return p.id!==profileId});if(_profiles.length>0&&!_profiles.some(function(p){return p.active}))_profiles[0].active=true;_render()};
			window.onAiProviderChange=function(){_profiles=_readProfiles();_render()};
			window.setActiveAiProfile=function(profileId){_profiles=_readProfiles();_profiles.forEach(function(p){p.active=p.id===profileId});_render();saveSetting('aiProfiles',JSON.stringify(_profiles))};
			window.saveAiProfiles=function(){_profiles=_readProfiles();saveSetting('aiProfiles',JSON.stringify(_profiles))};
			window.testAiProfile=function(profileId){
				_profiles=_readProfiles();
				var el=document.getElementById('ai-test-result-'+profileId);
				if(el){el.textContent='Saving\u2026';el.className='ai-test-result'}
				var body='aiProfiles='+encodeURIComponent(JSON.stringify(_profiles));
				fetch('/api/web/settings',{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body})
					.then(function(){if(el)el.textContent='Testing\u2026';return fetch('/api/web/ai/test-profile',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'profileId='+encodeURIComponent(profileId)})})
					.then(function(r){return r.json()})
					.then(function(data){
						if(data&&!data.ok)console.warn('[joplock] AI provider test failed',{status:data.providerStatus,response:data.response,providerError:data.providerError});
						if(!el)return;
						if(data.ok){el.textContent='\u2713 '+data.ms+'ms';el.className='ai-test-result ai-test-ok'}
						else{el.textContent='\u2717 '+(data.response||data.error||'Failed');el.className='ai-test-result ai-test-fail'}
					})
					.catch(function(err){console.warn('[joplock] AI provider test request failed',err&&err.message?err.message:err);if(el){el.textContent='\u2717 Network error';el.className='ai-test-result ai-test-fail'}})
			};
			document.addEventListener('click',function(e){var btn=e.target&&e.target.closest?e.target.closest('[data-remove-pid],[data-test-pid]'):null;if(!btn)return;if(btn.dataset.removePid)removeAiProfile(btn.dataset.removePid);if(btn.dataset.testPid)testAiProfile(btn.dataset.testPid)});
			_render();
		})();
		(function(){var saved=null;try{saved=localStorage.getItem('joplock-settings-tab')}catch(e){}var initial='${escapeHtml(tab)}';var hasExplicitTab=${hasExplicitTab ? 'true' : 'false'};if(!hasExplicitTab&&saved&&saved!==initial)switchTab(saved)})();
		(function(){
			var key='joplock-backup-compression-mode';
			document.querySelectorAll('[data-backup-form]').forEach(function(form){
				var select=form.querySelector('[data-backup-mode]');
				if(!select)return;
				try{var saved=localStorage.getItem(key);if(saved&&Array.from(select.options).some(function(o){return o.value===saved}))select.value=saved}catch(e){}
				select.addEventListener('change',function(){try{localStorage.setItem(key,select.value)}catch(e){}});
			});
		})();
		(function(){
			var panel=document.getElementById('admin-backup-status');
			if(!panel)return;
			var badge=document.getElementById('admin-backup-badge');
			var msg=document.getElementById('admin-backup-message');
			var log=document.getElementById('admin-backup-log');
			var reloaded=false;
			var lastState='idle';
			function render(job){
				if(!job)return;
				var state=job.state||'idle';
				badge.textContent=state.charAt(0).toUpperCase()+state.slice(1);
				badge.className='badge '+(state==='running'?'badge-warning':(state==='completed'?'badge-ok':(state==='failed'?'badge-off':'badge-off')));
				msg.textContent=job.message||'No backup job running.';
				var extra=job.error||job.stderrTail||'';
				if(extra){log.style.display='block';log.textContent=extra}else{log.style.display='none';log.textContent=''}
				if(lastState==='running'&&(state==='completed'||state==='failed')&&!reloaded){reloaded=true;setTimeout(function(){window.location.reload()},1200)}
				lastState=state;
			}
			try{render(JSON.parse(panel.getAttribute('data-initial')||'{}'))}catch(e){}
			setInterval(function(){fetch('/admin/status',{headers:{'Accept':'application/json'}}).then(function(r){return r.ok?r.json():null}).then(function(data){if(data&&data.job)render(data.job)}).catch(function(){})},1500)
		})();
		document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;if(e.defaultPrevented)return;if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable))return;if(document.querySelector('dialog[open]'))return;window.location.href='/'});
	})();
	</script>
</body>
</html>`;
};

module.exports = { adminUserRow, settingsPage };
