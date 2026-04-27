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

var _defaultNoteOpenMode=_cfg.noteOpenMode||'preview';
var _mobileStartup=_cfg.mobileStartup||null;
var _phoneMaxWidth=599;
var _mobileShellMaxWidth=768;
function viewportWidth(){return Math.max(window.innerWidth||0,document.documentElement&&document.documentElement.clientWidth||0)}
function isPhoneMode(){return viewportWidth()<=_phoneMaxWidth}
function isTabletMode(){var w=viewportWidth();return w>_phoneMaxWidth&&w<=_mobileShellMaxWidth}
function isMobileShellMode(){return viewportWidth()<=_mobileShellMaxWidth}
function isDesktopMode(){return !isMobileShellMode()}
(function(){var serverTheme=_cfg.theme||'matrix';var s=localStorage.getItem('joplock-theme');var e=document.querySelector('.theme-picker');if(s&&s!==serverTheme){localStorage.setItem('joplock-theme',serverTheme)}if(e)e.value=serverTheme})();
window.addEventListener('pageshow',function(e){if(e.persisted)window.location.replace('/login')});
function setMobileNav(open){var nav=document.getElementById('nav-panel');var bd=document.getElementById('mobile-nav-backdrop');if(!nav||!bd)return;nav.classList.toggle('open',open);bd.classList.toggle('open',open);document.body.classList.toggle('mobile-nav-open',open)}
function toggleNav(){if(isMobileShellMode()){var nav=document.getElementById('nav-panel');if(!nav)return;setMobileNav(!nav.classList.contains('open'))}else{document.body.classList.toggle('nav-collapsed');localStorage.setItem('joplock-nav-collapsed',document.body.classList.contains('nav-collapsed')?'1':'')}}
function closeNav(){setMobileNav(false)}
(function(){if(localStorage.getItem('joplock-nav-collapsed')==='1')document.body.classList.add('nav-collapsed')})();
function activeEditorForm(){if(isMobileShellMode()){var mobileBody=document.getElementById('mobile-editor-body');var mobileForm=mobileBody&&mobileBody.querySelector?mobileBody.querySelector('#note-editor-form'):null;if(mobileForm)return mobileForm}return document.getElementById('note-editor-form')}
function queryActiveEditor(selector){var form=activeEditorForm();return form&&form.querySelector?form.querySelector(selector):null}
function activeEditorMeta(){if(isMobileShellMode()){var mobileBody=document.getElementById('mobile-editor-body');var mobileMeta=mobileBody&&mobileBody.querySelector?mobileBody.querySelector('#note-meta'):null;if(mobileMeta)return mobileMeta}return document.getElementById('note-meta')}
function setSaveState(html,text){var s=queryActiveEditor('#autosave-status');if(s)s.innerHTML=html||'';var mobile=document.getElementById('mobile-editor-status');if(mobile)mobile.innerHTML=text?html:''}
function markEdited(){setSaveState('<span class="autosave-edited">Edited</span>','Edited');_log('markEdited')}
function renderNoteMeta(){var meta=activeEditorMeta();if(!meta)return;var c=Number(meta.getAttribute('data-created-time')||0),u=Number(meta.getAttribute('data-updated-time')||0);if(!c&&!u){meta.textContent='';return}var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var fmt=function(ts){if(!ts)return '';var d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'-'+months[d.getMonth()]+'-'+String(d.getFullYear()).slice(-2)};meta.textContent='Created '+fmt(c)+' | Edited '+fmt(u)}
var _folderMenuState={id:'',title:''};
function closeFolderContextMenu(){var menu=document.getElementById('folder-context-menu');if(menu)menu.hidden=true}
function openFolderContextMenu(event,id,title){if(event){event.preventDefault();event.stopPropagation()}var menu=document.getElementById('folder-context-menu');if(!menu)return false;_folderMenuState={id:id,title:title};menu.hidden=false;menu.style.left=(event.clientX||16)+'px';menu.style.top=(event.clientY||16)+'px';return false}
function closeFolderModal(){var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(modal)modal.hidden=true;if(backdrop)backdrop.hidden=true}
function openFolderModal(){var input=document.getElementById('folder-edit-title');var modal=document.getElementById('folder-modal');var backdrop=document.getElementById('folder-modal-backdrop');if(input)input.value=_folderMenuState.title||'';if(modal)modal.hidden=false;if(backdrop)backdrop.hidden=false;closeFolderContextMenu();if(input)input.focus()}
function editFolderFromMenu(){if(!_folderMenuState.id)return;openFolderModal()}
function deleteFolderFromMenu(){if(!_folderMenuState.id)return;closeFolderContextMenu();if(confirm('Delete notebook "'+(_folderMenuState.title||'Untitled')+'"?')){htmx.ajax('DELETE','/fragments/folders/'+encodeURIComponent(_folderMenuState.id),{target:'#nav-panel',swap:'innerHTML'})}}
function submitFolderEdit(event){if(event)event.preventDefault();var input=document.getElementById('folder-edit-title');var title=input?input.value.trim():'';if(!_folderMenuState.id||!title)return false;htmx.ajax('PUT','/fragments/folders/'+encodeURIComponent(_folderMenuState.id),{target:'#nav-panel',swap:'innerHTML',values:{title:title}});closeFolderModal();return false}
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
function syncEditorModeButtons(){var previewVisible=!!getPV();var markdownVisible=isMarkdownVisible();var mode=previewVisible?'preview':'markdown';_editorMode=mode;var mdBtn=document.getElementById('markdown-toggle');var pvBtn=document.getElementById('preview-toggle');if(mdBtn)mdBtn.classList.toggle('active',mode==='markdown');if(pvBtn)pvBtn.classList.toggle('active',mode==='preview');var mMd=document.getElementById('mobile-md-toggle');var mPv=document.getElementById('mobile-preview-toggle');if(mMd)mMd.classList.toggle('active',mode==='markdown');if(mPv)mPv.classList.toggle('active',mode==='preview');var tb=document.getElementById('editor-toolbar');if(tb&&inMobileEditor())tb.style.display='flex';document.body.classList.toggle('mobile-markdown-mode',inMobileEditor()&&mode==='markdown')}
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
function stripMdForTitle(s){var t=String(s||'').trim();while(t.charAt(0)==='#')t=t.slice(1).trimStart();t=t.split('**').join('').split('__').join('').split('++').join('').split('*').join('').split('_').join('').split('~~').join('').split(String.fromCharCode(96)).join('');var out='';for(var i=0;i<t.length;i++){var ch=t.charAt(i);if(ch==='!'&&t.charAt(i+1)==='['){var altEnd=t.indexOf(']',i+2);var imgOpen=altEnd>=0?t.indexOf('(',altEnd+1):-1;var imgClose=imgOpen>=0?t.indexOf(')',imgOpen+1):-1;if(altEnd>=0&&imgOpen===altEnd+1&&imgClose>=0){out+=t.slice(i+2,altEnd);i=imgClose;continue}}if(ch==='['){var labelEnd=t.indexOf(']',i+1);var linkOpen=labelEnd>=0?t.indexOf('(',labelEnd+1):-1;var linkClose=linkOpen>=0?t.indexOf(')',linkOpen+1):-1;if(labelEnd>=0&&linkOpen===labelEnd+1&&linkClose>=0){out+=t.slice(i+1,labelEnd);i=linkClose;continue}}out+=ch}return out.trim()}
function syncTitle(){var ti=queryActiveEditor('.editor-title');var hi=queryActiveEditor('.editor-title-hidden');var mobileTitle=document.getElementById('mobile-editor-title');if(ti&&hi){var plain=stripMdForTitle(ti.textContent);hi.value=plain;hi.dispatchEvent(new Event('input',{bubbles:true}));ti.textContent=plain;if(mobileTitle)mobileTitle.textContent=plain||'Note';markEdited();scheduleSaveTitle()}}
function initAutoTitle(){_titleManual=false;var ti=queryActiveEditor('.editor-title');if(ti){ti.addEventListener('input',function(){_titleManual=true;syncTitle()})}}
function autoTitle(){if(_titleManual)return;var ta=getTA();var ti=queryActiveEditor('.editor-title');var mobileTitle=document.getElementById('mobile-editor-title');if(!ta||!ti)return;var val=ta.value;var lines=val.split('\n');var first='';for(var i=0;i<lines.length;i++){var l=lines[i].replace(/^#+\s*/,'').trim();if(l){first=l;break}}var firstPlain=stripMdForTitle(first);if(firstPlain&&firstPlain!==ti.textContent){ti.textContent=firstPlain;if(mobileTitle)mobileTitle.textContent=firstPlain||'Note';var hi=queryActiveEditor('.editor-title-hidden');if(hi){hi.value=firstPlain;hi.dispatchEvent(new Event('input',{bubbles:true}))}}}
function pad2(value){return String(value).padStart(2,'0')}
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
	// Empty divs from contenteditable (Enter key creates <div><br></div>) — emit <br> for blank line
	td.addRule('emptyDiv',{filter:function(n){return n.nodeName==='DIV'&&!n.classList.length&&!n.querySelector('img,a,pre,code,ul,ol,blockquote,table')&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '<br>'}});
	// Empty paragraphs from contenteditable (<p><br></p>) — emit <br> for blank line
	td.addRule('emptyP',{filter:function(n){return n.nodeName==='P'&&!n.querySelector('img')&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '<br>'}});
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
function scheduleSave(){if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=setTimeout(function(){_saveTimer=null;if(_syncPVInFlight||_pvSyncTimer){_log('scheduleSave deferred, syncPV in flight');scheduleSave();return}if(_anyModalOpen()){_log('scheduleSave deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSave skip, hash unchanged',h);setSaveState('<span class="autosave-ok">Saved</span>','Saved');return}_log('scheduleSave firing, hash',_savedHash,'->',h);htmx.trigger(form,'joplock:save')},2000)}
function scheduleSaveTitle(){if(_saveTitleTimer)clearTimeout(_saveTitleTimer);if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=null;_saveTitleTimer=setTimeout(function(){_saveTitleTimer=null;if(_anyModalOpen()){_log('scheduleSaveTitle deferred, modal open');scheduleSave();return}var form=activeEditorForm();if(!form)return;var h=formHash(form);if(h===_savedHash){_log('scheduleSaveTitle skip, hash unchanged',h);setSaveState('<span class="autosave-ok">Saved</span>','Saved');return}_log('scheduleSaveTitle firing');htmx.trigger(form,'joplock:save')},1000)}
function snapshotHash(){var form=activeEditorForm();_savedHash=formHash(form);_log('snapshotHash',_savedHash)}
function initEditorPanel(){var form=activeEditorForm();if(!form||form.dataset.editorInit)return;form.dataset.editorInit='1';_log('initEditorPanel',form.getAttribute('hx-put'));if(isMobileShellMode())closeNav();_previewDirty=false;setSaveState('','');snapshotHash();_snapshots=[];var undoBtn=queryActiveEditor('#undo-save-btn');if(undoBtn)undoBtn.hidden=true;pushSnapshot();form.addEventListener('input',function(){markEdited();scheduleSave()});form.addEventListener('change',function(){markEdited();scheduleSave()});initAutoTitle();applyMobileTitleMode();renderNoteMeta();var ta=getTA();if(ta){ta.addEventListener('input',function(){autoTitle()})}var pendingSearch=(window._pendingNoteSearchTerm||'').trim();var mobileEditor=inMobileEditor();if(mobileEditor&&pendingSearch){var header=document.getElementById('mobile-editor-header');var searchHeader=document.getElementById('mobile-editor-search-header');if(header)header.style.display='none';if(searchHeader)searchHeader.style.display=''}var searchInput=activeSearchInput();if(searchInput&&pendingSearch&&!searchInput.value)searchInput.value=pendingSearch;window._pendingNoteSearchTerm='';var pv=queryActiveEditor('#note-preview');var host=queryActiveEditor('#cm-host');var defaultMode=form.dataset.editorMode||_defaultNoteOpenMode||'preview';if(defaultMode!=='markdown')defaultMode='preview';form.dataset.editorMode=defaultMode;if(defaultMode==='preview'&&pv&&pv.style.display!=='none'){_editorMode='preview';activatePV(pv);_previewDirty=false;if(host)host.style.display='none';syncEditorModeButtons();applySearchHighlight()}else{_editorMode='markdown';form.dataset.editorMode='markdown';if(pv)pv.style.display='none';if(host){host.style.display='';initCM(host,ta?ta.value:'')}syncEditorModeButtons();applySearchHighlight()}}
function applySearchHighlight(){var term=activeSearchTerm();var bar=document.getElementById('search-nav-bar');if(bar)bar.hidden=true;_searchMarks=[];_searchMarkIdx=0;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);if(!term||!term.trim()){clearCodeMirrorSearch();return}term=term.trim();if(_editorMode==='preview'&&pv){clearCodeMirrorSearch();var savedHandler=pv.oninput;pv.oninput=null;highlightInPreview(pv,term);pv.oninput=savedHandler}else if(_editorMode==='markdown'&&_cmView&&window.CM&&window.CM.SearchQuery&&window.CM.setSearchQuery){			window.CM.openSearchPanel(_cmView);var q=new window.CM.SearchQuery({search:term,caseSensitive:false});_cmView.dispatch({effects:window.CM.setSearchQuery.of(q)});_cmSearchMatches=collectCodeMirrorSearchMatches(q);if(_cmSearchMatches.length)setCodeMirrorSearchActive(0);else searchNavShow(0,0)}}
function escapeRegex(s){var specials=['.','+','*','?','^','$','(',')','{','}','[',']','|','\\'];return s.split('').map(function(c){return specials.indexOf(c)>=0?'\\'+c:c}).join('')}
var _searchMarks=[];var _searchMarkIdx=0;
function searchNavShow(total,idx){var bar=document.getElementById('search-nav-bar');var counter=document.getElementById('search-nav-counter');if(bar){if(total===0){bar.hidden=true}else{bar.hidden=false;if(counter)counter.textContent=(idx+1)+' / '+total}}var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(mobileCounter){mobileCounter.hidden=total===0;if(total>0)mobileCounter.textContent=(idx+1)+' / '+total}if(mobilePrev)mobilePrev.hidden=total===0;if(mobileNext)mobileNext.hidden=total===0}
function searchNavSetActive(idx){_searchMarks.forEach(function(m,i){m.classList.toggle('search-highlight-active',i===idx)});var m=_searchMarks[idx];if(m)m.scrollIntoView({block:'center',behavior:'smooth'})}
function searchNavStep(dir){if(_editorMode==='markdown'&&_cmSearchMatches.length){setCodeMirrorSearchActive(_searchMarkIdx+dir);return}if(!_searchMarks.length)return;_searchMarkIdx=(_searchMarkIdx+dir+_searchMarks.length)%_searchMarks.length;searchNavSetActive(_searchMarkIdx);searchNavShow(_searchMarks.length,_searchMarkIdx)}
function searchNavDismiss(){var bar=document.getElementById('search-nav-bar');var mobileCounter=document.getElementById('mobile-search-nav-counter');var mobilePrev=document.getElementById('mobile-search-prev-btn');var mobileNext=document.getElementById('mobile-search-next-btn');if(bar)bar.hidden=true;if(mobileCounter)mobileCounter.hidden=true;if(mobilePrev)mobilePrev.hidden=true;if(mobileNext)mobileNext.hidden=true;var pv=queryActiveEditor('#note-preview');if(pv)clearPreviewSearchMarks(pv);_searchMarks=[];_searchMarkIdx=0;clearCodeMirrorSearch()}
function highlightInPreview(pv,term){if(!pv||!term)return;_searchMarks=[];_searchMarkIdx=0;var walker=document.createTreeWalker(pv,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentElement&&n.parentElement.closest('script,style,mark')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}},false);var nodes=[];var node;while((node=walker.nextNode()))nodes.push(node);var re=new RegExp(escapeRegex(term),'gi');nodes.forEach(function(n){var matches=[];var m;re.lastIndex=0;while((m=re.exec(n.textContent))!==null)matches.push({start:m.index,end:m.index+m[0].length});if(!matches.length)return;var frag=document.createDocumentFragment();var last=0;matches.forEach(function(r){if(r.start>last)frag.appendChild(document.createTextNode(n.textContent.slice(last,r.start)));var mark=document.createElement('mark');mark.className='search-highlight';mark.textContent=n.textContent.slice(r.start,r.end);_searchMarks.push(mark);frag.appendChild(mark);last=r.end});if(last<n.textContent.length)frag.appendChild(document.createTextNode(n.textContent.slice(last)));n.parentNode.replaceChild(frag,n)});if(_searchMarks.length){searchNavSetActive(0);searchNavShow(_searchMarks.length,0)}else{searchNavShow(0,0)}}
function initNavPanel(){_log('initNavPanel');var state=navFolderState();document.querySelectorAll('.nav-folder').forEach(function(el){var id=el.getAttribute('data-folder-id');var selected=el.getAttribute('data-selected')==='1';var open=state[id]===true||state[id]==='1'||state[id]===1;if(state[id]===undefined)open=el.getAttribute('data-all-notes')==='1';if(selected)open=true;el.classList.toggle('collapsed',!open);// Lazy-load if expanded and not yet loaded
	if(open){var notesDiv=el.querySelector('.nav-folder-notes[data-folder-id]');if(notesDiv&&!notesDiv.getAttribute('data-loaded')){notesDiv.setAttribute('data-loaded','1');var folderId=notesDiv.getAttribute('data-folder-id');htmx.ajax('GET','/fragments/folder-notes?folderId='+encodeURIComponent(folderId),{target:notesDiv,swap:'innerHTML'})}}})}
document.body.addEventListener('htmx:afterSettle',function(){initNavPanel();initEditorPanel()});
document.body.addEventListener('htmx:confirm',function(e){var elt=e.detail&&e.detail.elt;if(!elt)return;var msg=elt.getAttribute('data-confirm-trash');if(msg){e.preventDefault();if(window._s&&!window._s.confirmTrash){e.detail.issueRequest(true);return}if(confirm(msg))e.detail.issueRequest(true)}});
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
window.addEventListener('load',function(){initNavPanel();initEditorPanel()});
window.addEventListener('resize',applyMobileTitleMode);
document.addEventListener('keydown',function(e){var mac=navigator.platform&&navigator.platform.indexOf('Mac')!==-1;var mod=mac?e.metaKey:e.ctrlKey;if(mod&&e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undoSnapshot()}});
	function flushSave(callback){var form=activeEditorForm();var status=queryActiveEditor('#autosave-status');var dirty=status&&status.querySelector('.autosave-edited');if(!form||!dirty){_log('flushSave skip (not dirty)');if(callback)callback(true);return}if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}if(_saveTitleTimer){clearTimeout(_saveTitleTimer);_saveTitleTimer=null}var pv=getPV();if(pv)syncPV();else cmSyncToTA();syncTitle();var fd=new FormData(form);var url=form.getAttribute('hx-put');if(!url){if(callback)callback(true);return}var body=new URLSearchParams(fd).toString();_log('flushSave',url);fetch(url,{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(function(html){_log('flushSave ok',html.slice(0,80));snapshotHash();window._mobileNewNoteId=null;setSaveState('<span class="autosave-ok">Saved</span>','Saved');if(callback)callback(true)}).catch(function(err){_log('flushSave error',err);showOffline();if(callback)callback(false)})}
document.addEventListener('click',function(e){var btn=e.target.closest('.notelist-item');if(!btn)return;var form=document.getElementById('note-editor-form');var status=document.getElementById('autosave-status');var dirty=status&&status.querySelector('.autosave-edited');if(!form||!dirty)return;_log('notelist-item click intercepted, flushing save');e.preventDefault();e.stopImmediatePropagation();flushSave(function(saved){if(saved){_log('flushSave done, re-clicking note');btn.click()}})},true);
window.joplockLiveSearch=_cfg.liveSearch||false;
(function(){var _navSearchSavedValue=null;function enableLiveSearch(){var el=document.getElementById('nav-search');if(!el||!window.joplockLiveSearch||el.dataset.liveSearch)return;el.dataset.liveSearch='1';el.setAttribute('hx-trigger','search-submit, input changed delay:300ms');el.addEventListener('htmx:beforeRequest',function(e){var v=el.value;if(v.length>0&&v.length<3){e.preventDefault();return}});htmx.process(el)}function restoreNavSearch(){if(_navSearchSavedValue===null)return;var el=document.getElementById('nav-search');if(!el){_navSearchSavedValue=null;return;}el.value=_navSearchSavedValue;el.selectionStart=el.selectionEnd=el.value.length;_navSearchSavedValue=null}enableLiveSearch();document.body.addEventListener('htmx:beforeSwap',function(e){var target=e.detail&&e.detail.target;if(target&&target.id==='nav-panel'){var el=document.getElementById('nav-search');if(el)_navSearchSavedValue=el.value}});document.body.addEventListener('htmx:afterSettle',function(){enableLiveSearch();restoreNavSearch()})})();
function confirmLogout(event){
	var ok=window.confirm('Log out?\n\nThis clears local data on this device, including the current session and saved UI state. Your notes and other server data remain on the server.');
	if(!ok&&event)event.preventDefault();
	return ok;
}
// --- Mobile navigation ---
(function(){
	var _mobileStack=[];// 'folders' | 'notes' | 'editor'
	var _mobileFolderId='';
	var _mobileFolderTitle='';
	var _mobileNoteId='';
	var _mobileInitDone=false;
	function isMobile(){return isMobileShellMode()}
	function mobileResumeTarget(){
		if(!_mobileStartup||!_mobileStartup.noteId)return null;
		return {
			folderId:_mobileStartup.folderId||'',
			folderTitle:_mobileStartup.folderTitle||'Notes',
			noteId:_mobileStartup.noteId,
			noteTitle:_mobileStartup.noteTitle||'Note',
		};
	}
	function mobileScreenId(name){return'mobile-'+name+'-screen'}
	function showMobileScreen(name,dir){
		var screens=['folders','notes','editor'];
		screens.forEach(function(s){
			var el=document.getElementById(mobileScreenId(s));
			if(!el)return;
			if(s===name){el.classList.remove('mobile-screen-right','mobile-screen-left');el.classList.add('mobile-screen-active')}
			else{el.classList.remove('mobile-screen-active');el.classList.add(dir==='forward'?'mobile-screen-left':'mobile-screen-right')}
		})
	}
	window.mobilePushNotes=function(folderId,folderTitle){
		if(!isMobile())return;
		_mobileFolderId=folderId;_mobileFolderTitle=folderTitle||'Notes';
		_mobileStack=['folders','notes'];
		var titleEl=document.getElementById('mobile-notes-title');if(titleEl)titleEl.textContent=_mobileFolderTitle;
		var body=document.getElementById('mobile-notes-body');if(body)body.innerHTML='<div class="empty-hint" style="padding:16px">Loading...</div>';
		showMobileScreen('notes','forward');
		htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(folderId),{target:'#mobile-notes-body',swap:'innerHTML'});
	};
	window.mobilePushEditor=function(noteId,folderId){
		if(!isMobile())return;
		_mobileNoteId=noteId;
		_mobileStack=['folders','notes','editor'];
		window.mobileEditorSearchClose();
		showMobileScreen('editor','forward');
		var body=document.getElementById('mobile-editor-body');if(body)body.innerHTML='<div class="editor-empty mobile-loading-note"><div class="note-loading-ring"></div></div>';
		htmx.ajax('GET','/fragments/editor/'+encodeURIComponent(noteId)+'?currentFolderId='+encodeURIComponent(folderId||_mobileFolderId),{target:'#mobile-editor-body',swap:'innerHTML'}).then(function(){hideNoteOverlay()}).catch(function(){hideNoteOverlay()});
	};
	window.mobilePopScreen=function(){
		if(!isMobile())return;
		_mobileStack.pop();
		var current=_mobileStack[_mobileStack.length-1]||'folders';
		showMobileScreen(current,'back');
		if(current==='folders'){
			// flush any dirty save when leaving editor
			flushSave(function(){})
		}
	};
	window.mobileEditorBack=function(){
		var form=document.getElementById('note-editor-form');
		var titleEl=form&&form.querySelector('.editor-title');
		var bodyEl=form&&form.querySelector('#note-body');
		var noteId=_mobileNoteId;
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
		if(_mobileFolderId){
			var body=document.getElementById('mobile-notes-body');
			if(body)htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_mobileFolderId),{target:'#mobile-notes-body',swap:'innerHTML'});
		}
	}
	window.mobileNewNote=function(){
		var fid=_mobileStack.indexOf('notes')>=0?_mobileFolderId:'';
		console.error('[mobile] mobileNewNote called', { stack:_mobileStack.slice(), fid:fid, folderId:_mobileFolderId });
		htmx.ajax('POST','/fragments/mobile/notes/new',{target:'#mobile-notes-body',swap:'innerHTML',values:{folderId:fid||''}});
		console.error('[mobile] mobileNewNote POST fired');
	};
	window.mobileFabOpen=function(){
		if(_mobileStack[_mobileStack.length-1]==='notes') return mobileNewNote();
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
		_mobileFolderId='__all__';
		_mobileFolderTitle='All Notes';
		var titleEl=document.getElementById('mobile-notes-title');if(titleEl)titleEl.textContent='All Notes';
		showMobileScreen('notes','forward');
		_mobileStack=['folders','notes'];
		mobileNewNote();
	};
	window.mobileFabNewFolder=function(){
		mobileFabClose();
		var title=prompt('New folder name:');
		if(!title||!title.trim())return;
		htmx.ajax('POST','/fragments/folders',{target:'#mobile-folders-body',swap:'none',values:{title:title.trim(),parentId:''}}).then(function(){
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
		});
	};
	window.mobileNewNoteInFolder=function(folderId,folderTitle,event){
		if(event){event.preventDefault();event.stopPropagation();}
		_mobileFolderId=folderId;
		_mobileFolderTitle=folderTitle||'Notes';
		var titleEl=document.getElementById('mobile-notes-title');if(titleEl)titleEl.textContent=_mobileFolderTitle;
		showMobileScreen('notes','forward');
		_mobileStack=['folders','notes'];
		mobileNewNote();
	};
	// Context menu (long-press on note rows)
	var _ctxNoteId=null,_ctxNoteTitle=null,_ctxLongPressTimer=null;
	function mobileCtxOpen(noteId,noteTitle){
		_ctxNoteId=noteId;_ctxNoteTitle=noteTitle;
		var backdrop=document.getElementById('mobile-ctx-backdrop');
		var sheet=document.getElementById('mobile-ctx-sheet');
		var titleEl=document.getElementById('mobile-ctx-title');
		var delBtn=document.getElementById('mobile-ctx-delete');
		if(titleEl)titleEl.textContent=noteTitle||'Untitled';
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
	function mobileCtxDelete(){
		if(!_ctxNoteId)return;
		var id=_ctxNoteId;
		mobileCtxClose();
		if(window._s&&window._s.confirmTrash&&!confirm('Move this note to trash?'))return;
		fetch('/fragments/notes/'+encodeURIComponent(id),{method:'DELETE',headers:{'hx-request':'true','hx-params':'none'}})
			.then(function(){mobileRefreshNotes()});
	}
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
		document.getElementById('mobile-app').setAttribute('aria-hidden','false');
		if(_mobileInitDone)return;
		_mobileInitDone=true;
		var resume=mobileResumeTarget();
		if(resume){
			_mobileFolderId=resume.folderId;
			_mobileFolderTitle=resume.folderTitle;
			_mobileNoteId=resume.noteId;
			_mobileStack=['folders','notes','editor'];
			var notesTitle=document.getElementById('mobile-notes-title');if(notesTitle)notesTitle.textContent=_mobileFolderTitle;
			var editorTitle=document.getElementById('mobile-editor-title');if(editorTitle)editorTitle.textContent=resume.noteTitle;
			showMobileScreen('editor','forward');
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
			htmx.ajax('GET','/fragments/mobile/notes?folderId='+encodeURIComponent(_mobileFolderId),{target:'#mobile-notes-body',swap:'innerHTML'});
		}else{
			_mobileStack=['folders'];
			showMobileScreen('folders','forward');
			htmx.ajax('GET','/fragments/mobile/folders',{target:'#mobile-folders-body',swap:'innerHTML'});
		}
		var fab=document.getElementById('mobile-fab');
		if(fab&&!fab.dataset.debugWired){
			fab.dataset.debugWired='1';
			fab.addEventListener('click',function(ev){
				var r=fab.getBoundingClientRect();
				var topEl=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
				console.log('[mobile] FAB click heard', { display:getComputedStyle(fab).display, z:getComputedStyle(fab).zIndex, rect:{x:r.x,y:r.y,w:r.width,h:r.height}, topEl:topEl&&topEl.id, topTag:topEl&&topEl.tagName });
			});
			fab.addEventListener('touchstart',function(){
				console.log('[mobile] FAB touchstart heard');
			},{passive:true});
		}
		var headerNewBtn=document.querySelector('#mobile-notes-screen .mobile-header button[title="New note"]');
		if(headerNewBtn&&!headerNewBtn.dataset.debugWired){
			headerNewBtn.dataset.debugWired='1';
			headerNewBtn.addEventListener('click',function(){
				console.log('[mobile] header + click heard');
			});
			headerNewBtn.addEventListener('touchstart',function(){
				console.log('[mobile] header + touchstart heard');
			},{passive:true});
		}
		// Swipe right to go back
		var startX=0,startY=0,swiping=false;
		document.getElementById('mobile-app').addEventListener('touchstart',function(e){startX=e.touches[0].clientX;startY=e.touches[0].clientY;swiping=true},{passive:true});
			document.getElementById('mobile-app').addEventListener('touchend',function(e){
				if(!swiping)return;swiping=false;
				var dx=e.changedTouches[0].clientX-startX;
				var dy=e.changedTouches[0].clientY-startY;
				if(Math.abs(dx)>Math.abs(dy)*1.5&&dx>60&&_mobileStack.length>1){mobileEditorBack()}
			},{passive:true});
	}
	function syncResponsiveMode(){
		if(isMobile()){
			mobileInit();
			return;
		}
		var app=document.getElementById('mobile-app');
		if(app)app.setAttribute('aria-hidden','true');
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
			if(_cmView){_cmView.destroy();_cmView=null}
			initEditorPanel();
			var titleInput=t.querySelector('.editor-title');
			var titleEl=document.getElementById('mobile-editor-title');
			if(titleEl&&titleInput)titleEl.textContent=titleInput.textContent||'Note';
			var mobileStatus=document.getElementById('mobile-editor-status');
			if(mobileStatus){
				var dirty=t.querySelector('#autosave-status .autosave-edited');
				var saved=t.querySelector('#autosave-status .autosave-ok');
				mobileStatus.innerHTML=dirty?'<span class="autosave-edited">Edited</span>':(saved?'<span class="autosave-ok">Saved</span>':'');
			}
			// Update title dynamically as user edits
			if(titleInput&&titleEl){titleInput.addEventListener('input',function(){titleEl.textContent=titleInput.textContent||'Note'})}
			// Hide desktop titlebar in mobile editor
			var titlebar=t.querySelector('.editor-titlebar');
			if(titlebar&&isMobile())titlebar.style.display='none';
			// Wire delete button
			var form=t.querySelector('#note-editor-form');
			var noteId=form?decodeURIComponent((form.getAttribute('hx-put')||'').replace('/fragments/editor/','')):'';
			var isDeleted=!!t.querySelector('.btn-danger[hx-confirm*="Permanently"]');
			wireMobileDeleteBtn(noteId,isDeleted);
			// Show FAB only when on notes screen
			var fab=document.getElementById('mobile-fab');if(fab)fab.style.display='none';
			// Position toolbar above keyboard using visualViewport
			initMobileToolbar();
		}
		if(t&&(t.id==='mobile-notes-body'||t.id==='mobile-folders-body')){
			var fab=document.getElementById('mobile-fab');
			if(fab)fab.style.display=(t.id==='mobile-notes-body'||t.id==='mobile-folders-body')?'flex':'none';
			wireNoteRowLongPress(t);
		}
	});
	// Handle new note response: push to editor
	document.body.addEventListener('htmx:afterRequest',function(e){
		var t=e.detail&&e.detail.target;
		console.log('[mobile] htmx:afterRequest target=',t&&t.id,'xhr status=',e.detail.xhr&&e.detail.xhr.status);
		if(t&&t.id==='mobile-notes-body'){
			var xhr=e.detail.xhr;
			var noteId=xhr&&xhr.getResponseHeader('X-Mobile-Note-Id');
			console.log('[mobile] notes-body afterRequest noteId=',noteId);
			if(noteId){window._mobileNewNoteId=noteId;mobilePushEditor(noteId,_mobileFolderId)}
		}
	});
	window.addEventListener('resize',syncResponsiveMode);
	syncResponsiveMode();
})();
// Expose functions needed by inline hx-on/onclick handlers (called from global scope by htmx eval)
window.isMobileShellMode=isMobileShellMode;
window.closeNav=closeNav;
window.toggleNav=toggleNav;
window.toggleNavFolder=toggleNavFolder;
window.openFolderContextMenu=openFolderContextMenu;
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
})(); // end main IIFE
