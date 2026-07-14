/* joplock client application — extracted from templates.js */
/* Server config is passed via window._joplockConfig set inline before this script loads */
(function(){
var _cfg=window._joplockConfig||{};
var _dbg=_cfg.debug||false;
var _assetVersion='20260519pwa22';
var _openRouterEnabled=!!_cfg.openRouterEnabled;
var _textExpanders=Array.isArray(_cfg.textExpanders)?_cfg.textExpanders.filter(function(e){return e&&e.trigger&&(e.action==='ai'||e.text!=null)}).map(function(e){return{id:String(e.id||''),trigger:String(e.trigger),action:e.action==='ai'?'ai':'text',profileId:String(e.profileId||''),text:String(e.text||'')}}):[];
function _log(){if(!_dbg)return;var a=Array.prototype.slice.call(arguments);a.unshift('[joplock]');console.log.apply(console,a)}
function _clientLog(event,data){try{var safe={};Object.keys(data||{}).forEach(function(k){if(/text|body|content|password|key|secret|token/i.test(k))return;var v=data[k];if(typeof v==='string')safe[k]=v.slice(0,120);else if(typeof v==='number'||typeof v==='boolean'||v===null)safe[k]=v});fetch('/api/web/client-log',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'event='+encodeURIComponent(event)+'&data='+encodeURIComponent(JSON.stringify(safe))}).catch(function(){})}catch(e){}}
if('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js?v='+encodeURIComponent(_assetVersion),{updateViaCache:'none'}).catch(function(){});
// If the browser restores this page from bfcache, force a reload so the server can validate the session
window.addEventListener('pageshow',function(e){if(e.persisted){_log('bfcache restore detected, reloading');window.location.reload()}});
function syncThemeColor(){var meta=document.querySelector('meta[name="theme-color"]');if(!meta)return;var color=getComputedStyle(document.body).getPropertyValue('--theme-color').trim();if(color)meta.setAttribute('content',color)}
function setTheme(t){document.body.classList.forEach(function(c){if(c.startsWith('theme-'))document.body.classList.remove(c)});document.body.classList.add('theme-'+t);syncThemeColor();localStorage.setItem('joplock-theme',t);_syncTinyMCEThemeVars();fetch('/api/web/theme',{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'theme='+encodeURIComponent(t)}).catch(function(){})}

// --- Encryption (vault-based client-side E2EE) ---
var PBKDF2_ITERATIONS=210000;
var ENCRYPTION_VERSION=2;
var ENCRYPTED_START='<!--joplock-encrypted-start-->';
var ENCRYPTED_END='<!--joplock-encrypted-end-->';
var ENCRYPTED_WRAPPER_HEAD='> **\uD83D\uDD12 This note is encrypted by Joplock**\n>\n> This note\'s content is encrypted and can only be viewed in Joplock.\n> Do not edit the data below \u2014 editing will permanently corrupt the encrypted content.\n\n';

var SVG_LOCK_CLOSED='<svg class="vault-svg-icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke-width="2.5"/></svg>';
var SVG_LOCK_OPEN='<svg class="vault-svg-icon" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="15" width="18" height="11" rx="2"/><path d="M7 15V8a5 5 0 0 1 10 0"/></svg>';

function isEncryptedBody(body){return typeof body==='string'&&body.indexOf(ENCRYPTED_START)>=0}

function extractCiphertext(body){
	var start=body.indexOf(ENCRYPTED_START);
	var end=body.indexOf(ENCRYPTED_END);
	if(start<0||end<0)return null;
	var json=body.slice(start+ENCRYPTED_START.length,end).trim();
	try{var obj=JSON.parse(json);return obj.joplock_encrypted?json:null}catch(e){return null}
}

function wrapCiphertext(jsonString){
	return ENCRYPTED_WRAPPER_HEAD+ENCRYPTED_START+'\n'+jsonString+'\n'+ENCRYPTED_END+'\n';
}

function _b64Encode(buf){var bytes=new Uint8Array(buf);var bin='';var chunk=0x8000;for(var i=0;i<bytes.length;i+=chunk){bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk))}return btoa(bin)}
function _b64Decode(str){var bin=atob(str);var buf=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);return buf}

async function deriveKey(password,salt){
	var enc=new TextEncoder();
	var keyMaterial=await crypto.subtle.importKey('raw',enc.encode(password),{name:'PBKDF2'},false,['deriveKey']);
	return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},keyMaterial,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
}

async function exportKey(cryptoKey){var jwk=await crypto.subtle.exportKey('jwk',cryptoKey);return btoa(JSON.stringify(jwk))}
async function importKey(jwkBase64){var jwk=JSON.parse(atob(jwkBase64));return crypto.subtle.importKey('jwk',jwk,{name:'AES-GCM',length:256},true,['encrypt','decrypt'])}

// Encrypt plaintext for a vault. Returns wrapped ciphertext string.
// vaultId: folder jop_id (stored in ciphertext for reference)
// key: CryptoKey (pre-derived vault key)
// salt: Uint8Array (vault salt, stored redundantly in ciphertext for resilience)
async function encryptForVault(plaintext,vaultId,key,salt){
	var iv=crypto.getRandomValues(new Uint8Array(12));
	var enc=new TextEncoder();
	var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,enc.encode(plaintext));
	var obj={joplock_encrypted:1,v:ENCRYPTION_VERSION,vault:vaultId,salt:_b64Encode(salt),iv:_b64Encode(iv),ct:_b64Encode(ct)};
	return wrapCiphertext(JSON.stringify(obj));
}

// Decrypt with a pre-derived CryptoKey (vault key or any AES-GCM key)
async function _decryptWithKey(wrappedBody,key){
	var json=extractCiphertext(wrappedBody);
	if(!json)throw new Error('No encrypted data');
	var obj=JSON.parse(json);
	var iv=_b64Decode(obj.iv);
	var ct=_b64Decode(obj.ct);
	var dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},key,ct);
	return new TextDecoder().decode(dec);
}

// v1 compat: decrypt with password (derives key from embedded salt)
async function decryptBody(password,wrappedBody){
	var json=extractCiphertext(wrappedBody);
	if(!json)throw new Error('No encrypted data found');
	var obj=JSON.parse(json);
	if(!obj.joplock_encrypted)throw new Error('Not an encrypted blob');
	var salt=_b64Decode(obj.salt);
	var iv=_b64Decode(obj.iv);
	var ct=_b64Decode(obj.ct);
	var key=await deriveKey(password,salt);
	var dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},key,ct);
	return new TextDecoder().decode(dec);
}

// Get the vault folderId embedded in an encrypted body (v2 only), or null
function getBodyVaultId(body){
	var json=extractCiphertext(body);
	if(!json)return null;
	try{var obj=JSON.parse(json);return obj.vault||null}catch(e){return null}
}

// --- Per-vault key management (sessionStorage keyed by folderId) ---
var _VAULT_KEY_PFX='joplock-vault-key-';
var _VAULT_CHECK_PLAINTEXT='joplock_vault_check';

function _vaultKeyStorageKey(folderId){return _VAULT_KEY_PFX+folderId}

// Cache a derived vault key in sessionStorage
async function cacheVaultKey(folderId,key,salt){
	var jwk=await exportKey(key);
	sessionStorage.setItem(_vaultKeyStorageKey(folderId),JSON.stringify({jwk:jwk,salt:_b64Encode(salt)}));
}

// Get a cached vault key from sessionStorage. Returns CryptoKey or null.
async function getVaultKey(folderId){
	try{
		var stored=sessionStorage.getItem(_vaultKeyStorageKey(folderId));
		if(!stored)return null;
		var obj=JSON.parse(stored);
		return await importKey(obj.jwk);
	}catch(e){return null}
}

// Get cached salt for a vault
function getVaultSalt(folderId){
	try{
		var stored=sessionStorage.getItem(_vaultKeyStorageKey(folderId));
		if(!stored)return null;
		var obj=JSON.parse(stored);
		return _b64Decode(obj.salt);
	}catch(e){return null}
}

// Check if a vault is currently unlocked (key in sessionStorage)
function isVaultUnlocked(folderId){
	try{
		var unlocked=!!sessionStorage.getItem(_vaultKeyStorageKey(folderId));
		return unlocked;
	}catch(e){
		_log('isVaultUnlocked error',folderId,e);
		return false;
	}
}

// Clear a vault's key from sessionStorage (lock the vault)
function clearVaultKey(folderId){
	try{
		_log('clearVaultKey',folderId);
		sessionStorage.removeItem(_vaultKeyStorageKey(folderId));
	}catch(e){_log('clearVaultKey error',folderId,e)}
}

// Clear ALL vault keys from sessionStorage
function clearAllVaultKeys(){
	try{
		var toRemove=[];
		for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);if(k&&k.startsWith(_VAULT_KEY_PFX))toRemove.push(k)}
		toRemove.forEach(function(k){sessionStorage.removeItem(k)});
	}catch(e){}
}

// Derive vault key from password + salt, verify against check blob, cache if correct.
// Returns true if successful.
async function unlockVault(folderId,password){
	try{
		_log('unlockVault start',folderId,{passwordLength:(password||'').length});
		// Fetch vault data (salt + verify) from server
		var resp=await fetch('/api/web/vaults/'+encodeURIComponent(folderId),{method:'GET'});
		if(!resp.ok){_log('unlockVault fetch failed',folderId,{status:resp.status});return false}
		var data=await resp.json();
		var vault=data.item;
		if(!vault){_log('unlockVault missing vault payload',folderId);return false}
		var salt=_b64Decode(vault.salt);
		var key=await deriveKey(password,salt);
		// Verify: decrypt the check blob
		var verifyObj=JSON.parse(atob(vault.verify));
		var iv=_b64Decode(verifyObj.iv);
		var ct=_b64Decode(verifyObj.ct);
		var dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},key,ct);
		var plain=new TextDecoder().decode(dec);
		if(plain!==_VAULT_CHECK_PLAINTEXT){_log('unlockVault verify mismatch',folderId);return false}
		// Success — cache key
		await cacheVaultKey(folderId,key,salt);
		_log('unlockVault success',folderId);
		return true;
	}catch(e){
		_log('unlockVault error',e);
		return false;
	}
}

// Build a verify blob from a password and salt for vault creation
async function buildVaultVerify(key){
	var iv=crypto.getRandomValues(new Uint8Array(12));
	var enc=new TextEncoder();
	var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,enc.encode(_VAULT_CHECK_PLAINTEXT));
	return btoa(JSON.stringify({iv:_b64Encode(iv),ct:_b64Encode(ct)}));
}

// Create a vault: derive key, build verify, POST to server, cache key
async function createVault(folderId,password){
	var salt=crypto.getRandomValues(new Uint8Array(16));
	var key=await deriveKey(password,salt);
	var verify=await buildVaultVerify(key);
	var saltB64=_b64Encode(salt);
	var resp=await fetch('/api/web/vaults',{
		method:'POST',
		headers:{'Content-Type':'application/json'},
		body:JSON.stringify({folderId:folderId,salt:saltB64,verify:verify})
	});
	if(!resp.ok){var err=await resp.json().catch(function(){return{}});throw new Error(err.error||'Failed to create vault')}
	await cacheVaultKey(folderId,key,salt);
	return true;
}

// Auto-lock timer (per-vault)
var _autoLockMinutes=Number(_cfg.encryptionAutoLockMinutes)||5;
var _autoLockActivity={};// folderId -> timestamp
var _autoLockTimer=null;

function touchVaultActivity(folderId){if(folderId)_autoLockActivity[folderId]=Date.now()}
function startAutoLockTimer(){
	if(_autoLockTimer||_autoLockMinutes<=0)return;
	_autoLockTimer=setInterval(function(){
		if(_autoLockMinutes<=0)return;
		var now=Date.now();
		var timeoutMs=_autoLockMinutes*60*1000;
		try{
			var toRemove=[];
			for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);if(k&&k.startsWith(_VAULT_KEY_PFX))toRemove.push(k)}
			toRemove.forEach(function(sk){
				var folderId=sk.slice(_VAULT_KEY_PFX.length);
				var last=_autoLockActivity[folderId]||0;
				if(now-last>timeoutMs){
					clearVaultKey(folderId);
					delete _autoLockActivity[folderId];
					_log('auto-lock: locked vault',folderId);
					// If currently open note belongs to this vault, close it
					var form=activeEditorForm();
					if(form){
						var noteBodyVault=form.dataset.vaultId||getBodyVaultId((getTA()||{}).value||'');
						if(noteBodyVault===folderId){
							var panel=form.closest('#editor-panel')||document.getElementById('editor-panel');
							if(panel)panel.innerHTML='<div class="editor-empty">Select a note</div>';
							hideTinyMCEHost();
						}
					}
				}
			});
		}catch(e){}
	},30000);
}

// Do not clear vault keys on ordinary same-tab navigation between notes/pages.
// They are session-scoped and are explicitly cleared on logout/login cleanup.
;

var _defaultNoteOpenMode=_cfg.noteOpenMode||'preview';
var _highlightActiveLine=_cfg.highlightActiveLine!==false;
var _mobileStartup=_cfg.mobileStartup||null;
var _uiMode=_cfg.uiMode||'auto';
var _mobileShellMaxWidth=768;
function viewportWidth(){return Math.max(window.innerWidth||0,document.documentElement&&document.documentElement.clientWidth||0)}
function viewportHeight(){return Math.max(window.innerHeight||0,document.documentElement&&document.documentElement.clientHeight||0)}
function visualViewportBounds(){var vv=window.visualViewport;return vv?{left:vv.offsetLeft||0,top:vv.offsetTop||0,width:vv.width||viewportWidth(),height:vv.height||viewportHeight()}:{left:0,top:0,width:viewportWidth(),height:viewportHeight()}}
var _lastViewportWidth=viewportWidth();
var _resizeTimer=null;
var _traceKey='joplock-debug-trace';
function isMobileShellMode(){if(_uiMode==='mobile')return true;if(_uiMode==='desktop')return false;return viewportWidth()<=_mobileShellMaxWidth}
function isDesktopMode(){return !isMobileShellMode()}
function _trace(){if(!_dbg)return;try{var line='['+new Date().toISOString().slice(11,23)+'] '+Array.prototype.slice.call(arguments).map(function(v){return typeof v==='string'?v:JSON.stringify(v)}).join(' ');var arr=JSON.parse(sessionStorage.getItem(_traceKey)||'[]');arr.push(line);if(arr.length>80)arr=arr.slice(arr.length-80);sessionStorage.setItem(_traceKey,JSON.stringify(arr));console.log('[trace]',line)}catch(_e){}}
function _traceDump(){if(!_dbg)return;try{var arr=JSON.parse(sessionStorage.getItem(_traceKey)||'[]');for(var i=0;i<arr.length;i++)console.log(arr[i])}catch(_e){}}
window.joplockTraceDump=_traceDump;
if(_dbg)_trace('boot',{w:viewportWidth(),mobile:isMobileShellMode(),startup:!!_mobileStartup});
function handleViewportResize(){
	// Immediately disable transitions during resize
	document.body.classList.add('resizing');
	if(_resizeTimer)clearTimeout(_resizeTimer);
	_resizeTimer=setTimeout(function(){
		document.body.classList.remove('resizing');
		// After resize settles, sync shell mode (defined inside mobile IIFE, exposed via window)
		if(window._syncResponsiveMode)window._syncResponsiveMode();
	},200);
}
(function(){var serverTheme=_cfg.theme||'matrix';var s=localStorage.getItem('joplock-theme');var e=document.querySelector('.theme-picker');if(s&&s!==serverTheme){localStorage.setItem('joplock-theme',serverTheme)}if(e)e.value=serverTheme})();
window.addEventListener('pageshow',function(e){if(e.persisted)window.location.replace('/login')});
function setMobileNav(open){var nav=document.getElementById('nav-panel');var bd=document.getElementById('mobile-nav-backdrop');if(!nav||!bd)return;nav.classList.toggle('open',open);bd.classList.toggle('open',open);document.body.classList.toggle('mobile-nav-open',open)}
function toggleNav(){if(isMobileShellMode()){var nav=document.getElementById('nav-panel');if(!nav)return;setMobileNav(!nav.classList.contains('open'))}else{document.body.classList.toggle('nav-collapsed');localStorage.setItem('joplock-nav-collapsed',document.body.classList.contains('nav-collapsed')?'1':'')}}
function closeNav(){setMobileNav(false)}
(function(){if(localStorage.getItem('joplock-nav-collapsed')==='1')document.body.classList.add('nav-collapsed')})();
function activeEditorForm(){if(isMobileShellMode()){var mobileBody=document.getElementById('mobile-editor-body');var mobileForm=mobileBody&&mobileBody.querySelector?mobileBody.querySelector('#note-editor-form'):null;return mobileForm||null}return document.getElementById('note-editor-form')}
function queryActiveEditor(selector){var form=activeEditorForm();return form&&form.querySelector?form.querySelector(selector):null}
function activeEditorMeta(){if(isMobileShellMode()){var mobileBody=document.getElementById('mobile-editor-body');var mobileMeta=mobileBody&&mobileBody.querySelector?mobileBody.querySelector('#note-meta'):null;if(mobileMeta)return mobileMeta}return document.getElementById('status-note-meta')}
function setSaveState(html,text){var s=queryActiveEditor('#autosave-status');if(s)s.innerHTML=html||'';var mobile=document.getElementById('mobile-editor-status');if(mobile)mobile.innerHTML=text?html:''}
function markEdited(){setSaveState('<span class="autosave-edited">Edited</span>','Edited');_log('markEdited')}
// After a programmatic mode switch, the markdown<->HTML round-trip fires
// synthetic input events (and can be slightly lossy). If, once the switch has
// settled, the form content still matches the last saved hash, the note is not
// actually dirty — reset the status to "Saved" instead of leaving a spurious
// "Edited". If the hash genuinely differs (e.g. an upload happened just before
// the switch), leave the edited/autosave flow alone so the change still saves.
function _reconcileSaveStateAfterModeSwitch(){
	var apply=function(){
		var form=activeEditorForm();if(!form)return;
		if(typeof _activeEditorIsDirty==='function'?!_activeEditorIsDirty():formHash(form)===_savedHash){
			if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}
			setSaveState('<span class="autosave-ok">Saved</span>','Saved');
		}
	};
	if(typeof requestAnimationFrame==='function'){requestAnimationFrame(function(){setTimeout(apply,0)})}
	else{setTimeout(apply,50)}
}
function renderNoteMeta(){var src=document.getElementById('note-meta');var mobileBody=document.getElementById('mobile-editor-body');if(isMobileShellMode()&&mobileBody){src=mobileBody.querySelector('#note-meta')||src}var target;if(isMobileShellMode()){target=src}else{target=document.getElementById('status-note-meta');if(src&&target){target.setAttribute('data-created-time',src.getAttribute('data-created-time')||'0');target.setAttribute('data-updated-time',src.getAttribute('data-updated-time')||'0')}}if(!target)return;var c=Number(target.getAttribute('data-created-time')||0),u=Number(target.getAttribute('data-updated-time')||0);if(!c&&!u){target.textContent='';return}var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var fmt=function(ts){if(!ts)return '';var d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'-'+months[d.getMonth()]+'-'+String(d.getFullYear()).slice(-2)};target.textContent='Created '+fmt(c)+' | Edited '+fmt(u)}
var _folderMenuState={id:'',title:''};
function closeFolderContextMenu(){var menu=document.getElementById('folder-context-menu');if(menu)menu.hidden=true}
function openFolderContextMenu(event,id,title){if(event){event.preventDefault();event.stopPropagation()}var menu=document.getElementById('folder-context-menu');if(!menu)return false;_folderMenuState={id:id,title:title};menu.hidden=false;menu.style.left=(event.clientX||16)+'px';menu.style.top=(event.clientY||16)+'px';return false}
function closeFolderModal(){var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
function openFolderModal(){var input=document.getElementById('folder-edit-title');var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(modal&&modal.parentNode!==document.body)document.body.appendChild(modal);if(backdrop&&backdrop.parentNode!==document.body)document.body.appendChild(backdrop);if(input)input.value=_folderMenuState.title||'';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;closeFolderContextMenu();if(input)input.focus()}
function openEmptyTrashModal(){var modal=document.getElementById('empty-trash-modal');var backdrop=document.getElementById('empty-trash-modal-backdrop');if(modal&&modal.parentNode!==document.body)document.body.appendChild(modal);if(backdrop&&backdrop.parentNode!==document.body)document.body.appendChild(backdrop);if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false}
function closeEmptyTrashModal(){var modal=document.getElementById('empty-trash-modal');var backdrop=document.getElementById('empty-trash-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
function submitEmptyTrash(event){if(event)event.preventDefault();closeEmptyTrashModal();htmx.ajax('POST','/fragments/trash/empty',{target:'#nav-panel',swap:'innerHTML'});return false}
function editFolderFromMenu(){if(!_folderMenuState.id)return;openFolderModal()}
function deleteFolderFromMenu(){if(!_folderMenuState.id)return;closeFolderContextMenu();if(confirm('Delete notebook "'+(_folderMenuState.title||'Untitled')+'"?')){htmx.ajax('DELETE','/fragments/folders/'+encodeURIComponent(_folderMenuState.id),{target:'#nav-panel',swap:'innerHTML'})}}
function submitFolderEdit(event){if(event)event.preventDefault();var input=document.getElementById('folder-edit-title');var title=input?input.value.trim():'';if(!_folderMenuState.id||!title)return false;var folderId=_folderMenuState.id;closeFolderModal();if(window.isMobileShellMode&&window.isMobileShellMode()){fetch('/fragments/folders/'+encodeURIComponent(folderId),{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded','hx-request':'true'},body:'title='+encodeURIComponent(title)}).then(function(){htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});var notesTitle=document.getElementById('mobile-notes-title');if(notesTitle&&notesTitle.textContent===_folderMenuState.title)notesTitle.textContent=title})}else{htmx.ajax('PUT','/fragments/folders/'+encodeURIComponent(folderId),{target:'#nav-panel',swap:'innerHTML',values:{title:title}})}return false}
function navFolderState(){try{return JSON.parse(localStorage.getItem('joplock-nav-folders')||'{}')}catch(e){return {}}}
function saveNavFolderState(s){localStorage.setItem('joplock-nav-folders',JSON.stringify(s))}
function toggleNavFolder(id,force){
	var el=document.querySelector('.nav-folder[data-folder-id="'+id.replace(/"/g,'\\"')+'"]');
	if(!el)return;
	var collapsed=force===undefined?!el.classList.contains('collapsed'):!force;
	var s=navFolderState();
	if(!collapsed){
		document.querySelectorAll('.nav-folder[data-folder-id]').forEach(function(other){
			var otherId=other.getAttribute('data-folder-id');
			if(!otherId||other===el)return;
			other.classList.add('collapsed');
			s[otherId]='0';
		});
	}
	el.classList.toggle('collapsed',collapsed);
	s[id]=collapsed?'0':'1';saveNavFolderState(s);
	// Lazy-load notes on first expand
	if(!collapsed){
		var notesDiv=el.querySelector('.nav-folder-notes[data-folder-id]');
		if(notesDiv&&!notesDiv.getAttribute('data-loaded')){
			notesDiv.setAttribute('data-loaded','1');
			var folderId=notesDiv.getAttribute('data-folder-id');
			htmx.ajax('GET','/fragments/folder-notes?folderId='+encodeURIComponent(folderId),{target:notesDiv,swap:'innerHTML'});
		}
	}
}
function openNavFolderAndFirstNote(id){
	if(isMobileShellMode())return;
	var el=document.querySelector('.nav-folder[data-folder-id="'+id.replace(/"/g,'\\"')+'"]');
	if(!el)return;
	if(!el.classList.contains('collapsed')){
		// Folder is already expanded — this must be a real toggle (collapse),
		// not another forced-open. Without this branch, toggleNavFolder(id,true)
		// below always forces collapsed=false, so an open folder like "Examples"
		// could never be closed again via its title text (only the tiny chevron
		// button, which calls toggleNavFolder with no force arg, worked).
		toggleNavFolder(id,false);
		return;
	}
	var notesDiv=el.querySelector('.nav-folder-notes[data-folder-id]');
	// Capture BEFORE toggling: toggleNavFolder() sets data-loaded="1" itself
	// (synchronously, before its htmx fetch) whenever it lazy-loads notes, so
	// checking data-loaded only after the call below can't distinguish
	// "already loaded from a previous expand" from "just started loading now".
	var wasLoaded=!!(notesDiv&&notesDiv.getAttribute('data-loaded'));
	toggleNavFolder(id,true);
	// After notes are loaded, click the first one
	function clickFirst(){
		var first=notesDiv&&notesDiv.querySelector('.notelist-item');
		if(first)first.click();
	}
	if(!notesDiv)return;
	if(wasLoaded){
		// Notes were already loaded from an earlier expand (e.g. this folder was
		// last collapsed via the chevron button rather than reloaded) —
		// toggleNavFolder() won't issue an htmx fetch, so no htmx:afterSettle
		// will ever fire for this notesDiv. Click immediately instead.
		clickFirst();
	} else {
		// First expand: wait for the lazy-load htmx swap into this notesDiv to
		// settle, then click first note.
		function onSettle(e){
			if(e.detail&&e.detail.target===notesDiv){
				document.body.removeEventListener('htmx:afterSettle',onSettle);
				clickFirst();
			}
		}
		document.body.addEventListener('htmx:afterSettle',onSettle);
	}
}
function getTA(){return queryActiveEditor('#note-body')}
function getPV(){var pv=queryActiveEditor('#note-preview');return pv&&pv.style.display!=='none'?pv:null}
function isMarkdownVisible(){var host=queryActiveEditor('#cm-host');return !!(host&&host.style.display!=='none')}
function inMobileEditor(){var form=activeEditorForm();return !!(form&&form.closest&&form.closest('#mobile-editor-body'))}
var _notesCache = null;
var _notesCachePromise = null;
function invalidateNotesCache(){
	_notesCache = null;
}
function fetchNoteHeaders(){
	if(_notesCache)return Promise.resolve(_notesCache);
	if(_notesCachePromise)return _notesCachePromise;
	_notesCachePromise = fetch('/api/web/notes/headers')
		.then(function(r){return r.json()})
		.then(function(data){
			_notesCache = data.items || [];
			_notesCachePromise = null;
			return _notesCache;
		})
		.catch(function(err){
			_notesCachePromise = null;
			_log('Failed to fetch note headers',err);
			return [];
		});
	return _notesCachePromise;
}
var _tinymceEditor=null;
var _cmView=null;
function getCM(){return _cmView}
function cmSyncToTA(){var ta=getTA();if(ta&&_cmView){var md=_cmView.state.doc.toString();if(ta.value!==md){ta.value=md;return true}}return false}
function cmSetVal(v){if(!_cmView)return;var cur=_cmView.state.doc.toString();if(cur===(v||''))return;_cmView.dispatch({changes:{from:0,to:cur.length,insert:v||''}})}
function getTinyMCE(){return _tinymceEditor}
function tinyMCEContent(){return _tinymceEditor?_tinymceEditor.getContent():''}
function tinyMCESetContent(html){if(_tinymceEditor)_tinymceEditor.setContent(html)}
function tinyMCESyncToTA(){var ta=getTA();if(ta&&_tinymceEditor){var html=_tinymceEditor.getContent();var md=tinymceToMarkdown(html);if(ta.value!==md){ta.value=md;ta.dispatchEvent(new Event('input',{bubbles:true}));return true}}return false}
function _isMarkdownModeActive(){return _editorMode==='markdown'||_editorMode==='md'}

/* ---------------- Note export (rendered mode only): MD / HTML / DOCX / PDF ---------------- */
function _downloadBlob(blob,filename){
	var url=URL.createObjectURL(blob);
	var a=document.createElement('a');
	a.href=url;
	a.download=filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
function _exportFilenameBase(){
	var hi=queryActiveEditor('.editor-title-hidden');
	var raw=(hi&&hi.value?hi.value:'').trim();
	var safe=raw.replace(/[\/\\:*?"<>|]/g,'').replace(/\s+/g,' ').trim();
	return safe||'note';
}
function _buildExportHtmlDoc(bodyHtml){
	return '<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>'+(bodyHtml||'')+'</body></html>';
}
function toggleExportMenu(anchorEl){
	var menu=document.getElementById('export-menu');
	// Find the best anchor: explicit arg, custom toolbar btn, TinyMCE toolbar btn, mobile header btn
	var btn=anchorEl
		||queryActiveEditor('#export-note-btn')
		||(document.querySelector('.tox-tbtn[aria-label="Export note"]'))
		||document.getElementById('mobile-editor-menu-btn');
	// If custom toolbar btn exists but isn't rendered (rich mode hides it), skip to TinyMCE btn
	if(btn&&btn.id==='export-note-btn'&&!btn.offsetParent){
		btn=document.querySelector('.tox-tbtn[aria-label="Export note"]')
			||document.getElementById('mobile-editor-menu-btn');
	}
	if(!menu||!btn)return;
	if(!menu.hidden){menu.hidden=true;return}
	menu.hidden=false;
	var r=btn.getBoundingClientRect();
	var mw=menu.offsetWidth||180;
	var mh=menu.offsetHeight||160;
	var left=r.right-mw;
	if(left<4)left=4;
	var top=r.bottom+4;
	if(top+mh>window.innerHeight-4)top=Math.max(4,r.top-mh-4);
	menu.style.left=left+'px';
	menu.style.top=top+'px';
}
function closeExportMenu(){
	var menu=document.getElementById('export-menu');
	if(menu)menu.hidden=true;
}
document.addEventListener('click',function(e){
	var menu=document.getElementById('export-menu');
	if(!menu||menu.hidden)return;
	if(menu.contains(e.target))return;
	if(e.target.closest&&e.target.closest('#export-note-btn'))return;
	closeExportMenu();
});
window.addEventListener('scroll',closeExportMenu,true);
window.addEventListener('resize',closeExportMenu);
function exportNoteAsMarkdown(){
	var ta=getTA();
	var md=ta?ta.value:'';
	_downloadBlob(new Blob([md],{type:'text/markdown'}),_exportFilenameBase()+'.md');
}
function exportNoteAsHtml(){
	var html=_buildExportHtmlDoc(tinyMCEContent());
	_downloadBlob(new Blob([html],{type:'text/html'}),_exportFilenameBase()+'.html');
}
function exportNoteAsDocx(){
	if(!window.htmlDocx||!window.htmlDocx.asBlob){alert('DOCX export is unavailable.');return}
	var html=_buildExportHtmlDoc(tinyMCEContent());
	try{
		var blob=window.htmlDocx.asBlob(html);
		_downloadBlob(blob,_exportFilenameBase()+'.docx');
	}catch(err){
		console.error('DOCX export failed:',err);
		alert('DOCX export failed.');
	}
}
function exportNoteAsPdf(){
	var html=tinyMCEContent();
	var printDoc='<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>\n'+
		'@page { margin: 1.5cm; size: A4; }\n'+
		'@page { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }\n'+
		'* { box-sizing: border-box; margin: 0; padding: 0; }\n'+
		'html, body { background: #fff; color: #000; font-family: sans-serif; font-size: 14px; line-height: 1.6; }\n'+
		'h1,h2,h3,h4,h5,h6 { color: #000; margin: 1em 0 0.4em; }\n'+
		'p { margin: 0.6em 0; }\n'+
		'a { color: #0066cc; }\n'+
		'code { background: #f4f4f4; color: #222; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }\n'+
		'pre { background: #f4f4f4; color: #222; padding: 12px; border-radius: 4px; overflow-wrap: break-word; white-space: pre-wrap; margin: 0.8em 0; }\n'+
		'pre code { background: none; padding: 0; }\n'+
		'blockquote { border-left: 3px solid #ccc; padding-left: 12px; color: #555; margin: 0.6em 0; }\n'+
		'table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }\n'+
		'th, td { border: 3px solid #ccc; padding: 6px 10px; text-align: left; }\n'+
		'th { background: #f0f0f0; }\n'+
		'img { max-width: 100%; height: auto; }\n'+
		'ul, ol { padding-left: 1.5em; margin: 0.6em 0; }\n'+
		'hr { border: none; border-top: 1px solid #ccc; margin: 1em 0; }\n'+
		'@media print {\n'+
		'  @page { margin: 1.5cm; }\n'+
		'  html, body { background: #fff !important; color: #000 !important; }\n'+
		'}\n'+
		'</style>\n</head>\n<body>'+html+'</body>\n</html>';
	var w=window.open('','_blank','width=800,height=600');
	if(!w){alert('Could not open print window. Check your popup blocker.');return}
	w.document.write(printDoc);
	w.document.close();
	w.focus();
	w.onload=function(){w.print();};
	setTimeout(function(){if(w&&!w.closed)w.print();},400);
}
function _runMarkdownToolbarFormat(cmd){
	if(cmd==='bold'){wrapSel('**','**');return true}
	if(cmd==='italic'){wrapSel('*','*');return true}
	if(cmd==='underline'){wrapSel('++','++');return true}
	if(cmd==='strikethrough'){wrapSel('~~','~~');return true}
	if(cmd==='code'){wrapSel('`','`');return true}
	if(cmd==='InsertUnorderedList'){insertPfx('- ');return true}
	if(cmd==='InsertOrderedList'){insertPfx('1. ');return true}
	if(cmd==='InsertHorizontalRule'){insertTxt('\n---\n');return true}
	if(cmd==='removeformat'||cmd==='RemoveFormat'){clearFormat();return true}
	if(cmd==='codesample'||cmd==='mceCodeSample'){openCodeModal();return true}
	if(cmd==='mceLink'||cmd==='link'){insertLink();return true}
	if(cmd==='mceImage'||cmd==='image'){insertImg();return true}
	return false;
}
function _runMarkdownToolbarBlock(tag){
	if(tag==='h1'){insertPfx('# ');return true}
	if(tag==='h2'){insertPfx('## ');return true}
	if(tag==='h3'){insertPfx('### ');return true}
	if(tag==='blockquote'){insertPfx('> ');return true}
	return false;
}
function tinyMCEFormat(cmd){
	if(_isMarkdownModeActive()&&_runMarkdownToolbarFormat(cmd))return;
	var ed=getTinyMCE();
	if(cmd==='codesample'||cmd==='mceCodeSample'){openCodeModal();return}
	if(ed){if(cmd==='InsertUnorderedList'||cmd==='InsertOrderedList'||cmd==='InsertHorizontalRule'||cmd==='removeformat'||cmd==='RemoveFormat')ed.execCommand(cmd==='removeformat'?'RemoveFormat':cmd);else if(cmd==='mceLink'||cmd==='link')ed.execCommand('mceLink');else if(cmd==='mceImage'||cmd==='image')ed.execCommand('mceImage');else ed.formatter.toggle(cmd);ed.focus()}
}
function tinyMCEFormatBlock(tag){
	if(_isMarkdownModeActive()&&_runMarkdownToolbarBlock(tag))return;
	var ed=getTinyMCE();
	if(ed){ed.formatter.toggle(tag);ed.focus()}
}
function tinyMCEInsertCheckbox(){if(_isMarkdownModeActive()){insertPfx('- [ ] ');return}var ed=getTinyMCE();if(ed){ed.execCommand('mceInsertContent',false,'<div class="md-checkbox">&nbsp;</div>');ed.focus()}}
function tinyMCEInsertCodeBlock(editPre){
	// Route rendered-mode code-block insert/edit through the custom themed CM6
	// modal (openCodeModal), not TinyMCE's built-in unthemed codesample dialog.
	openCodeModal(editPre||null);
	return true;
}
function tinyMCEInsertDate(){if(_isMarkdownModeActive()){insertStamp('date');return}var ed=getTinyMCE();if(ed){var d=new Date();var s=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');ed.execCommand('mceInsertContent',false,s);ed.focus()}}
function tinyMCEInsertDateTime(){if(_isMarkdownModeActive()){insertStamp('datetime');return}var ed=getTinyMCE();if(ed){var d=new Date();var s=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');ed.execCommand('mceInsertContent',false,s);ed.focus()}}
function tinyMCEInsertLink(){if(_isMarkdownModeActive()){insertLink();return}var ed=getTinyMCE();if(ed){ed.execCommand('mceLink');ed.focus()}}
function tinyMCEInsertImage(){if(_isMarkdownModeActive()){insertImg();return}var ed=getTinyMCE();if(ed){ed.execCommand('mceImage');ed.focus()}}
function _showLinkCopiedToast(x,y){var el=document.getElementById('link-copied-toast');if(!el){el=document.createElement('div');el.id='link-copied-toast';el.textContent='Link copied';document.body.appendChild(el)}el.style.left=x+'px';el.style.top=y+'px';el.classList.add('visible');setTimeout(function(){el.classList.remove('visible')},1500);}
function _copyTextToClipboard(text,onDone){
	if(navigator.clipboard&&navigator.clipboard.writeText){
		navigator.clipboard.writeText(text).then(function(){if(onDone)onDone(true)}).catch(function(){if(onDone)onDone(false)});
		return;
	}
	try{
		var ta=document.createElement('textarea');
		ta.value=text;
		ta.style.position='fixed';
		ta.style.opacity='0';
		document.body.appendChild(ta);
		ta.select();
		document.execCommand('copy');
		document.body.removeChild(ta);
		if(onDone)onDone(true);
	}catch(_e){if(onDone)onDone(false)}
}
function ensureTinyMCEEditableAfterPre(editor){
	if(!editor||!editor.getBody||!editor.getDoc)return;
	var body=editor.getBody();
	var doc=editor.getDoc();
	if(!body||!doc)return;
	body.querySelectorAll('pre').forEach(function(pre){
		var next=pre.nextElementSibling;
		if(next)return;
		var p=doc.createElement('p');
		p.innerHTML='<br data-mce-bogus="1">';
		body.appendChild(p);
	});
}
function highlightTinyMCECodeBlocks(editor){
	if(!editor||!editor.getBody||!window.hljs)return;
	var body=editor.getBody();
	if(!body)return;
	body.querySelectorAll('pre[class*="language-"]').forEach(function(pre){
		var target=pre.querySelector('code');
		if(!target)return;
		if(target&&target.querySelector&&target.querySelector('[class*="hljs-"]'))return;
		if(target&&target.dataset&&target.dataset.highlighted)delete target.dataset.highlighted;
		try{window.hljs.highlightElement(target)}catch(_e){}
	});
}
function normalizeTinyMCECodeSampleClasses(editor){
	if(!editor||!editor.getBody)return;
	var body=editor.getBody();
	if(!body)return;
	body.querySelectorAll('pre').forEach(function(pre){
		if(pre.className&&pre.className.indexOf('language-')!==-1)return;
		var code=pre.querySelector('code[class*="language-"]');
		if(!code)return;
		var m=(code.className||'').match(/language-[\w-]+/);
		if(m)pre.classList.add(m[0]);
	});
}
function normalizeTinyMCECodeSampleMarkup(editor){
	if(!editor||!editor.getBody||!editor.getDoc)return;
	var body=editor.getBody();
	var doc=editor.getDoc();
	if(!body||!doc)return;
	body.querySelectorAll('pre').forEach(function(pre){
		var code=pre.querySelector('code');
		if(code)return;
		// Skip pre already processed by codesample plugin (Prism spans, no <code> wrapper).
		if(pre.hasAttribute('data-mce-highlighted'))return;
		var btn=pre.querySelector('.pre-copy-btn');
		if(btn&&btn.parentNode===pre)pre.removeChild(btn);
		var text='';
		Array.prototype.forEach.call(pre.childNodes,function(node){
			if(node.nodeType===3)text+=node.nodeValue||'';
			else if(node.nodeType===1)text+=node.textContent||'';
		});
		while(pre.firstChild)pre.removeChild(pre.firstChild);
		code=doc.createElement('code');
		code.textContent=text;
		pre.appendChild(code);
		if(btn)pre.insertBefore(btn,pre.firstChild);
	});
}
function initTinyMCECodeCopyButtons(editor){
	if(!editor||!editor.getBody)return;
	var body=editor.getBody();
	if(!body)return;
	normalizeTinyMCECodeSampleClasses(editor);
	ensureTinyMCEEditableAfterPre(editor);
	body.querySelectorAll('pre').forEach(function(pre){
		if(!pre.getAttribute('data-jop-code-edit-bound')){
			pre.setAttribute('data-jop-code-edit-bound','1');
			var _openCodeSample=function(e){
				if(e.target&&e.target.closest&&e.target.closest('.pre-copy-btn')){return;}
				// Read-only mode blocks opening the code editor modal.
				if(_tinymceReadonly){return;}
				e.preventDefault();
				e.stopPropagation();
				tinyMCEInsertCodeBlock(pre);
			};
			pre.addEventListener('click',_openCodeSample);
			pre.addEventListener('touchend',_openCodeSample,{passive:false});
		}
		if(pre.querySelector('.pre-copy-btn'))return;
		var btn=editor.getDoc().createElement('button');
		btn.type='button';
		btn.className='pre-copy-btn';
		btn.title='Copy code';
		btn.setAttribute('aria-label','Copy code');
		btn.textContent='';
		btn.setAttribute('contenteditable','false');
		btn.setAttribute('data-mce-bogus','all');
		btn.addEventListener('click',function(e){
			e.preventDefault();
			e.stopPropagation();
			var code=pre.querySelector('code');
			var text=code?code.textContent:(pre.textContent||'');
			_copyTextToClipboard(text,function(ok){
				btn.classList.toggle('is-copied',!!ok);
				btn.classList.toggle('is-failed',!ok);
				setTimeout(function(){btn.classList.remove('is-copied');btn.classList.remove('is-failed')},1200);
			});
		});
		pre.insertBefore(btn,pre.firstChild);
	});
}
// Persistent TinyMCE lifecycle: init once on page load, reuse across note swaps.
// The editor lives in #tinymce-host (outside #editor-panel so htmx swaps don't
// destroy the iframe). Positioning tracks #tinymce-slot inside the swapped
// editor fragment so the editor visually sits where the fragment expects it.
var _tinymceInitStarted=false;
var _tinymceInitPromise=null;
// When true, TinyMCE input/change events are ignored (used to suppress spurious
// save-triggers when we call setContent programmatically on note switch / unlock).
var _tinymceSuppressEdits=false;
var _pendingSearchHighlight=false;
var _tinymceShowRequested=false;
function _setTinyMCEContent(html){
	if(!_tinymceEditor)return;
	_tinymceSuppressEdits=true;
	try{
		_tinymceEditor.setContent(html||'');
		if(_tinymceEditor.undoManager)_tinymceEditor.undoManager.clear();
	}finally{
		setTimeout(function(){
			_tinymceSuppressEdits=false;
			// Run after all sync SetContent handlers (codesample plugin) have finished.
			ensureTinyMCEEditableAfterPre(_tinymceEditor);
			initTinyMCECodeCopyButtons(_tinymceEditor);
			_applyTinyMCESpellcheck(_tinymceEditor);
			// Rendered-mode find: content just (re)loaded into the TinyMCE body.
			// Re-apply the search highlight now that there is text to mark. This
			// covers both the sync (server-rendered slot) and async (/fragments/
			// preview fetch) content paths without guessing a delay. Only consume
			// the pending flag once the body actually has text, so an earlier
			// empty setContent (first init) doesn't swallow the highlight.
			if(_pendingSearchHighlight){_log('_setTinyMCEContent: pendingSearchHighlight true, checking body');var _bd=_tinymceEditor&&_tinymceEditor.getBody&&_tinymceEditor.getBody();var _hasText=!!(_bd&&(_bd.textContent||'').trim());var _term=activeSearchTerm();_log('_setTinyMCEContent: hasText='+_hasText+' term='+(_term||''));if(_term&&_term.trim()&&_hasText){_log('_setTinyMCEContent: applying highlight');_pendingSearchHighlight=false;applySearchHighlight()}else if(!(_term&&_term.trim())){_pendingSearchHighlight=false}}
		},0);
	}
}
function _tinyMCEContentFontStyle(){
	var rs=getComputedStyle(document.body);
	var fontFamily=rs.getPropertyValue('--font-family-note').trim();
	if(!fontFamily)fontFamily=rs.fontFamily||'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
	var fontSize=rs.getPropertyValue(isMobileShellMode()?'--font-size-note-mobile':'--font-size-note').trim()||'15px';
	var fontSizeCode=rs.getPropertyValue('--font-size-code').trim()||'13px';
	return ''
		+'body{font-family:'+fontFamily+';font-size:'+fontSize+';line-height:1.7;color:var(--text);background:var(--bg)}'
		+'h1,h2,h3,h4,h5,h6{color:var(--accent)}'
		+'strong{color:var(--text-heading)}'
		+'a{color:var(--accent)}'
		+'code{background:var(--bg-hover);padding:2px 5px;border-radius:3px;font-family:"Cascadia Mono",monospace;font-size:'+fontSizeCode+'}'
		+'pre{position:relative;background:#000;color:#e6edf3;border:1px solid #343a40;padding:12px;border-radius:6px;font-family:"Cascadia Mono",monospace;font-size:'+fontSizeCode+'}'
		+'pre[class*="language-"]{background:#000!important;color:#e6edf3!important;text-shadow:none!important;font-family:"Cascadia Mono",monospace!important}'
		+'pre code{background:transparent;padding:0}'
		+'pre[class*="language-"] .token.comment,pre[class*="language-"] .token.prolog,pre[class*="language-"] .token.doctype,pre[class*="language-"] .token.cdata{color:#5c6370;font-style:italic}'
		+'pre[class*="language-"] .token.punctuation{color:#abb2bf}'
		+'pre[class*="language-"] .token.property,pre[class*="language-"] .token.tag,pre[class*="language-"] .token.boolean,pre[class*="language-"] .token.number,pre[class*="language-"] .token.constant,pre[class*="language-"] .token.symbol,pre[class*="language-"] .token.deleted{color:#d19a66}'
		+'pre[class*="language-"] .token.selector,pre[class*="language-"] .token.attr-name,pre[class*="language-"] .token.string,pre[class*="language-"] .token.char,pre[class*="language-"] .token.builtin,pre[class*="language-"] .token.inserted{color:#98c379}'
		+'pre[class*="language-"] .token.operator,pre[class*="language-"] .token.entity,pre[class*="language-"] .token.url{color:#56b6c2}'
		+'pre[class*="language-"] .token.atrule,pre[class*="language-"] .token.attr-value,pre[class*="language-"] .token.keyword{color:#c678dd}'
		+'pre[class*="language-"] .token.function,pre[class*="language-"] .token.class-name{color:#61afef}'
		+'pre[class*="language-"] .token.regex,pre[class*="language-"] .token.important,pre[class*="language-"] .token.variable{color:#e06c75}'
		+'pre>.pre-copy-btn{position:absolute!important;top:6px!important;right:8px!important;left:auto!important;float:none!important;margin:0!important;z-index:2;display:none;padding:2px 8px;font-size:11px;line-height:1.5;border:1px solid var(--border);border-radius:4px;background:var(--bg-elevated);color:var(--text-dim);opacity:0;pointer-events:none;transition:opacity .15s ease,color .15s ease,border-color .15s ease}'
		+'pre:hover>.pre-copy-btn{display:inline-block;opacity:1;pointer-events:auto}'
		+'.pre-copy-btn::after{content:"Copy"}'
		+'.pre-copy-btn:hover{color:var(--accent);border-color:var(--accent)}'
		+'blockquote{border-left:3px solid var(--accent);color:var(--text-dim)}'
		+'hr{border-color:var(--border)}'
		+'img{max-width:100%;height:auto;border-radius:6px}'
		+'table{border-collapse:collapse!important;width:100%;margin:0.8em 0}'
		+'th,td{border:3px solid var(--border)!important;padding:6px 10px;text-align:left}'
		+'th{background:var(--bg-hover);font-weight:bold}'
		+'.md-checkbox{display:flex;align-items:baseline;gap:0.35em;margin:0.25em 0;padding-left:24px}'
		+'.md-checkbox::before{content:"";display:inline-block;width:16px;height:16px;border:1.5px solid var(--accent);border-radius:3px;flex-shrink:0;background:transparent;box-sizing:border-box}'
		+'.md-checkbox.checked::before{background:var(--accent);border-color:var(--accent);content:"\\2713";color:var(--bg);font-size:11px;font-weight:bold;line-height:16px;text-align:center}'
		+'mark.search-highlight{background:#ffe066;color:#111;border-radius:2px;padding:0 1px}'
		+'mark.search-highlight-active{background:#ff9800;color:#111;border-radius:2px;padding:0 1px}';
}
function _syncTinyMCEThemeVars(){
	if(!_tinymceEditor||!_tinymceEditor.getDoc)return;
	try{
		var iframeDoc=_tinymceEditor.getDoc();
		if(!iframeDoc||!iframeDoc.documentElement)return;
		var rs=getComputedStyle(document.body);
		var vars=['--bg','--text','--text-dim','--text-heading','--accent','--border','--bg-hover','--toolbar-bg'];
		for(var i=0;i<vars.length;i++){
			var val=rs.getPropertyValue(vars[i]).trim();
			if(val)iframeDoc.documentElement.style.setProperty(vars[i],val);
		}
	}catch(_e){}
}
function _tinyMCEToolbarSpec(){
	return 'jop_edit | bold italic underline strikethrough | blocks | bullist numlist jop_checkbox | code jop_code blockquote hr | jop_date jop_datetime | removeformat | link image jop_upload table | jop_spellcheck jop_history jop_export';
}
// Spellcheck state (client-only, persisted in localStorage). Default off so
// shared browsers don't leak note text to remote spellcheck services.
function _spellcheckEnabled(){
	try{return localStorage.getItem('_joplockSpellcheck')==='1'}catch(_e){return false}
}
function _setSpellcheckEnabled(on){
	try{localStorage.setItem('_joplockSpellcheck',on?'1':'0')}catch(_e){}
}
// Read-only mode. Mobile notes open read-only by default so a tap scrolls/
// reads without accidentally editing; the jop_edit toolbar toggle enters edit
// mode. Desktop opens editable. State lives per editor session (not persisted).
var _tinymceReadonly=false;
function _tinymceReadonlyDefault(){return isMobileShellMode()}
// Push the current _tinymceReadonly flag into the live editor + sync the
// jop_edit toggle button. Safe to call before/after init.
function _applyTinyMCEReadonly(editor){
	editor=editor||_tinymceEditor;
	if(!editor)return;
	try{
		if(editor.mode&&editor.mode.set)editor.mode.set(_tinymceReadonly?'readonly':'design');
		else if(editor.setMode)editor.setMode(_tinymceReadonly?'readonly':'design');
	}catch(_e){}
	// TinyMCE's readonly mode can still let a tap focus the iframe body, which
	// raises the mobile soft keyboard even though typing is blocked. Force the
	// body non-editable + unfocusable while read-only and blur it so tapping to
	// scroll/read never opens the keyboard.
	try{
		var body=editor.getBody&&editor.getBody();
		if(body){
			if(_tinymceReadonly){
				body.setAttribute('contenteditable','false');
				body.setAttribute('tabindex','-1');
				if(editor.getDoc&&editor.getDoc()&&editor.getDoc().activeElement===body&&body.blur)body.blur();
			}else{
				body.removeAttribute('tabindex');
				// Editable state is restored by mode.set('design'); don't force
				// contenteditable here so TinyMCE keeps managing it.
			}
		}
	}catch(_e){}
	// Reflect state on the edit toggle button (active = editable).
	if(typeof _jopEditBtnApi!=='undefined'&&_jopEditBtnApi){try{_jopEditBtnApi.setActive(!_tinymceReadonly)}catch(_e){}}
}
function _setTinyMCEReadonly(on){
	_tinymceReadonly=!!on;
	_applyTinyMCEReadonly(_tinymceEditor);
}
var _jopEditBtnApi=null;
// Apply the current spellcheck state to the live TinyMCE iframe body.
function _applyTinyMCESpellcheck(editor){
	if(!editor)return;
	var on=_spellcheckEnabled();
	try{
		var body=editor.getBody&&editor.getBody();
		if(body){body.spellcheck=on;body.setAttribute('spellcheck',on?'true':'false')}
	}catch(_e){}
}
function initPersistentTinyMCE(){
	if(_tinymceInitStarted||!window.tinymce)return _tinymceInitPromise;
	var textarea=document.getElementById('tinymce-editor');
	if(!textarea)return null;
	_tinymceInitStarted=true;
	// Suppress edit events during initial render (TinyMCE fires input/change while
	// populating the iframe from the textarea's initial value). Cleared after init.
	_tinymceSuppressEdits=true;
	_tinymceInitPromise=window.tinymce.init({
		target:textarea,
		license_key:'gpl',
		menubar:false,
		newline_behavior:document.body.dataset.newlineBehavior||'linebreak',
		toolbar:_tinyMCEToolbarSpec(),
		toolbar_mode:'sliding',
		height:'100%',
		resize:false,
		skin:'oxide-dark',
		highlight_on_focus:false,
		plugins:'autolink advlist lists link image code codesample table',
		link_default_target:'_blank',
		// Native browser spellcheck. Toggled at runtime via the jop_spellcheck
		// toolbar button; browser_spellcheck must be true so TinyMCE does not
		// force spellcheck="false" on the iframe body.
		browser_spellcheck:true,
		// The link plugin's context-menu item resolves to a non-empty value
		// (a quick "Link" insert action) for ANY editable text, not just real
		// hyperlinks, so leaving 'link' in the default contextmenu list makes
		// TinyMCE swap in its own single-item menu on every right-click and
		// blocks the native browser menu (and its spellcheck suggestions) from
		// ever showing. Excluding it here restores the native context menu on
		// plain text while image/table right-clicks still get TinyMCE's own
		// menus (those only match when actually on an <img>/table element).
		// Link insertion/editing stays available via the toolbar Link button
		// and click-to-copy / Ctrl-click-to-open on existing links.
		contextmenu:'image table',
		codesample_languages:[
			{text:'Plain text',value:''},
			{text:'Bash',value:'bash'},
			{text:'BASIC',value:'basic'},
			{text:'C',value:'c'},
			{text:'C++',value:'cpp'},
			{text:'CSS',value:'css'},
			{text:'Go',value:'go'},
			{text:'HTML/XML',value:'markup'},
			{text:'JavaScript',value:'javascript'},
			{text:'JSON',value:'json'},
			{text:'Python',value:'python'},
			{text:'SQL',value:'sql'},
			{text:'TypeScript',value:'typescript'},
			{text:'YAML',value:'yaml'}
		],
		valid_elements:'*[*]',
		extended_valid_elements:'div[class|data-*],span[class|style],img[src|alt|class|width|height|data-resource-id]',
		content_css:'dark',
		content_style:_tinyMCEContentFontStyle(),
		mobile:{
			menubar:false,
			toolbar_mode:'sliding',
			toolbar_persist:true,
			toolbar:_tinyMCEToolbarSpec()
		},
		images_upload_handler:function(blobInfo){
			return new Promise(function(resolve,reject){
				var formData=new FormData();
				formData.append('file',blobInfo.blob(),blobInfo.filename());
				fetch('/fragments/upload',{method:'POST',body:formData,credentials:'same-origin'}).then(function(r){return r.json()}).then(function(data){if(data&&data.error){reject(data.error);return}resolve('/resources/'+data.resourceId)}).catch(reject);
			});
		},
		// Upload pasted/dropped images automatically through images_upload_handler
		// so they become Joplin resources instead of inline data: URIs.
		automatic_uploads:true,
		paste_data_images:true,
		// Browse button in the Image/Media dialogs -> upload through /fragments/upload.
		file_picker_types:'image media file',
		file_picker_callback:function(callback,value,meta){
			var input=document.createElement('input');
			input.type='file';
			if(meta&&meta.filetype==='image')input.accept='image/*';
			input.onchange=function(){
				var file=input.files&&input.files[0];
				if(!file)return;
				var fd=new FormData();
				fd.append('file',file);
				fetch('/fragments/upload',{method:'POST',body:fd,credentials:'same-origin'}).then(function(r){return r.json()}).then(function(data){
					if(data&&data.error){alert(data.error);return}
					callback('/resources/'+data.resourceId,{alt:file.name,title:file.name});
				}).catch(function(){alert('Upload failed')});
			};
			input.click();
		},
		setup:function(editor){
			// Custom app buttons used by the TinyMCE built-in toolbar.
			editor.ui.registry.addIcon('jop_checkbox','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>');
			editor.ui.registry.addIcon('jop_date','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4.5" y="5.5" width="15" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5v3M16 4.5v3M4.5 9.5h15" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>');
			editor.ui.registry.addIcon('jop_datetime','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5.5" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 4.5v3M12.5 4.5v3M3.5 9.5h12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="17.5" cy="16.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M17.5 14.8v2.1l1.5.9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');
			editor.ui.registry.addIcon('jop_upload','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8.2 12.8l5.3-5.3a3 3 0 114.3 4.3l-6.4 6.4a4.5 4.5 0 01-6.4-6.4l6.4-6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');
			editor.ui.registry.addIcon('jop_history','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 12a8 8 0 108-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 5v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8.5V12l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');
			editor.ui.registry.addIcon('jop_export','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v10m0 0l-3-3m3 3l3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
			editor.ui.registry.addButton('jop_checkbox',{
				tooltip:'Checkbox',
				icon:'jop_checkbox',
				onAction:function(){tinyMCEInsertCheckbox();}
			});
			editor.ui.registry.addButton('jop_date',{
				tooltip:'Insert date',
				icon:'jop_date',
				onAction:function(){tinyMCEInsertDate();}
			});
			editor.ui.registry.addButton('jop_datetime',{
				tooltip:'Insert date & time',
				icon:'jop_datetime',
				onAction:function(){tinyMCEInsertDateTime();}
			});
			editor.ui.registry.addButton('jop_upload',{
				tooltip:'Upload file',
				icon:'jop_upload',
				onAction:function(){openUploadModal();}
			});
			editor.ui.registry.addButton('jop_history',{
				tooltip:'Note history',
				icon:'jop_history',
				onAction:function(){
					var form=activeEditorForm();
					var noteId=form?form.dataset.noteId:'';
					if(noteId)openHistoryModal(noteId);
				}
			});
			editor.ui.registry.addButton('jop_export',{
				tooltip:'Export note',
				icon:'jop_export',
				onAction:function(){toggleExportMenu();}
			});
			// Custom code button opens our themed full-screen CM6 code modal
			// instead of TinyMCE's built-in (unthemed, non-highlighting)
			// codesample dialog. Uses a distinct name so it doesn't depend on
			// button-registration ordering vs the codesample plugin.
			editor.ui.registry.addButton('jop_code',{
				tooltip:'Code sample',
				icon:'code-sample',
				onAction:function(){openCodeModal();}
			});
			// Spellcheck toggle. Uses native browser spellcheck on the iframe body;
			// no external plugin/service. State persisted client-side.
			editor.ui.registry.addIcon('jop_spellcheck','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 17l4-10 4 10M5.2 14h5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 15.5l2 2 3.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');
			editor.ui.registry.addToggleButton('jop_spellcheck',{
				tooltip:'Toggle spellcheck',
				icon:'jop_spellcheck',
				onAction:function(api){
					var on=!_spellcheckEnabled();
					_setSpellcheckEnabled(on);
					api.setActive(on);
					_applyTinyMCESpellcheck(editor);
					// Re-focus so the browser re-scans the current content.
					try{editor.focus()}catch(_e){}
				},
				onSetup:function(api){
					api.setActive(_spellcheckEnabled());
					return function(){};
				}
			});
			// Edit toggle. Notes open read-only on mobile so tapping scrolls/reads
			// without accidental edits; tapping this pencil enters edit mode.
			// Active (highlighted) = editable, inactive = read-only.
			editor.ui.registry.addIcon('jop_edit','<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
			editor.ui.registry.addToggleButton('jop_edit',{
				tooltip:'Toggle edit mode',
				icon:'jop_edit',
				// Keep this button enabled in read-only mode so it can toggle back
				// to editable (default TinyMCE buttons are disabled in readonly).
				context:'any',
				onAction:function(api){
					var goEditable=_tinymceReadonly; // about to turn edit ON
					_setTinyMCEReadonly(!_tinymceReadonly);
					api.setActive(!_tinymceReadonly);
					if(goEditable){
						// Entering edit mode: honor the saved note-open preference,
						// which may be markdown (read-only always shows rendered).
						if(_defaultNoteOpenMode==='markdown'&&_editorMode!=='markdown'){setEditorMode('markdown');}
						else{try{editor.focus()}catch(_e){}}
					}else{
						// Leaving edit mode: always drop back to rendered (read-only)
						// so a subsequent tap scrolls/reads rather than edits markdown.
						if(_editorMode==='markdown'){setEditorMode('rich');}
					}
				},
				onSetup:function(api){
					_jopEditBtnApi=api;
					api.setActive(!_tinymceReadonly);
					return function(){if(_jopEditBtnApi===api)_jopEditBtnApi=null};
				}
			});
			editor.on('keydown',function(e){
				if(_tinymceReadonly){e.preventDefault();return;}
				if(e.key!=='Enter')return;
				if(e.shiftKey)return;
				var selNode=editor.selection&&editor.selection.getNode?editor.selection.getNode():null;
				var body=editor.getBody?editor.getBody():null;
				// Handle Enter inside list items — newline_behavior block conflicts with lists plugin
				var li=selNode;
				while(li&&li!==body&&li.nodeName!=='LI')li=li.parentNode;
				if(li&&li!==body){
					e.preventDefault();
					editor.undoManager.transact(function(){
						var doc=editor.getDoc();
						var rng=editor.selection.getRng();
						var text=li.textContent||'';
						var ulol=li.parentNode;
						var empty=!text.replace(/[\u00a0\u200b]/g,'').trim();
						if(empty||rng.collapsed&&rng.startOffset===0&&!text.trim()){
							// Empty li or caret at start of empty li — exit list
							var p=doc.createElement('p');
							p.innerHTML='<br data-mce-bogus="1">';
							ulol.parentNode.insertBefore(p,ulol.nextSibling);
							li.parentNode.removeChild(li);
							if(!ulol.children.length)ulol.parentNode.removeChild(ulol);
							editor.selection.setCursorLocation(p,0);
						}else if(rng.collapsed){
							// Split li at caret
							var neo=doc.createElement('li');
							var frag=rng.extractContents();
							if(frag.childNodes.length||frag.textContent){
								while(frag.firstChild)neo.appendChild(frag.firstChild);
							}else{
								neo.innerHTML='<br data-mce-bogus="1">';
							}
							// Clean trailing br in current li
							if(!(li.textContent||'').replace(/[\u00a0\u200b]/g,'').trim()){
								var nb=doc.createElement('br');
								nb.setAttribute('data-mce-bogus','1');
								li.appendChild(nb);
							}
							ulol.insertBefore(neo,li.nextSibling);
							editor.selection.setCursorLocation(neo,0);
						}
					});
					onEdit();
					return;
				}
				var cb=selNode;
				while(cb&&cb!==body&&!(cb.nodeType===1&&cb.classList&&cb.classList.contains('md-checkbox')))cb=cb.parentNode;
				if(!cb||cb===body)return;
				e.preventDefault();
				editor.undoManager.transact(function(){
					var doc=editor.getDoc();
					var label=(cb.textContent||'').replace(/^[\u2610\u2611][\u00a0 ]*/,'').replace(/\u00a0/g,' ').trim();
					if(!label){
						var p=doc.createElement('p');
						p.innerHTML='<br data-mce-bogus="1">';
						cb.parentNode.replaceChild(p,cb);
						editor.selection.setCursorLocation(p,0);
						return;
					}
					var neo=doc.createElement('div');
					neo.className='md-checkbox';
					var tn=doc.createTextNode('\u00a0');
					neo.appendChild(tn);
					if(cb.nextSibling)cb.parentNode.insertBefore(neo,cb.nextSibling);
					else cb.parentNode.appendChild(neo);
					var range=doc.createRange();
					range.setStart(tn,1);
					range.collapse(true);
					editor.selection.setRng(range);
				});
				onEdit();
			});
			// Resolve nearest PRE codeblock from an event target, or null.
			function _resolveTinyMCEPre(target){
				if(!target||!target.closest)return null;
				var pre=target.closest('pre,code[class*="language-"]');
				if(pre&&pre.nodeName==='CODE'&&pre.parentElement&&pre.parentElement.nodeName==='PRE')pre=pre.parentElement;
				if(pre&&pre.nodeName!=='PRE')pre=pre.closest&&pre.closest('pre')?pre.closest('pre'):null;
				return pre&&pre.nodeName==='PRE'?pre:null;
			}
			function _openTinyMCECodeBlock(pre){
				// Read-only mode blocks opening the code editor modal.
				if(_tinymceReadonly)return;
				normalizeTinyMCECodeSampleClasses(editor);
				tinyMCEInsertCodeBlock(pre);
			}
			// Long-press state for touch devices. Tap/scroll must NOT open the
			// code editor; only a sustained hold does.
			var _lpTimer=null,_lpPre=null,_lpX=0,_lpY=0,_lpFired=false;
			var LP_MS=500,LP_MOVE=10;
			function _cancelLongPress(){if(_lpTimer){clearTimeout(_lpTimer);_lpTimer=null;}_lpPre=null;}
			editor.on('touchstart',function(e){
				_lpFired=false;
				if(_tinymceReadonly)return;
				var t=e&&e.target?e.target:null;
				if(t&&t.closest&&t.closest('.pre-copy-btn'))return;
				var pre=_resolveTinyMCEPre(t);
				if(!pre)return;
				var pt=e.touches&&e.touches[0]?e.touches[0]:e;
				_lpPre=pre;_lpX=pt.clientX;_lpY=pt.clientY;
				_lpTimer=setTimeout(function(){
					_lpTimer=null;_lpFired=true;
					if(_lpPre)_openTinyMCECodeBlock(_lpPre);
					_lpPre=null;
				},LP_MS);
			});
			editor.on('touchmove',function(e){
				if(!_lpTimer)return;
				var pt=e.touches&&e.touches[0]?e.touches[0]:e;
				if(Math.abs(pt.clientX-_lpX)>LP_MOVE||Math.abs(pt.clientY-_lpY)>LP_MOVE)_cancelLongPress();
			});
			editor.on('touchend touchcancel',_cancelLongPress);
			editor.on('click',function(e){
				var target=e&&e.target?e.target:null;
				if(!target||!target.closest)return;
				if(target.closest('.pre-copy-btn'))return;
				var cb=target.closest('.md-checkbox');
				if(cb){
					e.preventDefault();
					// Read-only mode blocks toggling checkboxes.
					if(_tinymceReadonly)return;
					var checked=!cb.classList.contains('checked');
					cb.classList.toggle('checked',checked);
					onEdit();
					return;
				}
				var link=target.closest('a[href]');
				if(link&&!link.getAttribute('data-resource-id')){
					e.preventDefault();
					var href=link.getAttribute('href')||'';
					if(href){if(e.ctrlKey||e.metaKey){window.open(href,'_blank','noopener')}else{_copyTextToClipboard(href,function(ok){if(ok)_showLinkCopiedToast(e.clientX,e.clientY)})}}
					return;
				}
				var pre=_resolveTinyMCEPre(target);
				if(!pre)return;
				// Touch: long-press already handled (or was scroll/tap). Suppress
				// the synthetic click so a tap never opens the editor.
				if(_lpFired){_lpFired=false;e.preventDefault();e.stopPropagation();return;}
				if(e.pointerType==='touch'||e.sourceCapabilities&&e.sourceCapabilities.firesTouchEvents){e.preventDefault();e.stopPropagation();return;}
				e.preventDefault();
				e.stopPropagation();
				_openTinyMCECodeBlock(pre);
			});
			// Double-click an image or attachment link → open the in-app lightbox
			// (desktop only). Suppresses TinyMCE's built-in image dialog on dblclick.
			editor.on('dblclick',function(e){
				if(!isDesktopMode())return;
				var target=e&&e.target?e.target:null;
				if(!target||!target.closest)return;
				var el=target.closest('img[data-resource-id],a[data-resource-id]');
				if(!el)return;
				var resourceId=el.getAttribute('data-resource-id')||'';
				if(!resourceId)return;
				e.preventDefault();
				e.stopPropagation();
				if(e.stopImmediatePropagation)e.stopImmediatePropagation();
				_openResourceLightbox(resourceId);
			});
			// Drag-and-drop file upload directly into the note (no modal).
			// We handle ALL dropped files ourselves (images + other files) and stop
			// TinyMCE's default handling so images don't get inlined as base64.
			editor.on('dragover',function(e){
				if(e.dataTransfer){try{e.dataTransfer.dropEffect='copy'}catch(_){}}
				e.preventDefault();
				e.stopPropagation();
			});
			editor.on('drop',function(e){
				var files=e.dataTransfer&&e.dataTransfer.files;
				if(!files||!files.length)return; // let TinyMCE handle text/html drops
				e.preventDefault();
				e.stopPropagation();
				if(e.stopImmediatePropagation)e.stopImmediatePropagation();
				var doc=editor.getDoc();
				var range=null;
				if(doc.caretRangeFromPoint){
					range=doc.caretRangeFromPoint(e.clientX,e.clientY);
				}else if(doc.caretPositionFromPoint){
					var pos=doc.caretPositionFromPoint(e.clientX,e.clientY);
					if(pos){range=doc.createRange();range.setStart(pos.offsetNode,pos.offset);range.collapse(true)}
				}
				if(range)editor.selection.setRng(range);
				var arr=Array.prototype.slice.call(files);
				arr.reduce(function(p,file){return p.then(function(){return _uploadFileToTinyMCE(file,editor)})},Promise.resolve()).then(function(){markEdited();scheduleSave()}).catch(function(err){console.error('Drop upload failed:',err)});
				return false;
			});
			// Clipboard paste of non-image files (e.g. PDFs). Pasted images are handled by
			// TinyMCE's built-in paste_data_images + images_upload_handler pipeline, so we
			// only intercept non-image file items here to avoid double insertion.
			editor.on('paste',function(e){
				var cd=e.clipboardData||(window.clipboardData);
				if(!cd)return;
				var items=cd.items;
				if(!items||!items.length)return;
				var fileItems=[];
				for(var i=0;i<items.length;i++){
					if(items[i].kind==='file'&&items[i].type&&items[i].type.indexOf('image/')!==0){
						var f=items[i].getAsFile();
						if(f)fileItems.push(f);
					}
				}
				if(!fileItems.length)return;
			e.preventDefault();
			fileItems.reduce(function(p,file){return p.then(function(){return _uploadFileToTinyMCE(file,editor)})},Promise.resolve()).then(function(){markEdited();scheduleSave()}).catch(function(err){console.error('Paste upload failed:',err)});
			});
			function onEdit(){
				if(_tinymceSuppressEdits)return;
				if(_tinymceReadonly)return;
				var form=activeEditorForm();
				if(!form)return;
				if(form.dataset.encrypted==='1'&&form.dataset.vaultUnlocked!=='1')return;
				// Skip if editor host is hidden (locked note, empty state).
				var host=document.getElementById('tinymce-host');
				if(!host||!host.classList.contains('tinymce-host-visible'))return;
				var ta=getTA();
				if(ta){
					var html=editor.getContent();
					var md=tinymceToMarkdown(html);
					if(ta.value!==md){
						ta.value=md;
						ta.dispatchEvent(new Event('input',{bubbles:true}));
					}
				}
				markEdited();
				scheduleSave();
			}
			editor.on('input',onEdit);
			editor.on('change',onEdit);
			// FormatBlock fix: when newline_behavior='linebreak', soft-wrapped lines live
			// inside a single <p> separated by <br>. TinyMCE's FormatBlock command
			// (used by the blocks dropdown) operates at block granularity — it converts
			// the whole <p> to a heading even if only part of it is selected.
			// Fix: whenever the caret enters a <p> that contains <br> children, split
			// that <p> at the <br> boundaries into individual <p> elements. This gives
			// FormatBlock proper paragraph boundaries to work with, and also makes
			// selection behaviour more predictable for multi-line linebreak-mode content.
			function _splitBrBlock(block,editor){
				var doc=editor.getDoc();
				if(!block||!doc)return null;
				if(!block.querySelector('br'))return null;
				var tagName=block.nodeName.toLowerCase();
				// Only split paragraph-level blocks
				if(!/^(p|h[1-6])$/.test(tagName))return null;
				var children=Array.prototype.slice.call(block.childNodes);
				var lines=[];
				var current=[];
				children.forEach(function(node){
					if(node.nodeName==='BR'&&!node.getAttribute('data-mce-bogus')){
						lines.push(current);
						current=[];
					}else{
						current.push(node);
					}
				});
				lines.push(current);
				if(lines.length<=1)return null;
				var parent=block.parentNode;
				if(!parent)return null;
				var ref=block.nextSibling;
				var newBlocks=lines.map(function(nodes){
					var p=doc.createElement('p');
					if(!nodes.length||nodes.every(function(n){return n.nodeType===3&&!n.textContent.trim()})){
						var br=doc.createElement('br');
						br.setAttribute('data-mce-bogus','1');
						p.appendChild(br);
					}else{
						nodes.forEach(function(n){p.appendChild(n)});
					}
					return p;
				});
				newBlocks.forEach(function(p){parent.insertBefore(p,ref)});
				parent.removeChild(block);
				return newBlocks;
			}
			// FormatBlock (blocks dropdown) works at block granularity, so a
			// multi-line <p>…<br>…</p> gets fully reformatted even if only one
			// line is selected. Split br-separated <p> into individual <p>s
			// *just before* FormatBlock runs, so the command sees proper block
			// boundaries. Do NOT split on every NodeChange — that clobbers the
			// caret position after Enter (linebreak mode inserts a <br> which
			// would trigger a split and move the caret to offset 0 of the new
			// block, so the cursor visibly jumps to the start of the line).
			editor.on('BeforeExecCommand',function(e){
				if(!e||e.command!=='FormatBlock')return;
				if(_tinymceSuppressEdits)return;
				var sel=editor.selection;
				if(!sel)return;
				var body=editor.getBody();
				var node=sel.getNode();
				var block=node;
				while(block&&block!==body&&block.parentNode!==body){
					block=block.parentNode;
				}
				if(!block||block===body)return;
				if(block.nodeName!=='P')return;
				if(!block.querySelector('br'))return;
				// Remember the caret's text node + offset so we can restore it
				// inside the correct split block.
				var rng0=sel.getRng();
				var caretNode=rng0&&rng0.startContainer;
				var caretOffset=rng0?rng0.startOffset:0;
				var prev=_tinymceSuppressEdits;
				_tinymceSuppressEdits=true;
				try{
					var newBlocks=_splitBrBlock(block,editor);
					if(newBlocks&&caretNode){
						var targetBlock=null;
						newBlocks.forEach(function(p){
							if(!targetBlock&&(p===caretNode||p.contains(caretNode)))targetBlock=p;
						});
						if(!targetBlock)targetBlock=newBlocks[0];
						var rng=editor.getDoc().createRange();
						// Restore original text node + offset when still present;
						// otherwise fall back to start of target block.
						if(targetBlock.contains(caretNode)){
							try{rng.setStart(caretNode,caretOffset);}
							catch(_e){rng.setStart(targetBlock,0);}
						}else{
							rng.setStart(targetBlock,0);
						}
						rng.collapse(true);
						sel.setRng(rng);
					}
				}finally{
					_tinymceSuppressEdits=prev;
				}
			});
			// Text-expander: after text is committed to the iframe DOM, check the
			// caret suffix for a trigger and expand. Runs on keyup so the just-typed
			// character is present. Guarded to rendered mode + text triggers only.
			editor.on('keyup',function(e){
				if(_tinymceSuppressEdits)return;
				if(e&&(e.ctrlKey||e.metaKey||e.altKey))return;
				if(!_textExpanders.length)return;
				try{maybeExpandTextFromTinyMCE(editor)}catch(err){_clientLog('expander.tinymce.error',{message:String(err&&err.message||err)})}
			});
			// Ctrl/Cmd-Space: manual AI prose completion inside the rendered editor.
			// The global document keydown handler cannot see keystrokes inside the
			// TinyMCE iframe, so wire it on the editor directly.
			editor.on('keydown',function(e){
				if(!e)return;
				// When the AI completion popup is open, its keys (Enter/Tab/Esc/arrows)
				// must be handled here — iframe key events never reach the outer document.
				if(_activeRenderPopup&&_activeRenderPopupKind==='tinymce-prose'){
					if(handleRenderPopupKey(e))return;
					// Any other key (typing, backspace, etc.) dismisses the stale suggestion.
					if(!e.ctrlKey&&!e.metaKey&&!e.altKey)hideRenderAutocompletePopup();
				}
				if(e.altKey)return;
				if((e.ctrlKey||e.metaKey)&&(e.code==='Space'||e.key===' '||e.keyCode===32)){
					e.preventDefault();
					try{requestTinyMCEProseCompletion({editor:editor})}catch(err){_clientLog('expander.tinymce.error',{message:String(err&&err.message||err)})}
				}
				// In-note find/highlight: the global document keydown handler cannot
				// see Escape while focus is inside the TinyMCE iframe (separate
				// browsing context, key events do not bubble to the parent
				// document), so replicate the two-stage Esc here too:
				// 1st Esc dismisses the in-note search-nav-bar/highlight,
				// 2nd Esc clears the nav-search field and exits results.
				if(e.key==='Escape'){
					_log('esc:TinyMCE iframe keydown Escape');
					var bar=document.getElementById('search-nav-bar');
					var sesActive=_searchSessionActive();
					_log('esc:TinyMCE bar hidden='+(bar?bar.hidden:'n/a')+' sesActive='+sesActive);
					if((bar&&!bar.hidden)||sesActive){
						_log('esc:TinyMCE dismissing search');
						e.preventDefault();
						searchNavDismiss();
					}else{
						var navSearch=document.getElementById('nav-search');
						if(navSearch&&navSearch.value){
							_log('esc:TinyMCE clearing nav-search field');
							e.preventDefault();
							navSearch.value='';
							htmx.trigger(navSearch,'search-submit');
						}
					}
				}
			});
			// Code block init is deferred to _setTinyMCEContent so it runs after
			// TinyMCE's codesample plugin has finished processing the content.
			editor.on('focus',function(){
				// In read-only mode a tap must not raise the mobile soft keyboard.
				if(_tinymceReadonly){try{editor.getBody&&editor.getBody().blur&&editor.getBody().blur()}catch(_e){}return;}
				document.body.dispatchEvent(new CustomEvent('joplock:editor-focus',{detail:{source:'tinymce'}}));
			});
			editor.on('blur',function(){
				document.body.dispatchEvent(new CustomEvent('joplock:editor-blur',{detail:{source:'tinymce'}}));
			});
			editor.on('init',function(){
				_tinymceEditor=editor;
				ensureTinyMCEEditableAfterPre(editor);
				initTinyMCECodeCopyButtons(editor);
				try{
					var iframeDoc=editor.getDoc();
					if(iframeDoc){
						if(iframeDoc.documentElement){
							iframeDoc.documentElement.style.overscrollBehavior='none';
						}
						if(iframeDoc.body){
							iframeDoc.body.style.overscrollBehavior='none';
							iframeDoc.body.style.webkitOverflowScrolling='touch';
						}
					}
				}catch(e){}
				// Wire drop handlers on the host div (chrome area outside iframe)
				var host=document.getElementById('tinymce-host');
				if(host&&!host._jopDropWired){
					host._jopDropWired=true;
					host.addEventListener('dragover',function(ev){ev.preventDefault()});
				host.addEventListener('drop',function(ev){
					var files=ev.dataTransfer&&ev.dataTransfer.files;
					if(!files||!files.length)return;
					ev.preventDefault();
					var arr=Array.prototype.slice.call(files);
					arr.reduce(function(p,file){return p.then(function(){return _uploadFileToTinyMCE(file,_tinymceEditor)})},Promise.resolve()).then(function(){markEdited();scheduleSave()}).catch(function(err){console.error('Drop upload failed:',err)});
				});
				}
				_syncTinyMCEThemeVars();
				_tinymceSuppressEdits=false;
				_applyTinyMCESpellcheck(editor);
				_applyTinyMCEReadonly(editor);
				refreshTinyMCEForActiveNote();
			});
		}
	}).then(function(editors){
		if(editors&&editors[0])_tinymceEditor=editors[0];
	});
	return _tinymceInitPromise;
}
function positionTinyMCEHost(){
	var host=document.getElementById('tinymce-host');
	if(!host)return;
	var slot=queryActiveEditor('#tinymce-slot');
	if(!slot||slot.offsetParent===null){
		host.classList.remove('tinymce-host-visible');
		return;
	}
	var vv=window.visualViewport;
	var vpH=vv?vv.height:window.innerHeight;
	var top,left,width;
	if(isMobileShellMode()){
		// On mobile the slot lives inside a rubber-bandable container so
		// getBoundingClientRect().top drifts during over-scroll.  Instead,
		// anchor the host to the bottom of the last stable fixed header element
		// (mobile editor header, then toolbar if visible) — these are in normal
		// flow inside position:fixed .mobile-app and don't bounce.
		var editorScreen=document.getElementById('mobile-editor-screen');
		var anchorEl=null;
		// Walk fixed headers in order: search header (if visible), main header, toolbar.
		['mobile-editor-search-header','mobile-editor-header'].forEach(function(id){
			var el=document.getElementById(id);
			if(el&&getComputedStyle(el).display!=='none')anchorEl=el;
		});
		var tb=document.getElementById('mobile-editor-body')&&
		        document.getElementById('mobile-editor-body').querySelector('#editor-toolbar');
		if(tb&&getComputedStyle(tb).display!=='none')anchorEl=tb;
		if(anchorEl){
			var ar=anchorEl.getBoundingClientRect();
			top=ar.bottom;
		}else{
			// Fallback: use slot rect (no rubber-band active yet)
			top=slot.getBoundingClientRect().top;
		}
		var mobileApp=document.getElementById('mobile-app');
		var mar=mobileApp?mobileApp.getBoundingClientRect():{left:0,width:window.innerWidth};
		left=mar.left;
		width=mar.width;
		// Keep the host locked to the visible viewport while the keyboard is open,
		// otherwise iOS may pan the outer page (dual-scroll effect).
		// When keyboard is closed, prefer innerHeight to avoid rubber-band gaps.
		if(vv&&window.innerHeight-vv.height>80){
			vpH=vv.height+vv.offsetTop;
		}else{
			vpH=window.innerHeight;
		}
	}else{
		var rect=slot.getBoundingClientRect();
		if(rect.width===0||rect.height===0){
			host.classList.remove('tinymce-host-visible');
			return;
		}
		top=rect.top;left=rect.left;width=rect.width;
		host.style.height=Math.max(0,rect.height)+'px';
		host.style.top=top+'px';
		host.style.left=left+'px';
		host.style.width=width+'px';
		return;
	}
	host.style.top=top+'px';
	host.style.left=left+'px';
	host.style.width=width+'px';
	host.style.height=Math.max(0,vpH-top)+'px';
}
function hideTinyMCEHost(){
	_tinymceShowRequested=false;
	var host=document.getElementById('tinymce-host');
	if(host)host.classList.remove('tinymce-host-visible');
}
function stabilizeTinyMCEHostPosition(){
	if(!isMobileShellMode())return;
	positionTinyMCEHost();
	requestAnimationFrame(positionTinyMCEHost);
	setTimeout(positionTinyMCEHost,60);
	setTimeout(positionTinyMCEHost,180);
	try{
		if(_tinymceEditor&&_tinymceEditor.hasFocus&&_tinymceEditor.hasFocus()&&_tinymceEditor.selection&&_tinymceEditor.selection.scrollIntoView){
			_tinymceEditor.selection.scrollIntoView();
		}
	}catch(_e){}
}
function showTinyMCEHost(){
	_tinymceShowRequested=true;
	var host=document.getElementById('tinymce-host');
	if(!host)return;
	// Reveal on next frame so theme CSS overrides settle before first paint.
	requestAnimationFrame(function(){
		if(!_tinymceShowRequested)return;
		host.classList.add('tinymce-host-visible');
		positionTinyMCEHost();
		requestAnimationFrame(function(){
			positionTinyMCEHost();
			setTimeout(positionTinyMCEHost,60);
			setTimeout(positionTinyMCEHost,180);
		});
		if(isMobileShellMode()){
			try{
				if(_tinymceEditor&&_tinymceEditor.hasFocus&&_tinymceEditor.hasFocus()&&_tinymceEditor.selection&&_tinymceEditor.selection.scrollIntoView){
					_tinymceEditor.selection.scrollIntoView();
				}
			}catch(_e){}
		}
	});
}
function refreshTinyMCEForActiveNote(){
	if(!_tinymceEditor)return;
	var form=activeEditorForm();
	if(!form){hideTinyMCEHost();return}
	// Locked encrypted note: keep TinyMCE hidden, do not populate content.
	if(form.dataset.encrypted==='1'&&form.dataset.vaultUnlocked!=='1'){
		hideTinyMCEHost();
		return;
	}
	// Mode toggle: markdown mode shows the raw textarea, not TinyMCE.
	if(_editorMode==='markdown'||_editorMode==='md'){
		hideTinyMCEHost();
		return;
	}
	var slot=queryActiveEditor('#tinymce-slot');
	if(!slot){hideTinyMCEHost();return}
	// Use the server-rendered HTML from the slot's data attribute when available;
	// fall back to /fragments/preview if the note body was set client-side (e.g.
	// after unlock decrypts ciphertext into #note-body).
	var ta=getTA();
	var mdVal=ta?ta.value:'';
	var renderedFromServer=slot.dataset.renderedBody||'';
	if(renderedFromServer&&!(form.dataset.encrypted==='1')){
		_setTinyMCEContent(renderedFromServer);
		showTinyMCEHost();
		_applyTinyMCEReadonly(_tinymceEditor);
		return;
	}
	// Encrypted-and-now-unlocked: server sent no useful HTML. Re-render from plaintext.
	fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(mdVal)}).then(function(r){return r.text()}).then(function(h){
		if(!_tinymceEditor)return;
		_setTinyMCEContent(h);
		showTinyMCEHost();
		_applyTinyMCEReadonly(_tinymceEditor);
	});
}
// Reposition on resize / scroll / htmx swaps.
window.addEventListener('resize',positionTinyMCEHost);
document.addEventListener('scroll',positionTinyMCEHost,true);
// Back-compat shim: legacy code paths call initTinyMCE(textarea,content).
// Now they just refresh the persistent editor.
function initTinyMCE(_textarea,content){
	if(!_tinymceEditor){
		initPersistentTinyMCE();
		// When init completes it will refresh from the active note.
		return;
	}
	if(typeof content==='string'){
		_setTinyMCEContent(content);
		showTinyMCEHost();
	}
}
function noteCompletionSource(context) {
	var before = context.matchBefore(/\[\[[^\]]*/);
	if (!before) return null;
	var query = before.text.slice(2);
	return fetchNoteHeaders().then(function(headers) {
		var options = headers.filter(function(h) {
			return h.title.toLowerCase().indexOf(query.toLowerCase()) >= 0;
		}).map(function(h) {
			return {
				label: h.title,
				apply: '[' + h.title + '](:/' + h.id + ')',
				detail: 'Note link'
			};
		});
		return {
			from: before.from,
			options: options,
			filter: false
		};
	});
}
function getTextBeforeCursorPV(pv){
	var sel=window.getSelection();
	if(!sel||!sel.rangeCount||!pv||!pv.contains(sel.anchorNode))return'';
	var range=sel.getRangeAt(0);
	if(!range.collapsed)return'';
	var node=range.startContainer;
	var offset=range.startOffset;
	var walker=document.createTreeWalker(pv,NodeFilter.SHOW_TEXT,null,false);
	var text='';
	while(walker.nextNode()){
		var n=walker.currentNode;
		if(n===node){
			text+=(n.textContent||'').slice(0,offset);
			break;
		}
		text+=(n.textContent||'');
	}
	return text;
}
function requestProseCompletion(prompt,force,profileId){
	if(!force||!_openRouterEnabled)return Promise.resolve('');
	console.info('[joplock] prose autocomplete request context',{promptChars:String(prompt||'').length});
	var body='prompt='+encodeURIComponent(prompt||'')+(profileId?'&profileId='+encodeURIComponent(profileId):'');
	return fetch('/api/web/ai/prose-complete',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).then(function(r){if(r.ok)return r.json();return r.json().catch(function(){return {error:'HTTP '+r.status}}).then(function(data){var err=new Error((data&&data.error)||('HTTP '+r.status));err.providerStatus=data&&data.providerStatus;err.providerError=data&&data.providerError;err.contextChars=data&&data.contextChars;throw err})}).then(function(data){if(data&&typeof data.contextChars==='number')console.info('[joplock] prose autocomplete provider context',{contextChars:data.contextChars});if(data&&data.emptyReason)console.warn('[joplock] prose autocomplete empty',{reason:data.emptyReason,rawChars:data.rawChars,suffixTrimmedChars:data.suffixTrimmedChars,trimmedChars:data.trimmedChars,finishReason:data.finishReason||''});return data&&data.text?String(data.text).trim():''}).catch(function(err){console.warn('[joplock] prose autocomplete failed:',err&&err.message?err.message:err);if(err&&typeof err.contextChars==='number')console.warn('[joplock] prose autocomplete provider context',{contextChars:err.contextChars});if(err&&err.providerError)console.warn('[joplock] AI provider error', {status:err.providerStatus,error:err.providerError});return ''});
}
var _manualProseCompletionInFlight=false;
var _manualCodeMirrorProseText=null;
function manualProseCompletionSource(context){
	if(!_manualCodeMirrorProseText)return null;
	return {from:context.pos,options:[{label:_manualCodeMirrorProseText,apply:_manualCodeMirrorProseText,detail:'OpenRouter prose'}],filter:false};
}
function requestManualProseCompletion(opts){
	opts=opts||{};
	if(!_openRouterEnabled||_manualProseCompletionInFlight)return;
	var pv=getPV();
	var cm=getCM();
	var prompt='';
	var stateOverride=null;
	var cmRangeOverride=null;
	var profileId=opts.profileId||'';
	if(pv){syncPV();prompt=getTextBeforeCursorPV(pv)}
	else if(cm&&isMarkdownVisible()){prompt=cm.state.sliceDoc(0,cm.state.selection.main.head)}
	else{var ta2=getTA();prompt=ta2?ta2.value.slice(0,ta2.selectionStart||ta2.value.length):''}
	if(opts.state)stateOverride=opts.state;
	if(opts.cmRange)cmRangeOverride=opts.cmRange;
	if(!prompt||prompt.trim().length<20){console.info('[joplock] manual prose autocomplete skipped: prompt too short',{length:prompt?prompt.trim().length:0});return}
	console.info('[joplock] manual prose autocomplete query sent');
	_manualProseCompletionInFlight=true;
	requestProseCompletion(prompt,true,profileId).then(function(text){
		console.info('[joplock] manual prose autocomplete response received',{empty:!text,length:text?text.length:0});
		if(!text)return;
		if(getPV()){
			var coords=getCaretCoordinates();
			if(!coords)return;
			var state=stateOverride||getRenderProseState(true);
			if(!state){var sel=window.getSelection();if(sel&&sel.rangeCount){var range=sel.getRangeAt(0);if(range.startContainer&&range.startContainer.nodeType===3)state={kind:'prose',node:range.startContainer,startIdx:range.startOffset,endIdx:range.startOffset,prompt:prompt};else{var el=range.startContainer&&range.startContainer.nodeType===1?range.startContainer:(range.startContainer&&range.startContainer.parentElement?range.startContainer.parentElement:null);var block=el&&el.closest?el.closest('p,div,li,blockquote,h1,h2,h3,h4,h5,h6'):null;if(block&&getPV()&&getPV().contains(block))state={kind:'prose',node:block,startIdx:0,endIdx:(block.textContent||'').length,prompt:prompt}}}}
			if(state)showRenderAutocompletePopup(coords,[{label:text,text:text}],'prose',state);
		}else{var cm2=getCM();if(cm2&&isMarkdownVisible()){var s=cmRangeOverride||cm2.state.selection.main;var rect=cm2.coordsAtPos(s.from);if(!rect)return;showRenderAutocompletePopup({top:rect.top,left:rect.left,height:rect.height||18},[{label:text,text:text}],'cm-prose',{from:s.from,to:s.to})}else insertTxt(text)}
	}).finally(function(){_manualProseCompletionInFlight=false});
}

// --- Input ring buffer for Expander trigger detection ---
// Captures raw characters from beforeinput events before contenteditable normalization.
function createInputRingBuffer(size){
	var buf=[];
	var s=size||20;
	return {
		push:function(chars){if(!chars)return;buf.push(String(chars));while(buf.length>s)buf.shift()},
		tail:function(){return buf.join('')},
		reset:function(){buf=[]}
	};
}
var _inputRingBuffer=createInputRingBuffer(15);
var _pendingTextExpansion=null;
// Dedup flag: set when beforeinput successfully feeds the buffer so the input fallback can skip.
// On iOS Safari, beforeinput may not fire or may fire with insertCompositionText for normal Latin
// keystrokes (autocorrect pipeline), so input is used as a fallback.
var _ringBufFedFromBeforeinput=false;

// Only feed the buffer from committed text input events.
// insertCompositionText (in-progress IME) is excluded; only insertFromComposition (committed) is accepted.
function _ringBufAccepts(inputType){return inputType==='insertText'||inputType==='insertFromComposition'}

function detectTextExpanderFromBuffer(buffer){
	var tail=buffer.tail();
	if(!tail||!_textExpanders.length)return null;
	var candidates=_textExpanders.slice().sort(function(a,b){return b.trigger.length-a.trigger.length});
	for(var i=0;i<candidates.length;i++){var entry=candidates[i];if(entry.trigger&&tail.slice(-entry.trigger.length)===entry.trigger)return entry}
	return null;
}

function findPVTextPosition(root, offset){
	var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentElement&&n.parentElement.closest('script,style,button')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}},false);
	var count=0,node;
	while((node=walker.nextNode())){var len=(node.textContent||'').length;if(offset<=count+len)return {node:node,offset:Math.max(0,offset-count)};count+=len}
	return null;
}

function insertPVExpansionText(range,text){
	var value=String(text||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
	range.deleteContents();
	var parts=value.split('\n');
	var frag=document.createDocumentFragment();
	var caretNode=null;
	for(var i=0;i<parts.length;i++){
		var node=document.createTextNode(parts[i]);
		frag.appendChild(node);
		caretNode=node;
		if(i<parts.length-1)frag.appendChild(document.createElement('br'));
	}
	range.insertNode(frag);
	setPVCaret(caretNode,caretNode?caretNode.textContent.length:0);
}

function replacePVTextExpansion(entry){
	var pv=getPV();var sel=window.getSelection();
	if(!pv||!sel||!sel.rangeCount||!sel.isCollapsed||!entry){_clientLog('expander.pv.skip',{reason:'missing-selection-or-entry',hasPv:!!pv,hasSel:!!sel,rangeCount:sel&&sel.rangeCount||0,collapsed:!!(sel&&sel.isCollapsed)});return false;}
	var range=sel.getRangeAt(0);if(!pv.contains(range.commonAncestorContainer)){_clientLog('expander.pv.skip',{reason:'outside-preview'});return false;}
	var el=range.startContainer&&range.startContainer.nodeType===1?range.startContainer:(range.startContainer&&range.startContainer.parentElement?range.startContainer.parentElement:null);
	if(el&&el.closest&&el.closest('pre,code')){_clientLog('expander.pv.skip',{reason:'code-block',trigger:entry.trigger});return false;}
	if(range.startContainer&&range.startContainer.nodeType===3){
		var currentText=range.startContainer.textContent||'';
		if(currentText.slice(0,range.startOffset).slice(-entry.trigger.length)===entry.trigger){
			var directRange=document.createRange();directRange.setStart(range.startContainer,range.startOffset-entry.trigger.length);directRange.setEnd(range.startContainer,range.startOffset);directRange.deleteContents();
			insertPVExpansionText(directRange,entry.text);syncPV();pv.focus();_clientLog('expander.pv.replace',{path:'direct',trigger:entry.trigger,replacementLength:entry.text.length,lines:String(entry.text).split('\n').length});return true;
		}
	}
	var beforeRange=range.cloneRange();beforeRange.selectNodeContents(pv);beforeRange.setEnd(range.startContainer,range.startOffset);
	var before=beforeRange.toString();
	if(before.slice(-entry.trigger.length)!==entry.trigger){_clientLog('expander.pv.skip',{reason:'trigger-not-at-caret',trigger:entry.trigger,beforeTail:before.slice(-15).replace(/ /g,'·').replace(/\u00a0/g,'_')});return false;}
	var start=findPVTextPosition(pv,before.length-entry.trigger.length);
	if(!start){_clientLog('expander.pv.skip',{reason:'start-not-found',trigger:entry.trigger});return false;}
	var replaceRange=document.createRange();replaceRange.setStart(start.node,start.offset);replaceRange.setEnd(range.startContainer,range.startOffset);replaceRange.deleteContents();
	insertPVExpansionText(replaceRange,entry.text);syncPV();pv.focus();_clientLog('expander.pv.replace',{path:'range',trigger:entry.trigger,replacementLength:entry.text.length,lines:String(entry.text).split('\n').length});return true;
}

function removePVTriggerForAction(entry){
	var pv=getPV();var sel=window.getSelection();
	if(!pv||!sel||!sel.rangeCount||!sel.isCollapsed||!entry)return null;
	var range=sel.getRangeAt(0);if(!pv.contains(range.commonAncestorContainer))return null;
	var el=range.startContainer&&range.startContainer.nodeType===1?range.startContainer:(range.startContainer&&range.startContainer.parentElement?range.startContainer.parentElement:null);
	if(el&&el.closest&&el.closest('pre,code'))return null;
	if(range.startContainer&&range.startContainer.nodeType===3){
		var currentText=range.startContainer.textContent||'';
		if(currentText.slice(0,range.startOffset).slice(-entry.trigger.length)===entry.trigger){
			var caretOffset=range.startOffset-entry.trigger.length;var directRange=document.createRange();directRange.setStart(range.startContainer,caretOffset);directRange.setEnd(range.startContainer,range.startOffset);directRange.deleteContents();setPVCaret(range.startContainer,caretOffset);syncPV();pv.focus();return {kind:'prose',node:range.startContainer,startIdx:caretOffset,endIdx:caretOffset};
		}
	}
	var beforeRange=range.cloneRange();beforeRange.selectNodeContents(pv);beforeRange.setEnd(range.startContainer,range.startOffset);
	var before=beforeRange.toString();if(before.slice(-entry.trigger.length)!==entry.trigger)return null;
	var start=findPVTextPosition(pv,before.length-entry.trigger.length);if(!start)return null;
	var replaceRange=document.createRange();replaceRange.setStart(start.node,start.offset);replaceRange.setEnd(range.startContainer,range.startOffset);replaceRange.deleteContents();setPVCaret(start.node,start.offset);syncPV();pv.focus();return {kind:'prose',node:start.node,startIdx:start.offset,endIdx:start.offset};
}

function replaceCMTextExpansion(entry){
	var cm=getCM();if(!cm||!isMarkdownVisible()||!entry)return false;
	var s=cm.state.selection.main;if(!s||!s.empty)return false;
	var from=s.from-entry.trigger.length;if(from<0)return false;
	if(cm.state.sliceDoc(from,s.from)!==entry.trigger)return false;
	cm.dispatch({changes:{from:from,to:s.from,insert:entry.text},selection:{anchor:from+entry.text.length}});cm.focus();return true;
}

function removeCMTriggerForAction(entry){
	var cm=getCM();if(!cm||!isMarkdownVisible()||!entry)return null;
	var s=cm.state.selection.main;if(!s||!s.empty)return null;
	var from=s.from-entry.trigger.length;if(from<0)return null;
	if(cm.state.sliceDoc(from,s.from)!==entry.trigger)return null;
	cm.dispatch({changes:{from:from,to:s.from,insert:''},selection:{anchor:from}});cm.focus();return {from:from,to:from,trigger:entry.trigger};
}

// TinyMCE (rendered-mode) text expander. Inspects the text before the caret in
// the TinyMCE iframe selection; if it ends with a trigger, replaces the trigger
// with the expansion text. Text triggers only; AI triggers are skipped in
// rendered mode (the AI prose-completion path is not wired into the iframe).
function replaceTinyMCETextExpansion(entry,editor){
	var ed=editor||getTinyMCE();
	if(!ed||!entry||!entry.trigger)return false;
	var sel=ed.selection;if(!sel)return false;
	var rng=sel.getRng&&sel.getRng();if(!rng||!rng.collapsed)return false;
	var node=rng.startContainer;
	// Only act inside a text node; bail inside code/pre.
	var el=node&&node.nodeType===1?node:(node&&node.parentElement?node.parentElement:null);
	if(el&&el.closest&&el.closest('pre,code'))return false;
	if(!node||node.nodeType!==3)return false;
	var text=node.textContent||'';
	var caret=rng.startOffset;
	if(text.slice(0,caret).slice(-entry.trigger.length)!==entry.trigger)return false;
	var start=caret-entry.trigger.length;if(start<0)return false;
	var doc=ed.getDoc();
	var newRange=doc.createRange();
	newRange.setStart(node,start);
	newRange.setEnd(node,caret);
	newRange.deleteContents();
	// Insert expansion text; multi-line becomes <br>-separated for the rendered editor.
	var parts=String(entry.text).split('\n');
	var frag=doc.createDocumentFragment();
	var lastNode=null;
	for(var i=0;i<parts.length;i++){
		if(i>0)frag.appendChild(doc.createElement('br'));
		lastNode=doc.createTextNode(parts[i]);
		frag.appendChild(lastNode);
	}
	newRange.insertNode(frag);
	// Place caret after inserted content.
	var caretRange=doc.createRange();
	if(lastNode){caretRange.setStart(lastNode,(lastNode.textContent||'').length);}
	else{caretRange.setStart(node,start);}
	caretRange.collapse(true);
	sel.setRng(caretRange);
	ed.focus();
	// Sync to markdown source of truth.
	tinyMCESyncToTA();
	markEdited();scheduleSave();
	_clientLog('expander.tinymce.replace',{trigger:entry.trigger,replacementLength:entry.text.length,lines:parts.length});
	return true;
}

// Build an AI-prompt string from the text before the caret in the TinyMCE
// iframe. Walks the iframe body in document order up to the caret, joining
// block boundaries with newlines so the provider sees paragraph structure.
function getTextBeforeCaretTinyMCE(editor){
	var ed=editor||getTinyMCE();
	if(!ed||!ed.selection)return '';
	var rng=ed.selection.getRng&&ed.selection.getRng();
	if(!rng)return '';
	var doc=ed.getDoc&&ed.getDoc();var body=ed.getBody&&ed.getBody();
	if(!doc||!body)return '';
	// Range from the very start of the body to the caret.
	var pre=doc.createRange();
	pre.setStart(body,0);
	try{pre.setEnd(rng.startContainer,rng.startOffset);}catch(_e){return '';}
	var frag=pre.cloneContents();
	// Serialize the fragment to text, treating block elements as line breaks.
	var host=doc.createElement('div');host.appendChild(frag);
	var BLOCK=/^(P|DIV|LI|BLOCKQUOTE|H1|H2|H3|H4|H5|H6|PRE|TR|BR)$/;
	var out='';
	(function walk(node){
		for(var n=node.firstChild;n;n=n.nextSibling){
			if(n.nodeType===3){out+=n.textContent||'';}
			else if(n.nodeType===1){
				if(n.tagName==='BR'){out+='\n';continue;}
				var block=BLOCK.test(n.tagName);
				if(block&&out&&!/\n$/.test(out))out+='\n';
				walk(n);
				if(block&&out&&!/\n$/.test(out))out+='\n';
			}
		}
	})(host);
	return out.replace(/\u00a0/g,' ');
}

// Insert AI prose-completion text at the current TinyMCE caret and sync to the
// markdown source of truth. Multi-line completions become <br>-separated lines
// (matching replaceTinyMCETextExpansion), so a single paragraph is preserved.
// Text is inserted as DOM text nodes (never HTML) so provider output cannot
// inject markup into the iframe.
function insertProseCompletionTinyMCE(text,editor,bookmark){
	var ed=editor||getTinyMCE();
	if(!ed||!text||!ed.selection)return false;
	ed.focus();
	if(bookmark){try{ed.selection.moveToBookmark(bookmark);}catch(_e){}}
	var sel=ed.selection;
	var rng=sel.getRng&&sel.getRng();
	if(!rng)return false;
	var doc=ed.getDoc();
	rng.deleteContents();
	var parts=String(text).split('\n');
	var frag=doc.createDocumentFragment();
	var lastNode=null;
	for(var i=0;i<parts.length;i++){
		if(i>0)frag.appendChild(doc.createElement('br'));
		lastNode=doc.createTextNode(parts[i]);
		frag.appendChild(lastNode);
	}
	rng.insertNode(frag);
	var caretRange=doc.createRange();
	if(lastNode)caretRange.setStart(lastNode,(lastNode.textContent||'').length);
	else caretRange.setStart(rng.startContainer,rng.startOffset);
	caretRange.collapse(true);
	sel.setRng(caretRange);
	ed.focus();
	tinyMCESyncToTA();
	markEdited();scheduleSave();
	return true;
}

// Remove a matched AI-trigger from the TinyMCE iframe (so the trigger text does
// not become part of the prompt or remain after the completion). Returns true
// when the trigger was found immediately before the caret and removed.
function removeTinyMCETriggerForAction(entry,editor){
	var ed=editor||getTinyMCE();
	if(!ed||!entry||!entry.trigger||!ed.selection)return false;
	var rng=ed.selection.getRng&&ed.selection.getRng();
	if(!rng||!rng.collapsed)return false;
	var node=rng.startContainer;if(!node||node.nodeType!==3)return false;
	var caret=rng.startOffset;
	if((node.textContent||'').slice(0,caret).slice(-entry.trigger.length)!==entry.trigger)return false;
	var start=caret-entry.trigger.length;if(start<0)return false;
	var doc=ed.getDoc();
	var delRange=doc.createRange();
	delRange.setStart(node,start);delRange.setEnd(node,caret);
	delRange.deleteContents();
	var caretRange=doc.createRange();
	caretRange.setStart(node,start);caretRange.collapse(true);
	ed.selection.setRng(caretRange);
	return true;
}

// Screen (viewport) coordinates of the TinyMCE caret, for positioning the
// autocomplete popup which lives in the OUTER document. The caret rect from the
// iframe is relative to the iframe viewport, so offset it by the iframe element.
function tinyMCECaretCoords(editor){
	var ed=editor||getTinyMCE();
	if(!ed||!ed.selection)return null;
	var rng=ed.selection.getRng&&ed.selection.getRng();
	if(!rng)return null;
	var rect=null;
	try{
		var rects=rng.getClientRects&&rng.getClientRects();
		if(rects&&rects.length)rect=rects[rects.length-1];
		if(!rect||(!rect.width&&!rect.height)){
			var node=rng.startContainer;
			var el=node&&node.nodeType===1?node:(node&&node.parentElement);
			if(el&&el.getBoundingClientRect)rect=el.getBoundingClientRect();
		}
	}catch(_e){return null;}
	if(!rect)return null;
	var ifr=ed.iframeElement||(ed.getContentAreaContainer&&ed.getContentAreaContainer().querySelector&&ed.getContentAreaContainer().querySelector('iframe'));
	var off={left:0,top:0};
	if(ifr&&ifr.getBoundingClientRect){var ir=ifr.getBoundingClientRect();off.left=ir.left;off.top=ir.top;}
	return {top:rect.top+off.top,left:rect.left+off.left,height:rect.height||18};
}

// Launch an AI prose completion from within TinyMCE (rendered mode). Used by
// both the Ctrl/Cmd-Space shortcut and AI-action Expander triggers. The result
// is offered in the same accept/dismiss popup used by markdown mode (Enter/Tab
// to insert, Esc to discard) rather than inserted directly.
function requestTinyMCEProseCompletion(opts){
	opts=opts||{};
	var ed=opts.editor||getTinyMCE();
	if(!ed||!_openRouterEnabled||_manualProseCompletionInFlight)return false;
	var prompt=getTextBeforeCaretTinyMCE(ed);
	if(!prompt||prompt.trim().length<20){console.info('[joplock] tinymce prose autocomplete skipped: prompt too short',{length:prompt?prompt.trim().length:0});return false;}
	// Capture the caret so accept can insert at the right spot even if focus moves.
	var bookmark=null;try{bookmark=ed.selection.getBookmark(2);}catch(_e){}
	_manualProseCompletionInFlight=true;
	_clientLog('expander.tinymce.ai.request',{profileId:opts.profileId||'',promptChars:prompt.length});
	requestProseCompletion(prompt,true,opts.profileId||'').then(function(text){
		if(!text)return;
		var coords=tinyMCECaretCoords(ed);
		if(!coords){insertProseCompletionTinyMCE(text,ed);_clientLog('expander.tinymce.ai.insert',{length:text.length,fallback:true});return;}
		showRenderAutocompletePopup(coords,[{label:text,text:text}],'tinymce-prose',{editor:ed,bookmark:bookmark});
		_clientLog('expander.tinymce.ai.popup',{length:text.length});
	}).finally(function(){_manualProseCompletionInFlight=false});
	return true;
}

function maybeExpandTextFromTinyMCE(editor){
	var ed=editor||getTinyMCE();
	if(!ed||_editorMode==='markdown'||_editorMode==='md'||!_textExpanders.length)return false;
	var sel=ed.selection;if(!sel)return false;
	var rng=sel.getRng&&sel.getRng();if(!rng||!rng.collapsed)return false;
	var node=rng.startContainer;if(!node||node.nodeType!==3)return false;
	var before=(node.textContent||'').slice(0,rng.startOffset);
	var candidates=_textExpanders.slice().sort(function(a,b){return b.trigger.length-a.trigger.length});
	for(var i=0;i<candidates.length;i++){
		var entry=candidates[i];
		if(!entry.trigger)continue;
		if(before.slice(-entry.trigger.length)!==entry.trigger)continue;
		if(entry.action==='ai'){
			// AI prose-completion in rendered mode: remove the trigger from the
			// iframe, then request a completion and insert it at the caret.
			if(!_openRouterEnabled||_manualProseCompletionInFlight){
				_clientLog('expander.tinymce.skip',{reason:'ai-blocked',trigger:entry.trigger,openRouterEnabled:_openRouterEnabled,inFlight:_manualProseCompletionInFlight});
				continue;
			}
			if(!removeTinyMCETriggerForAction(entry,ed))continue;
			tinyMCESyncToTA();
			_clientLog('expander.tinymce.ai.trigger',{trigger:entry.trigger,profileId:entry.profileId||''});
			requestTinyMCEProseCompletion({editor:ed,profileId:entry.profileId||''});
			return true;
		}
		var ok=replaceTinyMCETextExpansion(entry,ed);
		_clientLog('expander.tinymce.match',{trigger:entry.trigger,action:entry.action,ok:ok});
		if(ok)return true;
	}
	return false;
}

function runTextExpanderAction(entry,source){
	if(!entry)return false;
	if(entry.action!=='ai')return source==='cm'?replaceCMTextExpansion(entry):replacePVTextExpansion(entry);
	if(!_openRouterEnabled||_manualProseCompletionInFlight){_clientLog('expander.ai.skip',{source:source,trigger:entry.trigger,reason:'blocked',openRouterEnabled:_openRouterEnabled,inFlight:_manualProseCompletionInFlight});return false;}
	if(source==='cm'){
		var cmRange=removeCMTriggerForAction(entry);if(!cmRange)return false;
		_clientLog('expander.ai.trigger',{source:source,trigger:entry.trigger,profileId:entry.profileId||''});
		requestManualProseCompletion({allowWithoutCtrlSpace:true,cmRange:cmRange,profileId:entry.profileId||''});return true;
	}
	var state=removePVTriggerForAction(entry);if(!state)return false;
	_clientLog('expander.ai.trigger',{source:source,trigger:entry.trigger,profileId:entry.profileId||''});
	requestManualProseCompletion({allowWithoutCtrlSpace:true,state:state,profileId:entry.profileId||''});return true;
}

function maybeExpandTextFromCM(cm){
	if(!cm||!isMarkdownVisible()||!_textExpanders.length)return false;
	var s=cm.state.selection.main;if(!s||!s.empty)return false;
	var from=Math.max(0,s.from-15);
	var before=cm.state.sliceDoc(from,s.from);
	var candidates=_textExpanders.slice().sort(function(a,b){return b.trigger.length-a.trigger.length});
	for(var i=0;i<candidates.length;i++){
		var entry=candidates[i];
		if(entry.trigger&&before.slice(-entry.trigger.length)===entry.trigger){_pendingTextExpansion=null;var ok=runTextExpanderAction(entry,'cm');_clientLog('expander.cm.match',{trigger:entry.trigger,action:entry.action,ok:ok,replacementLength:entry.text.length,lines:String(entry.text).split('\n').length});if(ok)_resetRingBuffer('cm-text-expansion');return ok}
	}
	return false;
}

function consumePendingTextExpansion(source){
	var entry=_pendingTextExpansion;_pendingTextExpansion=null;
	if(!entry)return false;
	var ok=runTextExpanderAction(entry,source);
	if(ok)_resetRingBuffer('text-expansion');
	_clientLog('expander.consume',{source:source,trigger:entry.trigger,ok:ok});
	return ok;
}

function _feedRingBuffer(source,inputType,data){
	if(!_ringBufAccepts(inputType)||!data)return;
	_inputRingBuffer.push(data);
	var tail=_inputRingBuffer.tail().slice(-12).replace(/ /g,'·').replace(/\u00a0/g,'⍽');
	var expansion=detectTextExpanderFromBuffer(_inputRingBuffer);
	if(expansion){_pendingTextExpansion=expansion;_clientLog('expander.detect',{source:source,inputType:inputType,trigger:expansion.trigger,tail:tail})}
}

function _resetRingBuffer(reason){
	_inputRingBuffer.reset();
	_pendingTextExpansion=null;
}
function maybeTriggerManualProseFromCM(cm, upd){
	if(!upd||!upd.docChanged||!upd.transactions||!upd.transactions.length)return;
	maybeExpandTextFromCM(cm);
}
var _activeRenderPopup = null;
var _activeRenderPopupKind = null;
var _activeRenderPopupState = null;
var _popupSelectedIndex = 0;
var _popupItems = [];
var _renderProseTimer = null;

function getRenderQueryState() {
	var sel = window.getSelection();
	if (!sel || !sel.rangeCount) return null;
	var range = sel.getRangeAt(0);
	if (range.startContainer.nodeType !== 3) return null;
	var text = range.startContainer.textContent;
	var offset = range.startOffset;
	var beforeText = text.slice(0, offset);
	var bracketIdx = beforeText.lastIndexOf('[[');
	if (bracketIdx === -1) return null;
	if (beforeText.slice(bracketIdx).indexOf(']]') !== -1) return null;
	var query = beforeText.slice(bracketIdx + 2);
	return {
		kind: 'note',
		node: range.startContainer,
		startIdx: bracketIdx,
		endIdx: offset,
		query: query
	};
}

function getRenderProseState(force) {
	var sel = window.getSelection();
	if (!sel || !sel.rangeCount) return null;
	var range = sel.getRangeAt(0);
	if (range.startContainer.nodeType !== 3) return null;
	var text = range.startContainer.textContent || '';
	var offset = range.startOffset;
	var beforeText = text.slice(0, offset);
	if (beforeText.length < 20) return null;
	if (/\[\[[^\]]*$/.test(beforeText)) return null;
	var query = '';
	if (!force) {
		var match = beforeText.match(/(?:^|[^A-Za-z0-9'’\-])([A-Za-z][A-Za-z0-9'’\-]{2,})\s+$/);
		if (!match) return null;
		query = match[1];
	}
	return {
		kind: 'prose',
		node: range.startContainer,
		startIdx: offset,
		endIdx: offset,
		query: query,
		prompt: text
	};
}

function getRenderAutocompleteState() {
	return getRenderQueryState();
}

function getCaretCoordinates() {
	var sel = window.getSelection();
	if (!sel || !sel.rangeCount) return null;
	var range = sel.getRangeAt(0);
	var rect = range.getBoundingClientRect();
	var vv=visualViewportBounds();
	function validRect(r){return !!(r&&Number.isFinite(r.top)&&Number.isFinite(r.left)&&r.bottom>=vv.top&&r.top<=vv.top+vv.height&&r.right>=vv.left&&r.left<=vv.left+vv.width&&(r.width>0||r.height>0))}
	if (validRect(rect)) {
		return { top: rect.top, left: rect.left, height: rect.height || 18 };
	}
	var span = document.createElement('span');
	span.textContent = '\u200b';
	var clonedRange = range.cloneRange();
	clonedRange.insertNode(span);
	var spanRect = span.getBoundingClientRect();
	var parent = span.parentNode;
	if (parent) {
		parent.removeChild(span);
		parent.normalize();
	}
	if (!validRect(spanRect)) return null;
	return { top: spanRect.top, left: spanRect.left, height: spanRect.height || 18 };
}

function hideRenderAutocompletePopup() {
	if (_activeRenderPopup) {
		if (_activeRenderPopup.parentNode) {
			_activeRenderPopup.parentNode.removeChild(_activeRenderPopup);
		}
		_activeRenderPopup = null;
	}
	_activeRenderPopupKind = null;
	_activeRenderPopupState = null;
	_popupItems = [];
}

function placeRenderAutocompletePopup(popup, coords) {
	var vv=visualViewportBounds();
	var margin=8;
	var viewportLeft=vv.left+margin;
	var viewportTop=vv.top+margin;
	var viewportRight=vv.left+vv.width-margin;
	var viewportBottom=vv.top+vv.height-margin;
	popup.style.maxWidth=Math.max(120,vv.width-(margin*2))+'px';
	popup.style.maxHeight=Math.max(80,vv.height-(margin*2))+'px';
	var rect=popup.getBoundingClientRect();
	var below=(coords.top||0)+(coords.height||18)+margin;
	var above=(coords.top||0)-rect.height-margin;
	var spaceBelow=viewportBottom-below;
	var spaceAbove=above-viewportTop;
	var top=(spaceBelow>=Math.min(rect.height,80)||spaceBelow>=spaceAbove)?below:above;
	var maxTop=Math.max(viewportTop,viewportBottom-rect.height);
	top=Math.min(Math.max(top,viewportTop),maxTop);
	var maxLeft=Math.max(viewportLeft,viewportRight-rect.width);
	var left=Math.min(Math.max(coords.left||viewportLeft,viewportLeft),maxLeft);
	popup.style.top=top+'px';
	popup.style.left=left+'px';
}

function showRenderAutocompletePopup(coords, items, kind, state) {
	hideRenderAutocompletePopup();
	if (!coords || !Number.isFinite(coords.top) || !Number.isFinite(coords.left)) return;
	if (!items || !items.length) return;
	_activeRenderPopupKind = kind || null;
	_activeRenderPopupState = state || null;
	_popupItems = items;
	_popupSelectedIndex = 0;
	var popup = document.createElement('div');
	popup.className = 'note-autocomplete-popup';
	popup.style.position = 'fixed';
	popup.style.top = '0px';
	popup.style.left = '0px';
	popup.style.zIndex = '999999';
	items.forEach(function(entry, idx) {
		var row = document.createElement('div');
		row.className = 'note-autocomplete-item' + (idx === 0 ? ' active' : '');
		row.textContent = entry.label || entry.title || entry.text || '';
		row.addEventListener('mousedown', function(e) {
			e.preventDefault();
			applyActiveAutocompleteSelection(entry);
			hideRenderAutocompletePopup();
		});
		popup.appendChild(row);
	});
	document.body.appendChild(popup);
	placeRenderAutocompletePopup(popup,coords);
	_activeRenderPopup = popup;
}

function applyActiveAutocompleteSelection(entry){
	if(!entry)return;
	if(_activeRenderPopupKind==='prose'){
		var shouldScroll=shouldScrollPreviewAfterAutocomplete(_activeRenderPopupState);
		replaceRenderQueryWithText((entry.text||entry.label||'').trim(),_activeRenderPopupState);
		if(shouldScroll)scrollPreviewToBottom();
	}else if(_activeRenderPopupKind==='cm-prose'){
		var cm=getCM();
		var state=_activeRenderPopupState||{};
		var text=(entry.text||entry.label||'').trim();
		if(cm&&text){var from=typeof state.from==='number'?state.from:cm.state.selection.main.from;var to=typeof state.to==='number'?state.to:cm.state.selection.main.to;var docLen=cm.state.doc.length;from=Math.min(Math.max(from,0),docLen);to=Math.min(Math.max(to,from),docLen);var atBottom=to>=docLen;try{cm.dispatch({changes:{from:from,to:to,insert:text},selection:{anchor:from+text.length}});cm.focus();if(atBottom)scrollMarkdownToBottom()}catch(err){console.error('[joplock] autocomplete dispatch failed',err);var cur=cm.state.selection.main;cm.dispatch({changes:{from:cur.from,to:cur.to,insert:text},selection:{anchor:cur.from+text.length}});cm.focus();scrollMarkdownToBottom()}}
	}else if(_activeRenderPopupKind==='tinymce-prose'){
		var st=_activeRenderPopupState||{};
		var t=(entry.text||entry.label||'').trim();
		if(t){insertProseCompletionTinyMCE(t,st.editor,st.bookmark);_clientLog('expander.tinymce.ai.insert',{length:t.length});}
	}else{
		replaceRenderQueryWithLink(entry.id,entry.title);
	}
}

function shouldScrollPreviewAfterAutocomplete(state){
	var pv=getPV();
	if(!pv||!state||!state.node)return false;
	var node=state.node;
	if(!pv.contains(node))return false;
	if(typeof state.endIdx==='number'&&state.endIdx<(node.textContent||'').length)return false;
	var cursor=node;
	while(cursor&&cursor!==pv){
		while(cursor.nextSibling){
			cursor=cursor.nextSibling;
			if((cursor.textContent||'').trim()||cursor.nodeName==='IMG')return false;
		}
		cursor=cursor.parentNode;
	}
	return true;
}

function scrollPreviewToBottom(){
	var pv=getPV();
	if(!pv)return;
	setTimeout(function(){pv.scrollTop=pv.scrollHeight},0);
}

function scrollMarkdownToBottom(){
	var cm=getCM();
	if(cm&&cm.scrollDOM){setTimeout(function(){cm.scrollDOM.scrollTop=cm.scrollDOM.scrollHeight},0);return}
	var ta=getTA();
	if(ta)setTimeout(function(){ta.scrollTop=ta.scrollHeight},0);
}

// Handle a keydown while the autocomplete popup is open. Returns true if the
// key was consumed. Shared between the outer-document listener and the TinyMCE
// iframe keydown handler (iframe key events never reach the outer document).
function handleRenderPopupKey(e){
	if(!_activeRenderPopup)return false;
	if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Enter'||e.key==='Tab'||e.key==='Escape'){
		if(e.preventDefault)e.preventDefault();
		if(e.stopPropagation)e.stopPropagation();
		if(e.key==='ArrowDown'){
			_popupSelectedIndex=(_popupSelectedIndex+1)%_popupItems.length;
			updateRenderPopupSelection();
		}else if(e.key==='ArrowUp'){
			_popupSelectedIndex=(_popupSelectedIndex-1+_popupItems.length)%_popupItems.length;
			updateRenderPopupSelection();
		}else if(e.key==='Enter'||e.key==='Tab'){
			applyActiveAutocompleteSelection(_popupItems[_popupSelectedIndex]);
			hideRenderAutocompletePopup();
		}else if(e.key==='Escape'){
			hideRenderAutocompletePopup();
		}
		return true;
	}
	return false;
}

document.addEventListener('keydown',function(e){
	handleRenderPopupKey(e);
},true);

function updateRenderPopupSelection() {
	if (!_activeRenderPopup) return;
	var items = _activeRenderPopup.querySelectorAll('.note-autocomplete-item');
	items.forEach(function(item, idx) {
		if (idx === _popupSelectedIndex) {
			item.classList.add('active');
			item.scrollIntoView({ block: 'nearest' });
		} else {
			item.classList.remove('active');
		}
	});
}

function replaceRenderQueryWithText(text, state) {
	var current = state || getRenderAutocompleteState();
	if (!current) return;
	var node = current.node;
	if (node && node.nodeType === 1) {
		while (node.firstChild) node.removeChild(node.firstChild);
		var insertElementNode = document.createTextNode(text);
		var afterElementNode = document.createTextNode('\u200b');
		node.appendChild(insertElementNode);
		node.appendChild(afterElementNode);
		var selElement = window.getSelection();
		var rangeElement = document.createRange();
		rangeElement.setStart(afterElementNode, 1);
		rangeElement.collapse(true);
		selElement.removeAllRanges();
		selElement.addRange(rangeElement);
		if (window.syncPV) window.syncPV();
		var pvElement = getPV();
		if (pvElement) pvElement.focus();
		return;
	}
	var fullText = node.textContent;
	var beforeText = fullText.slice(0, current.startIdx);
	var afterText = fullText.slice(current.endIdx);
	var parent = node.parentNode;
	if (!parent) return;
	if (beforeText) {
		parent.insertBefore(document.createTextNode(beforeText), node);
	}
	var insertNode = document.createTextNode(text);
	parent.insertBefore(insertNode, node);
	var afterNode = document.createTextNode(afterText || '\u200b');
	parent.insertBefore(afterNode, node);
	parent.removeChild(node);
	var sel = window.getSelection();
	var range = document.createRange();
	range.setStart(afterNode, afterText ? 0 : 1);
	range.collapse(true);
	sel.removeAllRanges();
	sel.addRange(range);
	if (window.syncPV) window.syncPV();
	var pv = getPV();
	if (pv) pv.focus();
}

function proseCompletionApply(text, state) {
	replaceRenderQueryWithText(text, state);
}

function replaceRenderQueryWithLink(noteId, title) {
	var state = getRenderQueryState();
	if (!state) return;
	var node = state.node;
	var text = node.textContent;
	var startIdx = state.startIdx;
	var endIdx = state.endIdx;
	var a = document.createElement('a');
	a.href = '/resources/' + noteId + '?download=1';
	a.setAttribute('data-resource-id', noteId);
	a.textContent = title;
	var beforeText = text.slice(0, startIdx);
	var afterText = text.slice(endIdx);
	var parent = node.parentNode;
	if (beforeText) {
		var beforeNode = document.createTextNode(beforeText);
		parent.insertBefore(beforeNode, node);
	}
	parent.insertBefore(a, node);
	var afterNode = null;
	if (afterText) {
		afterNode = document.createTextNode(afterText);
		parent.insertBefore(afterNode, node);
	} else {
		afterNode = document.createTextNode('\u200b');
		parent.insertBefore(afterNode, node);
	}
	parent.removeChild(node);
	var sel = window.getSelection();
	var range = document.createRange();
	range.setStart(afterNode, afterNode.textContent.startsWith('\u200b') ? 1 : 0);
	range.collapse(true);
	sel.removeAllRanges();
	sel.addRange(range);
	if (window.syncPV) window.syncPV();
	var pv = getPV();
	if (pv) pv.focus();
}
function _cmNormalizeLanguageSupport(support){
	if(!support)return null;
	if(support.language&&support.language.parser)return support;
	if(support.parser)return {language:support};
	return null;
}
function _cmLanguageDescription(C,name,alias,buildSupport){
	var support=null;
	try{support=_cmNormalizeLanguageSupport(buildSupport())}catch(_e){support=null}
	if(!support)return null;
	return C.LanguageDescription.of({
		name:name,
		alias:alias||[],
		load:function(){return Promise.resolve(support)}
	});
}
function initCM(host,content){
	if(_cmView){_cmView.destroy();_cmView=null}
	var C=window.CM;
	var joplockTheme=C.EditorView.theme({
		'&':{height:'100%'},
		'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Mono",monospace',lineHeight:'1.7'},
		'.cm-content':{padding:'16px 20px',caretColor:'var(--accent)'},
		'.cm-gutters':{display:'none'},
		'.cm-search.cm-panel':{display:'none'},
		'.cm-searchMatch':{backgroundColor:'#ffe066',color:'#111',borderRadius:'2px'},
		'.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#ff9800',color:'#111',borderRadius:'2px'},
		'.cm-selectionBackground':{backgroundColor:'color-mix(in srgb, var(--accent) 25%, transparent) !important'},
		'&.cm-focused .cm-selectionBackground':{backgroundColor:'color-mix(in srgb, var(--accent) 30%, transparent) !important'},
		'.cm-cursor':{borderLeftColor:'var(--accent)'},
		'.cm-matchingBracket':{backgroundColor:'color-mix(in srgb, var(--accent) 25%, transparent)'}
	});
	var joplockHighlight=C.HighlightStyle.define([
		{tag:C.tags.heading1,fontWeight:'bold',fontSize:'1.6em',color:'var(--text-heading)'},
		{tag:C.tags.heading2,fontWeight:'bold',fontSize:'1.35em',color:'var(--text-heading)'},
		{tag:C.tags.heading3,fontWeight:'bold',fontSize:'1.15em',color:'var(--text-heading)'},
		{tag:[C.tags.heading4,C.tags.heading5,C.tags.heading6],fontWeight:'bold',color:'var(--text-heading)'},
		{tag:C.tags.strong,fontWeight:'bold',color:'var(--text-heading)'},
		{tag:C.tags.emphasis,fontStyle:'italic'},
		{tag:C.tags.strikethrough,textDecoration:'line-through'},
		{tag:C.tags.link,color:'var(--accent)',textDecoration:'underline'},
		{tag:C.tags.url,color:'var(--accent)',textDecoration:'underline'},
		{tag:C.tags.processingInstruction,fontFamily:'"Cascadia Mono",monospace',color:'var(--accent)'},
		{tag:C.tags.monospace,fontFamily:'"Cascadia Mono",monospace'},
		{tag:C.tags.meta,color:'var(--text-dim)'},
		{tag:C.tags.quote,color:'var(--text-dim)',fontStyle:'italic'},
		{tag:C.tags.keyword,color:'#c678dd'},
		{tag:[C.tags.string,C.tags.special(C.tags.brace)],color:'#98c379'},
		{tag:C.tags.number,color:'#d19a66'},
		{tag:C.tags.bool,color:'#d19a66'},
		{tag:[C.tags.definition(C.tags.variableName),C.tags.function(C.tags.variableName)],color:'#61afef'},
		{tag:C.tags.typeName,color:'#e5c07b'},
		{tag:C.tags.comment,color:'var(--text-dim)',fontStyle:'italic'},
		{tag:C.tags.operator,color:'#56b6c2'},
		{tag:C.tags.className,color:'#e5c07b'},
		{tag:C.tags.propertyName,color:'#e06c75'},
		{tag:C.tags.attributeName,color:'#d19a66'},
		{tag:C.tags.attributeValue,color:'#98c379'}
	]);
	var onUpdate=C.EditorView.updateListener.of(function(upd){
		if(upd.docChanged){cmSyncToTA();var ta=getTA();if(ta)ta.dispatchEvent(new Event('input',{bubbles:true}));maybeTriggerManualProseFromCM(_cmView,upd)}
	});
	var codeLanguages=[];
	[
		_cmLanguageDescription(C,'javascript',['js','jsx'],function(){return C.javascript({jsx:true})}),
		_cmLanguageDescription(C,'typescript',['ts','tsx'],function(){return C.javascript({typescript:true,jsx:true})}),
		_cmLanguageDescription(C,'html',[],function(){return C.html()}),
		_cmLanguageDescription(C,'css',[],function(){return C.css()}),
		_cmLanguageDescription(C,'json',[],function(){return C.json()}),
		_cmLanguageDescription(C,'sql',[],function(){return C.sql()}),
		_cmLanguageDescription(C,'python',['py'],function(){return C.python()}),
		_cmLanguageDescription(C,'xml',[],function(){return C.xml()}),
		_cmLanguageDescription(C,'go',['golang'],function(){return C.go()}),
		_cmLanguageDescription(C,'c++',['cpp','c'],function(){return C.cpp()}),
		_cmLanguageDescription(C,'yaml',['yml','dockerfile','docker-compose'],function(){return C.yaml()}),
		_cmLanguageDescription(C,'shell',['bash','sh','zsh'],function(){return C.StreamLanguage.define(C.shell)})
	].forEach(function(desc){if(desc)codeLanguages.push(desc)});
	_cmView=new C.EditorView({
		state:C.EditorState.create({
			doc:content||'',
				extensions:[
					C.markdown({base:C.markdownLanguage,codeLanguages:codeLanguages}),
				C.syntaxHighlighting(joplockHighlight),
				C.syntaxHighlighting(C.defaultHighlightStyle,{fallback:true}),
				joplockTheme,
			C.drawSelection(),
			...(_highlightActiveLine?[C.highlightActiveLine()]:[]),
			C.bracketMatching(),
			C.highlightSelectionMatches(),
			C.history(),
					C.keymap.of([{key:'Mod-Space',run:function(){requestManualProseCompletion();return true}},{key:'Ctrl-Space',run:function(){requestManualProseCompletion();return true}},...C.defaultKeymap,...C.historyKeymap,...C.searchKeymap.filter(function(b){var k=b.key||'';return k!=='Mod-f'&&k!=='F3'&&k!=='Mod-g'}),C.indentWithTab]),
					C.placeholder('Start writing...'),
			C.autocompletion({ override: [manualProseCompletionSource,noteCompletionSource] }),
			onUpdate,
			C.EditorView.lineWrapping,
			C.EditorView.domEventHandlers({click:function(e,view){var pos=view.posAtCoords({x:e.clientX,y:e.clientY});if(pos==null)return false;var line=view.state.doc.lineAt(pos);var text=line.text;var offset=pos-line.from;var m;var linkRe=/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;while((m=linkRe.exec(text))!==null){if(offset>=m.index&&offset<=m.index+m[0].length){var url=m[2];if(e.ctrlKey||e.metaKey){window.open(url,'_blank','noopener');return true}_copyTextToClipboard(url,function(ok){if(ok)_showLinkCopiedToast(e.clientX,e.clientY)});return true}}var urlRe=/https?:\/\/[^\s)>\]]+/g;while((m=urlRe.exec(text))!==null){if(offset>=m.index&&offset<=m.index+m[0].length){if(e.ctrlKey||e.metaKey){window.open(m[0],'_blank','noopener');return true}_copyTextToClipboard(m[0],function(ok){if(ok)_showLinkCopiedToast(e.clientX,e.clientY)});return true}}return false;}})
		]
		}),
		parent:host
	});
	if(_cmView.contentDOM){
		// Ring buffer: capture raw input before CM processes it
		_cmView.contentDOM.addEventListener('beforeinput',function(e){
			_ringBufFedFromBeforeinput=false;
			if(!_ringBufAccepts(e.inputType)){
				if(e.inputType&&(e.inputType.indexOf('delete')>=0||e.inputType==='historyUndo'||e.inputType==='historyRedo'))_resetRingBuffer('cm-deletion-or-undo');
				return;
			}
			if(e.data){_feedRingBuffer('cm',e.inputType,e.data);_ringBufFedFromBeforeinput=true}
		});
		// Ring buffer: consume pending trigger after CM has settled.
		// Also feeds buffer as fallback when beforeinput didn't fire (iOS Safari autocorrect pipeline).
		_cmView.contentDOM.addEventListener('input',function(e){
			if(!_ringBufFedFromBeforeinput&&e&&e.data){_feedRingBuffer('cm-input-fallback',e.inputType||'insertText',e.data)}
			_ringBufFedFromBeforeinput=false;
			if(_pendingTextExpansion){consumePendingTextExpansion('cm');return}
		});
		_cmView.contentDOM.addEventListener('blur',function(){_resetRingBuffer('cm-blur')});
		// Drag-and-drop file upload directly into markdown editor (no modal).
		_cmView.contentDOM.addEventListener('dragover',function(e){
			if(e.dataTransfer&&e.dataTransfer.types&&Array.prototype.indexOf.call(e.dataTransfer.types,'Files')>=0){
				e.preventDefault();if(e.dataTransfer){try{e.dataTransfer.dropEffect='copy'}catch(_){}}
			}
		});
		_cmView.contentDOM.addEventListener('drop',function(e){
			var files=e.dataTransfer&&e.dataTransfer.files;
			if(!files||!files.length)return;
			e.preventDefault();e.stopPropagation();
			var arr=Array.prototype.slice.call(files);
			// Insert at drop position if resolvable, else at current selection.
			try{var p=_cmView.posAtCoords({x:e.clientX,y:e.clientY});if(p!=null)_cmView.dispatch({selection:{anchor:p}})}catch(_){}
			arr.reduce(function(pr,file){return pr.then(function(){return _uploadFileToCM(file)})},Promise.resolve()).then(function(){markEdited();scheduleSave()}).catch(function(err){console.error('CM drop upload failed:',err)});
		});
	}
}
var _editorMode='markdown';
function syncEditorModeButtons(){var mode=_editorMode||'rich';var isMd=mode==='markdown'||mode==='md';document.querySelectorAll('#markdown-toggle').forEach(function(btn){btn.classList.toggle('active',isMd)});document.querySelectorAll('#preview-toggle').forEach(function(btn){btn.classList.toggle('active',!isMd)});var mMd=document.getElementById('mobile-md-toggle');var mPv=document.getElementById('mobile-preview-toggle');if(mMd)mMd.classList.toggle('active',isMd);if(mPv)mPv.classList.toggle('active',!isMd);document.body.classList.toggle('mobile-markdown-mode',inMobileEditor()&&isMd);document.body.classList.toggle('editor-markdown-mode',isMd);document.body.classList.toggle('editor-rich-mode',!isMd);if(isMd&&typeof closeExportMenu==='function')closeExportMenu()}
function applyEditorModeVisibility(mode,opts){
	opts=opts||{};
	var isMd=mode==='markdown'||mode==='md';
	var ta=getTA();
	var tb=queryActiveEditor('#editor-toolbar');
	var cmHost=queryActiveEditor('#cm-host');
	var slot=queryActiveEditor('#tinymce-slot');
	var pv=queryActiveEditor('#note-preview');
	if(tb&&!opts.preserveToolbarInline)tb.style.display='';
	if(isMd){
		hideTinyMCEHost();
		// The tinymce-slot placeholder also has flex:1; collapse it in markdown mode so it
		// does not steal vertical space from #cm-host (which would truncate the editor).
		if(slot){slot.style.flex='0';slot.style.height='0';slot.style.minHeight='0';}
		var haveCM=!!(cmHost&&window.CM);
		if(cmHost)cmHost.style.display=haveCM?'':'none';
		if(ta){
			// When CM6 is available the textarea is a hidden sync target; otherwise it is the
			// visible fallback editor.
			if(haveCM){
				ta.style.display='none';
			}else{
				ta.style.display='block';
				ta.style.flex='1';
				ta.style.minHeight='0';
				if(opts.focusTextarea!==false)ta.focus();
			}
		}
		if(pv)pv.style.display='none';
		return;
	}
	// Rich mode: restore the slot so it anchors and sizes the TinyMCE host.
	if(slot){slot.style.flex='';slot.style.height='';slot.style.minHeight='';}
	if(ta)ta.style.display='none';
	if(cmHost)cmHost.style.display='none';
	if(pv)pv.style.display='none';
}
function activeSearchInput(){if(isMobileShellMode()){var mobileInput=document.getElementById('mobile-editor-search-input');if(mobileInput)return mobileInput}return document.getElementById('nav-search')}
function currentListSearchInput(){return document.getElementById('nav-search')||document.getElementById('mobile-search-input')}
function currentListSearchTerm(){var input=currentListSearchInput();return input&&typeof input.value==='string'?input.value:''}
function activeSearchTerm(){var input=activeSearchInput();return input&&typeof input.value==='string'?input.value:''}
var _cmSearchMatches=[];
function clearCodeMirrorSearch(){_cmSearchMatches=[];if(_cmView&&window.CM&&window.CM.SearchQuery&&window.CM.setSearchQuery){_cmView.dispatch({effects:window.CM.setSearchQuery.of(new window.CM.SearchQuery({search:'',caseSensitive:false}))});}}
function collectCodeMirrorSearchMatches(query){if(!_cmView||!query||!query.valid||!query.search)return[];var cursor=query.getCursor(_cmView.state.doc);var out=[];for(var next=cursor.next();!next.done;next=cursor.next())out.push({from:next.value.from,to:next.value.to});return out}
function setCodeMirrorSearchActive(idx){if(!_cmView||!_cmSearchMatches.length)return;_searchMarkIdx=((idx%_cmSearchMatches.length)+_cmSearchMatches.length)%_cmSearchMatches.length;var match=_cmSearchMatches[_searchMarkIdx];var Sel=_cmView.state.selection.constructor;_cmView.dispatch({selection:Sel.cursor(match.from),scrollIntoView:true});searchNavShow(_cmSearchMatches.length,_searchMarkIdx)}
function clearPreviewSearchMarks(root){if(!root)return;root.querySelectorAll('mark.search-highlight').forEach(function(m){var text=document.createTextNode(m.textContent);m.parentNode.replaceChild(text,m)});root.normalize()}
	function applyMobileTitleMode(){var ti=queryActiveEditor('.editor-title');if(!ti)return;var mobile=isMobileShellMode();var inMobileEditor=!!ti.closest('#mobile-editor-body');ti.contentEditable=(mobile&&!inMobileEditor)?'false':'true';ti.classList.toggle('editor-title-mobile-readonly',mobile&&!inMobileEditor)}
var _pvSyncTimer=null;var _syncPVInFlight=false;
var _previewDirty=false;
function syncPV(){var pv=getPV(),ta=getTA();if(pv&&ta){var md=htmlToMarkdown(pv);if(ta.value!==md){ta.value=md;ta.dispatchEvent(new Event('input',{bubbles:true}));_previewDirty=false;return true}}_previewDirty=false;return false}
function scheduleSyncPV(){if(_pvSyncTimer)clearTimeout(_pvSyncTimer);_pvSyncTimer=setTimeout(function(){_pvSyncTimer=null;_syncPVInFlight=true;var changed=syncPV();_syncPVInFlight=false;autoTitle();if(!changed){_log('scheduleSyncPV: no markdown change')}},150)}
// Auto-title: first line of body becomes title unless user manually edited it
var _titleManual=false;
var stripMdForTitle=window.joplockStripNoteTitle||function(s){return String(s||'').trim()};
function syncTitleToHidden(opts){opts=opts||{};var ti=queryActiveEditor('.editor-title');var hi=queryActiveEditor('.editor-title-hidden');var mobileTitle=document.getElementById('mobile-editor-title');if(!hi)return '';var raw=ti?ti.textContent:'';var plain=stripMdForTitle(raw);if(ti&&plain!==raw.trim())ti.textContent=plain;hi.value=plain;if(mobileTitle&&document.activeElement!==mobileTitle&&mobileTitle.textContent!==plain)mobileTitle.textContent=plain||'Note';if(!opts.silent){markEdited();scheduleSaveTitle()}return plain}
function syncTitle(){syncTitleToHidden()}
function mobileSyncTitle(){var mobileTitle=document.getElementById('mobile-editor-title');if(!mobileTitle)return;var plain=stripMdForTitle(mobileTitle.textContent);var hi=queryActiveEditor('.editor-title-hidden');var ti=queryActiveEditor('.editor-title');if(hi)hi.value=plain;if(ti)ti.textContent=plain;_titleManual=true;markEdited()}
function mobileSyncTitleAndSave(){mobileSyncTitle();scheduleSaveTitle()}
function initAutoTitle(){_titleManual=false;var ti=queryActiveEditor('.editor-title');if(ti&&ti.style.display!=='none'){ti.addEventListener('input',function(){_titleManual=true;syncTitle()})}}
function _autoTitleCandidate(line){var trimmed=(line||'').trim();if(!trimmed)return '';if(/^!\[[^\]]*\]\([^\)]+\)$/.test(trimmed))return '';if(/^<img\b[^>]*\/?>(?:<\/img>)?$/i.test(trimmed))return '';return stripMdForTitle(trimmed.replace(/^#+\s*/,''));}
function autoTitle(){if(_titleManual)return;var ta=getTA();var hi=queryActiveEditor('.editor-title-hidden');var ti=queryActiveEditor('.editor-title');var mobileTitle=document.getElementById('mobile-editor-title');if(!ta||!hi)return;var val=ta.value;var lines=val.split('\n');var firstPlain='';for(var i=0;i<lines.length;i++){var candidate=_autoTitleCandidate(lines[i]);if(candidate){firstPlain=candidate;break}}if(firstPlain&&firstPlain!==hi.value){if(ti)ti.textContent=firstPlain;// Don't clobber #mobile-editor-title while user is editing it
if(mobileTitle&&document.activeElement!==mobileTitle)mobileTitle.textContent=firstPlain;hi.value=firstPlain;hi.dispatchEvent(new Event('input',{bubbles:true}))}}function pad2(value){return String(value).padStart(2,'0')}
var _dateFmt=_cfg.dateFormat||'MMM-DD-YY';
var _datetimeFmt=_cfg.datetimeFormat||'YYYY-MM-DD HH:mm';
function formatStamp(kind){var d=new Date();var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var fmt=kind==='datetime'?_datetimeFmt:_dateFmt;var YYYY=String(d.getFullYear());var YY=YYYY.slice(-2);var MM=pad2(d.getMonth()+1);var MMM=months[d.getMonth()];var DD=pad2(d.getDate());var h24=d.getHours();var HH=pad2(h24);var h12=h24%12||12;var hh=pad2(h12);var A=h24<12?'AM':'PM';var mn=pad2(d.getMinutes());var ss=pad2(d.getSeconds());return fmt.replace('YYYY',YYYY).replace('YY',YY).replace('MMM',MMM).replace('MM',MM).replace('DD',DD).replace('HH',HH).replace('hh',hh).replace('mm',mn).replace('ss',ss).replace('A',A).replace('a',A.toLowerCase())}
function renderInlineMd(t){if(!t)return '';var h=t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');h=h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');h=h.replace(/\*(.+?)\*/g,'<em>$1</em>');h=h.replace(/~~(.+?)~~/g,'<del>$1</del>');h=h.replace(/\+\+(.+?)\+\+/g,'<u>$1</u>');h=h.replace(/`([^`]+)`/g,'<code spellcheck="false">$1</code>');return h}
// Image resize via drag handles
var _resizing=null;
function initImgResize(pv){if(!pv||pv.dataset.imgResizeInit)return;pv.dataset.imgResizeInit='1';pv.addEventListener('mousedown',function(e){if(e.target.tagName==='IMG'&&e.target.classList.contains('preview-img')){var img=e.target,rect=img.getBoundingClientRect();var nearRight=e.clientX>rect.right-16,nearBottom=e.clientY>rect.bottom-16;if(nearRight||nearBottom){e.preventDefault();_resizing={img:img,startX:e.clientX,startY:e.clientY,startW:img.offsetWidth,startH:img.offsetHeight}}}})}
document.addEventListener('mousemove',function(e){if(!_resizing)return;e.preventDefault();var dx=e.clientX-_resizing.startX,dy=e.clientY-_resizing.startY;var nw=Math.max(32,_resizing.startW+dx);var ratio=_resizing.startH/_resizing.startW;_resizing.img.style.width=nw+'px';_resizing.img.style.height=Math.round(nw*ratio)+'px'});
document.addEventListener('mouseup',function(){if(_resizing){_resizing=null;syncPV()}});
function pvBlockText(block){if(!block)return '';var text=typeof block.innerText==='string'?block.innerText:(block.textContent||'');return text.replace(/\r/g,'')}
function insertPVText(text){var sel=window.getSelection();if(!sel||!sel.rangeCount)return false;var range=sel.getRangeAt(0);range.deleteContents();var node=document.createTextNode(text);range.insertNode(node);range.setStart(node,text.length);range.collapse(true);sel.removeAllRanges();sel.addRange(range);return true}
function setPVCaret(node,offset){var sel=window.getSelection();if(!sel)return;var range=document.createRange();if(node&&node.nodeType===3){range.setStart(node,Math.min(offset,node.textContent.length));range.collapse(true)}else{range.selectNodeContents(node);range.collapse(false)}sel.removeAllRanges();sel.addRange(range)}
function _createPVLink(url,label){var a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label||url;return a}
function _replaceTextNodeWithAutoLinks(node){if(!node||node.nodeType!==3||!node.parentNode)return null;var text=node.textContent||'';var urlRe=/https?:\/\/[^\s<]+/g;var match=urlRe.exec(text);if(!match)return null;var frag=document.createDocumentFragment();var last=0;var created=[];while(match){if(match.index>last)frag.appendChild(document.createTextNode(text.slice(last,match.index)));var url=match[0];var link=_createPVLink(url,url);frag.appendChild(link);created.push(link);last=match.index+url.length;match=urlRe.exec(text)}var tailNode=document.createTextNode(text.slice(last));frag.appendChild(tailNode);node.parentNode.replaceChild(frag,node);return {links:created,tailNode:tailNode}}
function _autoLinkPVSelection(opts){var pv=getPV();var sel=window.getSelection();if(!pv||!sel||!sel.rangeCount||!sel.isCollapsed)return false;var range=sel.getRangeAt(0);var node=range.startContainer;if(!node||node.nodeType!==3||!pv.contains(node))return false;if(node.parentElement&&node.parentElement.closest('a,pre,code'))return false;var text=node.textContent||'';var before=text.slice(0,range.startOffset);var after=text.slice(range.startOffset);var allowEnd=!!(opts&&opts.allowEnd);var trimmedBefore=before;var trailingWs=0;if(/\s$/.test(before)){trimmedBefore=before.replace(/\s+$/,'');trailingWs=before.length-trimmedBefore.length}else if(!(allowEnd&&(!after||/^\s*$/.test(after))))return false;var match=trimmedBefore.match(/https?:\/\/[^\s<]+$/);if(!match)return false;var replaced=_replaceTextNodeWithAutoLinks(node);if(!replaced)return false;setPVCaret(replaced.tailNode,trailingWs);return true}
function _autoLinkPVBlock(block){if(!block||block.nodeType!==1)return false;var walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentElement&&n.parentElement.closest('a,pre,code,script,style,button')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}},false);var nodes=[];var node;while((node=walker.nextNode()))nodes.push(node);var changed=false;nodes.forEach(function(textNode){if(_replaceTextNodeWithAutoLinks(textNode))changed=true});return changed}
function replacePVBlock(buildNode){var pv=getPV();if(!pv)return false;var sel=window.getSelection();if(!sel||!sel.rangeCount)return false;var range=sel.getRangeAt(0);if(!pv.contains(range.commonAncestorContainer))return false;var block=range.startContainer;while(block&&block!==pv&&block.nodeType!==1)block=block.parentNode;if(!block||block===pv)block=range.startContainer.parentNode;while(block&&block!==pv&&block.nodeType===1&&!/^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(block.nodeName))block=block.parentNode;var neo=buildNode(block,sel.toString(),range,pv);if(!neo)return false;if(block&&block.parentNode&&block!==pv){block.parentNode.replaceChild(neo,block)}else{range.deleteContents();range.insertNode(neo)}var focusNode=neo.querySelector?neo.querySelector('code'):null;if(!focusNode)focusNode=neo;var textNode=focusNode.firstChild&&focusNode.firstChild.nodeType===3?focusNode.firstChild:null;setPVCaret(textNode||focusNode,textNode?textNode.textContent.length:0);syncPV();pv.focus();return true}
function transformPVBlock(tagName,defaultText){return replacePVBlock(function(block,selectedText,range,pv){var text=(!range.collapsed&&selectedText?selectedText:(block&&block!==pv?pvBlockText(block):selectedText))||defaultText;var neo=document.createElement(tagName);if(tagName==='pre'){neo.spellcheck=false;var code=document.createElement('code');code.textContent=text;neo.appendChild(code)}else{neo.textContent=text}return neo})}
function clearFormat(){var pv=getPV();if(pv){document.execCommand('removeFormat',false,null);var sel=window.getSelection();if(sel&&sel.rangeCount){var range=sel.getRangeAt(0);var block=range.startContainer;while(block&&block!==pv&&block.nodeType!==1)block=block.parentNode;if(block&&block!==pv&&/^(H[1-6]|BLOCKQUOTE|PRE)$/.test(block.nodeName)){var p=document.createElement('p');p.textContent=block.textContent;block.parentNode.replaceChild(p,block);var r=document.createRange();r.selectNodeContents(p);sel.removeAllRanges();sel.addRange(r)}}syncPV();pv.focus();return}var cm=getCM();if(cm){var s=cm.state.selection.main;var from=s.from,to=s.to,sel=cm.state.sliceDoc(from,to);sel=sel.replace(/(\*{1,2}|~~|\+\+|`)(.*?)\1/g,'$2');sel=sel.replace(/^#{1,6}\s+/gm,'');sel=sel.replace(/^>\s?/gm,'');sel=sel.replace(/^[-*]\s/gm,'');sel=sel.replace(/^\d+\.\s/gm,'');cm.dispatch({changes:{from:from,to:to,insert:sel},selection:{anchor:from,head:from+sel.length}});cm.focus()}}
function wrapSel(a,b){var pv=getPV();if(pv){var fenced=String.fromCharCode(10)+String.fromCharCode(96,96,96)+String.fromCharCode(10);var inlineCode=String.fromCharCode(96);if(a===fenced&&b===fenced&&transformPVBlock('pre','code'))return;if(a===inlineCode&&b===inlineCode){document.execCommand('insertHTML',false,'<code spellcheck="false">'+(window.getSelection().toString()||'code')+'</code>');syncPV();pv.focus();return}var cmdMap={'**':'bold','*':'italic','~~':'strikethrough','++':'underline'};var cmd=cmdMap[a];if(cmd){document.execCommand(cmd,false,null);syncPV();pv.focus();return}}var cm=getCM();if(cm){var s=cm.state.selection.main;var from=s.from,to=s.to,sel=cm.state.sliceDoc(from,to)||'text';var ins=a+sel+b;cm.dispatch({changes:{from:from,to:to,insert:ins},selection:{anchor:from+a.length,head:from+a.length+sel.length}});cm.focus()}}
function insertPfx(p){var pv=getPV();if(pv){var sel=window.getSelection();if(sel.rangeCount){var range=sel.getRangeAt(0);var block=range.startContainer;while(block&&block!==pv&&block.nodeType!==1)block=block.parentNode;if(!block||block===pv)block=range.startContainer.parentNode;var hm=p.match(/^(#{1,6})\s/);if(hm){var lvl=hm[1].length;var tag='h'+lvl;if(block&&block.parentNode&&block!==pv){var neo=document.createElement(tag);neo.textContent=block.textContent;block.parentNode.replaceChild(neo,block)}else{document.execCommand('insertHTML',false,'<'+tag+'>'+(sel.toString()||'Heading')+'</'+tag+'>')}setTimeout(function(){syncPV();pv.focus()},0);return}if(p==='- [ ] '){var neo=document.createElement('div');neo.className='md-checkbox';var iconSpan=document.createElement('span');iconSpan.className='md-cb-icon';iconSpan.textContent='\u2610';neo.appendChild(iconSpan);var nbsp=document.createTextNode('\u00a0');neo.appendChild(nbsp);var sel2=window.getSelection();var range2=sel2.rangeCount?sel2.getRangeAt(0):null;if(range2){range2.deleteContents();range2.insertNode(neo);var r=document.createRange();r.setStart(nbsp,1);r.collapse(true);sel2.removeAllRanges();sel2.addRange(r)}else{pv.appendChild(neo)}neo.scrollIntoView({block:'nearest'});syncPV();pv.focus();return}if(p==='- '){document.execCommand('insertUnorderedList',false,null);syncPV();pv.focus();return}if(p==='1. '){document.execCommand('insertOrderedList',false,null);syncPV();pv.focus();return}if(p==='> '&&transformPVBlock('blockquote','Quote'))return}return}var cm=getCM();if(cm){var s=cm.state.selection.main;var line=cm.state.doc.lineAt(s.from);cm.dispatch({changes:{from:line.from,to:line.from,insert:p}});cm.focus()}}
function insertTxt(x){var pv=getPV();if(pv){if(x==='\n---\n'){document.execCommand('insertHorizontalRule',false,null);syncPV();pv.focus();return}document.execCommand('insertText',false,x);syncPV();pv.focus();return}var cm=getCM();if(cm){var s=cm.state.selection.main;cm.dispatch({changes:{from:s.from,to:s.to,insert:x},selection:{anchor:s.from+x.length}});cm.focus()}}
function insertStamp(kind){insertTxt(formatStamp(kind))}
var _linkSavedRange=null;var _linkSavedTA=null;
function closeLinkModal(){var modal=document.getElementById('link-modal');var backdrop=document.getElementById('link-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
function openLinkModal(){var pv=getPV();var cm=getCM();if(pv){var sel=window.getSelection();_linkSavedRange=sel&&sel.rangeCount?sel.getRangeAt(0).cloneRange():null;var labelInput=document.getElementById('link-edit-label');if(labelInput)labelInput.value=(sel&&sel.toString())||''}else if(cm){var s=cm.state.selection.main;var labelInput=document.getElementById('link-edit-label');if(labelInput)labelInput.value=cm.state.sliceDoc(s.from,s.to)}var modal=document.getElementById('link-modal');var backdrop=document.getElementById('link-modal-backdrop');var urlInput=document.getElementById('link-edit-url');if(urlInput)urlInput.value='';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;if(urlInput)urlInput.focus()}
function submitLink(event){if(event)event.preventDefault();var url=document.getElementById('link-edit-url');var label=document.getElementById('link-edit-label');var u=(url?url.value:'').trim();if(!u)return false;var t=(label?label.value:'').trim()||u;closeLinkModal();var pv=getPV();if(pv){if(_linkSavedRange){var sel=window.getSelection();sel.removeAllRanges();sel.addRange(_linkSavedRange)}_linkSavedRange=null;var sel=window.getSelection();var range=sel&&sel.rangeCount?sel.getRangeAt(0):null;var link=_createPVLink(u,t);if(range){range.deleteContents();range.insertNode(link);range.setStartAfter(link);range.collapse(true);sel.removeAllRanges();sel.addRange(range)}syncPV();pv.focus();return false}var cm=getCM();if(cm){var md='['+t+']('+u+')';var s=cm.state.selection.main;cm.dispatch({changes:{from:s.from,to:s.to,insert:md},selection:{anchor:s.from+md.length}});cm.focus()}return false}
function insertLink(){openLinkModal()}
var _codeSavedSel=null;
var _codeSavedRange=null;
var _codeEditPre=null;
var _codeModalCM=null;
var _codeTinyMCE=false;
var _codeTinyMCEBookmark=null;
var _codeLangMap={'javascript':function(C){return C.javascript({jsx:true})},'typescript':function(C){return C.javascript({typescript:true,jsx:true})},'html':function(C){return C.html()},'css':function(C){return C.css()},'json':function(C){return C.json()},'sql':function(C){return C.sql()},'python':function(C){return C.python()},'xml':function(C){return C.xml()},'go':function(C){return C.go()},'c':function(C){return C.cpp()},'cpp':function(C){return C.cpp()},'yaml':function(C){return C.yaml()},'bash':function(C){return C.StreamLanguage.define(C.shell)}};
function _codeModalLangExt(lang){var C=window.CM;var fn=_codeLangMap[lang];return fn?fn(C):[]}
function _initCodeModalCM(host,content,lang){if(_codeModalCM){_codeModalCM.destroy();_codeModalCM=null}var C=window.CM;var codeModalTheme=C.EditorView.theme({'&':{height:'100%',fontSize:'13px',color:'var(--text)'},'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Mono",monospace',lineHeight:'1.5'},'.cm-content':{padding:'12px',caretColor:'var(--accent)'},'.cm-gutters':{display:'none'},'.cm-selectionBackground':{backgroundColor:'color-mix(in srgb, var(--accent) 25%, transparent)!important'},'&.cm-focused .cm-selectionBackground':{backgroundColor:'color-mix(in srgb, var(--accent) 30%, transparent)!important'},'.cm-cursor':{borderLeftColor:'var(--accent)'}});var codeModalHighlight=C.HighlightStyle.define([{tag:C.tags.keyword,color:'#c678dd'},{tag:[C.tags.string,C.tags.special(C.tags.brace)],color:'#98c379'},{tag:C.tags.number,color:'#d19a66'},{tag:C.tags.bool,color:'#d19a66'},{tag:[C.tags.definition(C.tags.variableName),C.tags.function(C.tags.variableName)],color:'#61afef'},{tag:C.tags.typeName,color:'#e5c07b'},{tag:C.tags.comment,color:'#5c6370',fontStyle:'italic'},{tag:C.tags.operator,color:'#56b6c2'},{tag:C.tags.className,color:'#e5c07b'},{tag:C.tags.propertyName,color:'#e06c75'},{tag:C.tags.attributeName,color:'#d19a66'},{tag:C.tags.attributeValue,color:'#98c379'},{tag:C.tags.meta,color:'var(--text-dim)'},{tag:C.tags.processingInstruction,fontFamily:'"Cascadia Mono",monospace',color:'var(--accent)'},{tag:C.tags.monospace,fontFamily:'"Cascadia Mono",monospace'}]);_codeModalCM=new C.EditorView({state:C.EditorState.create({doc:content||'',extensions:[_codeModalLangExt(lang),C.syntaxHighlighting(codeModalHighlight),C.syntaxHighlighting(C.defaultHighlightStyle,{fallback:true}),codeModalTheme,C.drawSelection(),C.bracketMatching(),C.history(),C.keymap.of([...C.defaultKeymap,...C.historyKeymap,C.indentWithTab]),C.placeholder('Paste or type code here...'),C.EditorView.lineWrapping]}),parent:host});_codeModalCM.focus()}
function _updateCodeModalLang(lang){if(!_codeModalCM)return;var C=window.CM;var doc=_codeModalCM.state.doc.toString();var host=_codeModalCM.dom.parentElement;_codeModalCM.destroy();_initCodeModalCM(host,doc,lang)}
function closeCodeModal(){if(_codeModalCM){_codeModalCM.destroy();_codeModalCM=null}var modal=document.getElementById('code-modal');if(modal)modal.hidden=true}
function openCodeModal(editPre){var pv=getPV();var cm=getCM();var tmce=(!_isMarkdownModeActive()&&getTinyMCE())?getTinyMCE():null;var sel='';var lang='';_codeSavedSel=null;_codeSavedRange=null;_codeEditPre=editPre||null;_codeTinyMCE=!!tmce;_codeTinyMCEBookmark=null;if(_codeEditPre){var codeEl=_codeEditPre.querySelector('code');var readEl=codeEl||_codeEditPre;var _clone=readEl.cloneNode(true);var _cb=_clone.querySelector&&_clone.querySelector('.pre-copy-btn');if(_cb&&_cb.parentNode)_cb.parentNode.removeChild(_cb);sel=_clone.textContent||'';var langSrc=(codeEl&&(codeEl.className||'').indexOf('language-')!==-1)?codeEl:_codeEditPre;var classes=((langSrc.getAttribute&&langSrc.getAttribute('class'))||'').split(' ');for(var i=0;i<classes.length;i++){if(classes[i].indexOf('language-')===0){lang=classes[i].slice(9);break}}}else if(tmce){try{_codeTinyMCEBookmark=tmce.selection&&tmce.selection.getBookmark?tmce.selection.getBookmark(2,true):null}catch(_e){_codeTinyMCEBookmark=null}sel=(tmce.selection&&tmce.selection.getContent)?(tmce.selection.getContent({format:'text'})||''):''}else if(pv){var s=window.getSelection();_codeSavedRange=s&&s.rangeCount?s.getRangeAt(0).cloneRange():null;sel=(s&&s.toString())||''}else if(cm){var s=cm.state.selection.main;_codeSavedSel={from:s.from,to:s.to};sel=cm.state.sliceDoc(s.from,s.to)}var langEl=document.getElementById('code-lang');if(langEl){langEl.value=lang;langEl.onchange=function(){_updateCodeModalLang(langEl.value)}}var title=document.getElementById('code-modal-title');if(title)title.textContent=_codeEditPre?'Edit code block':'Insert code block';var submitBtn=document.getElementById('code-modal-submit');if(submitBtn)submitBtn.textContent=_codeEditPre?'Save':'Insert';var modal=document.getElementById('code-modal');if(modal)modal.hidden=false;var host=document.getElementById('code-input');if(host){host.innerHTML='';_initCodeModalCM(host,sel,lang)}}
function submitCode(event){if(event)event.preventDefault();var lang=document.getElementById('code-lang');var l=(lang?lang.value:'');var code=_codeModalCM?_codeModalCM.state.doc.toString():'';var wasTinyMCE=_codeTinyMCE;var bookmark=_codeTinyMCEBookmark;closeCodeModal();if(wasTinyMCE){var ed=getTinyMCE();if(ed){var escapedT=code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');var preHTML='<pre class="language-'+(l||'')+'">'+escapedT+'</pre>';if(_codeEditPre){try{ed.selection.select(_codeEditPre)}catch(_e){}}else{try{if(bookmark&&ed.selection&&ed.selection.moveToBookmark)ed.selection.moveToBookmark(bookmark)}catch(_e2){}}ed.focus();ed.insertContent(preHTML);ed.focus();var _finishTinyMCECode=function(){ensureTinyMCEEditableAfterPre(ed);initTinyMCECodeCopyButtons(ed);tinyMCESyncToTA()};_finishTinyMCECode();setTimeout(_finishTinyMCECode,0);_codeSavedSel=null;_codeSavedRange=null;_codeEditPre=null;_codeTinyMCE=false;_codeTinyMCEBookmark=null;return false}}var pv=getPV();if(pv&&_codeEditPre){var codeEl=_codeEditPre.querySelector('code');if(!codeEl){codeEl=document.createElement('code');_codeEditPre.appendChild(codeEl)}codeEl.textContent=code;codeEl.className=l?'language-'+l:'';if(codeEl.dataset.highlighted)delete codeEl.dataset.highlighted;_codeEditPre=null;initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);syncPV();pv.focus();return false}if(pv){if(_codeSavedRange){var sel=window.getSelection();sel.removeAllRanges();sel.addRange(_codeSavedRange)}_codeSavedRange=null;var escaped=code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');var cls=l?' class="language-'+l+'"':'';	document.execCommand('insertHTML',false,'<pre'+cls+'><code>'+escaped+'</code></pre>');initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);syncPV();pv.focus();return false}var cm=getCM();if(cm){var s=_codeSavedSel||cm.state.selection.main;var md='\n```'+l+'\n'+code+'\n```\n';cm.dispatch({changes:{from:s.from,to:s.to,insert:md},selection:{anchor:s.from+md.length}});cm.focus()}_codeSavedSel=null;_codeSavedRange=null;_codeEditPre=null;_codeTinyMCE=false;_codeTinyMCEBookmark=null;return false}
function insertImg(){var pv=getPV();if(pv){var u=prompt('Image URL:');if(!u)return;document.execCommand('insertHTML',false,'<img src="'+u+'" alt="image" class="preview-img" />');syncPV();pv.focus();return}var u=prompt('Image URL:');if(u)insertTxt('![image]('+u+')')}
var _uploadInsertTarget=null;
function _captureUploadInsertTarget(){var pv=getPV();if(pv){var sel=window.getSelection();var range=sel&&sel.rangeCount?sel.getRangeAt(0):null;if(range&&pv.contains(range.commonAncestorContainer))return {mode:'preview',range:range.cloneRange()};var fallback=document.createRange();fallback.selectNodeContents(pv);fallback.collapse(false);return {mode:'preview',range:fallback}}var cm=getCM();if(cm&&isMarkdownVisible()){var s=cm.state.selection.main;return {mode:'cm',from:s.from,to:s.to}}var ta=getTA();if(!ta)return null;var current=ta.value||'';var start=typeof ta.selectionStart==='number'?ta.selectionStart:current.length;var end=typeof ta.selectionEnd==='number'?ta.selectionEnd:start;return {mode:'textarea',start:start,end:end}}
function _normalizeUploadInsert(markdown){return (markdown||'').trim()}
function _buildMarkdownInsert(current,start,end,markdown){var insert=_normalizeUploadInsert(markdown);if(!insert)return null;start=Math.max(0,Math.min(typeof start==='number'?start:current.length,current.length));end=Math.max(start,Math.min(typeof end==='number'?end:start,current.length));var before=current.slice(0,start);var after=current.slice(end);var prefix='';var suffix='';if(before&&before.charAt(before.length-1)!=='\n')prefix='\n';if(after&&after.charAt(0)!=='\n')suffix='\n';return {from:start,to:end,insert:prefix+insert+suffix,caret:start+prefix.length+insert.length}}
function _setUploadInsertTargetFromTextarea(start,end){_uploadInsertTarget={mode:'textarea',start:start,to:end,end:end}}
function _insertMarkdownAtTextareaTarget(markdown,target){var ta=getTA();if(!ta)return false;var current=ta.value||'';var insertOp=_buildMarkdownInsert(current,target&&target.start,target&&target.end,markdown);if(!insertOp)return false;var next=current.slice(0,insertOp.from)+insertOp.insert+current.slice(insertOp.to);if(next===current)return false;ta.value=next;ta.selectionStart=ta.selectionEnd=insertOp.caret;ta.dispatchEvent(new Event('input',{bubbles:true}));_setUploadInsertTargetFromTextarea(insertOp.caret,insertOp.caret);return true}
function _insertMarkdownAtCodeMirrorTarget(markdown,target){var cm=getCM();if(!cm)return false;var current=cm.state.doc.toString();var insertOp=_buildMarkdownInsert(current,target&&target.from,target&&target.to,markdown);if(!insertOp)return false;cm.dispatch({changes:{from:insertOp.from,to:insertOp.to,insert:insertOp.insert},selection:{anchor:insertOp.caret}});cm.focus();_uploadInsertTarget={mode:'cm',from:insertOp.caret,to:insertOp.caret};return true}
function _insertMarkdownAtPreviewTarget(markdown,target){var pv=getPV();if(!pv)return false;var insert=_normalizeUploadInsert(markdown);if(!insert)return false;var sel=window.getSelection();var range=target&&target.range?target.range.cloneRange():null;if(range&&pv.contains(range.commonAncestorContainer)){sel.removeAllRanges();sel.addRange(range)}else{range=document.createRange();range.selectNodeContents(pv);range.collapse(false);sel.removeAllRanges();sel.addRange(range)}if(!insertPVText(insert))return false;syncPV();var ta=getTA();var current=ta?ta.value||'':'';var idx=current.lastIndexOf(insert);if(idx>=0&&ta){var caret=idx+insert.length;ta.selectionStart=ta.selectionEnd=caret;_setUploadInsertTargetFromTextarea(caret,caret)}return true}
function _insertUploadedMarkdown(markdown){if(_uploadInsertTarget&&_uploadInsertTarget.mode==='preview'&&getPV())return _insertMarkdownAtPreviewTarget(markdown,_uploadInsertTarget);if(_uploadInsertTarget&&_uploadInsertTarget.mode==='cm'&&getCM()&&isMarkdownVisible())return _insertMarkdownAtCodeMirrorTarget(markdown,_uploadInsertTarget);if(_uploadInsertTarget&&_uploadInsertTarget.mode==='textarea')return _insertMarkdownAtTextareaTarget(markdown,_uploadInsertTarget);_uploadInsertTarget=_captureUploadInsertTarget();if(_uploadInsertTarget&&_uploadInsertTarget.mode==='preview'&&getPV())return _insertMarkdownAtPreviewTarget(markdown,_uploadInsertTarget);if(_uploadInsertTarget&&_uploadInsertTarget.mode==='cm'&&getCM()&&isMarkdownVisible())return _insertMarkdownAtCodeMirrorTarget(markdown,_uploadInsertTarget);if(_uploadInsertTarget&&_uploadInsertTarget.mode==='textarea')return _insertMarkdownAtTextareaTarget(markdown,_uploadInsertTarget);return false}
function openFilePicker(){_uploadInsertTarget=_captureUploadInsertTarget();var input=document.getElementById('file-upload');if(input)input.click()}
function handleFilePicker(input){
	if(!input||!input.files||!input.files.length)return;
	var files=Array.prototype.slice.call(input.files);
	input.value='';
	uploadFiles(files).catch(function(){});
}
var _uploadBatchDepth=0;
var _uploadBatchChanged=false;
function uploadFiles(files){
	if(!files||!files.length)return Promise.resolve();
	_uploadBatchDepth++;
	var queue=Promise.resolve();
	for(var i=0;i<files.length;i++){
		(function(file){queue=queue.then(function(){return uploadFile(file)})})(files[i]);
	}
	return queue.finally(function(){
		_uploadBatchDepth=Math.max(0,_uploadBatchDepth-1);
		if(_uploadBatchDepth===0&&_uploadBatchChanged){
			_uploadBatchChanged=false;
			scheduleSave();
		}
		if(_uploadBatchDepth===0)_uploadInsertTarget=null;
	});
}
function _appendMarkdownAtCursor(markdown){
	var ta=getTA();
	if(!ta)return false;
	var current=ta.value||'';
	var insertOp=_buildMarkdownInsert(current,typeof ta.selectionStart==='number'?ta.selectionStart:current.length,typeof ta.selectionEnd==='number'?ta.selectionEnd:(typeof ta.selectionStart==='number'?ta.selectionStart:current.length),markdown);
	if(!insertOp)return false;
	var next=current.slice(0,insertOp.from)+insertOp.insert+current.slice(insertOp.to);
	var caret=insertOp.caret;
	if(next!==current){
		ta.value=next;
		ta.selectionStart=ta.selectionEnd=caret;
		ta.dispatchEvent(new Event('input',{bubbles:true}));
	}
	return true;
}
function _refreshPreviewFromMarkdown(resolve){
	var ta=getTA();
	var pv=getPV();
	if(ta&&pv){
		fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(ta.value)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;activatePV(pv);resolve();}).catch(function(){resolve();});
		return true;
	}
	return false;
}
function uploadFile(f){
	if(!f)return;
	if((!f.name||f.name==='')&&f.type){
		var ext=f.type.split('/')[1]||'bin';
		f=new File([f],'pasted-image-'+Date.now()+'.'+ext,{type:f.type});
	}
	var s=document.getElementById('autosave-status');
	var fd=new FormData();
	fd.append('file',f);
	var xhr=new XMLHttpRequest();
	xhr.upload.onprogress=function(e){
		if(e.lengthComputable){
			var pct=Math.round(e.loaded/e.total*100);
			setSaveState('<span class="autosave-saving">Uploading '+pct+'%</span>','Uploading');
		}
	};
	var done=false;
	return new Promise(function(resolve,reject){
	xhr.onload=function(){
		_log('uploadFile onload status',xhr.status,xhr.responseText.slice(0,120));
		setSaveState('','');
		var d;
		try{d=JSON.parse(xhr.responseText)}catch(e){alert('Upload failed');reject(e);return}
		if(d.error){alert(d.error);reject(new Error(d.error));return}
		var changed=_insertUploadedMarkdown(d.markdown);
		if(changed){markEdited();if(_uploadBatchDepth>0)_uploadBatchChanged=true;else scheduleSave();}
		if(_refreshPreviewFromMarkdown(resolve))return;
		resolve();
	};
	xhr.onerror=function(){setSaveState('','');alert('Upload failed');reject(new Error('Upload failed'))};
	if(s)setSaveState('<span class="autosave-saving">Uploading 0%</span>','Uploading');
	xhr.open('POST','/fragments/upload');
	xhr.send(fd);
	});
}
// --- history modal ---
var _historyNoteId=null;var _historySnapshotId=null;
function openHistoryModal(noteId){_historyNoteId=noteId;_historySnapshotId=null;var modal=document.getElementById('history-modal');var backdrop=document.getElementById('history-modal-backdrop');var inner=document.getElementById('history-modal-inner');if(!modal||!backdrop||!inner)return;inner.innerHTML='<div class="history-loading">Loading...</div>';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;htmx.ajax('GET','/fragments/history/'+encodeURIComponent(noteId),{target:'#history-modal-inner',swap:'innerHTML'})}
function closeHistoryModal(){var modal=document.getElementById('history-modal');var backdrop=document.getElementById('history-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
function selectHistorySnapshot(id){_historySnapshotId=id;document.querySelectorAll('.history-item').forEach(function(el){el.classList.toggle('history-item-active',el.dataset.snapshotId===id)});var label=document.getElementById('history-selected-label');var preview=document.getElementById('history-preview');if(preview)preview.innerHTML='<div class="history-loading">Loading...</div>';if(label)label.textContent='Loading...';htmx.ajax('GET','/fragments/history-snapshot/'+encodeURIComponent(id),{target:'#history-preview',swap:'innerHTML'}).then(function(){var d=new Date(parseInt(id)*1||0);var label=document.getElementById('history-selected-label');if(label)label.textContent=''});_log('selectHistorySnapshot',id)}
function restoreHistorySnapshot(noteId){var sid=_historySnapshotId;if(!sid){alert('Select a snapshot first.');return}if(!confirm('Restore this version? The current note will be overwritten.'))return;var form=activeEditorForm();var cfi=(form&&form.querySelector('[name="currentFolderId"]'))?form.querySelector('[name="currentFolderId"]').value:'';closeHistoryModal();_log('restoreHistorySnapshot',noteId,sid);htmx.ajax('POST','/fragments/history/'+encodeURIComponent(noteId)+'/restore/'+encodeURIComponent(sid),{target:'#autosave-status',swap:'innerHTML',values:{currentFolderId:cfi}}).then(function(){var s=queryActiveEditor('#autosave-status');if(s&&!s.querySelector('.autosave-error'))s.innerHTML='<span class="autosave-ok">Restored</span>';_snapshots=[];_log('restore done')}).catch(function(e){alert('Restore failed: '+e.message)})}
// --- client ring buffer (in-session undo) ---
var _snapshots=[];var _snapshotMaxCount=20;var _undoTimer=null;
function pushSnapshot(){var ta=getTA();var title=queryActiveEditor('[name="title"]');var body=ta?ta.value:'';var t=title?title.value:'';if(_snapshots.length>0&&_snapshots[_snapshots.length-1].body===body&&_snapshots[_snapshots.length-1].title===t)return;_snapshots.push({body:body,title:t,ts:Date.now()});if(_snapshots.length>_snapshotMaxCount)_snapshots.shift();var btn=queryActiveEditor('#undo-save-btn');if(btn)btn.hidden=_snapshots.length<2;_log('pushSnapshot count',_snapshots.length)}
function undoSnapshot(){if(_snapshots.length<2){_log('undoSnapshot: nothing to undo');return}if(_undoTimer){clearTimeout(_undoTimer);_undoTimer=null}_snapshots.pop();var snap=_snapshots[_snapshots.length-1];var btn=queryActiveEditor('#undo-save-btn');if(btn)btn.hidden=_snapshots.length<2;_log('undoSnapshot restoring ts',snap.ts);var ta=getTA();var titleInput=queryActiveEditor('[name="title"]');var titleDiv=queryActiveEditor('.editor-title');var pv=getPV();if(ta)ta.value=snap.body;if(titleInput)titleInput.value=snap.title;if(titleDiv)titleDiv.textContent=snap.title;var cm=getCM();if(cm&&!pv)cmSetVal(snap.body);if(pv&&pv.style.display!=='none'){fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(snap.body)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;syncPV()}).catch(function(){})}if(ta)ta.dispatchEvent(new Event('input',{bubbles:true}));scheduleSave();var s=queryActiveEditor('#autosave-status');if(s){s.innerHTML='<span class="autosave-edited">Undone</span>';clearTimeout(_undoTimer);_undoTimer=setTimeout(function(){var s2=queryActiveEditor('#autosave-status');if(s2&&s2.querySelector('.autosave-edited'))s2.innerHTML='<span class="autosave-ok">Saved</span>'},3000)}}
function handleDrop(e){e.preventDefault();var files=e.dataTransfer&&e.dataTransfer.files;if(!files||!files.length)return;uploadFiles(files).catch(function(){})}
function _escapeHtmlAttr(s){return(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
// Keep in sync with appSettings.maxUploadMb (admin) and Joplin's own 200MB cap.
function _maxUploadBytes(){var mb=(window._joplockConfig&&window._joplockConfig.maxUploadMb)||200;return Math.min(mb,200)*1024*1024}
function _fileTooLarge(file){return!!(file&&typeof file.size==='number'&&file.size>_maxUploadBytes())}
function _tooLargeMsg(file){var mb=Math.round((file&&file.size||0)/1048576);var lim=Math.round(_maxUploadBytes()/1048576);return'"'+((file&&file.name)||'file')+'" is too large ('+mb+'MB). Maximum upload size is '+lim+'MB.'}
// Canonical deletable blank line for rendered (TinyMCE) mode. This exact shape
// is what injectBlankLineBlocks() emits and tinymceToMarkdown() pre-normalizes,
// so it survives markdown<->render round-trips as a real empty paragraph the
// user can delete between stacked attachments.
var _MD_BLANK_LINE_P='<p class="md-blank-line"><br></p>';
function _isBlankLineBlock(el){return !!(el&&el.nodeType===1&&el.classList&&el.classList.contains('md-blank-line'))}
// Wrap an attachment (image/link HTML) in its own <p> with a blank (deletable)
// line before and after so it is isolated and easy to remove — for BOTH images
// and documents. "Smart": skip a side when the caret block is already empty or
// already next to a blank-line paragraph, so gaps don't pile up. When the
// selection API isn't available (unit tests) both sides are added.
function _tinyMCEBlockAttachmentHtml(editor,inner){
	var leading=true,trailing=true;
	try{
		var node=editor&&editor.selection&&editor.selection.getNode?editor.selection.getNode():null;
		if(node){
			var block=node.closest?(node.closest('p,div,li,blockquote,h1,h2,h3,h4,h5,h6')||node):node;
			if(_isBlankLineBlock(block)||!(block.textContent||'').trim())leading=false;
			if(_isBlankLineBlock(block&&block.previousElementSibling))leading=false;
			if(_isBlankLineBlock(block&&block.nextElementSibling))trailing=false;
		}
	}catch(_e){}
	return (leading?_MD_BLANK_LINE_P:'')+'<p>'+inner+'</p>'+(trailing?_MD_BLANK_LINE_P:'');
}
function _uploadFileToTinyMCE(file,editor){
	if(!file)return Promise.resolve();
	if(_fileTooLarge(file)){alert(_tooLargeMsg(file));return Promise.reject(new Error('File too large'))}
	// Rename unnamed blobs
	if((!file.name||file.name==='')&&file.type){
		var ext=file.type.split('/')[1]||'bin';
		file=new File([file],'dropped-'+Date.now()+'.'+ext,{type:file.type});
	}
	var fd=new FormData();
	fd.append('file',file);
	return fetch('/fragments/upload',{method:'POST',body:fd,credentials:'same-origin'})
		.then(function(r){return r.json()})
		.then(function(data){
			var id=data.resourceId;
			var name=_escapeHtmlAttr(file.name||'file');
			var inner;
			if(file.type&&file.type.startsWith('image/')){
				inner='<img src="/resources/'+id+'" data-resource-id="'+id+'" alt="'+name+'" />';
			}else{
				inner='<a href="/resources/'+id+'" data-resource-id="'+id+'">'+name+'</a>';
			}
			// Pad the attachment with a blank (deletable) line before and after so
			// consecutive attachments stay individually removable in rendered mode.
			editor.insertContent(_tinyMCEBlockAttachmentHtml(editor,inner));
			// Sync textarea immediately so the source-of-truth (note-body) has
			// the resource reference even if onEdit fires asynchronously.
			var ta=getTA();
			if(ta){
				var md=tinymceToMarkdown(editor.getContent());
				if(ta.value!==md){ta.value=md;ta.dispatchEvent(new Event('input',{bubbles:true}));}
			}
		});
}
// Upload a file and insert its markdown reference at the CodeMirror cursor.
function _uploadFileToCM(file){
	if(!file||!_cmView)return Promise.resolve();
	if(_fileTooLarge(file)){alert(_tooLargeMsg(file));return Promise.reject(new Error('File too large'))}
	if((!file.name||file.name==='')&&file.type){
		var ext=file.type.split('/')[1]||'bin';
		file=new File([file],'dropped-'+Date.now()+'.'+ext,{type:file.type});
	}
	var fd=new FormData();
	fd.append('file',file);
	return fetch('/fragments/upload',{method:'POST',body:fd,credentials:'same-origin'})
		.then(function(r){return r.json()})
		.then(function(data){
			if(data&&data.error){alert(data.error);throw new Error(data.error)}
			var isImage=!!(file.type&&file.type.indexOf('image/')===0);
			var md=data.markdown||((isImage?'!':'')+'['+(file.name||'file')+'](:/'+data.resourceId+')');
			if(_cmView){
				var pos=_cmView.state.selection.main.head;
				// Pad the attachment (image AND document) with a blank line before
				// and after so it sits on its own line and stays easy to delete.
				var doc=_cmView.state.doc.toString();
				var pre=(pos>0&&!/\n\n$/.test(doc.slice(0,pos)))?(doc.charAt(pos-1)==='\n'?'\n':'\n\n'):'';
				var insert=pre+md+'\n\n';
				_cmView.dispatch({changes:{from:pos,insert:insert},selection:{anchor:pos+insert.length}});
				cmSyncToTA();
			}
		});
}
// --- upload modal ---
var _uploadModalFiles=[];
var _uploadModalInsertRng=null;
function openUploadModal(){
	// Capture editor insert position (TinyMCE only)
	_uploadModalInsertRng=null;
	if(_tinymceEditor){
		try{var rng=_tinymceEditor.selection.getRng();if(rng)_uploadModalInsertRng=rng.cloneRange()}catch(e){}
	}
	_uploadModalFiles=[];
	var list=document.getElementById('upload-file-list');if(list)list.innerHTML='';
	var btn=document.getElementById('upload-insert-btn');if(btn)btn.disabled=true;
	var backdrop=document.getElementById('upload-modal-backdrop');if(backdrop)backdrop.hidden=false;
	var modal=document.getElementById('upload-modal');if(modal)modal.hidden=false;
	// Wire drop zone events (once)
	var dz=document.getElementById('upload-drop-zone');
	if(dz&&!dz._dropWired){
		dz._dropWired=true;
		dz.addEventListener('dragover',function(e){e.preventDefault();e.stopPropagation();dz.classList.add('drag-over')});
		dz.addEventListener('dragleave',function(e){dz.classList.remove('drag-over')});
		dz.addEventListener('drop',function(e){
			e.preventDefault();e.stopPropagation();
			dz.classList.remove('drag-over');
			var files=e.dataTransfer&&e.dataTransfer.files;
			if(files&&files.length)uploadModalFiles(Array.prototype.slice.call(files));
		});
	}
}
function closeUploadModal(){
	var backdrop=document.getElementById('upload-modal-backdrop');if(backdrop)backdrop.hidden=true;
	var modal=document.getElementById('upload-modal');if(modal)modal.hidden=true;
}
function handleUploadModalFiles(input){
	if(!input||!input.files||!input.files.length)return;
	var files=Array.prototype.slice.call(input.files);
	input.value='';
	uploadModalFiles(files);
}
function uploadModalFiles(files){
	var list=document.getElementById('upload-file-list');if(!list)return;
	for(var i=0;i<files.length;i++){
		var file=files[i];
		var entry={file:file,resourceId:null,markdown:null,state:'uploading'};
		_uploadModalFiles.push(entry);
		_renderUploadFileItem(entry,list);
	}
	_uploadModalFilesSeq(0);
}
function _uploadModalFilesSeq(idx){
	if(idx>=_uploadModalFiles.length){
		var active=_uploadModalFiles.filter(function(e){return!e._deleted});
		var any=active.some(function(e){return e.state==='done'});
		var anyError=active.some(function(e){return e.state==='error'});
		var allDone=active.length>0&&active.every(function(e){return e.state==='done'});
		var btn=document.getElementById('upload-insert-btn');if(btn)btn.disabled=!any;
		// Auto-insert and dismiss when every file uploaded cleanly. If any failed,
		// keep the modal open so the user can see which file errored.
		if(allDone&&!anyError){insertUploadedFiles();}
		return;
	}
	var entry=_uploadModalFiles[idx];
	if(entry._deleted||entry.state!=='uploading'){_uploadModalFilesSeq(idx+1);return}
	var file=entry.file;
	if(_fileTooLarge(file)){entry.state='error';entry._errMsg='Too large (max '+Math.round(_maxUploadBytes()/1048576)+'MB)';_refreshUploadFileItem(idx);_uploadModalFilesSeq(idx+1);return}
	if((!file.name||file.name==='')&&file.type){
		var ext=file.type.split('/')[1]||'bin';
		file=new File([file],'upload-'+Date.now()+'.'+ext,{type:file.type});
		entry.file=file;
	}
	var fd=new FormData();fd.append('file',file);
	var xhr=new XMLHttpRequest();
	entry._xhr=xhr;
	xhr.upload.onprogress=function(e){
		if(e.lengthComputable)_updateUploadFileProgress(idx,Math.round(e.loaded/e.total*100));
	};
	xhr.onload=function(){
		entry._xhr=null;
		if(entry._deleted){_uploadModalFilesSeq(idx+1);return}
		try{var d=JSON.parse(xhr.responseText);
			if(d.error){entry.state='error';entry._errMsg=d.error}else{entry.state='done';entry.resourceId=d.resourceId;entry.markdown=d.markdown}
		}catch(e2){entry.state='error';entry._errMsg='Upload failed'}
		_refreshUploadFileItem(idx);
		_uploadModalFilesSeq(idx+1);
	};
	xhr.onerror=function(){
		entry._xhr=null;
		if(entry._deleted){_uploadModalFilesSeq(idx+1);return}
		entry.state='error';_refreshUploadFileItem(idx);_uploadModalFilesSeq(idx+1)
	};
	xhr.open('POST','/fragments/upload');
	xhr.send(fd);
}
function _renderUploadFileItem(entry,list){
	var idx=_uploadModalFiles.indexOf(entry);
	var div=document.createElement('div');div.className='upload-file-item';div.id='upload-file-'+idx;
	var name=_escapeHtmlAttr(entry.file.name||'file');
	div.innerHTML='<span class="upload-file-name">'+name+'</span>'+'<span class="upload-file-size">'+_fmtFileSize(entry.file.size)+'</span>'+'<span class="upload-file-status">Uploading</span>'+'<div class="upload-progress-bar"><div class="upload-progress-bar-fill" style="width:0%"></div></div>'+'<button type="button" class="upload-file-del" title="Delete this file" onclick="event.stopPropagation();deleteUploadedResource('+idx+')" style="display:none">&times;</button>';
	list.appendChild(div);
}
function _updateUploadFileProgress(idx,pct){
	var item=document.getElementById('upload-file-'+idx);if(!item)return;
	var fill=item.querySelector('.upload-progress-bar-fill');if(fill)fill.style.width=pct+'%';
}
function _refreshUploadFileItem(idx){
	var entry=_uploadModalFiles[idx];var item=document.getElementById('upload-file-'+idx);if(!item||!entry)return;
	var statusEl=item.querySelector('.upload-file-status');
	if(entry.state==='done'){
		item.classList.add('done');
		if(statusEl){statusEl.textContent='\u2713';statusEl.className='upload-file-status ok'}
	}else if(entry.state==='error'){
		item.classList.add('error');
		if(statusEl){statusEl.textContent=entry._errMsg||'Failed';statusEl.className='upload-file-status err';statusEl.title=entry._errMsg||'Failed'}
	}
	var bar=item.querySelector('.upload-progress-bar');if(bar)bar.remove();
	// Show delete button once uploaded (done or error)
	var delBtn=item.querySelector('.upload-file-del');
	if(delBtn)delBtn.style.display='';
}
function deleteUploadedResource(idx){
	if(idx<0||idx>=_uploadModalFiles.length)return;
	var entry=_uploadModalFiles[idx];
	entry._deleted=true;
	// Abort in-progress upload
	if(entry._xhr){try{entry._xhr.abort()}catch(e){}entry._xhr=null}
	// If already uploaded, delete from server
	if(entry.resourceId){
		fetch('/resources/'+entry.resourceId,{method:'DELETE',credentials:'same-origin'}).catch(function(){});
	}
	// Remove from array and from DOM
	var item=document.getElementById('upload-file-'+idx);
	if(item)item.remove();
	// Re-index remaining DOM items
	var list=document.getElementById('upload-file-list');
	if(list){
		var items=list.querySelectorAll('.upload-file-item');
		for(var i=0;i<items.length;i++){
			items[i].id='upload-file-'+i;
			var delBtn=items[i].querySelector('.upload-file-del');
			if(delBtn)delBtn.setAttribute('onclick','event.stopPropagation();deleteUploadedResource('+i+')');
		}
	}
	_uploadModalFiles.splice(idx,1);
	// Update insert button state
	var any=_uploadModalFiles.some(function(e){return e.state==='done'&&!e._deleted});
	var btn=document.getElementById('upload-insert-btn');if(btn)btn.disabled=!any;
}
function _fmtFileSize(bytes){if(!bytes&&bytes!==0)return'';if(bytes<1024)return bytes+' B';if(bytes<1048576)return(bytes/1024).toFixed(1)+' KB';return(bytes/1048576).toFixed(1)+' MB'}
function _mdToTinyMCEInsert(entry){
	var id=entry.resourceId||'';
	var name=_escapeHtmlAttr((entry.file&&entry.file.name)||'file');
	if(entry.file&&entry.file.type&&entry.file.type.startsWith('image/'))return'<img src="/resources/'+id+'" data-resource-id="'+id+'" alt="'+name+'" />';
	return'<a href="/resources/'+id+'" data-resource-id="'+id+'">'+name+'</a>';
}
function insertUploadedFiles(){
	var done=_uploadModalFiles.filter(function(e){return e.state==='done'&&e.markdown});
	if(!done.length)return;
	if(_tinymceEditor&&_uploadModalInsertRng){
		try{_tinymceEditor.selection.setRng(_uploadModalInsertRng)}catch(e){}
		var html='';
		for(var i=0;i<done.length;i++){if(i>0)html+=' ';html+=_mdToTinyMCEInsert(done[i])}
		_tinymceEditor.insertContent(html);
	}else{
		_uploadInsertTarget=_captureUploadInsertTarget();
		for(var j=0;j<done.length;j++)_insertUploadedMarkdown(done[j].markdown);
	}
	closeUploadModal();
	markEdited();
	scheduleSave();
}
var _tdService=null;
function getTurndown(){
	if(_tdService)return _tdService;
	var td=new TurndownService({headingStyle:'atx',hr:'---',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*',strongDelimiter:'**',br:''});
	// Preserve fenced code language from TinyMCE codesample blocks.
	td.addRule('fencedCodeLanguage',{filter:function(n){return n.nodeName==='PRE'&&(!!n.querySelector('code')||/(?:^|\s)language-/.test(n.getAttribute('class')||''))},replacement:function(_c,n){
		var codeEl=n.querySelector('code');
		var cls=((codeEl&&codeEl.getAttribute('class'))||n.getAttribute('class')||'');
		var m=cls.match(/(?:^|\s)language-([\w-]+)/);
		var lang=m?m[1]:'';
		var code=(codeEl?codeEl.textContent:n.textContent)||'';
		code=code.replace(/\n+$/,'');
		var ticks='```';
		var runs=code.match(/`{3,}/g)||[];
		runs.forEach(function(run){if(run.length>=ticks.length)ticks='`'.repeat(run.length+1)});
		return '\n'+ticks+lang+'\n'+code+'\n'+ticks+'\n';
	}});
	// Joplin resource images (with optional resize dimensions)
	td.addRule('joplinImg',{filter:function(n){return n.nodeName==='IMG'},replacement:function(c,n){
		var alt=n.getAttribute('alt')||'';var src=n.getAttribute('src')||'';
		var w=n.style.width||n.getAttribute('width');var h=n.style.height||n.getAttribute('height');
		var rm=src.match(/^\/?resources\/([0-9a-zA-Z]{32})$/);
		// Never embed data: URIs into markdown — they corrupt note storage
		if(src.startsWith('data:'))return alt?'['+alt+']':'';
		if(w||h){var iSrc=rm?':/'+rm[1]:src;return '<img src="'+iSrc+'" alt="'+alt+'"'+(w?' width="'+parseInt(w)+'"':'')+(h?' height="'+parseInt(h)+'"':'')+' />'}
		if(rm)return '!['+alt+'](:/'+rm[1]+')';return '!['+alt+']('+src+')'}});
	// Joplin resource links
	td.addRule('joplinLink',{filter:function(n){return n.nodeName==='A'&&/^\/?resources\/[0-9a-zA-Z]{32}(?:\?download=1)?$/.test((n.getAttribute('href')||'').split('#')[0])},
		replacement:function(c,n){var m=(n.getAttribute('href')||'').match(/^\/?resources\/([0-9a-zA-Z]{32})/);return '['+c+'](:/'+m[1]+')'}});
	// Preserve external links created in rendered mode instead of collapsing same-label links back to plain text.
	td.addRule('externalLink',{filter:function(n){var href=(n.getAttribute('href')||'').trim();return n.nodeName==='A'&&!!href&&!/^\/?resources\//.test(href)},replacement:function(c,n){var href=(n.getAttribute('href')||'').trim();var label=(c||'').trim()||href;return '['+label+']('+href+')'}});
	// md-blank-line markers — use placeholder to survive <br> normalization.
	// Emitted by the renderer as <p class="md-blank-line"><br></p> (TinyMCE-stable);
	// also accept the legacy <div class="md-blank-line"> shape. After
	// <br>→sentinel conversion, textContent is the sentinel string; accept that too.
	td.addRule('blankLine',{filter:function(n){return (n.nodeName==='DIV'||n.nodeName==='P')&&n.classList.contains('md-blank-line')&&!n.querySelector('img,a,pre,code,ul,ol,blockquote,table')&&(!n.textContent.trim()||n.textContent.trim()==='\u2764BR\u2764')},replacement:function(){return '\x00BL\x00'}});
	// md-checkbox divs
	td.addRule('checkbox',{filter:function(n){return n.nodeName==='DIV'&&n.classList.contains('md-checkbox')},
		replacement:function(c,n){var checked=n.classList.contains('checked');var txt=c.replace(/^[\u2611\u2610\u2612\u2705\u00a0 ]+/,'');return (checked?'- [x] ':'- [ ] ')+txt+'\n'}});
	// HTML tables → GFM markdown table syntax
	td.addRule('table',{filter:'table',replacement:function(_c,node){
		var rows=Array.from(node.querySelectorAll('tr'));
		if(!rows.length)return'';
		var head=node.querySelector('thead'),body=node.querySelector('tbody');
		var headerRow=rows[0];
		var bodyRows=body?Array.from(body.querySelectorAll('tr')):(head?rows.slice(1):rows);
		var headerCells=Array.from(headerRow.querySelectorAll('th,td'));
		var cols=headerCells.length||1;
		var cellText=function(cell){
			var inner=td.turndown(cell.innerHTML).trim().replace(/\n/g,' ');
			return inner||(cell.textContent||'').trim();
		};
		var lines=[];
		lines.push('| '+headerCells.map(cellText).join(' | ')+' |');
		lines.push('| '+Array(cols).fill('---').join(' | ')+' |');
		(bodyRows.length?bodyRows:rows.slice(head?1:0)).forEach(function(row){
			var cells=Array.from(row.querySelectorAll('td,th'));
			if(!cells.length)return;
			lines.push('| '+cells.map(cellText).join(' | ')+' |');
		});
		return lines.join('\n')+'\n';
	}});
	// Strikethrough
	td.addRule('strikethrough',{filter:['del','s','strike'],replacement:function(c){return c.trim()?'~~'+c.trim()+'~~':''}});
	// Underline
	td.addRule('underline',{filter:'u',replacement:function(c){return c.trim()?'++'+c.trim()+'++':''}});
	// Empty divs from contenteditable (Enter key creates <div><br></div>) — emit BL sentinel so
	// line 616 converts it to one extra newline (\n\n\n), which injectBlankLineBlocks turns into
	// exactly one md-blank-line div. Using '<br>' caused line 611 to produce 4 newlines (two divs).
	// Using '' made blank-line edits invisible to Turndown (hash never changed, note never saved).
	td.addRule('emptyDiv',{filter:function(n){return n.nodeName==='DIV'&&!n.classList.length&&!n.querySelector('img,a,pre,code,ul,ol,blockquote,table')&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '\x00BL\x00'}});
	// Empty paragraphs TinyMCE inserts when user presses Enter for a blank line (<p><br></p>).
	// Each one = one extra blank line → \x00BL\x00 sentinel → post-processing converts to \n\n\n.
	td.addRule('emptyP',{filter:function(n){return n.nodeName==='P'&&!n.querySelector('img')&&(!n.textContent.trim()||n.innerHTML==='<br>'||n.innerHTML==='\u2764BR\u2764')},replacement:function(){return '\x00BL\x00'}});
	_tdService=td;return td}
// Collapse a blank line immediately after / before an ATX heading, but ONLY
// outside fenced code blocks. A code line like `#include <stdio.h>` (C) or
// `# comment` (bash) is NOT a markdown heading, and its following blank line
// must be preserved verbatim — otherwise round-tripping through rendered mode
// eats blank lines inside code. We mask ``` fenced ``` regions, apply the
// heading spacing fixes to the rest, then restore the code untouched.
function _applyHeadingSpacing(md){
	var nl=String.fromCharCode(10);
	var headingGapRe=new RegExp('^(#{1,6}[^'+nl+']*)'+nl+'{2,}(?=\\S)','gm');
	var headingLeadRe=new RegExp('([^'+nl+'])'+nl+'{2,}(#{1,6}\\s)','g');
	// Split on fenced code blocks (```lang ... ```), keeping the fences.
	var fenceRe=/```[\s\S]*?```/g;
	var out='';var last=0;var m;
	var fix=function(seg){return seg.replace(headingLeadRe,'$1'+nl+'$2').replace(headingGapRe,'$1'+nl)};
	while((m=fenceRe.exec(md))!==null){
		out+=fix(md.slice(last,m.index));
		out+=m[0]; // code block passes through unchanged
		last=m.index+m[0].length;
	}
	out+=fix(md.slice(last));
	return out;
}
function htmlToMarkdown(el){
	var root=el.cloneNode(true);
	root.querySelectorAll('.pre-copy-btn').forEach(function(btn){btn.remove()});
	root.querySelectorAll('.preview-img-download-btn').forEach(function(btn){btn.remove()});
	root.querySelectorAll('.preview-img-download-wrap').forEach(function(wrap){var img=wrap.querySelector('img');if(img)wrap.replaceWith(img)});
	root.querySelectorAll('p[data-pv-trail]').forEach(function(p){p.remove()});
	var md=getTurndown().turndown(root.innerHTML);
	var nbsp=String.fromCharCode(160);
	while(md.indexOf(nbsp)>=0)md=md.split(nbsp).join('&nbsp;');
	var nl=String.fromCharCode(10);
	md=md.split('<br/>').join('<br>');
	md=md.split('<br>'+nl).join(nl);
	while(md.indexOf('<br><br>')>=0)md=md.split('<br><br>').join('<br>'+nl);
	md=_applyHeadingSpacing(md);
	md=md.replace(new RegExp(nl+nl+'<br>$'),'');
	md=md.replace(/\n*(?:\x00BL\x00\n*)+/g,function(m){var count=(m.match(/\x00BL\x00/g)||[]).length;return nl+nl+Array(count+1).join(nl)});
	var out='';
	for(var i=0;i<md.length;i++){
		var ch=md.charAt(i),nx=md.charAt(i+1);
		if(ch.charCodeAt(0)===92&&(nx==='['||nx===']'||nx.charCodeAt(0)===96||nx==='*'||nx==='_'||nx.charCodeAt(0)===92||nx==='$')){out+=nx;i++;continue}
		out+=ch
	}
	return out
}
function tinymceToMarkdown(html){
	if(!html)return '';
	html=html.replace(/\u200b/g,'');
	// Normalise blank-line markers. TinyMCE strips the <br> from
	// <p class="md-blank-line"><br></p> on setContent, leaving an empty
	// <p class="md-blank-line"></p> — which Turndown drops entirely (empty block
	// = no output), swallowing the blank line. Rewrite any md-blank-line paragraph
	// (empty or not) to the sentinel shape the blankLine rule reliably matches.
	html=html.replace(/<p([^>]*\bclass="[^"]*\bmd-blank-line\b[^"]*"[^>]*)>[\s\S]*?<\/p>/gi,'<p$1>\u2764BR\u2764</p>');
	// tinyMCE appends a trailing <br> to every non-empty <p> block. Strip before conversion
	// so it doesn't become a spurious newline. Do NOT strip from <p><br></p> (blank lines).
	html=html.replace(/<p>((?:[^<]|<(?!\/p>))+?)<br\s*\/?>\s*<\/p>/gi,'<p>$1</p>');
	// Convert <br> (line breaks within paragraphs and blank-line divs) to a
	// sentinel Turndown won't touch. Restore as \n after conversion.
	// For md-blank-line divs the blankLine rule matches the sentinel text.
	var BR='\u2764BR\u2764';
	html=html.replace(/<br\s*\/?>/gi,BR);
	html=html.replace(/src="\/?resources\/([0-9a-fA-F]{32})"/g,'src=":/$1"');
	html=html.replace(/href="\/?resources\/([0-9a-fA-F]{32})"/g,'href=":/$1"');
	html=html.replace(/<span style="text-decoration: underline;">([\s\S]*?)<\/span>/g,'++$1++');
	html=html.replace(/<span style="text-decoration: line-through;">([\s\S]*?)<\/span>/g,'~~$1~~');
	var td=getTurndown();
	var md=td.turndown(html);
	var nl=String.fromCharCode(10);
	md=_applyHeadingSpacing(md);
	// Normalise blank-line sentinels (md-blank-line divs + empty paragraphs)
	md=md.replace(/\n*(?:\x00BL\x00\n*)+/g,function(m){var count=(m.match(/\x00BL\x00/g)||[]).length;return nl+nl+Array(count+1).join(nl)});
	// Restore line-break sentinels as \n (soft breaks within paragraphs)
	md=md.split('\u2764BR\u2764').join(nl);
	var out='';
	for(var i=0;i<md.length;i++){
		var ch=md.charAt(i),nx=md.charAt(i+1);
		if(ch.charCodeAt(0)===92&&(nx==='['||nx===']'||nx.charCodeAt(0)===96||nx==='*'||nx==='_'||nx.charCodeAt(0)===92||nx==='$')){out+=nx;i++;continue}
		out+=ch
	}
	return out
}
function setEditorMode(mode){
	var ta=getTA();
	var form=activeEditorForm();
	if(form)form.dataset.editorMode=mode;
	// View/mode switches are transient: looking at one note in markdown does
	// not mean you want markdown for every note. The persisted note-open
	// preference is changed only in Settings. Track the current view locally so
	// entering edit mode can honor the preference, but never write it back.
	if(mode==='markdown'||mode==='md'){
		// Markdown mode: sync latest rich content back to the textarea, then mount CM6.
		tinyMCESyncToTA();
		applyEditorModeVisibility('markdown');
		mountMarkdownEditor(ta?ta.value:'');
		_editorMode='markdown';
		syncEditorModeButtons();
// The round-trip may have fired a spurious "Edited"; reset to "Saved" if
		// the note is not actually dirty (but keep a real pending change/save).
		_reconcileSaveStateAfterModeSwitch();
		if(_searchSessionActive())setTimeout(applySearchHighlight,0);
		return;
	}
	// Rich mode: sync CM6 content back to the textarea, hide markdown editor, show TinyMCE.
	cmSyncToTA();
	var mdVal=ta?ta.value:'';
	applyEditorModeVisibility('rich',{focusTextarea:false});
	_editorMode='rich';
	syncEditorModeButtons();
	if(!_tinymceEditor){
		// TinyMCE not ready yet — start init, it will call refreshTinyMCEForActiveNote on init.
		initPersistentTinyMCE();
		return;
	}
	// Re-render current textarea content and push into the persistent editor.
	if(_searchSessionActive())_pendingSearchHighlight=true;
	fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(mdVal)}).then(function(r){return r.text()}).then(function(h){
		if(!_tinymceEditor)return;
		_setTinyMCEContent(h);
		showTinyMCEHost();
		_applyTinyMCEReadonly(_tinymceEditor);
		if(!_tinymceReadonly)_tinymceEditor.focus();
	});
}
// Mount (or remount) the CodeMirror 6 markdown editor into #cm-host, seeded from `content`.
// Falls back gracefully to the raw textarea if the CM6 bundle failed to load.
function mountMarkdownEditor(content){
	var host=queryActiveEditor('#cm-host');
	if(!host||!window.CM||typeof initCM!=='function'){
		// No CM bundle / host — leave the textarea visible as a fallback.
		var ta=getTA();
		if(ta){ta.style.display='block';ta.style.flex='1';ta.style.minHeight='0';}
		return;
	}
	host.style.display='';
	initCM(host,content||'');
	if(_cmView){
		// Recompute layout after the host has its final flex height, then focus.
		if(_cmView.requestMeasure)_cmView.requestMeasure();
		requestAnimationFrame(function(){if(_cmView&&_cmView.requestMeasure)_cmView.requestMeasure();});
		if(_cmView.focus)_cmView.focus();
	}
}
document.addEventListener('keydown',function(e){if(e.key==='Escape'){_log('esc:keydown editorMode='+_editorMode+' marks='+_searchMarks.length+' cmMarks='+(_cmSearchMatches?_cmSearchMatches.length:0));var resViewer=document.getElementById('resource-viewer');if(resViewer&&!resViewer.hidden){_log('esc:resource-viewer visible, closing');_closeResourceViewer();return}if(resViewer)_log('esc:resource-viewer hidden, skip');var codeModal=document.getElementById('code-modal');if(codeModal&&!codeModal.hidden){_log('esc:code-modal visible, closing');closeCodeModal();return}var exportMenu=document.getElementById('export-menu');if(exportMenu&&!exportMenu.hidden){closeExportMenu();return}closeFolderContextMenu();closeFolderModal();closeLinkModal();closeNewFolderModal();closeVaultModal();closeHistoryModal();closeEmptyTrashModal();var bar=document.getElementById('search-nav-bar');_log('esc:bar exists='+!!bar+' hidden='+(bar?bar.hidden:'n/a')+' sesActive='+_searchSessionActive()+' navSearchVal='+((document.getElementById('nav-search')||{}).value||''));if(bar&&!bar.hidden){_log('esc:dismissing search-nav-bar');searchNavDismiss();return}if(_searchSessionActive()){_log('esc:session active, dismissing');searchNavDismiss();return}var navSearch=document.getElementById('nav-search');if(navSearch&&navSearch.value){_log('esc:clearing nav-search field');navSearch.value='';htmx.trigger(navSearch,'search-submit');return}_log('esc:no handler matched, fallthrough')}if(!getTA()&&!getPV()&&!getCM())return;if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.code==='Space'){e.preventDefault();requestManualProseCompletion();return}if((e.ctrlKey||e.metaKey)&&e.key==='b'){e.preventDefault();wrapSel('**','**')}if((e.ctrlKey||e.metaKey)&&e.key==='i'){e.preventDefault();wrapSel('*','*')}if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();if(_editorMode==='preview'&&_searchMarks.length){searchNavStep(1)}else{applySearchHighlight()}}});
document.addEventListener('click',function(e){var menu=document.getElementById('folder-context-menu');if(menu&&!menu.hidden&&!menu.contains(e.target))closeFolderContextMenu()});
function highlightCodeBlocks(container){if(!window.hljs||!container)return;container.querySelectorAll('pre code[class*="language-"]').forEach(function(el){if(el.dataset.highlighted)return;window.hljs.highlightElement(el)})}
function ensureEditableAfterPre(pv){if(!pv)return;var pres=pv.querySelectorAll('pre');pres.forEach(function(pre){var next=pre.nextElementSibling;if(!next){var p=document.createElement('p');p.innerHTML='<br>';p.dataset.pvTrail='1';pv.appendChild(p)}})}
function initCopyButtons(pv){if(!pv)return;pv.querySelectorAll('pre').forEach(function(pre){pre.contentEditable='false';pre.style.cursor='pointer';if(pre.querySelector('.pre-copy-btn'))return;var btn=document.createElement('button');btn.type='button';btn.className='pre-copy-btn';btn.title='Copy code';btn.textContent='Copy';btn.addEventListener('click',function(e){e.stopPropagation();var code=pre.querySelector('code');var text=code?code.textContent:(pre.textContent||'');navigator.clipboard.writeText(text).then(function(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},1500)}).catch(function(){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},1500)})});pre.insertBefore(btn,pre.firstChild);pre.addEventListener('click',function(e){if(e.target.closest('.pre-copy-btn'))return;e.preventDefault();e.stopPropagation();if(!tinyMCEInsertCodeBlock(pre))openCodeModal(pre)})})}
function _isIOSWebKit(){var ua=navigator.userAgent||'';var platform=navigator.platform||'';var touchMac=platform==='MacIntel'&&navigator.maxTouchPoints>1;return /iP(ad|hone|od)/.test(ua)||touchMac}
function _isStandalonePWA(){return !!((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true)}
function _openResourceInNewContext(url){var a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();document.body.removeChild(a)}
function _resourceFilenameFromHeaders(headers){
	var cd=headers.get('Content-Disposition')||'';
	var mStar=cd.match(/filename\*=([^;]+)/i);
	if(mStar){var v=mStar[1].trim();var idx=v.indexOf("''");if(idx>=0)v=v.slice(idx+2);try{return decodeURIComponent(v.replace(/^"|"$/g,''))}catch(_e){return v.replace(/^"|"$/g,'')}}
	var m=cd.match(/filename="([^"]+)"/i);if(m)return m[1];
	var m2=cd.match(/filename=([^;]+)/i);if(m2)return m2[1].trim();
	return '';
}
function _fetchResourceBlob(resourceId){
	var url='/resources/'+encodeURIComponent(resourceId);
	return fetch(url,{credentials:'same-origin'}).then(function(r){
		if(!r.ok)throw new Error('HTTP '+r.status);
		var mime=r.headers.get('Content-Type')||'application/octet-stream';
		var filename=_resourceFilenameFromHeaders(r.headers)||resourceId;
		return r.blob().then(function(blob){return {blob:blob,mime:mime,filename:filename,url:url}})
	})
}
function _openResourceView(resourceId){
	var id=resourceId||'';if(!id)return;
	var url='/resources/'+encodeURIComponent(id)+(_isStandalonePWA()?'?viewer=1':'');
	_openResourceInNewContext(url);
}
function _canPreviewResourceMime(mime){
	var lower=(mime||'').toLowerCase();
	if(_isStandalonePWA())return lower.indexOf('image/')===0||lower.indexOf('text/')===0||lower==='application/pdf';
	return lower.indexOf('image/')===0||lower==='application/pdf'||lower==='text/plain';
}
function _fetchResourceMeta(resourceId){
	var url='/resources/'+encodeURIComponent(resourceId);
	return fetch(url,{method:'HEAD',credentials:'same-origin'}).then(function(r){
		if(!r.ok)throw new Error('HTTP '+r.status);
		return {
			mime:r.headers.get('Content-Type')||'application/octet-stream',
			filename:_resourceFilenameFromHeaders(r.headers)||resourceId,
			disposition:r.headers.get('Content-Disposition')||''
		}
	})
}
function _triggerResourceDownload(resourceId){
	var id=resourceId||'';if(!id)return;
	var url='/resources/'+encodeURIComponent(id)+'?download=1';
	if(_isIOSWebKit()&&!isDesktopMode()){window.location.assign(url);return}
	var a=document.createElement('a');a.href=url;a.setAttribute('download','');a.rel='noopener';document.body.appendChild(a);a.click();document.body.removeChild(a)
}
function _shouldUseResourceActions(){return _isStandalonePWA()||isDesktopMode()}
function _triggerBlobDownload(blob,filename){
	var u=URL.createObjectURL(blob);
	var a=document.createElement('a');a.href=u;a.setAttribute('download',filename||'download');a.rel='noopener';document.body.appendChild(a);a.click();document.body.removeChild(a);
	setTimeout(function(){URL.revokeObjectURL(u)},10000);
}
function _shareBlob(blob,filename,mime){
	try{
		if(typeof File!=='function')return Promise.resolve(false);
		var file=new File([blob],filename||'download',{type:mime||blob.type||'application/octet-stream'});
		if(navigator.canShare&&navigator.canShare({files:[file]})&&navigator.share){
			return navigator.share({files:[file]}).then(function(){return true}).catch(function(){return false})
		}
	}catch(_e){}
	return Promise.resolve(false);
}
function _closeResourceViewer(){
	var v=document.getElementById('resource-viewer');
	if(v){var u=v.getAttribute('data-blob-url');if(u)try{URL.revokeObjectURL(u)}catch(_e){}v.remove()}
}
function _openResourceViewer(blob,mime,filename){
	_closeResourceViewer();
	var url=URL.createObjectURL(blob);
	var overlay=document.createElement('div');
	overlay.id='resource-viewer';
	overlay.className='resource-viewer';
	overlay.setAttribute('data-blob-url',url);
	var bar=document.createElement('div');bar.className='resource-viewer-bar';
	var title=document.createElement('span');title.className='resource-viewer-title';title.textContent=filename||'';
	var saveBtn=document.createElement('button');saveBtn.type='button';saveBtn.className='resource-viewer-btn';saveBtn.textContent='Save';
	saveBtn.addEventListener('click',function(){_shareBlob(blob,filename,mime).then(function(ok){if(!ok)_triggerBlobDownload(blob,filename)})});
	var closeBtn=document.createElement('button');closeBtn.type='button';closeBtn.className='resource-viewer-btn';closeBtn.textContent='Close';
	closeBtn.addEventListener('click',_closeResourceViewer);
	bar.appendChild(title);bar.appendChild(saveBtn);bar.appendChild(closeBtn);
	var body=document.createElement('div');body.className='resource-viewer-body';
	var lower=(mime||'').toLowerCase();
	if(lower.indexOf('image/')===0){var img=document.createElement('img');img.src=url;img.className='resource-viewer-img';img.alt=filename||'';body.appendChild(img)}
	else if(lower==='application/pdf'||lower.indexOf('text/')===0||lower.indexOf('video/')===0||lower.indexOf('audio/')===0){var iframe=document.createElement('iframe');iframe.src=url;iframe.className='resource-viewer-frame';iframe.setAttribute('title',filename||'');body.appendChild(iframe)}
	else {var msg=document.createElement('div');msg.className='resource-viewer-msg';msg.textContent='This file type cannot be previewed. Use Save to download it.';body.appendChild(msg)}
	overlay.appendChild(bar);overlay.appendChild(body);
	document.body.appendChild(overlay);
	// Close on backdrop click (clicks on the media/body do nothing).
	overlay.addEventListener('click',function(e){if(e.target===overlay||e.target===body)_closeResourceViewer()});
	// Own Escape handler + focus so the overlay closes even when the prior focus
	// was inside the TinyMCE iframe (whose key events never reach document).
	overlay.setAttribute('tabindex','-1');
	overlay.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();_closeResourceViewer()}});
	try{closeBtn.focus()}catch(_e){}
}
// Double-click entry point: open a resource in the in-app lightbox overlay.
// Viewable types (image/pdf/text) render inline; anything else falls back to download.
function _openResourceLightbox(resourceId){
	var id=resourceId||'';if(!id)return;
	_fetchResourceMeta(id).then(function(meta){
		if(meta&&!_canPreviewResourceMime(meta.mime)){_triggerResourceDownload(id);return}
		_fetchResourceBlob(id).then(function(r){_openResourceViewer(r.blob,r.mime,r.filename)}).catch(function(){_triggerResourceDownload(id)});
	}).catch(function(){_triggerResourceDownload(id)});
}
var _resourceActionViewportHandler=null;
function _positionResourceActions(anchorEl){
	var s=document.getElementById('resource-action-sheet');
	if(!s)return;
	var vv=window.visualViewport;
	var height=window.innerHeight||0;
	var top=12;
	var left=12;
	var bottomLimit=(vv?vv.height:height)||height;
	var rightLimit=(vv?vv.width:(window.innerWidth||0))||(window.innerWidth||0);
	var anchorRect=anchorEl&&anchorEl.getBoundingClientRect?anchorEl.getBoundingClientRect():null;
	if(vv)height=Math.round(vv.height||height);
	if(!_isStandalonePWA()&&isDesktopMode()){
		s.style.width='200px';
		s.style.right='auto';
	}else{
		s.style.width='';
		s.style.left='12px';
		s.style.right='12px';
	}
	if(anchorRect){
		top=Math.round(anchorRect.bottom+12);
		var sheetH=s.offsetHeight||0;
		if(!_isStandalonePWA()&&isDesktopMode()){
			var sheetW=s.offsetWidth||200;
			left=Math.max(12,Math.min(Math.round(anchorRect.left),Math.max(12,rightLimit-sheetW-12)));
			s.style.left=left+'px';
		}
		if(top+sheetH>bottomLimit-12){
			var aboveTop=Math.round(anchorRect.top-sheetH-12);
			if(aboveTop>=12)top=aboveTop;else top=Math.max(12,bottomLimit-sheetH-12);
		}
	}
	s.style.top=top+'px';
	s.style.maxHeight=Math.max(140,Math.floor(height*0.6))+'px';
}
function _closeResourceActions(){
	var s=document.getElementById('resource-action-sheet');
	var b=document.getElementById('resource-action-backdrop');
	if(window.visualViewport&&_resourceActionViewportHandler){
		window.visualViewport.removeEventListener('resize',_resourceActionViewportHandler);
		window.visualViewport.removeEventListener('scroll',_resourceActionViewportHandler);
	}
	_resourceActionViewportHandler=null;
	if(s)s.remove();if(b)b.remove();
}
function presentResourceActions(resourceId,anchorEl){
	if(!resourceId)return;
	_closeResourceActions();
	var metaRequest=_fetchResourceMeta(resourceId).catch(function(){return null});
	try{if(document.activeElement&&document.activeElement.blur)document.activeElement.blur()}catch(_e){}
	var backdrop=document.createElement('div');backdrop.id='resource-action-backdrop';backdrop.className='resource-action-backdrop';backdrop.addEventListener('click',_closeResourceActions);
	var sheet=document.createElement('div');sheet.id='resource-action-sheet';sheet.className='resource-action-sheet';
	var mkBtn=function(label,handler){var b=document.createElement('button');b.type='button';b.className='resource-action-btn';b.textContent=label;b.addEventListener('click',handler);return b};
	var saveBtn=mkBtn('Save',function(){_closeResourceActions();if(_isStandalonePWA()){_fetchResourceBlob(resourceId).then(function(r){return _shareBlob(r.blob,r.filename,r.mime).then(function(ok){if(!ok)_triggerBlobDownload(r.blob,r.filename)})}).catch(function(){alert('Failed to load resource')});return}_triggerResourceDownload(resourceId)});
	var cancelBtn=mkBtn('Cancel',_closeResourceActions);cancelBtn.classList.add('resource-action-btn-cancel');
	sheet.appendChild(saveBtn);sheet.appendChild(cancelBtn);
	document.body.appendChild(backdrop);document.body.appendChild(sheet);
	_resourceActionViewportHandler=_positionResourceActions;
	if(window.visualViewport){
		window.visualViewport.addEventListener('resize',_resourceActionViewportHandler);
		window.visualViewport.addEventListener('scroll',_resourceActionViewportHandler);
	}
	_positionResourceActions(anchorEl);
	metaRequest.then(function(meta){
		if(!meta||!document.body.contains(sheet)||!_canPreviewResourceMime(meta.mime))return;
		var viewBtn=mkBtn('View',function(){_closeResourceActions();_openResourceView(resourceId)});
		sheet.insertBefore(viewBtn,saveBtn);
		_positionResourceActions(anchorEl);
	});
}
function downloadResource(resourceId,anchorEl){var id=resourceId||'';if(!id)return;if(_shouldUseResourceActions()){presentResourceActions(id,anchorEl);return}_triggerResourceDownload(id)}
function initResourceImageDownloadButtons(pv){if(!pv)return;pv.querySelectorAll('img.preview-img[data-resource-id]').forEach(function(img){var wrap=img.parentElement;if(!(wrap&&wrap.classList&&wrap.classList.contains('preview-img-download-wrap'))){wrap=document.createElement('span');wrap.className='preview-img-download-wrap';img.parentNode.insertBefore(wrap,img);wrap.appendChild(img)}if(wrap.querySelector('.preview-img-download-btn'))return;var btn=document.createElement('button');btn.type='button';btn.className='preview-img-download-btn';btn.title='Download image';btn.setAttribute('aria-label','Download image');btn.setAttribute('contenteditable','false');btn.textContent='⬇️';btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var resourceId=img.getAttribute('data-resource-id')||'';if(!resourceId)return;downloadResource(resourceId,btn)});wrap.appendChild(btn)})}
function activatePV(pv){if(!pv)return;pv.contentEditable='true';initImgResize(pv);initCopyButtons(pv);initResourceImageDownloadButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);pv.oninput=function(){_previewDirty=true;scheduleSyncPV();
	var state=getRenderAutocompleteState();
	if(state&&state.kind==='note'){
		var coords=getCaretCoordinates();
		if(coords){fetchNoteHeaders().then(function(headers){var query=state.query.toLowerCase();var filtered=headers.filter(function(h){return h.title.toLowerCase().indexOf(query)>=0});if(filtered.length>0){showRenderAutocompletePopup(coords,filtered,'note',state)}else{hideRenderAutocompletePopup()}})}
		return;
	}
	hideRenderAutocompletePopup();
	};pv.onkeyup=null;if(pv.dataset.pvInit)return;pv.dataset.pvInit='1';
	pv.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.code==='Space'){e.preventDefault();e.stopPropagation();requestManualProseCompletion();return}});
	// Ring buffer: capture raw input before contenteditable normalizes spaces/characters
	pv.addEventListener('beforeinput',function(e){
		_ringBufFedFromBeforeinput=false;
		if(!_ringBufAccepts(e.inputType)){
			if(e.inputType&&(e.inputType.indexOf('delete')>=0||e.inputType==='historyUndo'||e.inputType==='historyRedo'))_resetRingBuffer('pv-deletion-or-undo');
			return;
		}
		if(e.data){_feedRingBuffer('preview',e.inputType,e.data);_ringBufFedFromBeforeinput=true}
	});
	// Ring buffer: consume pending trigger after DOM has settled.
	// Also feeds buffer as fallback when beforeinput didn't fire (iOS Safari autocorrect pipeline).
	pv.addEventListener('input',function(e){
		if(!_ringBufFedFromBeforeinput&&e&&e.data){_feedRingBuffer('preview-input-fallback',e.inputType||'insertText',e.data)}
		_ringBufFedFromBeforeinput=false;
		if(_pendingTextExpansion){consumePendingTextExpansion('preview');return}
	});
	pv.addEventListener('blur',function(){_resetRingBuffer('pv-blur')});
	pv.addEventListener('click',function(){hideRenderAutocompletePopup()});
	pv.addEventListener('blur',function(){setTimeout(hideRenderAutocompletePopup,200)});
	// Desktop: double-click an image or attachment link → open the in-app lightbox.
	pv.addEventListener('dblclick',function(e){if(!isDesktopMode())return;var el=e.target.closest('img.preview-img[data-resource-id],a[data-resource-id]');if(!el||!pv.contains(el))return;if(e.target.closest('.preview-img-download-btn'))return;var resourceId=el.getAttribute('data-resource-id')||'';if(!resourceId)return;e.preventDefault();_openResourceLightbox(resourceId)});
	pv.addEventListener('click',function(e){var link=e.target.closest('a');if(link&&pv.contains(link)){var resId=link.getAttribute('data-resource-id')||'';if(resId){if(isDesktopMode()){e.preventDefault();return}if(_shouldUseResourceActions()){e.preventDefault();presentResourceActions(resId,link);return}}var href=link.getAttribute('href')||'';if(href){e.preventDefault();if(e.ctrlKey||e.metaKey){window.open(href,'_blank','noopener');return}_copyTextToClipboard(href,function(ok){if(ok)_showLinkCopiedToast(e.clientX,e.clientY)});return}}});
	// Click checkbox icon to toggle checked state
	pv.addEventListener('click',function(e){var cb=e.target.closest('.md-checkbox');if(!cb)return;var iconEl=cb.querySelector('.md-cb-icon');if(!iconEl){var txt=cb.firstChild;if(!txt||txt.nodeType!==3)return;var icon=txt.textContent.charAt(0);if(icon!=='\u2610'&&icon!=='\u2611')return;var r=document.createRange();r.setStart(txt,0);r.setEnd(txt,Math.min(2,txt.textContent.length));var iconRect=r.getBoundingClientRect();if(e.clientX>iconRect.right)return;e.preventDefault();var checked=!cb.classList.contains('checked');cb.classList.toggle('checked',checked);txt.textContent=(checked?'\u2611':'\u2610')+txt.textContent.slice(1);syncPV();return}var iconRect=iconEl.getBoundingClientRect();if(e.clientX>iconRect.right)return;e.preventDefault();var checked=!cb.classList.contains('checked');cb.classList.toggle('checked',checked);iconEl.textContent=checked?'\u2611':'\u2610';syncPV()});
	// Enter inside code blocks should stay in the same block; Enter after checkbox creates new checkbox
	pv.addEventListener('keydown',function(e){if(e.key==='Enter'){var sel=window.getSelection();if(!sel.rangeCount)return;var range=sel.getRangeAt(0);var node=range.startContainer;var el=node.nodeType===3?node.parentElement:node;var pre=el&&el.closest?el.closest('pre'):null;if(pre&&pv.contains(pre)){e.preventDefault();var code=pre.querySelector('code')||pre;var txt=code.textContent||'';var atEnd=(node===code||node.parentElement===code)&&range.startOffset===(node.nodeType===3?node.textContent.length:code.childNodes.length)&&!range.toString();if(atEnd&&txt.endsWith('\n')){code.textContent=txt.slice(0,-1);var np=document.createElement('p');np.innerHTML='<br>';pre.parentNode.insertBefore(np,pre.nextSibling);var nr=document.createRange();nr.setStart(np,0);nr.collapse(true);sel.removeAllRanges();sel.addRange(nr);np.scrollIntoView({block:'nearest'});syncPV();return}if(insertPVText('\n'))syncPV();return}var cb=el&&el.closest?el.closest('.md-checkbox'):null;if(!cb&&node.nodeType===1&&range.startOffset>0){var prev=node.childNodes[range.startOffset-1];if(prev&&prev.nodeType===1&&prev.classList&&prev.classList.contains('md-checkbox'))cb=prev}if(!cb)return;e.preventDefault();var label=(cb.textContent||'').replace(/^[\u2610\u2611][\u00a0 ]*/,'').replace(/\u00a0|\s/g,'');if(!label){var para=document.createElement('p');para.innerHTML='<br>';if(cb.parentNode)cb.parentNode.replaceChild(para,cb);var rp=document.createRange();rp.setStart(para,0);rp.collapse(true);sel.removeAllRanges();sel.addRange(rp);para.scrollIntoView({block:'nearest'});syncPV();return}var neo=document.createElement('div');neo.className='md-checkbox';var iconSpan2=document.createElement('span');iconSpan2.className='md-cb-icon';iconSpan2.textContent='\u2610';neo.appendChild(iconSpan2);var tn=document.createTextNode('\u00a0');neo.appendChild(tn);cb.parentNode.insertBefore(neo,cb.nextSibling);var r=document.createRange();r.setStart(tn,1);r.collapse(true);sel.removeAllRanges();sel.addRange(r);neo.scrollIntoView({block:'nearest'});syncPV()}});
	pv.addEventListener('keydown',function(e){if(e.key==='Enter'&&_autoLinkPVSelection({allowEnd:true}))syncPV()});
	pv.addEventListener('keyup',function(e){if(e.key===' '||e.key==='Spacebar'||e.key==='Tab'){if(_autoLinkPVSelection())syncPV()}});
	pv.addEventListener('blur',function(e){var target=e.target&&e.target.nodeType===1?e.target:(e.target&&e.target.parentElement?e.target.parentElement:null);var block=target&&target.closest?target.closest('p,div,li,blockquote,h1,h2,h3,h4,h5,h6'):null;if(block&&pv.contains(block)&&_autoLinkPVBlock(block))syncPV()},true);
	// Scroll to keep cursor visible while typing
	pv.addEventListener('input',function(){var sel=window.getSelection();if(sel&&sel.rangeCount){var r=sel.getRangeAt(0).getBoundingClientRect();var pr=pv.getBoundingClientRect();if(r.bottom>pr.bottom-8)pv.scrollTop+=r.bottom-pr.bottom+24}});
	// Force plain-text paste — if inside <pre>, insert raw text directly; otherwise wrap leading-space content in <pre><code>
	pv.addEventListener('paste',function(e){
		// Image paste: upload and insert as resource
		var items=e.clipboardData&&e.clipboardData.items;
		_log('paste event, items:',(items?items.length:0));
		if(items){for(var i=0;i<items.length;i++){_log('paste item['+i+'] kind='+items[i].kind+' type='+items[i].type);}}
		if(items){for(var i=0;i<items.length;i++){if(items[i].type.startsWith('image/')){e.preventDefault();var f=items[i].getAsFile();_log('paste image file:',f&&f.name,'size:',f&&f.size,'type:',f&&f.type);
			if(f)uploadFile(f);return;}}}
		e.preventDefault();var text=(e.clipboardData||window.clipboardData).getData('text/plain');if(!text)return;var sel=window.getSelection();var inPre=false;if(sel&&sel.rangeCount){var node=sel.getRangeAt(0).startContainer;while(node&&node!==pv){if(node.nodeName==='PRE'||node.nodeName==='CODE'){inPre=true;break}node=node.parentNode}}if(inPre){insertPVText(text);syncPV();return}var trimmed=text.trim();if(/^https?:\/\/\S+$/.test(trimmed)&&trimmed.indexOf('\n')<0){var hasSelection=sel&&sel.rangeCount&&!sel.getRangeAt(0).collapsed;var label=hasSelection?sel.getRangeAt(0).toString()||trimmed:trimmed;var a=_createPVLink(trimmed,label);if(sel&&sel.rangeCount){var range=sel.getRangeAt(0);range.deleteContents();range.insertNode(a);range.setStartAfter(a);range.collapse(true);sel.removeAllRanges();sel.addRange(range)}syncPV();return}document.execCommand('insertText',false,text);syncPV()})}
function djb2(str){var h=5381;for(var i=0;i<str.length;i++)h=((h<<5)+h+str.charCodeAt(i))>>>0;return h}
var _formHashExclude={baseUpdatedTime:true,forceSave:true,createCopy:true};function formHash(form){if(!form)return 0;var parts=[];var els=form.elements;for(var i=0;i<els.length;i++){var el=els[i];if(el.name&&!_formHashExclude[el.name])parts.push(el.name+'='+el.value)}return djb2(parts.join('&'))}
var _savedHash=0;
var _saveTimer=null;
var _saveTitleTimer=null;
function _anyModalOpen(){var ids=['code-modal','link-modal','folder-modal','history-modal','empty-trash-modal','upload-modal','vault-modal','new-folder-modal','resource-viewer'];for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(el&&!el.hidden)return true}return false}
function scheduleSave(){if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=setTimeout(function(){_saveTimer=null;if(_syncPVInFlight||_pvSyncTimer){_log('scheduleSave deferred, syncPV in flight');scheduleSave();return}if(_anyModalOpen()){_log('scheduleSave deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSave skip, hash unchanged',h);setSaveState('<span class="autosave-ok">Saved</span>','Saved');return}_log('scheduleSave firing, hash',_savedHash,'->',h);htmx.trigger(form,'joplock:save')},2000)}
function scheduleSaveTitle(){var mobileTitle=document.getElementById('mobile-editor-title');if(mobileTitle&&document.activeElement===mobileTitle)return;// Don't save while user is still editing title
if(_saveTitleTimer)clearTimeout(_saveTitleTimer);if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=null;_saveTitleTimer=setTimeout(function(){_saveTitleTimer=null;if(_anyModalOpen()){_log('scheduleSaveTitle deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSaveTitle skip, hash unchanged',h);setSaveState('<span class="autosave-ok">Saved</span>','Saved');return}_log('scheduleSaveTitle firing');htmx.trigger(form,'joplock:save')},2000)}
function snapshotHash(){var form=activeEditorForm();_savedHash=formHash(form);_log('snapshotHash',_savedHash)}
function _isLockedOverlayEventTarget(target){return !!(target&&target.closest&&target.closest('#editor-locked'))}
function initEditorPanel(){var form=activeEditorForm();if(!form||form.dataset.editorInit)return;form.dataset.editorInit='1';_resetRingBuffer('note-switch');_log('initEditorPanel',form.getAttribute('hx-put'));if(isMobileShellMode())closeNav();_previewDirty=false;setSaveState('','');snapshotHash();_snapshots=[];var undoBtn=queryActiveEditor('#undo-save-btn');if(undoBtn)undoBtn.hidden=true;pushSnapshot();form.addEventListener('input',function(e){if(_isLockedOverlayEventTarget(e.target))return;markEdited();scheduleSave()});form.addEventListener('change',function(e){if(_isLockedOverlayEventTarget(e.target))return;markEdited();scheduleSave()});initAutoTitle();applyMobileTitleMode();renderNoteMeta();	var ta=getTA();if(ta){ta.addEventListener('input',function(){autoTitle()});ta.addEventListener('keydown',function(e){if(_editorMode!=='markdown'&&_editorMode!=='md')return;if(e.key!=='Enter')return;var mac=navigator.platform&&navigator.platform.indexOf('Mac')!==-1;var mod=mac?e.metaKey:e.ctrlKey;if(mod){// Ctrl/Cmd+Enter = soft break (\n, same paragraph)
e.preventDefault();var start=ta.selectionStart,end=ta.selectionEnd;ta.value=ta.value.slice(0,start)+'\n'+ta.value.slice(end);ta.selectionStart=ta.selectionEnd=start+1;ta.dispatchEvent(new Event('input',{bubbles:true}))}else{// Enter = new paragraph (\n\n)
e.preventDefault();var start=ta.selectionStart,end=ta.selectionEnd;ta.value=ta.value.slice(0,start)+'\n\n'+ta.value.slice(end);ta.selectionStart=ta.selectionEnd=start+2;ta.dispatchEvent(new Event('input',{bubbles:true}))}})}var pendingSearch=(window._pendingNoteSearchTerm||'').trim();var mobileEditor=inMobileEditor();if(mobileEditor&&pendingSearch){var header=document.getElementById('mobile-editor-header');var searchHeader=document.getElementById('mobile-editor-search-header');if(header)header.style.display='none';if(searchHeader)searchHeader.style.display=''}var searchInput=activeSearchInput();if(searchInput&&pendingSearch&&!searchInput.value)searchInput.value=pendingSearch;window._pendingNoteSearchTerm='';/* Persistent TinyMCE: refresh content for this note (skip locked encrypted notes) */if(form.dataset.encrypted!=='1'){var _mobileRO=_tinymceReadonlyDefault();_editorMode=(_mobileRO?false:_defaultNoteOpenMode==='markdown')?'markdown':'rich';_tinymceReadonly=_mobileRO;syncEditorModeButtons();if(_editorMode==='markdown'){hideTinyMCEHost();applyEditorModeVisibility('markdown');var mdta=getTA();mountMarkdownEditor(mdta?mdta.value:'');initPersistentTinyMCE()}else{initPersistentTinyMCE();refreshTinyMCEForActiveNote()}if(pendingSearch){var _pendTerm=pendingSearch;if(_editorMode==='markdown'){setTimeout(function(){var si=activeSearchInput();if(si&&!si.value)si.value=_pendTerm;applySearchHighlight()},0)}else{/* rich: highlight is (re)applied by _setTinyMCEContent once the body is painted (covers sync + async render) */var si2=activeSearchInput();if(si2&&!si2.value)si2.value=_pendTerm;_log('initEditorPanel: setting pendingSearchHighlight, rich mode, term='+(_pendTerm||''));_pendingSearchHighlight=true;/* Fallback: if no setContent fires (e.g. same-note reopen with body already loaded), apply once the body has text. */var _tries=0;var _fb=setInterval(function(){_tries++;if(!_pendingSearchHighlight||_tries>20){clearInterval(_fb);return}var _b=_tinymceEditor&&_tinymceEditor.getBody&&_tinymceEditor.getBody();if(_b&&(_b.textContent||'').trim()&&activeSearchTerm()&&activeSearchTerm().trim()){_pendingSearchHighlight=false;clearInterval(_fb);applySearchHighlight()}},50)}}}else{hideTinyMCEHost()}}
function applySearchHighlight(){var term=activeSearchTerm();_log('applySearchHighlight mode='+_editorMode+' term='+(term||''));var bar=document.getElementById('search-nav-bar');if(bar)bar.hidden=true;_searchMarks=[];_searchMarkIdx=0;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);clearTinyMCESearchMarks();if(!term||!term.trim()){clearCodeMirrorSearch();return}term=term.trim();if(_editorMode==='markdown'||_editorMode==='md'){_log('applySearchHighlight: markdown/CM6 branch');if(_cmView&&window.CM&&window.CM.SearchQuery&&window.CM.setSearchQuery){window.CM.openSearchPanel(_cmView);var q=new window.CM.SearchQuery({search:term,caseSensitive:false});_cmView.dispatch({effects:window.CM.setSearchQuery.of(q)});_cmSearchMatches=collectCodeMirrorSearchMatches(q);if(_cmSearchMatches.length)setCodeMirrorSearchActive(0);else searchNavShow(0,0)}}else if(_editorMode==='preview'&&pv){clearCodeMirrorSearch();var savedHandler=pv.oninput;pv.oninput=null;highlightInPreview(pv,term);pv.oninput=savedHandler}else{_log('applySearchHighlight: rich/TinyMCE branch');clearCodeMirrorSearch();highlightInTinyMCE(term)}}
function escapeRegex(s){var specials=['.','+','*','?','^','$','(',')','{','}','[',']','|','\\'];return s.split('').map(function(c){return specials.indexOf(c)>=0?'\\'+c:c}).join('')}
var _searchMarks=[];var _searchMarkIdx=0;
function _searchSessionActive(){var term=activeSearchTerm();if(!term||!term.trim())return false;var bar=document.getElementById('search-nav-bar');if(bar&&!bar.hidden)return true;var mc=document.getElementById('mobile-search-nav-counter');if(mc&&!mc.hidden)return true;return _searchMarks.length>0||(_cmSearchMatches&&_cmSearchMatches.length>0)}
function searchNavShow(total,idx){var bar=document.getElementById('search-nav-bar');var counter=document.getElementById('search-nav-counter');if(bar){if(total===0){bar.hidden=true}else{bar.hidden=false;if(counter)counter.textContent=(idx+1)+' / '+total}}var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(mobileCounter){mobileCounter.hidden=total===0;if(total>0)mobileCounter.textContent=(idx+1)+' / '+total}if(mobilePrev)mobilePrev.hidden=total===0;if(mobileNext)mobileNext.hidden=total===0}
function searchNavSetActive(idx){_searchMarks.forEach(function(m,i){m.classList.toggle('search-highlight-active',i===idx)});var m=_searchMarks[idx];if(m)m.scrollIntoView({block:'center',behavior:'smooth'})}
function searchNavStep(dir){if(_editorMode==='markdown'&&_cmSearchMatches.length){setCodeMirrorSearchActive(_searchMarkIdx+dir);return}if(!_searchMarks.length)return;_searchMarkIdx=(_searchMarkIdx+dir+_searchMarks.length)%_searchMarks.length;searchNavSetActive(_searchMarkIdx);searchNavShow(_searchMarks.length,_searchMarkIdx)}
function searchNavDismiss(){_log('searchNavDismiss: clearing marks='+_searchMarks.length+' cmMatches='+(_cmSearchMatches?_cmSearchMatches.length:0));var bar=document.getElementById('search-nav-bar');var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(bar)bar.hidden=true;if(mobileCounter)mobileCounter.hidden=true;if(mobilePrev)mobilePrev.hidden=true;if(mobileNext)mobileNext.hidden=true;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);clearTinyMCESearchMarks();_searchMarks=[];_searchMarkIdx=0;clearCodeMirrorSearch()}
function highlightInPreview(pv,term){if(!pv||!term)return;_searchMarks=[];_searchMarkIdx=0;var doc=pv.ownerDocument||document;var walker=doc.createTreeWalker(pv,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentElement&&n.parentElement.closest('script,style,mark')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}},false);var nodes=[];var node;while((node=walker.nextNode()))nodes.push(node);var re=new RegExp(escapeRegex(term),'gi');nodes.forEach(function(n){var matches=[];var m;re.lastIndex=0;while((m=re.exec(n.textContent))!==null)matches.push({start:m.index,end:m.index+m[0].length});if(!matches.length)return;var frag=doc.createDocumentFragment();var last=0;matches.forEach(function(r){if(r.start>last)frag.appendChild(doc.createTextNode(n.textContent.slice(last,r.start)));var mark=doc.createElement('mark');mark.className='search-highlight';mark.textContent=n.textContent.slice(r.start,r.end);_searchMarks.push(mark);frag.appendChild(mark);last=r.end});if(last<n.textContent.length)frag.appendChild(doc.createTextNode(n.textContent.slice(last)));n.parentNode.replaceChild(frag,n)});if(_searchMarks.length){searchNavSetActive(0);searchNavShow(_searchMarks.length,0)}else{searchNavShow(0,0)}}
// Rendered mode (TinyMCE): highlight the search term inside the iframe body.
// Marks are inserted with edits suppressed so autosave/markdown-sync never fire
// mid-highlight, and are always stripped again by clearTinyMCESearchMarks().
function tinymceSearchBody(){var ed=getTinyMCE();if(!ed||!ed.getBody)return null;try{return ed.getBody()}catch(e){return null}}
function clearTinyMCESearchMarks(){var body=tinymceSearchBody();if(!body)return;var marks=body.querySelectorAll('mark.search-highlight');if(!marks.length)return;var prev=_tinymceSuppressEdits;_tinymceSuppressEdits=true;try{marks.forEach(function(m){var text=(m.ownerDocument||document).createTextNode(m.textContent);m.parentNode.replaceChild(text,m)});body.normalize()}finally{_tinymceSuppressEdits=prev}}
function highlightInTinyMCE(term){var body=tinymceSearchBody();if(!body||!term){searchNavShow(0,0);return}var prev=_tinymceSuppressEdits;_tinymceSuppressEdits=true;try{highlightInPreview(body,term)}finally{_tinymceSuppressEdits=prev}}
function initNavPanel(){_log('initNavPanel');var state=navFolderState();var selectedEl=document.querySelector('.nav-folder[data-selected="1"]');var hasSelected=!!selectedEl;var selectedId=selectedEl?selectedEl.getAttribute('data-folder-id'):'';document.querySelectorAll('.nav-folder').forEach(function(el){var id=el.getAttribute('data-folder-id');var selected=el.getAttribute('data-selected')==='1';var isAllNotes=el.getAttribute('data-all-notes')==='1';var open=state[id]===true||state[id]==='1'||state[id]===1;if(state[id]===undefined){// No explicit state: use heuristics
	if(isAllNotes)open=!hasSelected||(selectedId===id);else if(selected)open=true;else open=false;}// Always trust explicit localStorage state — do not override with data-selected or all-notes heuristics
	el.classList.toggle('collapsed',!open);// Lazy-load if expanded and not yet loaded
	if(open){var notesDiv=el.querySelector('.nav-folder-notes[data-folder-id]');if(notesDiv&&!notesDiv.getAttribute('data-loaded')){notesDiv.setAttribute('data-loaded','1');var folderId=notesDiv.getAttribute('data-folder-id');htmx.ajax('GET','/fragments/folder-notes?folderId='+encodeURIComponent(folderId),{target:notesDiv,swap:'innerHTML'})}}})}
var _folderSelectValue=null;var _folderSelectNoteId=null;
var _lastSwapWasEditor=false;var _searchHlTerm='';
document.body.addEventListener('htmx:beforeSwap',function(e){var sel=document.getElementById('editor-folder-select');var form=document.getElementById('note-editor-form');if(sel){_folderSelectValue=sel.value;_folderSelectNoteId=form?form.getAttribute('hx-put'):''}var target=e.detail&&e.detail.target;_lastSwapWasEditor=!!(target&&(target.id==='editor-panel'||target.id==='mobile-editor-body'));if(_lastSwapWasEditor){/* Capture any pending in-note search term now: initEditorPanel clears it, and it may not re-run on same-note reopen. */var pt=(window._pendingNoteSearchTerm||'').trim();var navTerm=(currentListSearchInput()&&currentListSearchInput().value||'').trim();_searchHlTerm=pt||navTerm||'';hideTinyMCEHost()}});
document.body.addEventListener('htmx:afterSettle',function(){initNavPanel();initEditorPanel();refreshAllVaultIcons();positionTinyMCEHost();
	if(_lastSwapWasEditor){_lastSwapWasEditor=false;maybeHighlightOpenedNote(_searchHlTerm);_searchHlTerm=''}
	if(_folderSelectValue){var sel=document.getElementById('editor-folder-select');var form=document.getElementById('note-editor-form');var currentNoteId=form?form.getAttribute('hx-put'):'';if(sel&&currentNoteId&&currentNoteId===_folderSelectNoteId){sel.value=_folderSelectValue}_folderSelectValue=null;_folderSelectNoteId=null}});
// After an editor-panel swap that came from a search result, (re)apply the
// in-note find highlight once the visible editor has content. This does not
// depend on initEditorPanel re-running (it may not on a same-note reopen) and
// works for both markdown (CM6) and rendered (TinyMCE) modes.
function maybeHighlightOpenedNote(term){term=(term||'').trim();if(!term)return;_log('maybeHighlightOpenedNote term='+term+' mode='+_editorMode);var form=activeEditorForm();if(!form||form.dataset.encrypted==='1')return;var si=activeSearchInput();if(si&&!si.value)si.value=term;if(_editorMode==='markdown'||_editorMode==='md'){setTimeout(applySearchHighlight,0);return}/* rich: wait for TinyMCE body text, then highlight */_log('maybeHighlightOpenedNote: rich mode, setting pending');_pendingSearchHighlight=true;var tries=0;var iv=setInterval(function(){tries++;if(!_pendingSearchHighlight||tries>40){clearInterval(iv);return}var b=_tinymceEditor&&_tinymceEditor.getBody&&_tinymceEditor.getBody();if(b&&(b.textContent||'').trim()&&activeSearchTerm()&&activeSearchTerm().trim()){_log('maybeHighlightOpenedNote: TinyMCE body ready, applying highlight');_pendingSearchHighlight=false;clearInterval(iv);applySearchHighlight()}},50)}
// Also refresh on initial SSR page load (htmx:afterSettle only fires after htmx swaps)
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){refreshAllVaultIcons();initPersistentTinyMCE();setTimeout(positionTinyMCEHost,0)})}else{refreshAllVaultIcons();initPersistentTinyMCE();setTimeout(positionTinyMCEHost,0)}
document.body.addEventListener('htmx:confirm',function(e){var elt=e.detail&&e.detail.elt;if(!elt)return;var msg=elt.getAttribute('data-confirm-trash');if(msg){e.preventDefault();if(_cfg.confirmTrash===false){e.detail.issueRequest(true);return}if(confirm(msg))e.detail.issueRequest(true)}});
function showNoteOverlay(){var o=document.getElementById('note-loading-overlay');if(o)o.classList.add('active')}
function hideNoteOverlay(){var o=document.getElementById('note-loading-overlay');if(o)o.classList.remove('active')}
document.body.addEventListener('click',function(e){var btn=e.target.closest('.notelist-item');if(btn&&!e.defaultPrevented)showNoteOverlay()},true);
document.body.addEventListener('htmx:beforeRequest',function(e){var elt=e.detail&&e.detail.elt;_log('htmx:beforeRequest',elt&&elt.id,elt&&elt.getAttribute&&elt.getAttribute('hx-get'),elt&&elt.getAttribute&&elt.getAttribute('hx-put'));});
document.body.addEventListener('htmx:afterRequest',function(e){var xhr=e.detail&&e.detail.xhr;_log('htmx:afterRequest',e.detail&&e.detail.successful,xhr&&xhr.status,xhr&&typeof xhr.responseText==='string'?xhr.responseText.slice(0,120):'');var elt=e.detail&&e.detail.elt;if(e.detail&&e.detail.successful){invalidateNotesCache()}if(elt&&elt.classList&&elt.classList.contains('notelist-item')&&!e.detail.successful)hideNoteOverlay();if(elt&&elt.id==='note-editor-form'&&e.detail.successful){var conflict=xhr&&xhr.getResponseHeader&&xhr.getResponseHeader('X-Note-Conflict')==='1';if(conflict){// Server rejected the save because the row moved underneath us. Do NOT
// snapshotHash (edits are still pending), do NOT overwrite the conflict UI
// that just got swapped into #autosave-status, and surface the prominent
// banner so the user can't miss it.
_log('afterRequest detected save conflict');showRemoteUpdateBanner('changed')}else{snapshotHash();pushSnapshot();setSaveState('<span class="autosave-ok">Saved</span>','Saved');dismissRemoteUpdateBanner();_log('afterRequest snapshotHash after save')}}if(e.detail&&e.detail.successful&&document.body.classList.contains('is-offline')){clearOffline()}});
document.body.addEventListener('htmx:afterSwap',function(e){var target=e.detail&&e.detail.target;_log('htmx:afterSwap',target&&target.id);if(target&&(target.id==='editor-panel'||target.id==='mobile-editor-body')){hideNoteOverlay();dismissRemoteUpdateBanner();if(_cmView){_cmView.destroy();_cmView=null}_searchMarks=[];_searchMarkIdx=0;/* Persistent TinyMCE: no destroy; reposition + refresh on next tick */setTimeout(positionTinyMCEHost,0)}});
function showOffline(){setSaveState('<span class="autosave-offline">Offline</span>','Offline');document.body.classList.add('is-offline');_log('offline indicator shown');showDisconnected()}
function clearOffline(){document.body.classList.remove('is-offline');_log('offline indicator cleared')}
document.body.addEventListener('htmx:sendError',function(e){var elt=e.detail&&e.detail.elt;_log('htmx:sendError',elt&&elt.id);if(elt&&elt.id==='note-editor-form')showOffline()});
document.body.addEventListener('htmx:responseError',function(e){var elt=e.detail&&e.detail.elt;var xhr=e.detail&&e.detail.xhr;_log('htmx:responseError',elt&&elt.id,xhr&&xhr.status);if(xhr&&xhr.status===401){_log('htmx 401, session invalid, logging out');window.location.assign('/logout');return;}if(elt&&elt.id==='note-editor-form')showOffline()});
// --- Disconnected overlay (server unreachable) ---
var _dcFailCount=0;
var _dcFailThreshold=1;
var _dcRetryIntervalSec=15;
var _dcRetryCountdown=0;
var _dcRetryTimer=null;
var _dcOverlay=null;
var _dcVisible=false;

function _createDcOverlay(){
	if(_dcOverlay)return _dcOverlay;
	var o=document.createElement('div');
	o.className='disconnected-overlay';
	o.innerHTML='<img src="/icon.svg" class="disconnected-logo" alt="" />'
		+'<div class="disconnected-card">'
		+'<div class="disconnected-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
		+'<path d="M6.5 19H5a4 4 0 0 1-.98-7.88A5.5 5.5 0 0 1 15.9 8.7 4 4 0 0 1 19 16h-1"/>'
		+'<line x1="2" y1="2" x2="22" y2="22"/></svg></div>'
		+'<div class="disconnected-title">Connection lost</div>'
		+'<div class="disconnected-sub">Unable to reach the server.</div>'
		+'<div class="disconnected-countdown" id="dc-countdown"></div>'
		+'<div class="disconnected-actions">'
		+'<button class="disconnected-retry" id="dc-retry-btn" type="button">Retry now</button>'
		+'<button class="disconnected-logout" type="button" onclick="window.location.assign(\'/logout\')">Log out</button>'
		+'</div></div>';
	document.body.appendChild(o);
	o.querySelector('#dc-retry-btn').addEventListener('click',_dcRetryNow);
	_dcOverlay=o;
	return o;
}

function _dcUpdateCountdown(){
	var el=document.getElementById('dc-countdown');
	if(el)el.textContent='Retrying in '+_dcRetryCountdown+'s\u2026';
}

function _dcPing(){
	_log('connectivity ping');
	return fetch('/heartbeat',{method:'POST',credentials:'same-origin'}).then(function(r){
		if(r.status===401){
			_log('ping 401, session expired');
			window.location.assign('/logout');
			return false;
		}
		if(!r.ok)throw new Error('HTTP '+r.status);
		return true;
	});
}

function showDisconnected(){
	if(_dcVisible)return;
	_dcVisible=true;
	_log('showDisconnected');
	var o=_createDcOverlay();
	o.style.display='';
	document.body.classList.add('is-disconnected');
	_dcRetryCountdown=_dcRetryIntervalSec;
	_dcUpdateCountdown();
	if(_dcRetryTimer)clearInterval(_dcRetryTimer);
	_dcRetryTimer=setInterval(function(){
		_dcRetryCountdown--;
		if(_dcRetryCountdown<=0){
			_dcRetryCountdown=_dcRetryIntervalSec;
			_dcPing().then(function(ok){if(ok)clearDisconnected()}).catch(function(){});
		}
		_dcUpdateCountdown();
	},1000);
}

function clearDisconnected(){
	if(!_dcVisible)return;
	_dcVisible=false;
	_dcFailCount=0;
	_log('clearDisconnected, reconnected');
	if(_dcOverlay)_dcOverlay.style.display='none';
	document.body.classList.remove('is-disconnected');
	if(_dcRetryTimer){clearInterval(_dcRetryTimer);_dcRetryTimer=null}
	clearOffline();
	// Re-save if dirty
	var status=queryActiveEditor('#autosave-status');
	var dirty=status&&status.querySelector('.autosave-edited');
	if(dirty){_log('clearDisconnected: re-saving dirty note');scheduleSave()}
}

function _dcRetryNow(){
	var btn=document.getElementById('dc-retry-btn');
	if(btn){btn.disabled=true;btn.textContent='Connecting\u2026'}
	_dcRetryCountdown=_dcRetryIntervalSec;
	_dcPing().then(function(ok){if(ok)clearDisconnected()}).catch(function(){});
	setTimeout(function(){if(btn){btn.disabled=false;btn.textContent='Retry now'}},2000);
}

function _dcOnFetchFail(){
	_dcFailCount++;
	if(_dcFailCount>=_dcFailThreshold)showDisconnected();
}

function _dcOnFetchOk(){
	_dcFailCount=0;
	if(_dcVisible)clearDisconnected();
}

window.addEventListener('online',function(){_log('browser online event');if(_dcVisible){_dcPing().then(function(ok){if(ok)clearDisconnected()}).catch(function(){})}if(document.body.classList.contains('is-offline')){var s=document.getElementById('autosave-status');var dirty=s&&s.querySelector('.autosave-edited');if(dirty){scheduleSave()}else if(s){setSaveState('<span class="autosave-ok">Reconnected</span>','Saved')}clearOffline()}});
window.addEventListener('offline',function(){_log('browser offline event');showDisconnected()});
// --- Cross-browser note sync (passive freshness probe) ---
// On each connectivity-ping tick (and on tab-visible), ask the server for the
// current note's updatedTime. If it advanced past our baseUpdatedTime, the
// note was edited in another browser/device. When the editor is clean, we
// silently swap in the fresh fragment. When dirty, we surface a banner so the
// user can choose to discard their edits or keep them (the existing Conflict
// flow then handles the save).
var _noteFreshnessBusy=false;
function _activeEditorNoteId(){var form=activeEditorForm();if(!form)return '';var hx=form.getAttribute('hx-put')||'';var m=hx.match(/\/fragments\/editor\/([0-9a-zA-Z]{32})/);return m?m[1]:''}
function _activeEditorCurrentFolderId(){var form=activeEditorForm();if(!form)return '';var el=form.querySelector('[name="currentFolderId"]');return el?el.value:''}
function _activeEditorBaseUpdatedTime(){var form=activeEditorForm();if(!form)return 0;var el=form.querySelector('[name="baseUpdatedTime"]');return el?Number(el.value||0):0}
// Dirty = there are user edits that differ from what we last saved/loaded.
// Don't trust the transient autosave-status text (which flips to "Saved" after
// each successful autosave even if the server has since moved past us). Use
// the durable signals instead:
//   - _previewDirty / _pvSyncTimer: preview-mode edits not yet flushed to textarea
//   - title contenteditable: text differs from hidden input
//   - formHash != _savedHash: textarea/folder/title fields differ from last save
function _activeEditorIsDirty(){var form=activeEditorForm();if(!form)return false;if(_previewDirty)return true;if(typeof _pvSyncTimer!=='undefined'&&_pvSyncTimer)return true;var ti=form.querySelector('.editor-title');var hi=form.querySelector('.editor-title-hidden');if(ti&&hi){var raw=ti.textContent||'';if(typeof stripMdForTitle==='function'){if(stripMdForTitle(raw)!==(hi.value||''))return true}else if(raw!==(hi.value||''))return true}return formHash(form)!==_savedHash}
function dismissRemoteUpdateBanner(){var bar=document.getElementById('remote-update-bar');if(bar)bar.hidden=true}
function showRemoteUpdateBanner(kind){var bar=document.getElementById('remote-update-bar');if(!bar)return;var text=document.getElementById('remote-update-text');var useBtn=document.getElementById('remote-update-use-server-btn');var owBtn=document.getElementById('remote-update-overwrite-btn');if(kind==='deleted'){if(text)text.textContent='This note was deleted in another window.';if(useBtn)useBtn.hidden=true;if(owBtn)owBtn.hidden=true}else{if(text)text.textContent='A newer version of this note exists on the server.';if(useBtn)useBtn.hidden=false;if(owBtn)owBtn.hidden=false}bar.hidden=false}
function reloadCurrentNoteFromServer(){var noteId=_activeEditorNoteId();if(!noteId)return;var folderId=_activeEditorCurrentFolderId();var targetSel=inMobileEditor()?'#mobile-editor-body':'#editor-panel';var target=document.querySelector(targetSel);if(!target)return;dismissRemoteUpdateBanner();var url='/fragments/editor/'+encodeURIComponent(noteId)+(folderId?'?currentFolderId='+encodeURIComponent(folderId):'');_log('reloadCurrentNoteFromServer',url);htmx.ajax('GET',url,{target:targetSel,swap:'innerHTML'}).catch(function(){})}
function overwriteWithLocalEdits(){var form=activeEditorForm();if(!form)return;dismissRemoteUpdateBanner();// Sync preview/CM into the textarea so the body in the form is current
var pv=getPV();if(pv)syncPV();else if(_editorMode!=='markdown'&&_editorMode!=='md')tinyMCESyncToTA();syncTitleToHidden({silent:true});// Set forceSave=1 so the server skips the optimistic-concurrency guard
var fs=form.querySelector('[name="forceSave"]');if(fs)fs.value='1';setSaveState('<span class="autosave-saving">Saving...</span>','Saving...');_log('overwriteWithLocalEdits forcing save');htmx.trigger(form,'joplock:save')}
function checkNoteFreshness(){if(_noteFreshnessBusy)return;var noteId=_activeEditorNoteId();if(!noteId)return;if(document.hidden)return;if(_anyModalOpen())return;var form=activeEditorForm();if(!form||form.dataset.encrypted==='1')return;// Skip while a vault note is locked or unlock UI is showing
if(form.dataset.unlocking==='1')return;var base=_activeEditorBaseUpdatedTime();if(!base)return;// Editor doesn't have a baseline yet (fresh new note); nothing to compare
_noteFreshnessBusy=true;fetch('/api/web/notes/'+encodeURIComponent(noteId)+'/freshness',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(r.status===404){showRemoteUpdateBanner('deleted');return null}if(!r.ok)return null;return r.json()}).then(function(data){if(!data)return;if(_activeEditorNoteId()!==noteId)return;var remote=Number(data.updatedTime||0);if(!remote||remote<=base)return;// Remote advanced past our baseline
if(data.deletedTime&&data.deletedTime>0){showRemoteUpdateBanner('deleted');return}if(_activeEditorIsDirty()){showRemoteUpdateBanner('changed');return}// Clean editor: silently reload from server
reloadCurrentNoteFromServer()}).catch(function(){}).then(function(){_noteFreshnessBusy=false})}
// Always-on connectivity ping (every 30s) — triggers disconnected overlay on failure and probes note freshness
(function(){var _cpMs=30000;function _connectivityPing(){_dcPing().then(function(ok){if(ok){_dcOnFetchOk();checkNoteFreshness()}else _dcOnFetchFail()}).catch(function(){_dcOnFetchFail()})}var _cpInterval=setInterval(_connectivityPing,_cpMs);_connectivityPing()})();
document.addEventListener('visibilitychange',function(){if(document.hidden){_log('visibilitychange hidden, flushing dirty note');flushSave(function(){})}else{checkNoteFreshness()}});
window.addEventListener('load',function(){if(isMobileShellMode())return;initNavPanel();initEditorPanel()});
window.addEventListener('resize',applyMobileTitleMode);
document.addEventListener('keydown',function(e){var mac=navigator.platform&&navigator.platform.indexOf('Mac')!==-1;var mod=mac?e.metaKey:e.ctrlKey;if(mod&&e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undoSnapshot()}});
	function flushSave(callback){
		var form=activeEditorForm();
		if(!form){_log('flushSave skip (no form)');if(callback)callback(true);return}
		if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}
		if(_saveTitleTimer){clearTimeout(_saveTitleTimer);_saveTitleTimer=null}
		if(_pvSyncTimer){clearTimeout(_pvSyncTimer);_pvSyncTimer=null;_syncPVInFlight=true;syncPV();_syncPVInFlight=false}else{var pv=getPV();if(pv&&_previewDirty)syncPV();else if(!pv&&_editorMode!=='markdown'&&_editorMode!=='md')tinyMCESyncToTA()}
		syncTitleToHidden({silent:true});
		var run=function(){
			var h=formHash(form);
			if(h===_savedHash){_log('flushSave skip (hash unchanged)',h);if(callback)callback(true);return}
			setSaveState('<span class="autosave-saving">Saving...</span>','Saving...');
			var restoreReq=function(){};
			var settled=false;
			var p;
			// finish(): the one place that clears the watchdog, releases the
			// _flushSaveInFlight mutex, and invokes callback exactly once — used
			// on success, on error, AND on watchdog timeout. Without this, a
			// fetch() that never settles (dropped connection, server hang) would
			// (a) leave #note-body's name="body" stripped forever (formHash()
			// then silently ignores all future body edits — note stuck "Edited",
			// nothing ever saves again) and (b) never invoke callback, which
			// permanently freezes the nav-intercept click handler below (clicking
			// another note in the list would do nothing).
			var finish=function(ok){
				if(settled)return;
				settled=true;
				clearTimeout(watchdog);
				if(_flushSaveInFlight===p)_flushSaveInFlight=null;
				if(callback)callback(ok);
			};
			var watchdog=setTimeout(function(){
				_log('flushSave watchdog fired, forcing restore');
				restoreReq();
				showOffline();
				finish(false);
			},20000);
			p=buildFlushRequest(form).then(function(req){
				if(settled)return;
				if(!req){finish(true);return}
				restoreReq=req.restore||restoreReq;
				_log('flushSave',req.url);
				return fetch(req.url,{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:req.body}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(function(html){
					if(settled)return;
					restoreReq();
					_log('flushSave ok',html.slice(0,80));
					snapshotHash();
					window._mobileNewNoteId=null;
					setSaveState('<span class="autosave-ok">Saved</span>','Saved');
					finish(true);
				});
			}).catch(function(err){
				if(settled)return;
				restoreReq();
				_log('flushSave error',err);
				showOffline();
				finish(false);
			});
			_flushSaveInFlight=p;
		};
		// If an encrypted autosave already owns the textarea's temporary
		// body-swap (_setOneShotEncryptedBody), wait for it instead of racing a
		// second swap on the same element — see _encryptedAutosaveInFlight.
		if(_encryptedAutosaveInFlight){
			_log('flushSave waiting for in-flight encrypted autosave');
			_encryptedAutosaveInFlight.then(run,run);
		}else{
			run();
		}
	}
	function shouldInterceptNavigationClick(target){var navTarget=target&&target.closest?target.closest('.notelist-item,.sidebar-item,.nav-folder-row,[hx-get],[hx-post],[hx-delete]'):null;if(!navTarget)return null;if(navTarget.closest&&navTarget.closest('#note-editor-form'))return null;if(navTarget.closest&&navTarget.closest('#folder-context-menu,#folder-modal,#link-modal,#history-modal,#code-modal,#new-folder-modal,#vault-modal,#empty-trash-modal'))return null;return navTarget}
document.addEventListener('click',function(e){var navTarget=shouldInterceptNavigationClick(e.target);if(!navTarget)return;var form=activeEditorForm();var status=queryActiveEditor('#autosave-status');var dirty=status&&status.querySelector('.autosave-edited');if(!form||!dirty)return;_log('navigation click intercepted, flushing save',navTarget.className||navTarget.id||navTarget.tagName);e.preventDefault();e.stopImmediatePropagation();flushSave(function(saved){if(saved){_log('flushSave done, re-clicking navigation target');navTarget.click()}})},true);
window.joplockLiveSearch=_cfg.liveSearch||false;
(function(){var _navSearchSavedValue=null;function enableLiveSearch(){var el=document.getElementById('nav-search');if(!el||!window.joplockLiveSearch||el.dataset.liveSearch)return;el.dataset.liveSearch='1';el.setAttribute('hx-trigger','search-submit, input changed delay:300ms');el.addEventListener('htmx:beforeRequest',function(e){var v=el.value;if(v.length>0&&v.length<3){e.preventDefault();return}});htmx.process(el)}function restoreNavSearch(){if(_navSearchSavedValue===null)return;var el=document.getElementById('nav-search');if(!el){_navSearchSavedValue=null;return;}el.value=_navSearchSavedValue;el.selectionStart=el.selectionEnd=el.value.length;_navSearchSavedValue=null}enableLiveSearch();document.body.addEventListener('htmx:beforeSwap',function(e){var target=e.detail&&e.detail.target;if(target&&target.id==='nav-panel'){var el=document.getElementById('nav-search');if(el)_navSearchSavedValue=el.value}});document.body.addEventListener('htmx:afterSettle',function(){enableLiveSearch();restoreNavSearch()})})();
function confirmLogout(event){
	var ok=window.confirm('Log out?\n\nThis clears local data on this device, including the current session and saved UI state. Your notes and other server data remain on the server.');
	if(!ok&&event)event.preventDefault();
	return ok;
}
// --- Mobile navigation ---
// SINGLE-SCREEN INVARIANT: Exactly one .mobile-screen carries .mobile-screen-active at any time.
// All transitions MUST go through setMobileState(). Direct DOM toggling is forbidden.
// renderMobile() is the only function that writes .mobile-screen-active and screen-driven UI
// (titles, FAB). assertSingleActiveScreen() enforces the invariant after every render.
(function(){
	// Canonical state. Mutated only by setMobileState() (which calls renderMobile()).
	var _state={screen:'folders',folderId:'',folderTitle:'',noteId:'',noteTitle:''};
	var _prevRenderedScreen=null;
	var _mobileInitDone=false;
	var _lastSyncWasMobile=null;// null=first call, true/false=previous syncResponsiveMode result
	function isMobile(){return isMobileShellMode()}
	function mobileScreenId(name){return'mobile-'+name+'-screen'}
	function assertSingleActiveScreen(){
		var active=document.querySelectorAll('.mobile-screen.mobile-screen-active');
		if(active.length===1)return;
		_trace('mobile-invariant-violation',{count:active.length,expected:_state.screen,ids:Array.prototype.map.call(active,function(e){return e.id})});
		// Self-heal: force exactly one active.
		var screens=['folders','notes','editor'];
		screens.forEach(function(s){
			var el=document.getElementById(mobileScreenId(s));
			if(el)el.classList.toggle('mobile-screen-active',s===_state.screen);
		});
	}
	// The ONLY function that writes .mobile-screen-active and screen-driven UI.
	function renderMobile(){
		if(_prevRenderedScreen!==null&&_prevRenderedScreen!==_state.screen)hideRenderAutocompletePopup();
		var screens=['folders','notes','editor'];
		screens.forEach(function(s){
			var el=document.getElementById(mobileScreenId(s));
			if(!el)return;
			el.classList.remove('mobile-screen-left','mobile-screen-right');
			el.classList.toggle('mobile-screen-active',s===_state.screen);
		});
		// Hide the persistent TinyMCE host and reparented toolbar whenever the editor screen is not active.
		if(_state.screen!=='editor'){hideTinyMCEHost()}else{setTimeout(positionTinyMCEHost,0)}
		// Titles
		var notesTitle=document.getElementById('mobile-notes-title');
		if(notesTitle&&_state.folderTitle)notesTitle.textContent=_state.folderTitle;
		var editorTitle=document.getElementById('mobile-editor-title');
		if(editorTitle&&_state.noteTitle&&_prevRenderedScreen!=='editor')editorTitle.textContent=_state.noteTitle;
		// FAB
		var fab=document.getElementById('mobile-fab');
		if(fab){
			var fabVisible=_state.screen==='folders'||_state.screen==='notes';
			fab.style.display=fabVisible?'flex':'none';
			if(!fabVisible)mobileFabClose();
		}
		// Editor search header should not persist across screen changes
		if(_state.screen!=='editor'&&_prevRenderedScreen==='editor'){
			window.mobileEditorSearchClose&&window.mobileEditorSearchClose();
		}
		_prevRenderedScreen=_state.screen;
		assertSingleActiveScreen();
	}
	// THE one entry point for all mobile screen transitions.
	function setMobileState(patch){
		if(!patch)return;
		Object.keys(patch).forEach(function(k){_state[k]=patch[k]});
		renderMobile();
	}
	// Read-only state access for debugging.
	window.joplockMobileState=function(){return JSON.parse(JSON.stringify(_state))};
	window.mobilePushNotes=function(folderId,folderTitle){
		if(!isMobile())return;
		setMobileState({screen:'notes',folderId:folderId,folderTitle:folderTitle||'Notes'});
		var body=document.getElementById('mobile-notes-body');if(body)body.innerHTML='<div class="empty-hint" style="padding:16px">Loading...</div>';
		htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(folderId),{target:'#mobile-notes-body',swap:'innerHTML'});
	};
	window.mobilePushEditor=function(noteId,folderId){
		if(!isMobile())return;
		setMobileState({screen:'editor',noteId:noteId,folderId:folderId||_state.folderId});
		_trace('mobilePushEditor-start',{noteId:noteId,folderId:folderId||_state.folderId});
		var body=document.getElementById('mobile-editor-body');if(body)body.innerHTML='<div class="editor-empty mobile-loading-note"><div class="note-loading-ring"></div></div>';
		htmx.ajax('GET','/fragments/editor/'+encodeURIComponent(noteId)+'?currentFolderId='+encodeURIComponent(folderId||_state.folderId),{target:'#mobile-editor-body',swap:'innerHTML'}).then(function(){_trace('mobilePushEditor-ok',{noteId:noteId});hideNoteOverlay()}).catch(function(err){_trace('mobilePushEditor-err',{noteId:noteId,error:err&&err.message?err.message:String(err)});hideNoteOverlay()});
	};
	// Back-navigation: deterministic editor->notes->folders.
	function mobileBack(){
		if(_state.screen==='editor'){
			setMobileState({screen:_state.folderId?'notes':'folders'});
			return'notes-or-folders';
		}
		if(_state.screen==='notes'){
			setMobileState({screen:'folders'});
			return'folders';
		}
		return'folders';
	}
	window.mobilePopScreen=function(){
		if(!isMobile())return;
		var prev=_state.screen;
		var dest=mobileBack();
		if(prev==='editor'&&dest==='folders'){
			// flush any dirty save when leaving editor
			flushSave(function(){})
		}
	};
	window.mobileEditorBack=function(){
		var form=document.getElementById('note-editor-form');
		if(form&&form.dataset.encrypted==='1'){
			setMobileState({screen:'folders'});
			return;
		}
		var titleEl=form&&form.querySelector('.editor-title');
		var bodyEl=form&&form.querySelector('#note-body');
		var noteId=_state.noteId;
		var title=((titleEl&&titleEl.textContent)||'').trim();
		var body=((bodyEl&&bodyEl.value)||'').trim();
		var shouldDiscard=!!(window._mobileNewNoteId&&noteId===window._mobileNewNoteId&&!body&&(title===''||title==='Untitled note'));
		if(shouldDiscard){
			fetch('/fragments/notes/'+encodeURIComponent(noteId),{method:'DELETE',headers:{'hx-request':'true','hx-params':'none'}})
				.then(function(){window._mobileNewNoteId=null;mobileRefreshNotes();mobilePopScreen()})
				.catch(function(){mobilePopScreen()});
			return;
		}
		flushSave(function(){mobileRefreshNotes();mobilePopScreen()});
	};
	// Wire mobile delete button after editor loads
	function wireMobileDeleteBtn(noteId,isDeleted){
		var btn=document.getElementById('mobile-delete-btn');
		if(!btn)return;
		btn.onclick=function(){
			var msg=isDeleted?'Permanently delete this note?':'Move this note to trash?';
			if(!confirm(msg))return;
			fetch('/fragments/notes/'+encodeURIComponent(noteId),{method:'DELETE',headers:{'hx-request':'true','hx-params':'none'}})
				.then(function(){mobilePopScreen();mobileRefreshNotes()});
		};
	}
	function mobileRefreshNotes(){
		if(_state.folderId){
			var body=document.getElementById('mobile-notes-body');
			if(body)htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_state.folderId),{target:'#mobile-notes-body',swap:'innerHTML'});
		}
	}
	window.mobileNewNote=function(){
		var fid=_state.screen==='notes'?_state.folderId:'';
		htmx.ajax('POST','/fragments/mobile/notes/new',{target:'#mobile-notes-body',swap:'innerHTML',values:{folderId:fid||''}});
	};
	window.mobileFabOpen=function(){
		if(_state.screen==='notes') return mobileNewNote();
		var b=document.getElementById('mobile-fab-menu-backdrop');
		var m=document.getElementById('mobile-fab-menu');
		if(b)b.style.display='';
		if(m)m.style.display='';
	};
	window.mobileFabClose=function(){
		var b=document.getElementById('mobile-fab-menu-backdrop');
		var m=document.getElementById('mobile-fab-menu');
		if(b)b.style.display='none';
		if(m)m.style.display='none';
	};
	window.mobileFabNewNote=function(){
		mobileFabClose();
		setMobileState({screen:'notes',folderId:'__all__',folderTitle:'All Notes'});
		mobileNewNote();
	};
	window.mobileFabNewFolder=function(){
		mobileFabClose();
		openNewFolderModal('mobile');
	};
	window.mobileNewNoteInFolder=function(folderId,folderTitle,event){
		if(event){event.preventDefault();event.stopPropagation();}
		setMobileState({screen:'notes',folderId:folderId,folderTitle:folderTitle||'Notes'});
		mobileNewNote();
	};
	// Context menu (long-press on note rows)
	var _ctxNoteId=null,_ctxNoteTitle=null,_ctxLongPressTimer=null;
	function mobileCtxOpen(noteId,noteTitle,opts){
		opts=opts||{};
		_ctxNoteId=noteId;_ctxNoteTitle=noteTitle;
		var backdrop=document.getElementById('mobile-ctx-backdrop');
		var sheet=document.getElementById('mobile-ctx-sheet');
		var titleEl=document.getElementById('mobile-ctx-title');
		var metaEl=document.getElementById('mobile-ctx-meta');
		var exportBtn=document.getElementById('mobile-ctx-export');
		var moveBtn=document.getElementById('mobile-ctx-move');
		var delBtn=document.getElementById('mobile-ctx-delete');
		if(titleEl)titleEl.textContent=noteTitle||'Untitled';
		if(exportBtn)exportBtn.style.display=(opts.isEditorContext&&!_isMarkdownModeActive())?'':'none';
		if(metaEl){
			var mbody=document.getElementById('mobile-editor-body');
			var metaSrc=mbody?mbody.querySelector('#note-meta'):null;
			if(!metaSrc)metaSrc=document.getElementById('status-note-meta');
			var c=metaSrc?Number(metaSrc.getAttribute('data-created-time')||0):0;
			var u=metaSrc?Number(metaSrc.getAttribute('data-updated-time')||0):0;
			if(c||u){
				var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
				var fmt=function(ts){if(!ts)return '';var d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'-'+months[d.getMonth()]+'-'+String(d.getFullYear()).slice(-2)};
				metaEl.textContent='Created '+fmt(c)+' \u2022 Edited '+fmt(u);
				metaEl.style.display='';
			}else{
				metaEl.textContent='';
				metaEl.style.display='none';
			}
		}
		if(moveBtn)moveBtn.onclick=function(){mobileCtxMove()};
		if(delBtn)delBtn.onclick=function(){mobileCtxDelete()};
		if(backdrop)backdrop.style.display='';
		if(sheet)sheet.style.display='';
	}
	window.mobileCtxClose=function(){
		var backdrop=document.getElementById('mobile-ctx-backdrop');
		var sheet=document.getElementById('mobile-ctx-sheet');
		if(backdrop)backdrop.style.display='none';
		if(sheet)sheet.style.display='none';
		_ctxNoteId=null;_ctxNoteTitle=null;
	};
	window.mobileFolderPickerClose=function(){
		var backdrop=document.getElementById('mobile-folder-picker-backdrop');
		var sheet=document.getElementById('mobile-folder-picker-sheet');
		var list=document.getElementById('mobile-folder-picker-list');
		if(backdrop)backdrop.style.display='none';
		if(sheet)sheet.style.display='none';
		if(list)list.innerHTML='';
	};
	function mobileCtxDelete(){
		if(!_ctxNoteId)return;
		var id=_ctxNoteId;
		mobileCtxClose();
		if(_cfg.confirmTrash!==false&&!confirm('Move this note to trash?'))return;
		fetch('/fragments/notes/'+encodeURIComponent(id),{method:'DELETE',headers:{'hx-request':'true','hx-params':'none'}})
			.then(function(){mobileRefreshNotes()});
	}
	function mobileCtxMove(){
		var form=activeEditorForm();
		var select=form&&form.querySelector?form.querySelector('#editor-folder-select'):null;
		if(!form||!select)return;
		mobileCtxClose();
		var options=Array.prototype.slice.call(select.options||[]);
		if(!options.length)return;
		var current=select.value||'';
		var backdrop=document.getElementById('mobile-folder-picker-backdrop');
		var sheet=document.getElementById('mobile-folder-picker-sheet');
		var list=document.getElementById('mobile-folder-picker-list');
		if(!backdrop||!sheet||!list)return;
		list.innerHTML='';
		options.forEach(function(opt){
			var btn=document.createElement('button');
			btn.type='button';
			btn.className='mobile-ctx-btn mobile-folder-picker-btn'+(opt.value===current?' is-current':'');
			btn.textContent=opt.text+(opt.value===current?' (current)':'');
			btn.disabled=opt.value===current;
			btn.onclick=function(){
				window.mobileFolderPickerClose();
				select.value=opt.value;
				select.dispatchEvent(new Event('change',{bubbles:true}));
			};
			list.appendChild(btn);
		});
		backdrop.style.display='';
		sheet.style.display='';
	}
	window.mobileEditorMenuOpen=function(){
		var form=activeEditorForm();
		if(!form)return;
		var titleInput=form.querySelector('.editor-title');
		mobileCtxOpen(form.dataset.noteId||_state.noteId,(titleInput&&titleInput.textContent)||document.getElementById('mobile-editor-title')&&document.getElementById('mobile-editor-title').textContent||'Untitled',{isEditorContext:true});
	};
	window.mobileCtxExport=function(){
		mobileCtxClose();
		setTimeout(function(){
			var anchor=document.getElementById('mobile-editor-menu-btn');
			toggleExportMenu(anchor);
		},50);
	};
	function wireNoteRowLongPress(container){
		if(!container)return;
		container.querySelectorAll('.mobile-note-row[data-note-id]').forEach(function(row){
			if(row.dataset.lpWired)return;
			row.dataset.lpWired='1';
			row.addEventListener('touchstart',function(e){
				var id=row.dataset.noteId,title=row.dataset.noteTitle;
				_ctxLongPressTimer=setTimeout(function(){
					e.preventDefault();
					mobileCtxOpen(id,title);
				},500);
			},{passive:true});
			row.addEventListener('touchend',function(){if(_ctxLongPressTimer){clearTimeout(_ctxLongPressTimer);_ctxLongPressTimer=null}});
			row.addEventListener('touchmove',function(){if(_ctxLongPressTimer){clearTimeout(_ctxLongPressTimer);_ctxLongPressTimer=null}});
		});
		wireFolderRowLongPress(container);
	}
	var _folderCtxId=null,_folderCtxTitle=null,_folderCtxLongPressTimer=null;
	function mobileFolderCtxOpen(folderId,folderTitle){
		_folderCtxId=folderId;_folderCtxTitle=folderTitle||'Untitled';
		var backdrop=document.getElementById('mobile-folder-ctx-backdrop');
		var sheet=document.getElementById('mobile-folder-ctx-sheet');
		var titleEl=document.getElementById('mobile-folder-ctx-title');
		var renameBtn=document.getElementById('mobile-folder-ctx-rename');
		var delBtn=document.getElementById('mobile-folder-ctx-delete');
		if(titleEl)titleEl.textContent=_folderCtxTitle;
		if(renameBtn)renameBtn.onclick=function(){mobileFolderCtxRename()};
		if(delBtn)delBtn.onclick=function(){mobileFolderCtxDelete()};
		if(backdrop)backdrop.style.display='';
		if(sheet)sheet.style.display='';
	}
	window.mobileFolderCtxClose=function(){
		var backdrop=document.getElementById('mobile-folder-ctx-backdrop');
		var sheet=document.getElementById('mobile-folder-ctx-sheet');
		if(backdrop)backdrop.style.display='none';
		if(sheet)sheet.style.display='none';
	};
	function mobileFolderCtxRename(){
		if(!_folderCtxId)return;
		_folderMenuState={id:_folderCtxId,title:_folderCtxTitle};
		window.mobileFolderCtxClose();
		openFolderModal();
	}
	function mobileFolderCtxDelete(){
		if(!_folderCtxId)return;
		var id=_folderCtxId,title=_folderCtxTitle;
		window.mobileFolderCtxClose();
		if(!confirm('Delete notebook "'+(title||'Untitled')+'"?'))return;
		fetch('/fragments/folders/'+encodeURIComponent(id),{method:'DELETE',headers:{'hx-request':'true'}})
			.then(function(){htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'})});
	}
	function wireFolderRowLongPress(container){
		if(!container)return;
		container.querySelectorAll('.mobile-folder-row').forEach(function(row){
			if(row.dataset.flpWired)return;
			var onclickAttr=row.getAttribute('onclick')||'';
			var m=onclickAttr.match(/mobilePushNotes\(\s*(?:"([^"]+)"|'([^']+)')\s*,\s*(?:"([^"]*)"|'([^']*)')/);
			if(!m)return;
			var fid=m[1]||m[2]||'';
			var ftitle=m[3]||m[4]||'';
			if(!fid||fid==='__all__')return;
			row.dataset.flpWired='1';
			row.addEventListener('touchstart',function(e){
				_folderCtxLongPressTimer=setTimeout(function(){
					e.preventDefault();
					mobileFolderCtxOpen(fid,ftitle);
				},500);
			},{passive:true});
			row.addEventListener('touchend',function(){if(_folderCtxLongPressTimer){clearTimeout(_folderCtxLongPressTimer);_folderCtxLongPressTimer=null}});
			row.addEventListener('touchmove',function(){if(_folderCtxLongPressTimer){clearTimeout(_folderCtxLongPressTimer);_folderCtxLongPressTimer=null}});
			row.addEventListener('contextmenu',function(e){e.preventDefault();mobileFolderCtxOpen(fid,ftitle)});
		});
	}
	// Search
	var _mobileSearchTimer=null;
	window.mobileSearchOpen=function(){
		var fh=document.getElementById('mobile-folders-header');
		var sh=document.getElementById('mobile-search-header');
		var inp=document.getElementById('mobile-search-input');
		if(fh)fh.style.display='none';
		if(sh)sh.style.display='';
		if(inp){inp.value='';inp.focus()}
		var body=document.getElementById('mobile-folders-body');
		if(body)body.innerHTML='';
	};
	window.mobileSearchClose=function(){
		var fh=document.getElementById('mobile-folders-header');
		var sh=document.getElementById('mobile-search-header');
		if(fh)fh.style.display='';
		if(sh)sh.style.display='none';
		htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
	};
	window.mobileSearchQuery=function(q){
		if(_mobileSearchTimer)clearTimeout(_mobileSearchTimer);
		if(!q||!q.trim()){var body=document.getElementById('mobile-folders-body');if(body)body.innerHTML='';return}
		if(q.trim().length<2)return;
		_mobileSearchTimer=setTimeout(function(){
			htmx.ajax('GET','/fragments/mobile/search?q='+encodeURIComponent(q.trim()),{target:'#mobile-folders-body',swap:'innerHTML'});
		},300);
	};
	window.mobileEditorSearchOpen=function(){
		var header=document.getElementById('mobile-editor-header');
		var searchHeader=document.getElementById('mobile-editor-search-header');
		var input=document.getElementById('mobile-editor-search-input');
		if(header)header.style.display='none';
		if(searchHeader)searchHeader.style.display='';
		if(input&&!input.value){var pending=window._pendingNoteSearchTerm||'';var listTerm=currentListSearchTerm();var seed=(pending&&pending.trim())||(listTerm&&listTerm.trim())||'';if(seed)input.value=seed;window._pendingNoteSearchTerm=''}
		if(input){input.focus();input.select();applySearchHighlight()}
	};
	window.mobileEditorSearchClose=function(){
		var header=document.getElementById('mobile-editor-header');
		var searchHeader=document.getElementById('mobile-editor-search-header');
		var mobileBar=document.getElementById('mobile-search-nav-bar');
		var input=document.getElementById('mobile-editor-search-input');
		if(input)input.value='';
		if(searchHeader)searchHeader.style.display='none';
		if(mobileBar)mobileBar.hidden=true;
		if(header)header.style.display='';
		searchNavDismiss();
	};
	window.mobileEditorSearchQuery=function(){applySearchHighlight()};
	function mobileInit(){
		if(!isMobile())return;
		_trace('mobileInit-start',{initDone:_mobileInitDone});
		document.getElementById('mobile-app').setAttribute('aria-hidden','false');
		// Reset any stale active classes; renderMobile() (via setMobileState below) sets the correct one.
		['folders','notes','editor'].forEach(function(name){
			var screen=document.getElementById(mobileScreenId(name));
			if(!screen)return;
			screen.classList.remove('mobile-screen-active','mobile-screen-left','mobile-screen-right');
			screen.style.pointerEvents='';
		});
		if(_mobileInitDone){renderMobile();return}
		_mobileInitDone=true;
		// Check if server pre-rendered a note into mobile-editor-body (resumeLastNote)
		var startup=_mobileStartup;
		if(startup&&startup.noteId){
			setMobileState({
				screen:'editor',
				folderId:startup.folderId||'',
				folderTitle:startup.folderTitle||'Notes',
				noteId:startup.noteId,
				noteTitle:startup.noteTitle||'Note'
			});
			// SSR already rendered editor content — init it directly, fetch lists in background
			initEditorPanel();
			initMobileToolbar();
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
			if(_state.folderId)htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_state.folderId),{target:'#mobile-notes-body',swap:'innerHTML'});
		}else{
			// Fresh load: start at folders screen
			setMobileState({screen:'folders'});
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
		}
		var fab=document.getElementById('mobile-fab');
		if(fab&&!fab.dataset.debugWired)fab.dataset.debugWired='1';
		// Swipe right to go back
		var startX=0,startY=0,swiping=false;
		document.getElementById('mobile-app').addEventListener('touchstart',function(e){startX=e.touches[0].clientX;startY=e.touches[0].clientY;swiping=true},{passive:true});
			document.getElementById('mobile-app').addEventListener('touchend',function(e){
				if(!swiping)return;swiping=false;
				var dx=e.changedTouches[0].clientX-startX;
				var dy=e.changedTouches[0].clientY-startY;
				if(Math.abs(dx)>Math.abs(dy)*1.5&&dx>60&&_state.screen!=='folders'){mobileEditorBack()}
			},{passive:true});
	}
	// Redraw the current mobile screen after a shell switch (no reload needed)
	function redrawMobileUI(){
		if(!isMobile())return;
		_trace('redrawMobileUI',{state:_state});
		// Re-assert current state (renderMobile picks up DOM that may have been stale).
		renderMobile();
		if(_state.screen==='editor'&&_state.noteId){
			// Re-fetch editor; lists refresh after editor settles
			var body=document.getElementById('mobile-editor-body');if(body)body.innerHTML='<div class="editor-empty mobile-loading-note"><div class="note-loading-ring"></div></div>';
			htmx.ajax('GET','/fragments/editor/'+encodeURIComponent(_state.noteId)+'?currentFolderId='+encodeURIComponent(_state.folderId),{target:'#mobile-editor-body',swap:'innerHTML'}).then(function(){
				htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
				if(_state.folderId)htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_state.folderId),{target:'#mobile-notes-body',swap:'innerHTML'});
			});
		}else if(_state.screen==='notes'){
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
			if(_state.folderId)htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_state.folderId),{target:'#mobile-notes-body',swap:'innerHTML'});
		}else{
			setMobileState({screen:'folders'});
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
		}
	}
	function syncResponsiveMode(){
		var mobile=isMobile();
		document.body.classList.toggle('mobile-shell-active',mobile);
		document.documentElement.classList.toggle('mobile-no-page-scroll',mobile);
		document.body.classList.toggle('mobile-no-page-scroll',mobile);
		// For auto mode, ensure body classes reflect current viewport so CSS overrides work
		if(_uiMode==='auto'){
			document.body.classList.toggle('force-mobile',mobile);
			document.body.classList.toggle('force-desktop',!mobile);
		}
		if(mobile){
			if(!_mobileInitDone){
				mobileInit();
			}else if(_lastSyncWasMobile===false){
				// Only redraw if we just crossed from desktop→mobile
				document.getElementById('mobile-app').setAttribute('aria-hidden','false');
				redrawMobileUI();
			}
			_lastSyncWasMobile=true;
			return;
		}
		var wasMobile=_lastSyncWasMobile;
		_lastSyncWasMobile=false;
		var app=document.getElementById('mobile-app');
		if(app){
			// Blur any focused element inside mobile-app before hiding to avoid aria-hidden warning
			var focused=app.contains(document.activeElement)?document.activeElement:null;
			if(focused)focused.blur();
			app.setAttribute('aria-hidden','true');
		}
		mobileFabClose();
		mobileCtxClose();
		var fab=document.getElementById('mobile-fab');
		if(fab)fab.style.display='none';
		var foldersHeader=document.getElementById('mobile-folders-header');
		var searchHeader=document.getElementById('mobile-search-header');
		if(foldersHeader)foldersHeader.style.display='';
		if(searchHeader)searchHeader.style.display='none';
		setMobileNav(false);
		// Mirror redrawMobileUI: if we just crossed mobile→desktop, re-init desktop UI.
		// Without this, a session that started in mobile mode never calls initNavPanel/
		// initEditorPanel for the desktop form, leaving the preview/CM host in an
		// uninitialized state (both visible, wrong display values, stale scroll).
		if(wasMobile===true){initNavPanel();initEditorPanel();}
	}
	function mobileEditorToolbar(){
		var body=document.getElementById('mobile-editor-body');
		return body?body.querySelector('#editor-toolbar'):null;
	}
	function setMobileToolbarVisible(show){
		var tb=mobileEditorToolbar();
		if(!tb)return;
		// In rich (TinyMCE) mode the built-in toolbar is used; always keep the
		// custom toolbar visibility class-driven and clear inline overrides.
		if(_editorMode!=='markdown'&&_editorMode!=='md'){
			tb.style.display='';
			positionTinyMCEHost();
			return;
		}
		var form=activeEditorForm();
		if(form&&form.dataset.encrypted==='1'&&form.dataset.vaultUnlocked!=='1')show=false;
		tb.style.display=show?'flex':'none';
		// Reposition immediately, then again after a tick so the toolbar has a
		// rendered height before positionTinyMCEHost measures the anchor bottom.
		positionTinyMCEHost();
		if(show)setTimeout(positionTinyMCEHost,0);
	}
	function initMobileToolbar(){
		// Remove any stale reparented toolbar from a previous approach.
		var stale=document.body.querySelector('#editor-toolbar[data-mobile-reparented]');
		if(stale)stale.remove();
		var tb=mobileEditorToolbar();
		if(!tb||!inMobileEditor())return;
		// Allow CSS mode classes to control toolbar visibility.
		tb.style.display='';
		positionTinyMCEHost();
		syncEditorModeButtons();
	}
	// Reposition TinyMCE host when viewport changes (keyboard open/close, resize).
	// Show/hide toolbar on TinyMCE focus/blur.
	(function initMobileToolbarGlobalListeners(){
		function onVpChange(){
			stabilizeTinyMCEHostPosition();
			// When the visual viewport returns to full height the keyboard has gone away.
			// Hide the toolbar — user is no longer actively editing.
			if(!inMobileEditor())return;
			var vv=window.visualViewport;
			var keyboardGone=!vv||(window.innerHeight-vv.height<80);
			if(keyboardGone&&!(_tinymceEditor&&_tinymceEditor.hasFocus&&_tinymceEditor.hasFocus())){
				setMobileToolbarVisible(false);
			}
		}
		if(window.visualViewport){
			window.visualViewport.addEventListener('resize',onVpChange);
			window.visualViewport.addEventListener('scroll',positionTinyMCEHost);
		}
		window.addEventListener('resize',positionTinyMCEHost);
		// TinyMCE lives in an iframe; relay focus/blur via custom events from setup().
		document.body.addEventListener('joplock:editor-focus',function(){
			if(_tinymceSuppressEdits)return;
			if(inMobileEditor()){
				setMobileToolbarVisible(true);
				stabilizeTinyMCEHostPosition();
			}
		});
		document.body.addEventListener('joplock:editor-blur',function(){
			if(!inMobileEditor())return;
			// Give the browser time to update hasFocus and visualViewport,
			// then hide toolbar if editor is truly no longer focused.
			setTimeout(function(){
				if(_tinymceEditor&&_tinymceEditor.hasFocus&&_tinymceEditor.hasFocus())return;
				setMobileToolbarVisible(false);
			},200);
		});
	})();
	// Update editor title when editor loads
		document.body.addEventListener('htmx:afterSettle',function(e){
		var t=e.detail&&e.detail.target;
		if(t&&t.id==='mobile-editor-body'){
			_trace('mobile-editor-settle-start');
			initEditorPanel();
			var titleHidden=t.querySelector('.editor-title-hidden');
			var titleEl=document.getElementById('mobile-editor-title');
			if(titleEl&&titleHidden)titleEl.textContent=titleHidden.value||'Note';
			var mobileStatus=document.getElementById('mobile-editor-status');
			if(mobileStatus){
				var dirty=t.querySelector('#autosave-status .autosave-edited');
				var saved=t.querySelector('#autosave-status .autosave-ok');
				mobileStatus.innerHTML=dirty?'<span class="autosave-edited">Edited</span>':(saved?'<span class="autosave-ok">Saved</span>':'');
			}
			// Hide desktop titlebar in mobile editor
			var titlebar=t.querySelector('.editor-titlebar');
			if(titlebar&&isMobile())titlebar.style.display='none';
			// Wire delete button
			var form=t.querySelector('#note-editor-form');
			var noteId=form?decodeURIComponent((form.getAttribute('hx-put')||'').replace('/fragments/editor/','')):'';
			_trace('mobile-editor-settle-done',{hasForm:!!form,noteId:noteId,spinner:!!t.querySelector('.mobile-loading-note,.note-loading-ring')});
			var isDeleted=!!t.querySelector('.btn-danger[hx-confirm*="Permanently"]');
			wireMobileDeleteBtn(noteId,isDeleted);
			// Show FAB only when on notes screen
			var fab=document.getElementById('mobile-fab');if(fab)fab.style.display='none';
			// Position toolbar above keyboard using visualViewport
			initMobileToolbar();
		}
		if(t&&(t.id==='mobile-notes-body'||t.id==='mobile-folders-body')){
			var fab=document.getElementById('mobile-fab');
			var editorActive=!!document.querySelector('#mobile-editor-screen.mobile-screen-active');
			if(fab)fab.style.display=editorActive?'none':'flex';
			wireNoteRowLongPress(t);
		}
	});
	// Handle new note response: push to editor
	document.body.addEventListener('htmx:afterRequest',function(e){
		var t=e.detail&&e.detail.target;
		if(t&&t.id==='mobile-notes-body'){
			var xhr=e.detail.xhr;
			var noteId=xhr&&xhr.getResponseHeader('X-Mobile-Note-Id');
			if(noteId){window._mobileNewNoteId=noteId;mobilePushEditor(noteId,_state.folderId)}
		}
	});
	window._syncResponsiveMode=syncResponsiveMode;
	window.addEventListener('resize',handleViewportResize);
	window.addEventListener('orientationchange',handleViewportResize);
	syncResponsiveMode();
})();
// --- Encryption UI flows (vault-centric) ---

// _vaultModal: modal for creating vault password or unlocking a vault
var _vaultModalFolderId=null;
var _vaultModalMode=null; // 'create' | 'unlock'
var _vaultModalCallback=null; // called with success/failure

function _showVaultModal(folderId,mode,callback){
	_vaultModalFolderId=folderId;
	_vaultModalMode=mode;
	_vaultModalCallback=callback;
	var modal=document.getElementById('vault-modal');
	var backdrop=document.getElementById('vault-modal-backdrop');
	var titleEl=document.getElementById('vault-modal-title');
	var pw=document.getElementById('vault-modal-password');
	var confirm=document.getElementById('vault-modal-confirm-wrap');
	var warn=document.getElementById('vault-modal-warning');
	var err=document.getElementById('vault-modal-error');
	if(err)err.textContent='';
	if(pw)pw.value='';
	if(mode==='create'){
		if(titleEl)titleEl.textContent='Create Vault';
		if(confirm)confirm.style.display='';
		if(warn)warn.style.display='';
	}else{
		if(titleEl)titleEl.textContent='Unlock Vault';
		if(confirm)confirm.style.display='none';
		if(warn)warn.style.display='none';
	}
	if(modal)modal.hidden=false;
	if(backdrop)backdrop.hidden=false;
	if(pw)pw.focus();
}

function closeVaultModal(){
	var modal=document.getElementById('vault-modal');
	var backdrop=document.getElementById('vault-modal-backdrop');
	if(modal)modal.hidden=true;
	if(backdrop)backdrop.hidden=true;
	_vaultModalFolderId=null;
	_vaultModalMode=null;
	if(_vaultModalCallback){_vaultModalCallback(false);_vaultModalCallback=null}
}

async function submitVaultModal(event){
	if(event)event.preventDefault();
	var folderId=_vaultModalFolderId;
	var mode=_vaultModalMode;
	if(!folderId||!mode)return;
	var pw=document.getElementById('vault-modal-password');
	var confirmInput=document.getElementById('vault-modal-confirm');
	var err=document.getElementById('vault-modal-error');
	var password=(pw?pw.value:'').trim();
	if(!password){if(err)err.textContent='Password is required.';return}

	if(mode==='create'){
		var confirmVal=(confirmInput?confirmInput.value:'').trim();
		if(password!==confirmVal){if(err)err.textContent='Passwords do not match.';return}
		if(password.length<4){if(err)err.textContent='Password too short (minimum 4 characters).';return}
		try{
			await createVault(folderId,password);
			var cb=_vaultModalCallback;
			_vaultModalCallback=null;
			_closeVaultModalSilent();
			// Update nav icons to show vault unlocked
			_refreshVaultIcon(folderId,true);
			touchVaultActivity(folderId);
			startAutoLockTimer();
			if(cb)cb(true);
		}catch(e){
			if(err)err.textContent='Failed to create vault: '+(e.message||e);
		}
	}else{
		// unlock mode
		try{
			var ok=await unlockVault(folderId,password);
			if(!ok){if(err)err.textContent='Wrong password.';if(pw){pw.value='';pw.focus()}return}
			var cb=_vaultModalCallback;
			_vaultModalCallback=null;
			_closeVaultModalSilent();
			_refreshVaultIcon(folderId,true);
			touchVaultActivity(folderId);
			startAutoLockTimer();
			if(cb)cb(true);
		}catch(e){
			if(err)err.textContent='Unlock error: '+(e.message||e);
		}
	}
}

function _closeVaultModalSilent(){
	var modal=document.getElementById('vault-modal');
	var backdrop=document.getElementById('vault-modal-backdrop');
	if(modal)modal.hidden=true;
	if(backdrop)backdrop.hidden=true;
	_vaultModalFolderId=null;
	_vaultModalMode=null;
}

// Update vault folder lock icon in nav (client-side optimistic update)
function _refreshVaultIcon(folderId,unlocked){
	document.querySelectorAll('.vault-folder-lock[data-folder-id="'+folderId+'"]').forEach(function(el){
		el.innerHTML=unlocked?SVG_LOCK_OPEN:SVG_LOCK_CLOSED;
		el.title=unlocked?'Lock vault':'Unlock vault';
	});
	// Also update note lock icons for notes in this vault
	document.querySelectorAll('.note-lock-icon').forEach(function(el){
		var btn=el.closest('.notelist-item,.mobile-note-row');
		if(btn&&btn.dataset.vaultId===folderId){
		el.innerHTML=unlocked?SVG_LOCK_OPEN:SVG_LOCK_CLOSED;
			el.classList.toggle('note-lock-unlocked',unlocked);
		}
	});
}

// Single source of truth: scan DOM for all vault folders and refresh their icons
// based on isVaultUnlocked() state. Safe to call repeatedly.
function refreshAllVaultIcons(){
		document.querySelectorAll('.vault-folder-lock[data-folder-id]').forEach(function(el){
			var folderId=el.getAttribute('data-folder-id');
			if(!folderId)return;
			var unlocked=isVaultUnlocked(folderId);
			_refreshVaultIcon(folderId,unlocked);
		});
}

// Toggle vault lock: if unlocked → lock; if locked → prompt unlock
function toggleVaultLock(folderId){
	var unlocked=isVaultUnlocked(folderId);
	_log('toggleVaultLock',folderId,{unlocked:unlocked});
	if(unlocked){
		// Lock the vault
		clearVaultKey(folderId);
		delete _autoLockActivity[folderId];
		_refreshVaultIcon(folderId,false);
		// If current note belongs to this vault, close it (clear the editor)
		var form=activeEditorForm();
		if(form){
			var ta=getTA();
			// Check form.dataset.vaultId first (set after unlock when textarea is plaintext)
			// Fall back to parsing the body (if still encrypted)
			var bodyVault=form.dataset.vaultId||( ta?getBodyVaultId(ta.value):null);
			_log('toggleVaultLock close-check',folderId,{formVaultId:form.dataset.vaultId||null,bodyVault:bodyVault,noteId:form.dataset.noteId||null});
			if(bodyVault===folderId){
				var panel=form.closest('#editor-panel')||document.getElementById('editor-panel');
				if(panel)panel.innerHTML='<div class="editor-empty">Select a note</div>';
				hideTinyMCEHost();
			}
		}
	}else{
		_showVaultModal(folderId,'unlock',function(ok){
			_log('toggleVaultLock unlock-callback',folderId,{ok:ok});
			if(ok){
				// Auto-decrypt if current note belongs to this vault
				var form=activeEditorForm();
				if(form){
					var noteId=form.dataset.noteId;
					var ta=getTA();
					if(ta&&isEncryptedBody(ta.value)){
						var bodyVault=getBodyVaultId(ta.value);
						_log('toggleVaultLock unlock-open-note-check',folderId,{bodyVault:bodyVault,noteId:noteId});
						if(bodyVault===folderId){
							getVaultKey(folderId).then(function(key){
								if(!key)return;
								return _decryptWithKey(ta.value,key).then(function(pt){_completeUnlock(noteId,pt,folderId)});
							}).catch(function(){});
						}
					}
				}
			}
		});
	}
}

// lockNote: lock a currently-unlocked note (by encrypting it into its vault)
// If the note is not in a vault, do nothing (encryption requires vault)
function lockNote(noteId){
	var form=activeEditorForm();
	if(!form)return;
	var ta=getTA();
	if(!ta)return;
	// Determine vault from editor context (parentId select)
	var parentSelect=form.querySelector('[name="parentId"]');
	var folderId=parentSelect?parentSelect.value:'';
	if(!folderId){
		alert('Please move this note to a vault folder before encrypting it.');
		return;
	}
	if(isVaultUnlocked(folderId)){
		// Encrypt immediately
		_doEncryptNoteInVault(noteId,folderId);
	}else{
		// Need to unlock vault first
		_showVaultModal(folderId,'unlock',function(ok){
			if(ok)_doEncryptNoteInVault(noteId,folderId);
		});
	}
}

async function _doEncryptNoteInVault(noteId,folderId){
	try{
		var ta=getTA();
		if(!ta)return;
		var plaintext=ta.value;
		if(isEncryptedBody(plaintext)){_log('note already encrypted');return}
		var key=await getVaultKey(folderId);
		if(!key){_log('vault key missing');return}
		var salt=getVaultSalt(folderId);
		if(!salt){_log('vault salt missing',folderId);alert('Vault key not available. Unlock the vault and try again.');return}
		_log('_doEncryptNoteInVault encrypt',{noteId:noteId,folderId:folderId,plaintextLen:plaintext.length,keyType:key&&key.type,saltLen:salt&&salt.length});
		var ciphertext=await encryptForVault(plaintext,folderId,key,salt);
		touchVaultActivity(folderId);
		var form=activeEditorForm();
		if(form){
			form.dataset.encrypted='1';
			form.dataset.vaultId=folderId;
			_triggerEncryptedSave(form,ciphertext);
		}
		_updateLockToggle(noteId,true);
		_updateNoteLockIcon(noteId,true);
	}catch(e){
		_log('_doEncryptNoteInVault error',e);
		alert('Encryption failed: '+e.message);
	}
}

// unlockNote: called from the locked editor overlay
async function unlockNote(noteId){
	var passwordInput=document.getElementById('editor-locked-password');
	var errEl=document.getElementById('editor-locked-error');
	var ta=getTA();
	if(!ta)return;
	var form=activeEditorForm();

	// Determine vaultId from the ciphertext
	var vaultId=getBodyVaultId(ta.value)||((form&&form.dataset.vaultId)||null);
	var encryptedBody=isEncryptedBody(ta.value);
	_log('unlockNote start',{noteId:noteId,vaultId:vaultId,encryptedBody:encryptedBody,formVaultId:form&&form.dataset.vaultId||null});

	// Special case: note belongs to a vault but body is still plaintext in storage.
	// Unlock the vault, immediately encrypt+save this note, then keep editing.
	if(vaultId&&!encryptedBody){
		var passwordPlain=(passwordInput?passwordInput.value:'');
		if(!isVaultUnlocked(vaultId)){
			if(!passwordPlain){if(errEl)errEl.textContent='Enter vault password.';return}
			var unlockedPlain=await unlockVault(vaultId,passwordPlain);
			if(!unlockedPlain){if(errEl)errEl.textContent='Wrong password.';if(passwordInput){passwordInput.value='';passwordInput.focus()}return}
		}
		_completeUnlock(noteId,ta.value,vaultId);
		_doEncryptNoteInVault(noteId,vaultId);
		return;
	}

	// Try auto-unlock with cached vault key
	if(vaultId&&isVaultUnlocked(vaultId)){
		try{
			var key=await getVaultKey(vaultId);
			if(key){
				var plaintext=await _decryptWithKey(ta.value,key);
				_completeUnlock(noteId,plaintext,vaultId);
				return;
			}
		}catch(e){_log('auto-unlock failed')}
	}

	// Manual password entered
	var password=(passwordInput?passwordInput.value:'');
	if(!password&&!vaultId){if(errEl)errEl.textContent='Enter a password.';return}
	if(!password&&vaultId){
		// Try opening vault modal
		_showVaultModal(vaultId,'unlock',function(ok){
			if(ok)unlockNote(noteId);
		});
		return;
	}

	// Try to unlock vault with typed password
	if(vaultId){
		try{
			var ok=await unlockVault(vaultId,password);
			if(ok){
				var key=await getVaultKey(vaultId);
				var plaintext=await _decryptWithKey(ta.value,key);
				_completeUnlock(noteId,plaintext,vaultId);
				return;
			}
		}catch(e){}
		// Fall through to v1 compat decrypt attempt
	}

	// v1 compat or orphaned note: try password directly (note has embedded salt)
	try{
		var plaintext=await decryptBody(password,ta.value);
		_completeUnlock(noteId,plaintext,null);
	}catch(e){
		if(errEl)errEl.textContent='Wrong password.';
		if(passwordInput){passwordInput.value='';passwordInput.focus()}
	}
}

// _completeUnlock: shows plaintext in editor. vaultId may be null for v1 notes.
function _completeUnlock(noteId,plaintext,vaultId){
	if(vaultId)touchVaultActivity(vaultId);

	var ta=getTA();
	var lockedDiv=document.getElementById('editor-locked');
	var tb=queryActiveEditor('#editor-toolbar');
	var form=activeEditorForm();

	if(ta){
		ta.dataset.ciphertext=ta.value;
		ta.value=plaintext;
		ta.style.display='';
	}
	if(form){
		if(vaultId){
			form.dataset.encrypted='1';
			form.dataset.vaultId=vaultId;
			form.dataset.vaultUnlocked='1';
		}else{
			// Orphan / v1 note: decrypted with embedded salt, no live vault key.
			// Treat as plaintext so subsequent folder moves don't try to re-encrypt
			// with a vault we have no key for.
			delete form.dataset.encrypted;
			delete form.dataset.vaultId;
			delete form.dataset.vaultUnlocked;
		}
	}

	if(lockedDiv)lockedDiv.style.display='none';
	if(tb)tb.style.display='';

	var mdBtn=document.getElementById('markdown-toggle');
	var pvBtn=document.getElementById('preview-toggle');
	if(mdBtn)mdBtn.style.display='';
	if(pvBtn)pvBtn.style.display='';

	// Open in the user's preferred mode — setEditorMode handles CM6 mount / TinyMCE setContent.
	setEditorMode(_defaultNoteOpenMode==='markdown'?'markdown':'rich');
	snapshotHash();

	_updateLockToggle(noteId,true);
	_updateNoteLockIcon(noteId,true);
	if(vaultId)_refreshVaultIcon(vaultId,true);
	snapshotHash();
}

// toggleNoteLock: single button in titlebar
function toggleNoteLock(noteId){
	var form=activeEditorForm();
	var isEnc=form&&form.dataset.encrypted==='1';
	var vaultId=form&&form.dataset.vaultId;
	if(isEnc&&vaultId&&isVaultUnlocked(vaultId)){
		// Vault is unlocked, note is open → lock the vault
		toggleVaultLock(vaultId);
	}else if(isEnc&&(!vaultId||!isVaultUnlocked(vaultId))){
		// Encrypted note, vault locked → unlock
		unlockNote(noteId);
	}else{
		// Not encrypted → lock it (encrypt into current folder's vault)
		lockNote(noteId);
	}
}

function _updateLockToggle(noteId,unlocked){
	var btn=document.getElementById('lock-toggle-btn');
	if(!btn)return;
	btn.innerHTML=unlocked?SVG_LOCK_OPEN:SVG_LOCK_CLOSED;
	btn.title=unlocked?'Lock vault':'Unlock vault';
}

function _updateNoteLockIcon(noteId,unlocked){
	document.querySelectorAll('.note-lock-icon[data-note-id="'+noteId+'"]').forEach(function(el){
		el.innerHTML=unlocked?SVG_LOCK_OPEN:SVG_LOCK_CLOSED;
		el.classList.toggle('note-lock-unlocked',unlocked);
	});
}

// --- Autosave interceptor for encrypted notes ---
document.body.addEventListener('htmx:configRequest',function(e){
	// no-op: encryption is handled in scheduleSave override
});

var _origScheduleSave=scheduleSave;
function _setOneShotEncryptedBody(form,ciphertext){
	if(!form)return function(){};
	var ta=form.querySelector('textarea[name="body"], textarea.editor-body');
	if(!ta)return function(){};
	var originalName=ta.getAttribute('name');
	var hidden=document.createElement('input');
	hidden.type='hidden';
	hidden.name='body';
	hidden.value=ciphertext;
	hidden.setAttribute('data-joplock-temp-body','1');
	// Prevent duplicate body fields during htmx form serialization.
	ta.removeAttribute('name');
	form.appendChild(hidden);
	return function(){
		if(originalName!==null)ta.setAttribute('name',originalName);else ta.removeAttribute('name');
		if(hidden.parentNode)hidden.parentNode.removeChild(hidden);
	};
}

// Mutex guarding #note-body's temporary name-swap (_setOneShotEncryptedBody):
// the debounced autosave (_triggerEncryptedSave) and the forced flush
// (flushSave/buildFlushRequest) both rename-then-restore the SAME textarea
// while encrypting. If both ran concurrently, one's restore() could be
// skipped/duplicated and name="body" could be left stripped permanently —
// formHash() only hashes named elements, so body edits would then be
// invisible to it forever ("hash unchanged" on every keystroke, note stuck
// on "Edited", edit silently never saved). These flags let each side wait
// for the other instead of racing it on the same element.
var _encryptedAutosaveInFlight=null; // Promise<boolean> while _triggerEncryptedSave owns the swap
var _flushSaveInFlight=null; // Promise<boolean> while flushSave owns the swap

function _triggerEncryptedSave(form,ciphertext){
	if(!form)return;
	// Cancel any pending plaintext autosave (e.g. from the change event that
	// just triggered this encrypted save). Otherwise that timer would fire 2s
	// later with name="body" back on the textarea (plaintext) and the server
	// would reject the move with "Vault notes must be saved encrypted".
	if(typeof _saveTimer!=='undefined'&&_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}
	if(typeof _saveTitleTimer!=='undefined'&&_saveTitleTimer){clearTimeout(_saveTitleTimer);_saveTitleTimer=null}
	var restore=_setOneShotEncryptedBody(form,ciphertext);
	var done=false;
	var cleanupTimer=null;
	var resolveInFlight=function(){};
	_encryptedAutosaveInFlight=new Promise(function(res){resolveInFlight=res});
	var cleanup=function(success){
		if(done)return;
		done=true;
		if(cleanupTimer)clearTimeout(cleanupTimer);
		form.removeEventListener('htmx:afterRequest',onDone);
		form.removeEventListener('htmx:responseError',onDone);
		form.removeEventListener('htmx:sendError',onDone);
		restore();
		// Re-snapshot the form hash after the textarea regains its name attr,
		// so a subsequent debounced scheduleSave compares apples to apples.
		if(success)snapshotHash();
		_encryptedAutosaveInFlight=null;
		resolveInFlight(success);
	};
	var onDone=function(e){
		if(e.target!==form)return;
		var ok=e.type==='htmx:afterRequest'&&e.detail&&e.detail.successful;
		setTimeout(function(){cleanup(ok)},0);
	};
	form.addEventListener('htmx:afterRequest',onDone);
	form.addEventListener('htmx:responseError',onDone);
	form.addEventListener('htmx:sendError',onDone);
	cleanupTimer=setTimeout(function(){cleanup(false)},30000);
	htmx.trigger(form,'joplock:save');
}

function buildFlushRequest(form){
	if(!form)return Promise.resolve(null);
	var url=form.getAttribute('hx-put');
	if(!url)return Promise.resolve(null);
	var pv=getPV();
	if(pv)syncPV();else if(_editorMode!=='markdown'&&_editorMode!=='md')tinyMCESyncToTA();
	syncTitle();
	var ta=getTA();
	if(form.dataset.encrypted==='1'&&form.dataset.vaultId&&ta&&!isEncryptedBody(ta.value)){
		return getVaultKey(form.dataset.vaultId).then(function(key){
			if(!key)throw new Error('Vault is locked');
			var salt=getVaultSalt(form.dataset.vaultId);
			return encryptForVault(ta.value,form.dataset.vaultId,key,salt).then(function(ciphertext){
				var restore=_setOneShotEncryptedBody(form,ciphertext);
				var fd=new FormData(form);
				var body=new URLSearchParams(fd).toString();
				return { url:url, body:body, restore:restore };
			});
		});
	}
	var fd=new FormData(form);
	var body=new URLSearchParams(fd).toString();
	return Promise.resolve({ url:url, body:body, restore:function(){} });
}

scheduleSave=function(){
	var form=activeEditorForm();
	if(!form||form.dataset.encrypted!=='1'){_origScheduleSave();return}
	var noteId=form.dataset.noteId;
	var vaultId=form.dataset.vaultId;
	if(!noteId){_origScheduleSave();return}
	// If not a vault note, pass through
	if(!vaultId){_origScheduleSave();return}

	if(_saveTimer)clearTimeout(_saveTimer);
	_saveTimer=setTimeout(async function(){
		_saveTimer=null;
		if(_syncPVInFlight||_pvSyncTimer){scheduleSave();return}
		if(_anyModalOpen()){scheduleSave();return}
		// A forced flushSave() (e.g. navigating to another note) already owns
		// the textarea's temporary name-swap — don't race it with a second
		// encrypt+swap on the same element. Re-check once it's done.
		if(_flushSaveInFlight){_log('encrypted scheduleSave deferred, flush in flight');scheduleSave();return}
		if(!form)return;
		var h=formHash(form);
		if(h===_savedHash){_log('encrypted scheduleSave skip, hash unchanged',h);return}

		var ta=getTA();
		if(!ta)return;
		var plaintext=ta.value;
		_log('encrypted save begin',vaultId,{noteId:noteId,plaintextLength:plaintext.length,alreadyEncrypted:isEncryptedBody(plaintext)});

		// Skip if somehow the textarea already holds ciphertext
		if(isEncryptedBody(plaintext)){_origScheduleSave();return}

		try{
			var key=await getVaultKey(vaultId);
			if(!key){_log('vault key gone during save for vault',vaultId);return}
			var salt=getVaultSalt(vaultId);
			var ciphertext=await encryptForVault(plaintext,vaultId,key,salt);
			_log('encrypted save ciphertext ready',vaultId,{noteId:noteId,ciphertextLength:ciphertext.length,hasMarker:isEncryptedBody(ciphertext)});
			_triggerEncryptedSave(form,ciphertext);
			touchVaultActivity(vaultId);
		}catch(e){
			_log('encrypted save error',e);
			setSaveState('<span class="autosave-error">Encrypt error</span>','Error');
		}
	},2000);
};

// Auto-unlock on editor init if vault key is cached
var _origInitEditorPanel=initEditorPanel;
initEditorPanel=function(){
	_origInitEditorPanel();
	var form=activeEditorForm();
	if(!form){_log('initEditorPanel vault-check: no active form');return}
	if(form.dataset.vaultChecked){return}
	form.dataset.vaultChecked='1';
	_log('initEditorPanel vault-check start',{noteId:form.dataset.noteId||null,encryptedFlag:form.dataset.encrypted||null,formVaultId:form.dataset.vaultId||null});
	if(form.dataset.encrypted!=='1'){_log('initEditorPanel vault-check skip: form not encrypted');return}
	var noteId=form.dataset.noteId;
	if(!noteId){_log('initEditorPanel vault-check skip: no noteId');return}

	var ta=getTA();
	if(!ta){_log('initEditorPanel vault-check skip: no textarea');return}
	var initialVaultId=form.dataset.vaultId||null;
	var encryptedBody=isEncryptedBody(ta.value);
	var editorUnlocked=form.dataset.vaultUnlocked==='1';
	if(!encryptedBody){
		_log('initEditorPanel vault plaintext-in-vault state',{noteId:noteId,vaultId:initialVaultId,editorUnlocked:editorUnlocked,bodyPreview:ta.value.slice(0,80)});
		if(editorUnlocked){
			_log('initEditorPanel vault plaintext-in-vault skip: already unlocked in editor',{noteId:noteId,vaultId:initialVaultId});
			return;
		}
		// Vault-bound note with plaintext body. Keep it hidden while locked; if the vault
		// is already unlocked, immediately encrypt+save and then reveal normally.
		if(initialVaultId&&isVaultUnlocked(initialVaultId)){
			_log('initEditorPanel vault plaintext-in-vault auto-encrypt', {noteId:noteId,vaultId:initialVaultId});
			_completeUnlock(noteId,ta.value,initialVaultId);
			_doEncryptNoteInVault(noteId,initialVaultId);
		}else{
			var lockedDiv=document.getElementById('editor-locked');
			var host=queryActiveEditor('#cm-host');
			var pv=queryActiveEditor('#note-preview');
			var tb=queryActiveEditor('#editor-toolbar');
			var mdBtn=document.getElementById('markdown-toggle');
			var pvBtn=document.getElementById('preview-toggle');
			if(lockedDiv)lockedDiv.style.display='';
			if(tb)tb.style.display='none';
			if(host)host.style.display='none';
			if(pv)pv.style.display='none';
			if(ta)ta.style.display='none';
			if(mdBtn)mdBtn.style.display='none';
			if(pvBtn)pvBtn.style.display='none';
			var pwField=document.getElementById('editor-locked-password');
			if(pwField){
				_log('initEditorPanel prompting for vault password (plaintext note in vault)',{noteId:noteId,vaultId:initialVaultId});
				pwField.focus();
				pwField.addEventListener('keydown',function(e){
					if(e.key==='Enter'){e.preventDefault();_showVaultModal(initialVaultId,'unlock',function(ok){if(ok)window.location.reload()})}
				});
			}
		}
		return;
	}

	// Determine vault from ciphertext
	var vaultId=getBodyVaultId(ta.value);
	_log('initEditorPanel encrypted note detected',{noteId:noteId,vaultId:vaultId,bodyLength:ta.value.length});

	// Store vaultId on form for autosave
	if(vaultId&&form)form.dataset.vaultId=vaultId;

	// Try auto-unlock with cached vault key
	var unlocked=vaultId&&isVaultUnlocked(vaultId);
	_log('initEditorPanel auto-unlock decision',{noteId:noteId,vaultId:vaultId,unlocked:!!unlocked});
	if(unlocked){
		getVaultKey(vaultId).then(function(key){
			_log('initEditorPanel cached key lookup',{noteId:noteId,vaultId:vaultId,hasKey:!!key});
			if(!key)return;
			return _decryptWithKey(ta.value,key).then(function(pt){_completeUnlock(noteId,pt,vaultId)});
		}).catch(function(){
			_log('auto-unlock failed for vault',vaultId);
			var pwField=document.getElementById('editor-locked-password');
			if(pwField)pwField.focus();
		});
		return;
	}

	// Focus password field and handle Enter key
	var pwField=document.getElementById('editor-locked-password');
	if(pwField){
		_log('initEditorPanel prompting for vault password',{noteId:noteId,vaultId:vaultId});
		pwField.focus();
		pwField.addEventListener('keydown',function(e){
			if(e.key==='Enter'){e.preventDefault();unlockNote(noteId)}
		});
	}
};

// Move note: encrypt/decrypt when folder changes
// Called when user changes folder via the editor folder select
(function(){
	document.body.addEventListener('change',function(e){
		var select=e.target;
		if(!select||select.id!=='editor-folder-select')return;
		var form=activeEditorForm();
		if(!form)return;
		var noteId=form.dataset.noteId;
		var ta=getTA();
		if(!ta||!noteId)return;

		var newFolderId=select.value;
		var oldVaultId=form.dataset.vaultId||null;
		var isEnc=form.dataset.encrypted==='1';

		// Determine if destination is a vault (check nav DOM for vault icon)
		var newFolderIsVault=!!document.querySelector('.vault-folder-lock[data-folder-id="'+newFolderId+'"]');

		if(!isEnc&&!newFolderIsVault)return; // plain note to plain folder, nothing to do

		// Helper: only show the unlock modal if the vault is not already unlocked
		var _ensureUnlocked=function(vaultId,cb){
			if(isVaultUnlocked(vaultId)){cb(true);return}
			_showVaultModal(vaultId,'unlock',cb);
		};

		if(isEnc&&!newFolderIsVault){
			// Moving encrypted note out of vault → save as plaintext.
			// ta.value is already plaintext (note is open and unlocked in editor).
			if(typeof _saveTimer!=='undefined'&&_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}
			delete form.dataset.encrypted;
			delete form.dataset.vaultId;
			delete form.dataset.vaultUnlocked;
			_updateLockToggle(noteId,false);
			_updateNoteLockIcon(noteId,false);
			htmx.trigger(form,'joplock:save');
		}else if(!isEnc&&newFolderIsVault){
			// Moving plain note into vault → encrypt it
			select.value=form.dataset.vaultId||'';
			_ensureUnlocked(newFolderId,function(ok){
				if(!ok)return;
				select.value=newFolderId;
				_doEncryptNoteInVault(noteId,newFolderId);
			});
		}else if(isEnc&&newFolderIsVault&&oldVaultId!==newFolderId){
			// Moving between vaults → re-encrypt with new vault key.
			// ta.value is plaintext (note is open and unlocked); old vault key
			// is irrelevant for the body content. We just need the new vault
			// unlocked so we can encrypt with its key.
			select.value=oldVaultId;
			_ensureUnlocked(newFolderId,function(ok){
				if(!ok)return;
				select.value=newFolderId;
				if(typeof _saveTimer!=='undefined'&&_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}
				getVaultKey(newFolderId).then(function(newKey){
					if(!newKey){_log('new vault key missing',newFolderId);return}
					var salt=getVaultSalt(newFolderId);
					if(!salt){_log('new vault salt missing',newFolderId);return}
					return encryptForVault(ta.value,newFolderId,newKey,salt).then(function(ct){
						form.dataset.vaultId=newFolderId;
						form.dataset.encrypted='1';
						_triggerEncryptedSave(form,ct);
					});
				}).catch(function(e){_log('re-encrypt failed',e);alert('Re-encryption failed: '+e.message)});
			});
		}
	});
})();

// v1 migration: scan for v1 encrypted notes, offer to migrate to a vault
// Called after first vault is created
async function migrateV1Notes(newVaultFolderId){
	try{
		var resp=await fetch('/api/web/notes',{method:'GET'});
		if(!resp.ok)return;
		var data=await resp.json();
		var notes=(data.items||[]).filter(function(n){return n.isEncrypted});
		if(!notes.length)return;
		// Check if any are v1 (no vault field)
		// We can't tell without fetching each note body. Check first few.
		var v1candidates=[];
		for(var i=0;i<Math.min(notes.length,50);i++){
			var nr=await fetch('/api/web/notes/'+encodeURIComponent(notes[i].id));
			if(!nr.ok)continue;
			var nd=await nr.json();
			var body=(nd.item||{}).body||'';
			var json=extractCiphertext(body);
			if(!json)continue;
			try{var obj=JSON.parse(json);if(!obj.vault)v1candidates.push({id:notes[i].id,body:body})}catch(e){}
		}
		if(!v1candidates.length)return;
		var oldPw=prompt('Found '+v1candidates.length+' note(s) encrypted with your old password.\nEnter that password to migrate them to your new vault (or Cancel to skip):');
		if(!oldPw)return;
		var key=await getVaultKey(newVaultFolderId);
		var salt=getVaultSalt(newVaultFolderId);
		if(!key||!salt)return;
		var migrated=0;
		for(var j=0;j<v1candidates.length;j++){
			try{
				var pt=await decryptBody(oldPw,v1candidates[j].body);
				var newCt=await encryptForVault(pt,newVaultFolderId,key,salt);
				await fetch('/api/web/notes/'+encodeURIComponent(v1candidates[j].id),{
					method:'PUT',
					headers:{'Content-Type':'application/json'},
					body:JSON.stringify({body:newCt})
				});
				migrated++;
			}catch(e){_log('migrate v1 note failed',v1candidates[j].id,e)}
		}
		if(migrated>0)alert('Migrated '+migrated+' note(s) to your new vault.');
	}catch(e){_log('migrateV1Notes error',e)}
}

// Create vault flow: called from folder creation modal (new vault checkbox)
async function submitNewVaultFolder(event){
	if(event)event.preventDefault();
	var modal=document.getElementById('new-folder-modal');
	var origin=modal&&modal.dataset?modal.dataset.origin:'';
	var titleInput=document.getElementById('new-folder-title');
	var pwInput=document.getElementById('new-vault-password');
	var confirmInput=document.getElementById('new-vault-confirm');
	var errEl=document.getElementById('new-vault-error');
	var title=(titleInput?titleInput.value:'').trim();
	var password=(pwInput?pwInput.value:'').trim();
	var confirmVal=(confirmInput?confirmInput.value:'').trim();

	if(!title){if(errEl)errEl.textContent='Notebook name is required.';return}
	if(!password){if(errEl)errEl.textContent='Vault password is required.';return}
	if(password!==confirmVal){if(errEl)errEl.textContent='Passwords do not match.';return}
	if(password.length<4){if(errEl)errEl.textContent='Password too short (minimum 4 characters).';return}
	if(errEl)errEl.textContent='';

	try{
		// Create folder via API
		var folderResp=await fetch('/api/web/folders',{
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({title:title})
		});
		if(!folderResp.ok){var ferr=await folderResp.json().catch(function(){return{}});throw new Error(ferr.error||'Failed to create notebook')}
		var folderData=await folderResp.json();
		var folderId=(folderData.item||{}).id;
		if(!folderId)throw new Error('No notebook id returned');

		// Create vault
		await createVault(folderId,password);

		// Check for v1 notes to migrate
		migrateV1Notes(folderId);

		// Close modal and refresh relevant notebook list
		closeNewFolderModal();
		refreshAfterFolderCreate(origin);
	}catch(e){
		if(errEl)errEl.textContent='Error: '+(e.message||e);
	}
}

function closeNewFolderModal(){
	var modal=document.getElementById('new-folder-modal');
	var backdrop=document.getElementById('new-folder-modal-backdrop');
	if(modal)modal.hidden=true;
	if(backdrop)backdrop.hidden=true;
	if(modal)delete modal.dataset.origin;
}

function openNewFolderModal(origin){
	var modal=document.getElementById('new-folder-modal');
	var backdrop=document.getElementById('new-folder-modal-backdrop');
	var titleInput=document.getElementById('new-folder-title');
	var errEl=document.getElementById('new-vault-error');
	var isVaultCheck=document.getElementById('new-folder-is-vault');
	var vaultFields=document.getElementById('new-vault-fields');
	var pwInput=document.getElementById('new-vault-password');
	var confirmInput=document.getElementById('new-vault-confirm');
	if(titleInput)titleInput.value='';
	if(errEl)errEl.textContent='';
	if(isVaultCheck)isVaultCheck.checked=false;
	if(vaultFields)vaultFields.style.display='none';
	if(pwInput)pwInput.value='';
	if(confirmInput)confirmInput.value='';
	if(modal){
		if(origin)modal.dataset.origin=origin;
		else delete modal.dataset.origin;
	}
	if(modal)modal.hidden=false;
	if(backdrop)backdrop.hidden=false;
	if(titleInput)titleInput.focus();
}

function refreshAfterFolderCreate(origin){
	if(origin==='mobile'){
		var body=document.getElementById('mobile-folders-body');
		if(body)htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
		return;
	}
	htmx.ajax('GET','/fragments/nav',{target:'#nav-panel',swap:'innerHTML'});
}

function toggleNewFolderVault(checked){
	var fields=document.getElementById('new-vault-fields');
	if(fields)fields.style.display=checked?'':'none';
}

async function submitNewFolderModal(event){
	if(event)event.preventDefault();
	var isVaultCheck=document.getElementById('new-folder-is-vault');
	var modal=document.getElementById('new-folder-modal');
	var origin=modal&&modal.dataset?modal.dataset.origin:'';
	if(isVaultCheck&&isVaultCheck.checked){
		await submitNewVaultFolder(event);
	}else{
		// Regular folder creation
		var titleInput=document.getElementById('new-folder-title');
		var errEl=document.getElementById('new-vault-error');
		var title=(titleInput?titleInput.value:'').trim();
		if(!title){if(errEl)errEl.textContent='Notebook name is required.';return}
		htmx.ajax('POST','/fragments/folders',{target:origin==='mobile'?'#mobile-folders-body':'#nav-panel',swap:'none',values:{title:title}}).then(function(){
			refreshAfterFolderCreate(origin);
		});
		closeNewFolderModal();
	}
}

// Expose functions needed by inline hx-on/onclick handlers (called from global scope by htmx eval)
	window.isMobileShellMode=isMobileShellMode;
	window.closeNav=closeNav;
	window.toggleNav=toggleNav;
	window.toggleNavFolder=toggleNavFolder;
	window.openNavFolderAndFirstNote=openNavFolderAndFirstNote;
	window.openFolderContextMenu=openFolderContextMenu;
	window.editFolderFromMenu=editFolderFromMenu;
	window.deleteFolderFromMenu=deleteFolderFromMenu;
	window.closeFolderModal=closeFolderModal;
	window.submitFolderEdit=submitFolderEdit;
	window.openEmptyTrashModal=openEmptyTrashModal;
	window.closeEmptyTrashModal=closeEmptyTrashModal;
	window.submitEmptyTrash=submitEmptyTrash;
window.closeLinkModal=closeLinkModal;
window.submitLink=submitLink;
window.closeHistoryModal=closeHistoryModal;
window.openHistoryModal=openHistoryModal;
window.selectHistorySnapshot=selectHistorySnapshot;
window.restoreHistorySnapshot=restoreHistorySnapshot;
window.setEditorMode=setEditorMode;
window.tinyMCEFormat=tinyMCEFormat;
window.tinyMCEFormatBlock=tinyMCEFormatBlock;
window.tinyMCEInsertCheckbox=tinyMCEInsertCheckbox;
window.tinyMCEInsertDate=tinyMCEInsertDate;
window.tinyMCEInsertDateTime=tinyMCEInsertDateTime;
window.tinyMCEInsertLink=tinyMCEInsertLink;
window.tinyMCEInsertImage=tinyMCEInsertImage;
window.wrapSel=wrapSel;
window.insertPfx=insertPfx;
window.insertTxt=insertTxt;
window.insertStamp=insertStamp;
window.clearFormat=clearFormat;
window.insertLink=insertLink;
window.insertImg=insertImg;
window.openFilePicker=openFilePicker;
window.handleFilePicker=handleFilePicker;
window.uploadFiles=uploadFiles;
window.uploadFile=uploadFile;
window.openCodeModal=openCodeModal;
window.closeCodeModal=closeCodeModal;
window.submitCode=submitCode;
window.handleDrop=handleDrop;
window.openUploadModal=openUploadModal;
window.closeUploadModal=closeUploadModal;
window.handleUploadModalFiles=handleUploadModalFiles;
window.insertUploadedFiles=insertUploadedFiles;
window.deleteUploadedResource=deleteUploadedResource;
window.undoSnapshot=undoSnapshot;
window.searchNavStep=searchNavStep;
window.searchNavDismiss=searchNavDismiss;
window.dismissRemoteUpdateBanner=dismissRemoteUpdateBanner;
window.reloadCurrentNoteFromServer=reloadCurrentNoteFromServer;
window.overwriteWithLocalEdits=overwriteWithLocalEdits;
window.syncPV=syncPV;
window.getPV=getPV;
window.setTheme=setTheme;
window.confirmLogout=confirmLogout;
window.lockNote=lockNote;
window.unlockNote=unlockNote;
window.toggleNoteLock=toggleNoteLock;
window.toggleVaultLock=toggleVaultLock;
window.refreshAllVaultIcons=refreshAllVaultIcons;
window.isVaultUnlocked=isVaultUnlocked;
window.submitVaultModal=submitVaultModal;
window.closeVaultModal=closeVaultModal;
window.openNewFolderModal=openNewFolderModal;
window.closeNewFolderModal=closeNewFolderModal;
window.toggleNewFolderVault=toggleNewFolderVault;
window.submitNewFolderModal=submitNewFolderModal;
window.isEncryptedBody=isEncryptedBody;
window.mobileSyncTitle=mobileSyncTitle;
window.mobileSyncTitleAndSave=mobileSyncTitleAndSave;
window.mobileTitleInput=function(){_titleManual=true}; // called oninput on #mobile-editor-title
window.toggleExportMenu=toggleExportMenu;
window.closeExportMenu=closeExportMenu;
window.exportNoteAsMarkdown=exportNoteAsMarkdown;
window.exportNoteAsHtml=exportNoteAsHtml;
window.exportNoteAsDocx=exportNoteAsDocx;
window.exportNoteAsPdf=exportNoteAsPdf;
})(); // end main IIFE
