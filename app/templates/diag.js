// Device diagnostics page (GET /diag, debug mode only). A mock of the mobile shell that measures
// viewport / safe-area / soft-keyboard behaviour on a REAL phone (installed PWA or browser) and
// posts flat snapshots to /api/web/client-log, where they appear in `docker logs` as
// "[joplock client] diag.viewport {...}". It exists so layout work can be compared on real
// hardware before the real editor is changed: `?shell=current` is today's fixed-inset shell,
// `?shell=vv` is the herdr-web-ui approach (shell height follows visualViewport while the
// keyboard is up). No dependencies on app.js.
'use strict';

const SHELLS = ['current', 'vv'];

const diagOptions = query => {
	const get = key => (query && typeof query.get === 'function' ? query.get(key) : (query || {})[key]);
	const shell = SHELLS.includes(get('shell')) ? get('shell') : 'current';
	return { shell, iw: get('iw') === '1', zoom: get('zoom') === '1' };
};

const viewportContent = ({ iw, zoom }) => [
	'width=device-width',
	'initial-scale=1.0',
	zoom ? null : 'maximum-scale=1.0',
	zoom ? null : 'user-scalable=no',
	'viewport-fit=cover',
	iw ? 'interactive-widget=resizes-content' : null,
].filter(Boolean).join(', ');

const diagPage = (options = {}) => {
	const { shell, iw, zoom } = diagOptions(options.query || options);
	const config = JSON.stringify({ shell, iw, zoom });
	const link = (label, params) => {
		const active = params.shell === shell && (params.iw === '1') === iw && (params.zoom === '1') === zoom;
		const href = `/diag?${Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')}`;
		return `<a href="${href}"${active ? ' class="on"' : ''}>${label}</a>`;
	};
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="${viewportContent({ iw, zoom })}" />
<meta name="theme-color" content="#2a3446" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="manifest" href="/manifest.webmanifest" />
<title>Joplock device diagnostics</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;overscroll-behavior:none;background:#14181f;color:#e8ecf2;font:13px/1.35 -apple-system,system-ui,sans-serif}
body{position:fixed;inset:0;width:100%}
#shell{position:fixed;left:0;right:0;top:0;display:flex;flex-direction:column;background:#1b2230;overflow:hidden}
#shell.shell-current{bottom:0}
#shell.shell-vv{height:var(--app-height,100dvh)}
#hdr{flex:none;height:calc(44px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) 8px 0;display:flex;align-items:center;gap:8px;background:#2a3446;border-bottom:1px solid #3a475e}
#hdr b{flex:1;font-size:15px}
#hdr a,#bar a{color:#8fd3e6;text-decoration:none;padding:8px 6px}
#panel{flex:none;max-height:36%;overflow:auto;padding:6px 10px;background:#161c28;border-bottom:1px solid #3a475e;-webkit-overflow-scrolling:touch}
#out{font:10.5px/1.3 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
#variants{display:flex;flex-wrap:wrap;gap:4px 10px;padding:4px 0}
#variants a{color:#8fd3e6;padding:4px 0}
#variants a.on{color:#fff;font-weight:700;text-decoration:underline}
details{margin:4px 0;color:#b9c3d3}
summary{padding:4px 0}
details p{padding:2px 0}
#edit{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;padding:8px}
#edit iframe{flex:none;height:64px;width:100%;border:1px solid #3a475e;border-radius:6px;background:#10151f}
#edit input,#edit textarea{width:100%;font-size:16px;color:#e8ecf2;background:#10151f;border:1px solid #3a475e;border-radius:6px;padding:8px;font-family:inherit}
#edit input{flex:none}
#edit textarea{flex:1;min-height:60px;resize:none}
#bar{flex:none;display:flex;align-items:center;gap:6px;padding:6px 8px calc(6px + env(safe-area-inset-bottom,0px));background:#2a3446;border-top:1px solid #3a475e}
#bar select,#bar button{font-size:14px;padding:6px 8px;color:#e8ecf2;background:#10151f;border:1px solid #3a475e;border-radius:6px}
#bar select{flex:1;min-width:0}
#status{flex:none;font-size:11px;padding:0 10px 4px;color:#9fb0c8;background:#2a3446}
#probes{position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none}
#probes i{display:block;width:0}
</style>
</head>
<body>
<div id="probes" aria-hidden="true">
<i id="p-vh" style="height:100vh"></i><i id="p-dvh" style="height:100dvh"></i><i id="p-svh" style="height:100svh"></i><i id="p-lvh" style="height:100lvh"></i>
<i id="p-st" style="height:env(safe-area-inset-top,0px)"></i><i id="p-sb" style="height:env(safe-area-inset-bottom,0px)"></i>
<i id="p-sl" style="height:env(safe-area-inset-left,0px)"></i><i id="p-sr" style="height:env(safe-area-inset-right,0px)"></i>
</div>
<div id="shell" class="shell-${shell}">
<div id="hdr"><a href="/settings?tab=about">&lsaquo; Back</a><b>Diagnostics &middot; ${shell}${iw ? ' + iw' : ''}${zoom ? ' + zoom' : ''}</b></div>
<div id="panel">
<div id="variants">${link('current', { shell: 'current' })}${link('vv shell', { shell: 'vv' })}${link('vv + interactive-widget', { shell: 'vv', iw: '1' })}${link('current + zoom allowed', { shell: 'current', zoom: '1' })}</div>
<details><summary>How to test (tap)</summary>
<p>Reports send themselves (two samples, 0.7s and 1.8s after each event) and are only logged on the server; nothing touches your notes. Run each variant link below; do it in the installed Home Screen app, and once in the browser tab.</p>
<p>1. Open the page and leave it alone for 3s (<b>load</b>).</p>
<p>2. Tap the top box (iframe, like the rich editor), wait 3s. Dismiss the keyboard (Done / tap outside), wait 3s. Repeat for the single-line field and the big box. While the keyboard is up, look: does the header stay at the top? Is the bottom bar right above the keyboard?</p>
<p>3. Rotate to landscape, wait 3s; tap a field, wait 3s; rotate back.</p>
<p>4. Background the app 10s and return (<b>visible</b>).</p>
<p>5. Optional: type a note in the label menu and tap Send, e.g. when something looks wrong.</p>
</details>
<pre id="out">measuring&hellip;</pre>
</div>
<div id="edit">
<iframe id="f-iframe" title="editor-like iframe" srcdoc="&lt;!doctype html&gt;&lt;html&gt;&lt;body contenteditable style='margin:8px;font:16px -apple-system,system-ui,sans-serif;color:#e8ecf2;background:#10151f;min-height:40px'&gt;Tap here (iframe, like TinyMCE)&lt;/body&gt;&lt;/html&gt;"></iframe>
<input id="f-input" type="text" placeholder="single-line field (like the title)" autocomplete="off" />
<textarea id="f-area" placeholder="big box (like the markdown editor)"></textarea>
</div>
<div id="status">&nbsp;</div>
<div id="bar">
<select id="label" aria-label="report label"><option>idle</option><option>kb-open-iframe</option><option>kb-open-input</option><option>kb-open-textarea</option><option>kb-closed</option><option>landscape</option><option>landscape-kb-open</option><option>after-bg-return</option><option>other</option></select>
<button id="send" type="button">Send</button><button id="copy" type="button">Copy</button>
</div>
</div>
<script>
(function(){
var CONFIG=${config};
var $=function(id){return document.getElementById(id)};
var vv=window.visualViewport,root=document.documentElement;
var coarse=window.matchMedia('(pointer: coarse)');
var remembered={},rid=Math.random().toString(36).slice(2,8),seq=0,autoSent=0,last=null,events=[];
function typing(el){return !!el&&(el.tagName==='TEXTAREA'||el.tagName==='IFRAME'||(el.tagName==='INPUT'&&!/^(button|checkbox|radio|range|submit|reset|file|color)$/.test(el.type))||el.isContentEditable===true)}
function h(id){return $(id).getBoundingClientRect().height}
function kbVisible(){
	var w=window.innerWidth,height=vv?vv.height:window.innerHeight,large=h('p-lvh');
	var ref=Math.max(large,remembered[w]||0,window.innerHeight);
	var api=navigator.virtualKeyboard&&navigator.virtualKeyboard.boundingRect&&navigator.virtualKeyboard.boundingRect.height>0;
	var visible=coarse.matches&&typing(document.activeElement)&&(api||(!!vv&&vv.scale===1&&ref-height>ref*0.2));
	if(!visible)remembered[w]=Math.max(ref,height);
	return visible;
}
// The vv shell is the herdr-web-ui approach: height follows visualViewport only while a soft
// keyboard is up, and the page is pinned at (0,0). The current shell does nothing here.
function applyShell(visible){
	if(CONFIG.shell!=='vv')return;
	if(visible&&vv)root.style.setProperty('--app-height',Math.round(vv.height)+'px');else root.style.removeProperty('--app-height');
	window.scrollTo(0,0);
}
function snap(){
	var o={},put=function(k,v){o[k]=v};
	var visible=kbVisible();applyShell(visible);
	var sh=$('shell').getBoundingClientRect(),hd=$('hdr').getBoundingClientRect(),bar=$('bar').getBoundingClientRect(),ed=$('edit').getBoundingClientRect();
	var vTop=vv?vv.offsetTop:0,vH=vv?vv.height:window.innerHeight,vBottom=vTop+vH,ae=document.activeElement;
	put('shell',CONFIG.shell);put('iw',CONFIG.iw);put('zoom',CONFIG.zoom);
	put('standalone',window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true);
	put('navStandalone',navigator.standalone===true);
	put('dpr',window.devicePixelRatio);put('screenW',screen.width);put('screenH',screen.height);
	put('innerW',window.innerWidth);put('innerH',window.innerHeight);put('outerH',window.outerHeight);put('clientH',root.clientHeight);
	put('vvW',vv?Math.round(vv.width):-1);put('vvH',Math.round(vH));put('vvTop',Math.round(vTop));put('vvLeft',vv?Math.round(vv.offsetLeft):-1);put('vvScale',vv?Math.round(vv.scale*100)/100:-1);
	put('p100vh',Math.round(h('p-vh')));put('p100dvh',Math.round(h('p-dvh')));put('p100svh',Math.round(h('p-svh')));put('p100lvh',Math.round(h('p-lvh')));
	put('safeT',Math.round(h('p-st')));put('safeB',Math.round(h('p-sb')));put('safeL',Math.round(h('p-sl')));put('safeR',Math.round(h('p-sr')));
	put('scrollY',Math.round(window.scrollY));put('docScrollY',Math.round(root.scrollTop));
	put('shellTop',Math.round(sh.top));put('shellH',Math.round(sh.height));put('shellBottom',Math.round(sh.bottom));
	// header's position on the visible screen (0 = pinned at the top; negative = panned off)
	put('hdrScreenY',Math.round(hd.top-vTop));
	// gap between the bottom bar and the bottom of the visible area (>=0 = bar visible; negative = under the keyboard)
	put('barGap',Math.round(vBottom-bar.bottom));put('editH',Math.round(ed.height));
	put('appHeightVar',(getComputedStyle(root).getPropertyValue('--app-height')||'').trim()||'none');
	put('focus',ae?(ae.id||ae.tagName):'none');put('kbGuess',visible);
	put('kbApi',!!navigator.virtualKeyboard);put('kbApiH',navigator.virtualKeyboard&&navigator.virtualKeyboard.boundingRect?Math.round(navigator.virtualKeyboard.boundingRect.height):-1);
	put('orient',(screen.orientation&&screen.orientation.type)||'');
	put('hoverHover',window.matchMedia('(hover: hover)').matches);put('coarse',coarse.matches);
	return o;
}
function render(){
	last=snap();
	var lines=Object.keys(last).map(function(k){return k+'='+last[k]});
	$('out').textContent=lines.join('  ')+'\\n\\nevents:\\n'+events.slice(-6).join('\\n');
}
var raf=0;function schedule(){if(!raf)raf=requestAnimationFrame(function(){raf=0;render()})}
function note(ev){events.push(new Date().toISOString().slice(14,23)+' '+ev+' vvH='+(vv?Math.round(vv.height):'-')+' vvTop='+(vv?Math.round(vv.offsetTop):'-')+' scrollY='+Math.round(window.scrollY));if(events.length>40)events.shift();schedule()}
function send(label,auto){
	var snapshot=snap();snapshot.label=label;snapshot.rid=rid;snapshot.n=++seq;snapshot.auto=!!auto;last=snapshot;
	var safe={};Object.keys(snapshot).forEach(function(k){var v=snapshot[k];if(typeof v==='string')safe[k]=v.slice(0,120);else if(typeof v==='number'||typeof v==='boolean'||v===null)safe[k]=v});
	$('status').textContent='sending #'+snapshot.n+' ('+label+')…';
	fetch('/api/web/client-log',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},credentials:'same-origin',body:'event='+encodeURIComponent('diag.viewport')+'&data='+encodeURIComponent(JSON.stringify(safe))})
		.then(function(r){$('status').textContent=(r.ok||r.status===204)?'sent #'+snapshot.n+' ('+label+')':'FAILED #'+snapshot.n+' HTTP '+r.status+' (session expired? log in again)'})
		.catch(function(e){$('status').textContent='FAILED #'+snapshot.n+' '+e.message});
}
function auto(ev){note(ev);if(autoSent>=80)return;autoSent+=2;setTimeout(function(){send('auto:'+ev+'@0.7s',true)},700);setTimeout(function(){send('auto:'+ev+'@1.8s',true)},1800)}
['send','copy'].forEach(function(id){['pointerdown','mousedown'].forEach(function(t){$(id).addEventListener(t,function(e){e.preventDefault()})})});
$('send').addEventListener('click',function(){send($('label').value,false)});
$('copy').addEventListener('click',function(){var s=JSON.stringify(last||snap());try{navigator.clipboard.writeText(s).then(function(){$('status').textContent='copied'},function(){$('status').textContent='copy blocked'})}catch(e){$('status').textContent='copy blocked'}});
if(vv){vv.addEventListener('resize',function(){note('vv.resize')});vv.addEventListener('scroll',function(){note('vv.scroll')})}
window.addEventListener('resize',function(){note('win.resize')});
window.addEventListener('orientationchange',function(){auto('orientation')});
document.addEventListener('focusin',function(){auto('focusin')});
document.addEventListener('focusout',function(){setTimeout(function(){auto('focusout')},0)});
document.addEventListener('visibilitychange',function(){if(!document.hidden)auto('visible')});
window.addEventListener('scroll',function(){note('win.scroll')});
render();setTimeout(function(){auto('load')},600);
})();
</script>
</body>
</html>`;
};

module.exports = { diagPage, diagOptions, viewportContent };
