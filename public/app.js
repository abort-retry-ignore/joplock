/* joplock client application — extracted from templates.js */
/* Server config is passed via window._joplockConfig set inline before this script loads */
(function(){
var _cfg=window._joplockConfig||{};
var _dbg=_cfg.debug||false;
function _log(){if(!_dbg)return;var a=Array.prototype.slice.call(arguments);a.unshift('[joplock]');console.log.apply(console,a)}
if('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(function(){});
// If the browser restores this page from bfcache, force a reload so the server can validate the session
window.addEventListener('pageshow',function(e){if(e.persisted){_log('bfcache restore detected, reloading');window.location.reload()}});
function syncThemeColor(){var meta=document.querySelector('meta[name="theme-color"]');if(!meta)return;var color=getComputedStyle(document.body).getPropertyValue('--theme-color').trim();if(color)meta.setAttribute('content',color)}
function setTheme(t){document.body.classList.forEach(function(c){if(c.startsWith('theme-'))document.body.classList.remove(c)});document.body.classList.add('theme-'+t);syncThemeColor();localStorage.setItem('joplock-theme',t);fetch('/api/web/theme',{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'theme='+encodeURIComponent(t)}).catch(function(){})}

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

function _b64Encode(buf){return btoa(String.fromCharCode.apply(null,new Uint8Array(buf)))}
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
var _mobileStartup=_cfg.mobileStartup||null;
var _uiMode=_cfg.uiMode||'auto';
var _mobileShellMaxWidth=768;
function viewportWidth(){return Math.max(window.innerWidth||0,document.documentElement&&document.documentElement.clientWidth||0)}
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
function renderNoteMeta(){var src=document.getElementById('note-meta');var mobileBody=document.getElementById('mobile-editor-body');if(isMobileShellMode()&&mobileBody){src=mobileBody.querySelector('#note-meta')||src}var target;if(isMobileShellMode()){target=src}else{target=document.getElementById('status-note-meta');if(src&&target){target.setAttribute('data-created-time',src.getAttribute('data-created-time')||'0');target.setAttribute('data-updated-time',src.getAttribute('data-updated-time')||'0')}}if(!target)return;var c=Number(target.getAttribute('data-created-time')||0),u=Number(target.getAttribute('data-updated-time')||0);if(!c&&!u){target.textContent='';return}var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var fmt=function(ts){if(!ts)return '';var d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'-'+months[d.getMonth()]+'-'+String(d.getFullYear()).slice(-2)};target.textContent='Created '+fmt(c)+' | Edited '+fmt(u)}
var _folderMenuState={id:'',title:''};
function closeFolderContextMenu(){var menu=document.getElementById('folder-context-menu');if(menu)menu.hidden=true}
function openFolderContextMenu(event,id,title){if(event){event.preventDefault();event.stopPropagation()}var menu=document.getElementById('folder-context-menu');if(!menu)return false;_folderMenuState={id:id,title:title};menu.hidden=false;menu.style.left=(event.clientX||16)+'px';menu.style.top=(event.clientY||16)+'px';return false}
function closeFolderModal(){var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
function openFolderModal(){var input=document.getElementById('folder-edit-title');var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(modal&&modal.parentNode!==document.body)document.body.appendChild(modal);if(backdrop&&backdrop.parentNode!==document.body)document.body.appendChild(backdrop);if(input)input.value=_folderMenuState.title||'';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;closeFolderContextMenu();if(input)input.focus()}
function editFolderFromMenu(){if(!_folderMenuState.id)return;openFolderModal()}
function deleteFolderFromMenu(){if(!_folderMenuState.id)return;closeFolderContextMenu();if(confirm('Delete notebook "'+(_folderMenuState.title||'Untitled')+'"?')){htmx.ajax('DELETE','/fragments/folders/'+encodeURIComponent(_folderMenuState.id),{target:'#nav-panel',swap:'innerHTML'})}}
function submitFolderEdit(event){if(event)event.preventDefault();var input=document.getElementById('folder-edit-title');var title=input?input.value.trim():'';if(!_folderMenuState.id||!title)return false;var folderId=_folderMenuState.id;closeFolderModal();if(window.isMobileShellMode&&window.isMobileShellMode()){fetch('/fragments/folders/'+encodeURIComponent(folderId),{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded','hx-request':'true'},body:'title='+encodeURIComponent(title)}).then(function(){htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});var notesTitle=document.getElementById('mobile-notes-title');if(notesTitle&&notesTitle.textContent===_folderMenuState.title)notesTitle.textContent=title})}else{htmx.ajax('PUT','/fragments/folders/'+encodeURIComponent(folderId),{target:'#nav-panel',swap:'innerHTML',values:{title:title}})}return false}
function navFolderState(){try{return JSON.parse(localStorage.getItem('joplock-nav-folders')||'{}')}catch(e){return {}}}
function saveNavFolderState(s){localStorage.setItem('joplock-nav-folders',JSON.stringify(s))}
function toggleNavFolder(id,force){
	var el=document.querySelector('.nav-folder[data-folder-id="'+id.replace(/"/g,'\\"')+'"]');
	if(!el)return;
	var collapsed=force===undefined?!el.classList.contains('collapsed'):!force;
	el.classList.toggle('collapsed',collapsed);
	var s=navFolderState();s[id]=collapsed?'0':'1';saveNavFolderState(s);
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
function getTA(){return queryActiveEditor('#note-body')}
function getPV(){var pv=queryActiveEditor('#note-preview');return pv&&pv.style.display!=='none'?pv:null}
function isMarkdownVisible(){var host=queryActiveEditor('#cm-host');return !!(host&&host.style.display!=='none')}
function inMobileEditor(){var form=activeEditorForm();return !!(form&&form.closest&&form.closest('#mobile-editor-body'))}
var _cmView=null;
function getCM(){return _cmView}
function cmVal(){return _cmView?_cmView.state.doc.toString():''}
function cmSetVal(v){if(!_cmView)return;_cmView.dispatch({changes:{from:0,to:_cmView.state.doc.length,insert:v}})}
function cmSyncToTA(){var ta=getTA();if(ta&&_cmView)ta.value=cmVal()}
function initCM(host,content){
	if(_cmView){_cmView.destroy();_cmView=null}
	var C=window.CM;
	var joplockTheme=C.EditorView.theme({
		'&':{height:'100%',fontSize:'14px'},
		'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Mono",monospace',lineHeight:'1.65'},
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
		{tag:C.tags.url,color:'var(--accent)'},
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
		if(upd.docChanged){cmSyncToTA();var ta=getTA();if(ta)ta.dispatchEvent(new Event('input',{bubbles:true}))}
	});
	_cmView=new C.EditorView({
		state:C.EditorState.create({
			doc:content||'',
				extensions:[
					C.markdown({base:C.markdownLanguage,codeLanguages:[
				C.LanguageDescription.of({name:'javascript',alias:['js','jsx'],load:function(){return Promise.resolve(C.javascript({jsx:true}))}}),
				C.LanguageDescription.of({name:'typescript',alias:['ts','tsx'],load:function(){return Promise.resolve(C.javascript({typescript:true,jsx:true}))}}),
				C.LanguageDescription.of({name:'html',load:function(){return Promise.resolve(C.html())}}),
				C.LanguageDescription.of({name:'css',load:function(){return Promise.resolve(C.css())}}),
				C.LanguageDescription.of({name:'json',load:function(){return Promise.resolve(C.json())}}),
				C.LanguageDescription.of({name:'sql',load:function(){return Promise.resolve(C.sql())}}),
				C.LanguageDescription.of({name:'python',alias:['py'],load:function(){return Promise.resolve(C.python())}}),
				C.LanguageDescription.of({name:'xml',load:function(){return Promise.resolve(C.xml())}}),
				C.LanguageDescription.of({name:'go',alias:['golang'],load:function(){return Promise.resolve(C.go())}}),
				C.LanguageDescription.of({name:'c++',alias:['cpp','c'],load:function(){return Promise.resolve(C.cpp())}}),
				C.LanguageDescription.of({name:'yaml',alias:['yml','dockerfile','docker-compose'],load:function(){return Promise.resolve(C.yaml())}}),
				C.LanguageDescription.of({name:'shell',alias:['bash','sh','zsh'],load:function(){return Promise.resolve(C.StreamLanguage.define(C.shell))}})
			]}),
				C.syntaxHighlighting(joplockHighlight),
				C.syntaxHighlighting(C.defaultHighlightStyle,{fallback:true}),
				joplockTheme,
				C.drawSelection(),
				C.highlightActiveLine(),
				C.bracketMatching(),
					C.highlightSelectionMatches(),
					C.history(),
					C.keymap.of([...C.defaultKeymap,...C.historyKeymap,...C.searchKeymap.filter(function(b){var k=b.key||'';return k!=='Mod-f'&&k!=='F3'&&k!=='Mod-g'}),C.indentWithTab]),
					C.placeholder('Start writing...'),
					onUpdate,
					C.EditorView.lineWrapping
			]
		}),
		parent:host
	});
}
var _editorMode='markdown';
function syncEditorModeButtons(){var previewVisible=!!getPV();var markdownVisible=isMarkdownVisible();var mode=previewVisible?'preview':'markdown';_editorMode=mode;var mdBtn=document.getElementById('markdown-toggle');var pvBtn=document.getElementById('preview-toggle');if(mdBtn)mdBtn.classList.toggle('active',mode==='markdown');if(pvBtn)pvBtn.classList.toggle('active',mode==='preview');var mMd=document.getElementById('mobile-md-toggle');var mPv=document.getElementById('mobile-preview-toggle');if(mMd)mMd.classList.toggle('active',mode==='markdown');if(mPv)mPv.classList.toggle('active',mode==='preview');var tb=document.getElementById('editor-toolbar');var form=activeEditorForm();if(tb&&inMobileEditor()&&!(form&&form.dataset.encrypted==='1'))tb.style.display='flex';document.body.classList.toggle('mobile-markdown-mode',inMobileEditor()&&mode==='markdown')}
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
function stripMdForTitle(s){var t=String(s||'').trim().replace(/<[^>]+>/g,' ');while(t.charAt(0)==='#')t=t.slice(1).trimStart();t=t.split('**').join('').split('__').join('').split('++').join('').split('*').join('').split('_').join('').split('~~').join('').split(String.fromCharCode(96)).join('');var out='';for(var i=0;i<t.length;i++){var ch=t.charAt(i);if(ch==='!'&&t.charAt(i+1)==='['){var altEnd=t.indexOf(']',i+2);var imgOpen=altEnd>=0?t.indexOf('(',altEnd+1):-1;var imgClose=imgOpen>=0?t.indexOf(')',imgOpen+1):-1;if(altEnd>=0&&imgOpen===altEnd+1&&imgClose>=0){out+=t.slice(i+2,altEnd);i=imgClose;continue}}if(ch==='['){var labelEnd=t.indexOf(']',i+1);var linkOpen=labelEnd>=0?t.indexOf('(',labelEnd+1):-1;var linkClose=linkOpen>=0?t.indexOf(')',linkOpen+1):-1;if(labelEnd>=0&&linkOpen===labelEnd+1&&linkClose>=0){out+=t.slice(i+1,labelEnd);i=linkClose;continue}}out+=ch}return out.trim()}
function syncTitleToHidden(opts){opts=opts||{};var ti=queryActiveEditor('.editor-title');var hi=queryActiveEditor('.editor-title-hidden');var mobileTitle=document.getElementById('mobile-editor-title');if(!hi)return '';var raw=ti?ti.textContent:'';var plain=stripMdForTitle(raw);if(ti&&plain!==raw.trim())ti.textContent=plain;hi.value=plain;if(mobileTitle&&document.activeElement!==mobileTitle&&mobileTitle.textContent!==plain)mobileTitle.textContent=plain||'Note';if(!opts.silent){markEdited();scheduleSaveTitle()}return plain}
function syncTitle(){syncTitleToHidden()}
function mobileSyncTitle(){var mobileTitle=document.getElementById('mobile-editor-title');if(!mobileTitle)return;var plain=stripMdForTitle(mobileTitle.textContent);var hi=queryActiveEditor('.editor-title-hidden');var ti=queryActiveEditor('.editor-title');if(hi)hi.value=plain;if(ti)ti.textContent=plain;_titleManual=true;markEdited()}
function mobileSyncTitleAndSave(){mobileSyncTitle();scheduleSaveTitle()}
function initAutoTitle(){_titleManual=false;var ti=queryActiveEditor('.editor-title');if(ti&&ti.style.display!=='none'){ti.addEventListener('input',function(){_titleManual=true;syncTitle()})}}
function autoTitle(){if(_titleManual)return;var ta=getTA();var hi=queryActiveEditor('.editor-title-hidden');var ti=queryActiveEditor('.editor-title');var mobileTitle=document.getElementById('mobile-editor-title');if(!ta||!hi)return;var val=ta.value;var lines=val.split('\n');var first='';for(var i=0;i<lines.length;i++){var l=lines[i].replace(/^#+\s*/,'').trim();if(l){first=l;break}}var firstPlain=stripMdForTitle(first);if(firstPlain&&firstPlain!==hi.value){if(ti)ti.textContent=firstPlain;// Don't clobber #mobile-editor-title while user is editing it
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
function submitLink(event){if(event)event.preventDefault();var url=document.getElementById('link-edit-url');var label=document.getElementById('link-edit-label');var u=(url?url.value:'').trim();if(!u)return false;var t=(label?label.value:'').trim()||u;closeLinkModal();var pv=getPV();if(pv){if(_linkSavedRange){var sel=window.getSelection();sel.removeAllRanges();sel.addRange(_linkSavedRange)}_linkSavedRange=null;document.execCommand('insertHTML',false,'<a href="'+u.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">'+t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</a>');syncPV();pv.focus();return false}var cm=getCM();if(cm){var md='['+t+']('+u+')';var s=cm.state.selection.main;cm.dispatch({changes:{from:s.from,to:s.to,insert:md},selection:{anchor:s.from+md.length}});cm.focus()}return false}
function insertLink(){openLinkModal()}
var _codeSavedSel=null;
var _codeSavedRange=null;
var _codeEditPre=null;
var _codeModalCM=null;
var _codeLangMap={'javascript':function(C){return C.javascript({jsx:true})},'typescript':function(C){return C.javascript({typescript:true,jsx:true})},'html':function(C){return C.html()},'css':function(C){return C.css()},'json':function(C){return C.json()},'sql':function(C){return C.sql()},'python':function(C){return C.python()},'xml':function(C){return C.xml()},'go':function(C){return C.go()},'c':function(C){return C.cpp()},'cpp':function(C){return C.cpp()},'yaml':function(C){return C.yaml()},'bash':function(C){return C.StreamLanguage.define(C.shell)}};
function _codeModalLangExt(lang){var C=window.CM;var fn=_codeLangMap[lang];return fn?fn(C):[]}
function _initCodeModalCM(host,content,lang){if(_codeModalCM){_codeModalCM.destroy();_codeModalCM=null}var C=window.CM;var theme=C.EditorView.theme({'&':{height:'100%',fontSize:'13px'},'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Mono",monospace',lineHeight:'1.5'},'.cm-content':{padding:'12px'},'.cm-gutters':{display:'none'},'.cm-activeLine':{backgroundColor:'var(--bg-hover)'},'.cm-selectionBackground':{backgroundColor:'var(--accent-dim) !important'},'&.cm-focused .cm-selectionBackground':{backgroundColor:'var(--accent-dim) !important'},'.cm-cursor':{borderLeftColor:'var(--accent)'}});_codeModalCM=new C.EditorView({state:C.EditorState.create({doc:content||'',extensions:[_codeModalLangExt(lang),C.syntaxHighlighting(C.defaultHighlightStyle,{fallback:true}),C.syntaxHighlighting(C.HighlightStyle.define([{tag:C.tags.keyword,color:'#c678dd'},{tag:[C.tags.string,C.tags.special(C.tags.brace)],color:'#98c379'},{tag:C.tags.number,color:'#d19a66'},{tag:C.tags.bool,color:'#d19a66'},{tag:[C.tags.definition(C.tags.variableName),C.tags.function(C.tags.variableName)],color:'#61afef'},{tag:C.tags.typeName,color:'#e5c07b'},{tag:C.tags.comment,color:'var(--text-dim)',fontStyle:'italic'},{tag:C.tags.operator,color:'#56b6c2'},{tag:C.tags.className,color:'#e5c07b'},{tag:C.tags.propertyName,color:'#e06c75'},{tag:C.tags.attributeName,color:'#d19a66'},{tag:C.tags.attributeValue,color:'#98c379'}])),theme,C.drawSelection(),C.highlightActiveLine(),C.bracketMatching(),C.history(),C.keymap.of([...C.defaultKeymap,...C.historyKeymap,C.indentWithTab]),C.placeholder('Paste or type code here...'),C.EditorView.lineWrapping]}),parent:host});_codeModalCM.focus()}
function _updateCodeModalLang(lang){if(!_codeModalCM)return;var C=window.CM;var doc=_codeModalCM.state.doc.toString();var host=_codeModalCM.dom.parentElement;_codeModalCM.destroy();_initCodeModalCM(host,doc,lang)}
function closeCodeModal(){if(_codeModalCM){_codeModalCM.destroy();_codeModalCM=null}var modal=document.getElementById('code-modal');if(modal)modal.hidden=true}
function openCodeModal(editPre){var pv=getPV();var cm=getCM();var sel='';var lang='';_codeSavedSel=null;_codeSavedRange=null;_codeEditPre=editPre||null;if(_codeEditPre){var codeEl=_codeEditPre.querySelector('code[class*="language-"]');sel=codeEl?codeEl.textContent:(_codeEditPre.querySelector('code')||_codeEditPre).textContent;if(codeEl){var classes=(codeEl.getAttribute('class')||'').split(' ');for(var i=0;i<classes.length;i++){if(classes[i].indexOf('language-')===0){lang=classes[i].slice(9);break}}}}else if(pv){var s=window.getSelection();_codeSavedRange=s&&s.rangeCount?s.getRangeAt(0).cloneRange():null;sel=(s&&s.toString())||''}else if(cm){var s=cm.state.selection.main;_codeSavedSel={from:s.from,to:s.to};sel=cm.state.sliceDoc(s.from,s.to)}var langEl=document.getElementById('code-lang');if(langEl){langEl.value=lang;langEl.onchange=function(){_updateCodeModalLang(langEl.value)}}var title=document.getElementById('code-modal-title');if(title)title.textContent=_codeEditPre?'Edit code block':'Insert code block';var submitBtn=document.getElementById('code-modal-submit');if(submitBtn)submitBtn.textContent=_codeEditPre?'Save':'Insert';var modal=document.getElementById('code-modal');if(modal)modal.hidden=false;var host=document.getElementById('code-input');if(host){host.innerHTML='';_initCodeModalCM(host,sel,lang)}}
function submitCode(event){if(event)event.preventDefault();var lang=document.getElementById('code-lang');var l=(lang?lang.value:'');var code=_codeModalCM?_codeModalCM.state.doc.toString():'';closeCodeModal();var pv=getPV();if(pv&&_codeEditPre){var codeEl=_codeEditPre.querySelector('code');if(!codeEl){codeEl=document.createElement('code');_codeEditPre.appendChild(codeEl)}codeEl.textContent=code;codeEl.className=l?'language-'+l:'';if(codeEl.dataset.highlighted)delete codeEl.dataset.highlighted;_codeEditPre=null;initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);syncPV();pv.focus();return false}if(pv){if(_codeSavedRange){var sel=window.getSelection();sel.removeAllRanges();sel.addRange(_codeSavedRange)}_codeSavedRange=null;var escaped=code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');var cls=l?' class="language-'+l+'"':'';document.execCommand('insertHTML',false,'<pre spellcheck="false"><code'+cls+'>'+escaped+'</code></pre>');initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);syncPV();pv.focus();return false}var cm=getCM();if(cm){var s=_codeSavedSel||cm.state.selection.main;var md='\n```'+l+'\n'+code+'\n```\n';cm.dispatch({changes:{from:s.from,to:s.to,insert:md},selection:{anchor:s.from+md.length}});cm.focus()}_codeSavedSel=null;_codeSavedRange=null;_codeEditPre=null;return false}
function insertImg(){var pv=getPV();if(pv){var u=prompt('Image URL:');if(!u)return;document.execCommand('insertHTML',false,'<img src="'+u+'" alt="image" class="preview-img" />');syncPV();pv.focus();return}var u=prompt('Image URL:');if(u)insertTxt('![image]('+u+')')}
function uploadFile(f){
	if(!f)return;
	if((!f.name||f.name==='')&&f.type){
		var ext=f.type.split('/')[1]||'bin';
		f=new File([f],'pasted-image-'+Date.now()+'.'+ext,{type:f.type});
	}
	var pv=getPV();
	var savedRange=null;
	var placeholder=null;
	if(pv){
		var sel=window.getSelection();
		if(sel&&sel.rangeCount)savedRange=sel.getRangeAt(0).cloneRange();
		if(savedRange){
			placeholder=document.createElement('span');
			placeholder.id='upload-placeholder-'+Date.now();
			try{
				var r=savedRange.cloneRange();
				r.collapse(true);
				r.insertNode(placeholder);
			}catch(e){
				placeholder=null;
			}
		}
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
	xhr.onload=function(){
		_log('uploadFile onload status',xhr.status,xhr.responseText.slice(0,120));
		setSaveState('','');
		var d;
		try{d=JSON.parse(xhr.responseText)}catch(e){alert('Upload failed');return}
		if(d.error){alert(d.error);return}
		var currentPv=getPV();
		_log('uploadFile onload pv',!!currentPv,'resourceId',d.resourceId,'savedRange',!!savedRange);
		if(currentPv&&d.resourceId){
			var inserted=false;
			if(placeholder&&placeholder.parentNode){
				_log('uploadFile inserting via placeholder');
				if(f.type.startsWith('image/')){
					var wrap=document.createElement('div');
					var img=document.createElement('img');
					img.src='/resources/'+d.resourceId;
					img.alt=f.name;
					img.className='preview-img';
					wrap.appendChild(img);
					placeholder.parentNode.replaceChild(wrap,placeholder);
				}else{
					var a=document.createElement('a');
					a.href='/resources/'+d.resourceId;
					a.target='_blank';
					a.rel='noopener';
					a.textContent=f.name;
					placeholder.parentNode.replaceChild(a,placeholder);
				}
				inserted=true;
			}else if(savedRange){
				var sel=window.getSelection();
				sel.removeAllRanges();
				sel.addRange(savedRange);
				_log('uploadFile restored selection');
				currentPv.focus();
				if(f.type.startsWith('image/')){
					_log('uploadFile insertHTML img');
					document.execCommand('insertHTML',false,'<img src="/resources/'+d.resourceId+'" alt="'+f.name+'" class="preview-img" />');
				}else{
					document.execCommand('insertHTML',false,'<a href="/resources/'+d.resourceId+'" target="_blank" rel="noopener">'+f.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</a>');
				}
				inserted=true;
			}
			if(inserted){
				_log('uploadFile calling syncPV');
				var changed=syncPV();
				_log('uploadFile syncPV changed',changed);
				if(changed){markEdited();scheduleSave();}
				var ta2=getTA();
				if(ta2&&currentPv){
					_log('uploadFile re-rendering preview');
					fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(ta2.value)}).then(function(r){return r.text()}).then(function(h){currentPv.innerHTML=h;}).catch(function(){})
				}
				currentPv.focus();
				return;
			}
		}
		insertTxt(d.markdown);
	};
	xhr.onerror=function(){setSaveState('','');alert('Upload failed')};
	if(s)setSaveState('<span class="autosave-saving">Uploading 0%</span>','Uploading');
	xhr.open('POST','/fragments/upload');
	xhr.send(fd);
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
function handleDrop(e){e.preventDefault();var files=e.dataTransfer&&e.dataTransfer.files;if(!files||!files.length)return;for(var i=0;i<files.length;i++)uploadFile(files[i])}
var _tdService=null;
function getTurndown(){
	if(_tdService)return _tdService;
	var td=new TurndownService({headingStyle:'atx',hr:'---',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*',strongDelimiter:'**',br:'\n'});
	// Joplin resource images (with optional resize dimensions)
	td.addRule('joplinImg',{filter:function(n){return n.nodeName==='IMG'},replacement:function(c,n){
		var alt=n.getAttribute('alt')||'';var src=n.getAttribute('src')||'';
		var w=n.style.width||n.getAttribute('width');var h=n.style.height||n.getAttribute('height');
		var rm=src.match(/^\/resources\/([0-9a-zA-Z]{32})$/);
		// Never embed data: URIs into markdown — they corrupt note storage
		if(src.startsWith('data:'))return alt?'['+alt+']':'';
		if(w||h){var iSrc=rm?':/'+rm[1]:src;return '<img src="'+iSrc+'" alt="'+alt+'"'+(w?' width="'+parseInt(w)+'"':'')+(h?' height="'+parseInt(h)+'"':'')+' />'}
		if(rm)return '!['+alt+'](:/'+rm[1]+')';return '!['+alt+']('+src+')'}});
	// Joplin resource links
	td.addRule('joplinLink',{filter:function(n){return n.nodeName==='A'&&/^\/resources\/[0-9a-zA-Z]{32}(?:\?download=1)?$/.test((n.getAttribute('href')||'').split('#')[0])},
		replacement:function(c,n){var m=(n.getAttribute('href')||'').match(/^\/resources\/([0-9a-zA-Z]{32})/);return '['+c+'](:/'+m[1]+')'}});
	// md-blank-line divs — use placeholder to survive <br> normalization
	td.addRule('blankLine',{filter:function(n){return n.nodeName==='DIV'&&n.classList.contains('md-blank-line')&&!n.querySelector('img,a,pre,code,ul,ol,blockquote,table')&&!n.textContent.trim()},replacement:function(){return '\x00BL\x00'}});
	// md-checkbox divs
	td.addRule('checkbox',{filter:function(n){return n.nodeName==='DIV'&&n.classList.contains('md-checkbox')},
		replacement:function(c,n){var checked=n.classList.contains('checked');var txt=c.replace(/^[\u2611\u2610\u2612\u2705\u00a0 ]+/,'');return (checked?'- [x] ':'- [ ] ')+txt+'\n'}});
	// Strikethrough
	td.addRule('strikethrough',{filter:['del','s','strike'],replacement:function(c){return c.trim()?'~~'+c.trim()+'~~':''}});
	// Underline
	td.addRule('underline',{filter:'u',replacement:function(c){return c.trim()?'++'+c.trim()+'++':''}});
	// Empty divs from contenteditable (Enter key creates <div><br></div>) — emit BL sentinel so
	// line 616 converts it to one extra newline (\n\n\n), which injectBlankLineBlocks turns into
	// exactly one md-blank-line div. Using '<br>' caused line 611 to produce 4 newlines (two divs).
	// Using '' made blank-line edits invisible to Turndown (hash never changed, note never saved).
	td.addRule('emptyDiv',{filter:function(n){return n.nodeName==='DIV'&&!n.classList.length&&!n.querySelector('img,a,pre,code,ul,ol,blockquote,table')&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '\x00BL\x00'}});
	// Empty paragraphs from contenteditable (<p><br></p>) — same reasoning.
	td.addRule('emptyP',{filter:function(n){return n.nodeName==='P'&&!n.querySelector('img')&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '\x00BL\x00'}});
	_tdService=td;return td}
function htmlToMarkdown(el){
	var root=el.cloneNode(true);
	root.querySelectorAll('.pre-copy-btn').forEach(function(btn){btn.remove()});
	var md=getTurndown().turndown(root.innerHTML);
	var nbsp=String.fromCharCode(160);
	while(md.indexOf(nbsp)>=0)md=md.split(nbsp).join('&nbsp;');
	var nl=String.fromCharCode(10);
	var headingGapRe=new RegExp('^(#{1,6}[^'+nl+']*)'+nl+'{2,}(?=\\S)','gm');
	var headingLeadRe=new RegExp('([^'+nl+'])'+nl+'{2,}(#{1,6}\\s)','g');
	md=md.split('<br/>').join('<br>');
	md=md.split('<br>'+nl).join(nl);
	while(md.indexOf('<br><br>')>=0)md=md.split('<br><br>').join('<br>'+nl);
	md=md.replace(headingLeadRe,'$1'+nl+'$2');
	md=md.replace(headingGapRe,'$1'+nl);
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
function setEditorMode(mode){var ta=getTA(),pv=queryActiveEditor('#note-preview'),tb=queryActiveEditor('#editor-toolbar'),host=queryActiveEditor('#cm-host'),form=activeEditorForm();if(!ta||!pv)return;if(form)form.dataset.editorMode=mode;if(mode==='preview'){_previewDirty=false;if(_cmView)cmSyncToTA();fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(ta.value)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;pv.contentEditable='true';pv.style.display='';if(host)host.style.display='none';_editorMode='preview';syncEditorModeButtons();activatePV(pv);_previewDirty=false;applySearchHighlight()})}else{if(_pvSyncTimer){clearTimeout(_pvSyncTimer);_pvSyncTimer=null}if(pv.contentEditable==='true'&&_previewDirty){syncPV()}_previewDirty=false;pv.contentEditable='false';pv.oninput=null;pv.onkeyup=null;pv.style.display='none';if(host){host.style.display='';if(!_cmView)initCM(host,ta.value);else cmSetVal(ta.value);setTimeout(function(){if(_cmView)_cmView.focus();applySearchHighlight()},0)}if(tb)tb.style.display='';_editorMode='markdown';syncEditorModeButtons()}}
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var codeModal=document.getElementById('code-modal');if(codeModal&&!codeModal.hidden){closeCodeModal();return}closeFolderContextMenu();closeFolderModal();closeLinkModal();var bar=document.getElementById('search-nav-bar');if(bar&&!bar.hidden){searchNavDismiss();return}}if(!getTA()&&!getPV()&&!getCM())return;if((e.ctrlKey||e.metaKey)&&e.key==='b'){e.preventDefault();wrapSel('**','**')}if((e.ctrlKey||e.metaKey)&&e.key==='i'){e.preventDefault();wrapSel('*','*')}if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();if(_editorMode==='preview'&&_searchMarks.length){searchNavStep(1)}else{applySearchHighlight()}}});
document.addEventListener('click',function(e){var menu=document.getElementById('folder-context-menu');if(menu&&!menu.hidden&&!menu.contains(e.target))closeFolderContextMenu()});
function highlightCodeBlocks(container){if(!window.hljs||!container)return;container.querySelectorAll('pre code[class*="language-"]').forEach(function(el){if(el.dataset.highlighted)return;window.hljs.highlightElement(el)})}
function ensureEditableAfterPre(pv){if(!pv)return;var pres=pv.querySelectorAll('pre');pres.forEach(function(pre){var next=pre.nextElementSibling;if(!next){var p=document.createElement('p');p.innerHTML='<br>';pv.appendChild(p)}})}
function initCopyButtons(pv){if(!pv)return;pv.querySelectorAll('pre').forEach(function(pre){pre.contentEditable='false';pre.style.cursor='pointer';if(pre.querySelector('.pre-copy-btn'))return;var btn=document.createElement('button');btn.type='button';btn.className='pre-copy-btn';btn.title='Copy code';btn.textContent='Copy';btn.addEventListener('click',function(e){e.stopPropagation();var code=pre.querySelector('code');var text=code?code.textContent:(pre.textContent||'');navigator.clipboard.writeText(text).then(function(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},1500)}).catch(function(){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},1500)})});pre.insertBefore(btn,pre.firstChild);pre.addEventListener('click',function(e){if(e.target.closest('.pre-copy-btn'))return;e.preventDefault();e.stopPropagation();openCodeModal(pre)})})}
function activatePV(pv){if(!pv)return;pv.contentEditable='true';initImgResize(pv);initCopyButtons(pv);highlightCodeBlocks(pv);ensureEditableAfterPre(pv);pv.oninput=function(){_previewDirty=true;scheduleSyncPV()};pv.onkeyup=null;if(pv.dataset.pvInit)return;pv.dataset.pvInit='1';
	pv.addEventListener('click',function(e){var link=e.target.closest('a');if(link&&pv.contains(link)){var href=link.getAttribute('href')||'';if(href){e.preventDefault();window.open(href,'_blank','noopener');return}}});
	// Click checkbox icon to toggle checked state
	pv.addEventListener('click',function(e){var cb=e.target.closest('.md-checkbox');if(!cb)return;var iconEl=cb.querySelector('.md-cb-icon');if(!iconEl){var txt=cb.firstChild;if(!txt||txt.nodeType!==3)return;var icon=txt.textContent.charAt(0);if(icon!=='\u2610'&&icon!=='\u2611')return;var r=document.createRange();r.setStart(txt,0);r.setEnd(txt,Math.min(2,txt.textContent.length));var iconRect=r.getBoundingClientRect();if(e.clientX>iconRect.right)return;e.preventDefault();var checked=!cb.classList.contains('checked');cb.classList.toggle('checked',checked);txt.textContent=(checked?'\u2611':'\u2610')+txt.textContent.slice(1);syncPV();return}var iconRect=iconEl.getBoundingClientRect();if(e.clientX>iconRect.right)return;e.preventDefault();var checked=!cb.classList.contains('checked');cb.classList.toggle('checked',checked);iconEl.textContent=checked?'\u2611':'\u2610';syncPV()});
	// Enter inside code blocks should stay in the same block; Enter after checkbox creates new checkbox
	pv.addEventListener('keydown',function(e){if(e.key==='Enter'){var sel=window.getSelection();if(!sel.rangeCount)return;var range=sel.getRangeAt(0);var node=range.startContainer;var el=node.nodeType===3?node.parentElement:node;var pre=el&&el.closest?el.closest('pre'):null;if(pre&&pv.contains(pre)){e.preventDefault();var code=pre.querySelector('code')||pre;var txt=code.textContent||'';var atEnd=(node===code||node.parentElement===code)&&range.startOffset===(node.nodeType===3?node.textContent.length:code.childNodes.length)&&!range.toString();if(atEnd&&txt.endsWith('\n')){code.textContent=txt.slice(0,-1);var np=document.createElement('p');np.innerHTML='<br>';pre.parentNode.insertBefore(np,pre.nextSibling);var nr=document.createRange();nr.setStart(np,0);nr.collapse(true);sel.removeAllRanges();sel.addRange(nr);np.scrollIntoView({block:'nearest'});syncPV();return}if(insertPVText('\n'))syncPV();return}var cb=el&&el.closest?el.closest('.md-checkbox'):null;if(!cb&&node.nodeType===1&&range.startOffset>0){var prev=node.childNodes[range.startOffset-1];if(prev&&prev.nodeType===1&&prev.classList&&prev.classList.contains('md-checkbox'))cb=prev}if(!cb)return;e.preventDefault();var label=(cb.textContent||'').replace(/^[\u2610\u2611][\u00a0 ]*/,'').replace(/\u00a0|\s/g,'');if(!label){var para=document.createElement('p');para.innerHTML='<br>';if(cb.parentNode)cb.parentNode.replaceChild(para,cb);var rp=document.createRange();rp.setStart(para,0);rp.collapse(true);sel.removeAllRanges();sel.addRange(rp);para.scrollIntoView({block:'nearest'});syncPV();return}var neo=document.createElement('div');neo.className='md-checkbox';var iconSpan2=document.createElement('span');iconSpan2.className='md-cb-icon';iconSpan2.textContent='\u2610';neo.appendChild(iconSpan2);var tn=document.createTextNode('\u00a0');neo.appendChild(tn);cb.parentNode.insertBefore(neo,cb.nextSibling);var r=document.createRange();r.setStart(tn,1);r.collapse(true);sel.removeAllRanges();sel.addRange(r);neo.scrollIntoView({block:'nearest'});syncPV()}});
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
		e.preventDefault();var text=(e.clipboardData||window.clipboardData).getData('text/plain');if(!text)return;var sel=window.getSelection();var inPre=false;if(sel&&sel.rangeCount){var node=sel.getRangeAt(0).startContainer;while(node&&node!==pv){if(node.nodeName==='PRE'||node.nodeName==='CODE'){inPre=true;break}node=node.parentNode}}if(inPre){insertPVText(text);syncPV();return}var trimmed=text.trim();if(/^https?:\/\/\S+$/.test(trimmed)&&trimmed.indexOf('\n')<0){var hasSelection=sel&&sel.rangeCount&&!sel.getRangeAt(0).collapsed;var label=hasSelection?sel.getRangeAt(0).toString()||trimmed:trimmed;var a=document.createElement('a');a.href=trimmed;a.target='_blank';a.rel='noopener';a.textContent=label;if(sel&&sel.rangeCount){var range=sel.getRangeAt(0);range.deleteContents();range.insertNode(a);range.setStartAfter(a);range.collapse(true);sel.removeAllRanges();sel.addRange(range)}syncPV();return}document.execCommand('insertText',false,text);syncPV()})}
function djb2(str){var h=5381;for(var i=0;i<str.length;i++)h=((h<<5)+h+str.charCodeAt(i))>>>0;return h}
var _formHashExclude={baseUpdatedTime:true,forceSave:true,createCopy:true};function formHash(form){if(!form)return 0;var parts=[];var els=form.elements;for(var i=0;i<els.length;i++){var el=els[i];if(el.name&&!_formHashExclude[el.name])parts.push(el.name+'='+el.value)}return djb2(parts.join('&'))}
var _savedHash=0;
var _saveTimer=null;
var _saveTitleTimer=null;
function _anyModalOpen(){var ids=['code-modal','link-modal','folder-modal','history-modal'];for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(el&&!el.hidden)return true}return false}
function scheduleSave(){if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=setTimeout(function(){_saveTimer=null;if(_syncPVInFlight||_pvSyncTimer){_log('scheduleSave deferred, syncPV in flight');scheduleSave();return}if(_anyModalOpen()){_log('scheduleSave deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSave skip, hash unchanged',h);return}_log('scheduleSave firing, hash',_savedHash,'->',h);htmx.trigger(form,'joplock:save')},2000)}
function scheduleSaveTitle(){var mobileTitle=document.getElementById('mobile-editor-title');if(mobileTitle&&document.activeElement===mobileTitle)return;// Don't save while user is still editing title
if(_saveTitleTimer)clearTimeout(_saveTitleTimer);if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=null;_saveTitleTimer=setTimeout(function(){_saveTitleTimer=null;if(_anyModalOpen()){_log('scheduleSaveTitle deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSaveTitle skip, hash unchanged',h);return}_log('scheduleSaveTitle firing');htmx.trigger(form,'joplock:save')},2000)}
function snapshotHash(){var form=activeEditorForm();_savedHash=formHash(form);_log('snapshotHash',_savedHash)}
function _isLockedOverlayEventTarget(target){return !!(target&&target.closest&&target.closest('#editor-locked'))}
function initEditorPanel(){var form=activeEditorForm();if(!form||form.dataset.editorInit)return;form.dataset.editorInit='1';_log('initEditorPanel',form.getAttribute('hx-put'));if(isMobileShellMode())closeNav();_previewDirty=false;setSaveState('','');snapshotHash();_snapshots=[];var undoBtn=queryActiveEditor('#undo-save-btn');if(undoBtn)undoBtn.hidden=true;pushSnapshot();form.addEventListener('input',function(e){if(_isLockedOverlayEventTarget(e.target))return;markEdited();scheduleSave()});form.addEventListener('change',function(e){if(_isLockedOverlayEventTarget(e.target))return;markEdited();scheduleSave()});initAutoTitle();applyMobileTitleMode();renderNoteMeta();var ta=getTA();if(ta){ta.addEventListener('input',function(){autoTitle()})}var pendingSearch=(window._pendingNoteSearchTerm||'').trim();var mobileEditor=inMobileEditor();if(mobileEditor&&pendingSearch){var header=document.getElementById('mobile-editor-header');var searchHeader=document.getElementById('mobile-editor-search-header');if(header)header.style.display='none';if(searchHeader)searchHeader.style.display=''}var searchInput=activeSearchInput();if(searchInput&&pendingSearch&&!searchInput.value)searchInput.value=pendingSearch;window._pendingNoteSearchTerm='';var pv=queryActiveEditor('#note-preview');var host=queryActiveEditor('#cm-host');if(form.dataset.encrypted==='1'){if(pv)pv.style.display='none';if(host)host.style.display='none';_editorMode='markdown';syncEditorModeButtons();return}var defaultMode=form.dataset.editorMode||_defaultNoteOpenMode||'preview';if(defaultMode!=='markdown')defaultMode='preview';form.dataset.editorMode=defaultMode;if(defaultMode==='preview'&&pv&&pv.style.display!=='none'){_editorMode='preview';activatePV(pv);_previewDirty=false;if(host)host.style.display='none';syncEditorModeButtons();applySearchHighlight()}else{_editorMode='markdown';form.dataset.editorMode='markdown';if(pv)pv.style.display='none';if(host){host.style.display='';initCM(host,ta?ta.value:'')}syncEditorModeButtons();applySearchHighlight()}}
function applySearchHighlight(){var term=activeSearchTerm();var bar=document.getElementById('search-nav-bar');if(bar)bar.hidden=true;_searchMarks=[];_searchMarkIdx=0;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);if(!term||!term.trim()){clearCodeMirrorSearch();return}term=term.trim();if(_editorMode==='preview'&&pv){clearCodeMirrorSearch();var savedHandler=pv.oninput;pv.oninput=null;highlightInPreview(pv,term);pv.oninput=savedHandler}else if(_editorMode==='markdown'&&_cmView&&window.CM&&window.CM.SearchQuery&&window.CM.setSearchQuery){			window.CM.openSearchPanel(_cmView);var q=new window.CM.SearchQuery({search:term,caseSensitive:false});_cmView.dispatch({effects:window.CM.setSearchQuery.of(q)});_cmSearchMatches=collectCodeMirrorSearchMatches(q);if(_cmSearchMatches.length)setCodeMirrorSearchActive(0);else searchNavShow(0,0)}}
function escapeRegex(s){var specials=['.','+','*','?','^','$','(',')','{','}','[',']','|','\\'];return s.split('').map(function(c){return specials.indexOf(c)>=0?'\\'+c:c}).join('')}
var _searchMarks=[];var _searchMarkIdx=0;
function searchNavShow(total,idx){var bar=document.getElementById('search-nav-bar');var counter=document.getElementById('search-nav-counter');if(bar){if(total===0){bar.hidden=true}else{bar.hidden=false;if(counter)counter.textContent=(idx+1)+' / '+total}}var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(mobileCounter){mobileCounter.hidden=total===0;if(total>0)mobileCounter.textContent=(idx+1)+' / '+total}if(mobilePrev)mobilePrev.hidden=total===0;if(mobileNext)mobileNext.hidden=total===0}
function searchNavSetActive(idx){_searchMarks.forEach(function(m,i){m.classList.toggle('search-highlight-active',i===idx)});var m=_searchMarks[idx];if(m)m.scrollIntoView({block:'center',behavior:'smooth'})}
function searchNavStep(dir){if(_editorMode==='markdown'&&_cmSearchMatches.length){setCodeMirrorSearchActive(_searchMarkIdx+dir);return}if(!_searchMarks.length)return;_searchMarkIdx=(_searchMarkIdx+dir+_searchMarks.length)%_searchMarks.length;searchNavSetActive(_searchMarkIdx);searchNavShow(_searchMarks.length,_searchMarkIdx)}
function searchNavDismiss(){var bar=document.getElementById('search-nav-bar');var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(bar)bar.hidden=true;if(mobileCounter)mobileCounter.hidden=true;if(mobilePrev)mobilePrev.hidden=true;if(mobileNext)mobileNext.hidden=true;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);_searchMarks=[];_searchMarkIdx=0;clearCodeMirrorSearch()}
function highlightInPreview(pv,term){if(!pv||!term)return;_searchMarks=[];_searchMarkIdx=0;var walker=document.createTreeWalker(pv,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentElement&&n.parentElement.closest('script,style,mark')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}},false);var nodes=[];var node;while((node=walker.nextNode()))nodes.push(node);var re=new RegExp(escapeRegex(term),'gi');nodes.forEach(function(n){var matches=[];var m;re.lastIndex=0;while((m=re.exec(n.textContent))!==null)matches.push({start:m.index,end:m.index+m[0].length});if(!matches.length)return;var frag=document.createDocumentFragment();var last=0;matches.forEach(function(r){if(r.start>last)frag.appendChild(document.createTextNode(n.textContent.slice(last,r.start)));var mark=document.createElement('mark');mark.className='search-highlight';mark.textContent=n.textContent.slice(r.start,r.end);_searchMarks.push(mark);frag.appendChild(mark);last=r.end});if(last<n.textContent.length)frag.appendChild(document.createTextNode(n.textContent.slice(last)));n.parentNode.replaceChild(frag,n)});if(_searchMarks.length){searchNavSetActive(0);searchNavShow(_searchMarks.length,0)}else{searchNavShow(0,0)}}
function initNavPanel(){_log('initNavPanel');var state=navFolderState();var selectedEl=document.querySelector('.nav-folder[data-selected="1"]');var hasSelected=!!selectedEl;var selectedId=selectedEl?selectedEl.getAttribute('data-folder-id'):'';document.querySelectorAll('.nav-folder').forEach(function(el){var id=el.getAttribute('data-folder-id');var selected=el.getAttribute('data-selected')==='1';var isAllNotes=el.getAttribute('data-all-notes')==='1';var open=state[id]===true||state[id]==='1'||state[id]===1;if(state[id]===undefined)open=!hasSelected&&isAllNotes;if(isAllNotes&&selectedId&&selectedId!==id)open=false;if(selected)open=true;el.classList.toggle('collapsed',!open);// Lazy-load if expanded and not yet loaded
	if(open){var notesDiv=el.querySelector('.nav-folder-notes[data-folder-id]');if(notesDiv&&!notesDiv.getAttribute('data-loaded')){notesDiv.setAttribute('data-loaded','1');var folderId=notesDiv.getAttribute('data-folder-id');htmx.ajax('GET','/fragments/folder-notes?folderId='+encodeURIComponent(folderId),{target:notesDiv,swap:'innerHTML'})}}})}
var _folderSelectValue=null;var _folderSelectNoteId=null;
document.body.addEventListener('htmx:beforeSwap',function(e){var sel=document.getElementById('editor-folder-select');var form=document.getElementById('note-editor-form');if(sel){_folderSelectValue=sel.value;_folderSelectNoteId=form?form.getAttribute('hx-put'):''}});
document.body.addEventListener('htmx:afterSettle',function(){initNavPanel();initEditorPanel();refreshAllVaultIcons();
	if(_folderSelectValue){var sel=document.getElementById('editor-folder-select');var form=document.getElementById('note-editor-form');var currentNoteId=form?form.getAttribute('hx-put'):'';if(sel&&currentNoteId&&currentNoteId===_folderSelectNoteId){sel.value=_folderSelectValue}_folderSelectValue=null;_folderSelectNoteId=null}});
// Also refresh on initial SSR page load (htmx:afterSettle only fires after htmx swaps)
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',refreshAllVaultIcons)}else{refreshAllVaultIcons()}
document.body.addEventListener('htmx:confirm',function(e){var elt=e.detail&&e.detail.elt;if(!elt)return;var msg=elt.getAttribute('data-confirm-trash');if(msg){e.preventDefault();if(_cfg.confirmTrash===false){e.detail.issueRequest(true);return}if(confirm(msg))e.detail.issueRequest(true)}});
function showNoteOverlay(){var o=document.getElementById('note-loading-overlay');if(o)o.classList.add('active')}
function hideNoteOverlay(){var o=document.getElementById('note-loading-overlay');if(o)o.classList.remove('active')}
document.body.addEventListener('click',function(e){var btn=e.target.closest('.notelist-item');if(btn&&!e.defaultPrevented)showNoteOverlay()},true);
document.body.addEventListener('htmx:beforeRequest',function(e){var elt=e.detail&&e.detail.elt;_log('htmx:beforeRequest',elt&&elt.id,elt&&elt.getAttribute&&elt.getAttribute('hx-get'),elt&&elt.getAttribute&&elt.getAttribute('hx-put'));});
document.body.addEventListener('htmx:afterRequest',function(e){var xhr=e.detail&&e.detail.xhr;_log('htmx:afterRequest',e.detail&&e.detail.successful,xhr&&xhr.status,xhr&&typeof xhr.responseText==='string'?xhr.responseText.slice(0,120):'');var elt=e.detail&&e.detail.elt;if(elt&&elt.classList&&elt.classList.contains('notelist-item')&&!e.detail.successful)hideNoteOverlay();if(elt&&elt.id==='note-editor-form'&&e.detail.successful){snapshotHash();pushSnapshot();setSaveState('<span class="autosave-ok">Saved</span>','Saved');_log('afterRequest snapshotHash after save')}if(e.detail&&e.detail.successful&&document.body.classList.contains('is-offline')){clearOffline()}});
document.body.addEventListener('htmx:afterSwap',function(e){var target=e.detail&&e.detail.target;_log('htmx:afterSwap',target&&target.id);if(target&&target.id==='editor-panel'){hideNoteOverlay();if(_cmView){_cmView.destroy();_cmView=null}_searchMarks=[];_searchMarkIdx=0}});
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
// Always-on connectivity ping (every 30s) — triggers disconnected overlay on failure
(function(){var _cpMs=30000;function _connectivityPing(){_dcPing().then(function(ok){if(ok)_dcOnFetchOk();else _dcOnFetchFail()}).catch(function(){_dcOnFetchFail()})}var _cpInterval=setInterval(_connectivityPing,_cpMs);_connectivityPing()})();
window.addEventListener('load',function(){if(isMobileShellMode())return;initNavPanel();initEditorPanel()});
window.addEventListener('resize',applyMobileTitleMode);
document.addEventListener('keydown',function(e){var mac=navigator.platform&&navigator.platform.indexOf('Mac')!==-1;var mod=mac?e.metaKey:e.ctrlKey;if(mod&&e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undoSnapshot()}});
	function flushSave(callback){var form=activeEditorForm();if(!form){_log('flushSave skip (no form)');if(callback)callback(true);return}if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}if(_saveTitleTimer){clearTimeout(_saveTitleTimer);_saveTitleTimer=null}if(_pvSyncTimer){clearTimeout(_pvSyncTimer);_pvSyncTimer=null;_syncPVInFlight=true;syncPV();_syncPVInFlight=false}else{var pv=getPV();if(pv)syncPV();else cmSyncToTA()}syncTitleToHidden({silent:true});var h=formHash(form);if(h===_savedHash){_log('flushSave skip (hash unchanged)',h);if(callback)callback(true);return}setSaveState('<span class="autosave-saving">Saving...</span>','Saving...');var restoreReq=function(){};buildFlushRequest(form).then(function(req){if(!req){if(callback)callback(true);return}restoreReq=req.restore||restoreReq;_log('flushSave',req.url);return fetch(req.url,{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:req.body}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(function(html){restoreReq();_log('flushSave ok',html.slice(0,80));snapshotHash();window._mobileNewNoteId=null;setSaveState('<span class="autosave-ok">Saved</span>','Saved');if(callback)callback(true)})}).catch(function(err){restoreReq();_log('flushSave error',err);showOffline();if(callback)callback(false)})}
	function shouldInterceptNavigationClick(target){var navTarget=target&&target.closest?target.closest('.notelist-item,.sidebar-item,.nav-folder-row,[hx-get],[hx-post],[hx-delete]'):null;if(!navTarget)return null;if(navTarget.closest&&navTarget.closest('#note-editor-form'))return null;if(navTarget.closest&&navTarget.closest('#folder-context-menu,#folder-modal,#link-modal,#history-modal,#code-modal,#new-folder-modal,#vault-modal'))return null;return navTarget}
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
		var screens=['folders','notes','editor'];
		screens.forEach(function(s){
			var el=document.getElementById(mobileScreenId(s));
			if(!el)return;
			el.classList.remove('mobile-screen-left','mobile-screen-right');
			el.classList.toggle('mobile-screen-active',s===_state.screen);
		});
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
	function mobileCtxOpen(noteId,noteTitle){
		_ctxNoteId=noteId;_ctxNoteTitle=noteTitle;
		var backdrop=document.getElementById('mobile-ctx-backdrop');
		var sheet=document.getElementById('mobile-ctx-sheet');
		var titleEl=document.getElementById('mobile-ctx-title');
		var metaEl=document.getElementById('mobile-ctx-meta');
		var moveBtn=document.getElementById('mobile-ctx-move');
		var delBtn=document.getElementById('mobile-ctx-delete');
		if(titleEl)titleEl.textContent=noteTitle||'Untitled';
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
		mobileCtxOpen(form.dataset.noteId||_state.noteId,(titleInput&&titleInput.textContent)||document.getElementById('mobile-editor-title')&&document.getElementById('mobile-editor-title').textContent||'Untitled');
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
	}
	function initMobileToolbar(){
		var tb=document.getElementById('editor-toolbar');
		if(!tb||!inMobileEditor())return;
		if(tb.dataset.mobileToolbarInit==='1'){syncEditorModeButtons();return}
		tb.dataset.mobileToolbarInit='1';
		tb.style.position='fixed';
		tb.style.left='0';tb.style.right='0';
		tb.style.bottom='0';
		tb.style.zIndex='50';
		tb.style.background='var(--bg-side)';
		tb.style.borderTop='1px solid var(--border)';
		// Adjust editor body padding so toolbar doesn't overlap content
		var body=document.getElementById('mobile-editor-body');
		if(body)body.style.paddingBottom='90px';
		tb.style.display='flex';
		function positionToolbar(){
			if(!inMobileEditor()||!tb)return;
			var vv=window.visualViewport;
			// Use innerHeight - vv.height so toolbar clears keyboard + iOS accessory bar
			var keyboardH=vv?Math.max(0,window.innerHeight-vv.height):0;
			tb.style.bottom=keyboardH+'px';
		}
		if(window.visualViewport){
			window.visualViewport.addEventListener('resize',positionToolbar);
			window.visualViewport.addEventListener('scroll',positionToolbar);
		}
		positionToolbar();
		syncEditorModeButtons();
	}
	// Update editor title when editor loads
		document.body.addEventListener('htmx:afterSettle',function(e){
		var t=e.detail&&e.detail.target;
		if(t&&t.id==='mobile-editor-body'){
			_trace('mobile-editor-settle-start');
			if(_cmView){_cmView.destroy();_cmView=null}
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
		var ciphertext=await encryptForVault(plaintext,folderId,key,salt);
		touchVaultActivity(folderId);
		var form=activeEditorForm();
		if(form){
			form.dataset.encrypted='1';
			form.dataset.vaultId=folderId;
			var restoreBodyField=_setOneShotEncryptedBody(form,ciphertext);
			htmx.trigger(form,'joplock:save');
			setTimeout(restoreBodyField,0);
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
	var host=queryActiveEditor('#cm-host');
	var pv=queryActiveEditor('#note-preview');
	var tb=queryActiveEditor('#editor-toolbar');
	var form=activeEditorForm();

	if(ta){
		ta.dataset.ciphertext=ta.value;
		ta.value=plaintext;
		ta.style.display='';
	}
	if(form){
		form.dataset.encrypted='1';
		if(vaultId)form.dataset.vaultId=vaultId;
		form.dataset.vaultUnlocked='1';
	}

	if(lockedDiv)lockedDiv.style.display='none';
	if(tb)tb.style.display='';

	var mdBtn=document.getElementById('markdown-toggle');
	var pvBtn=document.getElementById('preview-toggle');
	if(mdBtn)mdBtn.style.display='';
	if(pvBtn)pvBtn.style.display='';

	// Use user's default open mode
	if(form)delete form.dataset.editorMode;
	var defaultMode=_defaultNoteOpenMode||'preview';
	if(defaultMode==='preview'&&pv){
		pv.style.display='';
		fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(plaintext)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;activatePV(pv);_previewDirty=false;if(host)host.style.display='none';_editorMode='preview';syncEditorModeButtons()});
	}else{
		if(pv)pv.style.display='none';
		if(host){host.style.display='';initCM(host,plaintext)}
		_editorMode='markdown';
		syncEditorModeButtons();
	}

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

function buildFlushRequest(form){
	if(!form)return Promise.resolve(null);
	var url=form.getAttribute('hx-put');
	if(!url)return Promise.resolve(null);
	var pv=getPV();
	if(pv)syncPV();else cmSyncToTA();
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
			var restoreBodyField=_setOneShotEncryptedBody(form,ciphertext);
			htmx.trigger(form,'joplock:save');
			setTimeout(restoreBodyField,0);
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

		if(isEnc&&!newFolderIsVault){
			// Moving encrypted note out of vault → decrypt it
			if(!oldVaultId)return;
			if(!isVaultUnlocked(oldVaultId)){
				select.value=oldVaultId; // revert
				_showVaultModal(oldVaultId,'unlock',function(ok){
					if(ok){select.value=newFolderId;select.dispatchEvent(new Event('change',{bubbles:true}))}
				});
				return;
			}
			getVaultKey(oldVaultId).then(function(key){
				if(!key){_log('no vault key to decrypt on move');return}
				return _decryptWithKey(ta.value,key).then(function(pt){
					ta.value=pt;
					delete form.dataset.encrypted;
					delete form.dataset.vaultId;
					_updateLockToggle(noteId,false);
					_updateNoteLockIcon(noteId,false);
					htmx.trigger(form,'joplock:save');
				});
			}).catch(function(e){_log('decrypt on move failed',e)});
		}else if(!isEnc&&newFolderIsVault){
			// Moving plain note into vault → encrypt it
			if(!isVaultUnlocked(newFolderId)){
				_showVaultModal(newFolderId,'unlock',function(ok){
					if(ok)_doEncryptNoteInVault(noteId,newFolderId);
				});
			}else{
				_doEncryptNoteInVault(noteId,newFolderId);
			}
		}else if(isEnc&&newFolderIsVault&&oldVaultId!==newFolderId){
			// Moving between vaults → decrypt with old, re-encrypt with new
			if(!oldVaultId)return;
			var doReencrypt=function(){
				getVaultKey(oldVaultId).then(function(oldKey){
					if(!oldKey){_log('no old vault key');return}
					return _decryptWithKey(ta.value,oldKey).then(function(pt){
						if(!isVaultUnlocked(newFolderId)){
							_showVaultModal(newFolderId,'unlock',function(ok){
								if(!ok)return;
								getVaultKey(newFolderId).then(function(newKey){
									var salt=getVaultSalt(newFolderId);
									return encryptForVault(pt,newFolderId,newKey,salt).then(function(ct){
										form.dataset.vaultId=newFolderId;
										var restoreBodyField=_setOneShotEncryptedBody(form,ct);
										htmx.trigger(form,'joplock:save');
										setTimeout(restoreBodyField,0);
									});
								}).catch(function(e){_log('re-encrypt failed',e)});
							});
						}else{
							getVaultKey(newFolderId).then(function(newKey){
							var salt=getVaultSalt(newFolderId);
							return encryptForVault(pt,newFolderId,newKey,salt).then(function(ct){
								form.dataset.vaultId=newFolderId;
								var restoreBodyField=_setOneShotEncryptedBody(form,ct);
								htmx.trigger(form,'joplock:save');
								setTimeout(restoreBodyField,0);
							});
						}).catch(function(e){_log('re-encrypt failed',e)});
						}
					});
				}).catch(function(e){_log('move between vaults failed',e)});
			};
			if(!isVaultUnlocked(oldVaultId)){
				select.value=oldVaultId;
				_showVaultModal(oldVaultId,'unlock',function(ok){
					if(ok){select.value=newFolderId;doReencrypt()}
				});
			}else{
				doReencrypt();
			}
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
	window.openFolderContextMenu=openFolderContextMenu;
	window.editFolderFromMenu=editFolderFromMenu;
	window.deleteFolderFromMenu=deleteFolderFromMenu;
	window.closeFolderModal=closeFolderModal;
	window.submitFolderEdit=submitFolderEdit;
window.closeLinkModal=closeLinkModal;
window.submitLink=submitLink;
window.closeHistoryModal=closeHistoryModal;
window.openHistoryModal=openHistoryModal;
window.selectHistorySnapshot=selectHistorySnapshot;
window.restoreHistorySnapshot=restoreHistorySnapshot;
window.setEditorMode=setEditorMode;
window.wrapSel=wrapSel;
window.insertPfx=insertPfx;
window.insertTxt=insertTxt;
window.insertStamp=insertStamp;
window.clearFormat=clearFormat;
window.insertLink=insertLink;
window.insertImg=insertImg;
window.uploadFile=uploadFile;
window.openCodeModal=openCodeModal;
window.closeCodeModal=closeCodeModal;
window.submitCode=submitCode;
window.handleDrop=handleDrop;
window.undoSnapshot=undoSnapshot;
window.searchNavStep=searchNavStep;
window.searchNavDismiss=searchNavDismiss;
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
})(); // end main IIFE
