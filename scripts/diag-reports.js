#!/usr/bin/env node
'use strict';

// Reads real-device reports out of the dev container's logs (and .diag-archive/, where
// scripts/rebuild-dev.sh keeps them across rebuilds) and prints one compact line per report.
//
//   node scripts/diag-reports.js [--since 30m] [--container joplock-dev-joplock-1]
//                                [--event diag.viewport|viewport.kb] [--rid abc123] [--json] [--no-archive]
//
// diag.viewport  (the /diag page): flags
//   HDR-OFF   header not at the top of the visible screen (page panned)
//   BAR-HID   bottom bar below the visible area (under the keyboard)
//   BAR-GAP   more than 2px of empty space under the bottom bar (keyboard down)
//   DEAD-BAND shell ends above the window's bottom edge (iOS black-translucent viewport bug)
//   NO-SAFE   standalone but every safe-area inset is 0
// viewport.kb  (the real app, admin debug on; public/viewport.js): flags
//   HDR-OFF / TB-OFF  header / markdown toolbar scrolled off the top of the screen
//   TB-HIDDEN         markdown toolbar display:none
//   PANNED            iOS scrolled the page under us (pins>0 means we put it back)
//   NOT-PINNED        page scrollY != 0 while the shell is showing

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const container = opt('container', 'joplock-dev-joplock-1');
const since = opt('since', '1h');
const ridFilter = opt('rid', '');
const eventFilter = opt('event', '');
const asJson = args.includes('--json');
const useArchive = !args.includes('--no-archive');

const sources = [];
if (useArchive) {
	const dir = path.join(__dirname, '..', '.diag-archive');
	if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.log')) sources.push(fs.readFileSync(path.join(dir, f), 'utf8'));
}
const logs = spawnSync('docker', ['logs', '-t', '--since', since, container], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (logs.error) console.error(`docker logs failed: ${logs.error.message}`);
else sources.push(`${logs.stdout}\n${logs.stderr}`);

const stamp = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z /;
const reports = [];
const seen = new Set();
for (const source of sources) {
	const lines = source.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(\S+) \[joplock client\] (diag\.viewport|viewport\.kb) \{$/);
		if (!m) continue;
		const body = ['{'];
		let j = i + 1;
		for (; j < lines.length; j++) {
			const text = lines[j].replace(stamp, '');
			body.push(text);
			if (text === '}') break;
		}
		try {
			const data = vm.runInNewContext(`(${body.join('\n')})`, {}, { timeout: 200 });
			data.event = m[2];
			data.at = m[1].slice(0, 19).replace('T', ' ');
			const key = `${data.event}|${data.at}|${data.rid || ''}|${data.n || ''}|${JSON.stringify(data).length}`;
			if (!seen.has(key)) { seen.add(key); reports.push(data); }
		} catch { /* a truncated block: skip */ }
		i = j;
	}
}
reports.sort((a, b) => a.at.localeCompare(b.at));

const diagFlags = r => {
	const out = [];
	if (Math.abs(r.hdrScreenY) > 1) out.push('HDR-OFF');
	if (r.barGap < 0) out.push('BAR-HID');
	if (r.barGap > 2 && !r.kbGuess) out.push('BAR-GAP');
	if (r.bandBottom > 2 && !r.kbGuess) out.push('DEAD-BAND');
	if (r.standalone && !(r.safeT || r.safeB || r.safeL || r.safeR)) out.push('NO-SAFE');
	return out;
};
const kbFlags = r => {
	const out = [];
	if (r.hdrTop < 0 && r.hdrTop !== -9999) out.push('HDR-OFF');
	if (r.tbTop < 0 && r.tbTop !== -9999) out.push('TB-OFF');
	if (r.tbDisplay === 'none') out.push('TB-HIDDEN');
	if (r.pins > 0) out.push(`PANNED(max ${r.maxScr}px, pinned ${r.pins}x)`);
	if (r.scrollY !== 0 && r.appBottom !== -9999) out.push('NOT-PINNED');
	return out;
};
const flags = r => (r.event === 'viewport.kb' ? kbFlags(r) : diagFlags(r));

const selected = reports.filter(r => (!ridFilter || r.rid === ridFilter) && (!eventFilter || r.event === eventFilter));
if (asJson) {
	console.log(JSON.stringify(selected.map(r => ({ ...r, flags: flags(r) })), null, 1));
} else if (!selected.length) {
	console.log(`no device reports in the last ${since} (container ${container}${useArchive ? ' + archive' : ''})`);
} else {
	for (const r of selected) {
		if (r.event === 'viewport.kb') {
			console.log([
				r.at.slice(5), 'app  ', r.standalone ? 'PWA' : 'tab', `kb=${r.kb ? 'Y' : 'n'}`,
				`vv ${r.vvH}@${r.vvTop} s=${r.vvScale}`, `inner ${r.innerH} lvh=${r.lvh}`, `scrollY=${r.scrollY}`,
				`appH=${r.appH} appTop=${r.appTop} appBottom=${r.appBottom}`,
				`hdrTop=${r.hdrTop} tbTop=${r.tbTop}(${r.tbDisplay})`, `focus=${r.focus}`,
				flags(r).join(',') || 'ok',
			].join(' | '));
			continue;
		}
		const variant = `${r.shell}${r.iw ? '+iw' : ''}${r.zoom ? '+zoom' : ''}`;
		console.log([
			r.at.slice(11),
			`${r.rid}#${r.n}`.padEnd(9),
			String(r.label).padEnd(18),
			variant.padEnd(10),
			r.standalone ? 'PWA' : 'tab',
			`inner ${r.innerW}x${r.innerH}`,
			`vv ${r.vvW}x${r.vvH} top=${r.vvTop} s=${r.vvScale}`,
			`lvh=${r.p100lvh} dvh=${r.p100dvh} svh=${r.p100svh}`,
			`safe T${r.safeT} B${r.safeB} L${r.safeL} R${r.safeR}`,
			`hdrY=${r.hdrScreenY} barGap=${r.barGap} band=${r.bandBottom ?? '?'} shellH=${r.shellH} outerH=${r.outerH}`,
			`scr ${r.screenW}x${r.screenH}`,
			`appH=${r.appHeightVar}${r.kbAttr !== undefined ? ` kbAttr=${r.kbAttr ? 'Y' : 'n'} top=${r.appTopVar} pins=${r.vpPins}` : ''}`,
			`focus=${r.focus} kb=${r.kbGuess ? 'Y' : 'n'}${r.kbApi ? `/api${r.kbApiH}` : ''}`,
			flags(r).join(',') || 'ok',
		].join(' | '));
	}
	console.log(`\n${selected.length} report(s); latest UA: ${selected[selected.length - 1].ua}`);
}
