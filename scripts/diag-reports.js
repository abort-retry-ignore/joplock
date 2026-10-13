#!/usr/bin/env node
'use strict';

// Reads the device-diagnostics reports (/diag, app/templates/diag.js) out of the dev container's
// logs and prints one compact line per report, with flags for the layout failures we care about.
//
//   node scripts/diag-reports.js [--since 30m] [--container joplock-dev-joplock-1] [--rid abc123] [--json]
//
// Flags: HDR-OFF  header not at the top of the visible screen (page panned)
//        BAR-HID  bottom bar below the visible area (under the keyboard)
//        BAR-GAP  more than 2px of empty space under the bottom bar
//        NO-SAFE  standalone but every safe-area inset is 0 (insets not applied/black-translucent off)

const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const container = opt('container', 'joplock-dev-joplock-1');
const since = opt('since', '1h');
const ridFilter = opt('rid', '');
const asJson = args.includes('--json');

const logs = spawnSync('docker', ['logs', '-t', '--since', since, container], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (logs.error) { console.error(`docker logs failed: ${logs.error.message}`); process.exit(1); }
const lines = `${logs.stdout}\n${logs.stderr}`.split('\n');

const stamp = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z /;
const reports = [];
for (let i = 0; i < lines.length; i++) {
	const m = lines[i].match(/^(\S+) \[joplock client\] diag\.viewport \{$/);
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
		data.at = m[1].slice(0, 19).replace('T', ' ');
		reports.push(data);
	} catch { /* a truncated block: skip */ }
	i = j;
}

const flags = r => {
	const out = [];
	if (Math.abs(r.hdrScreenY) > 1) out.push('HDR-OFF');
	if (r.barGap < 0) out.push('BAR-HID');
	if (r.barGap > 2) out.push('BAR-GAP');
	if (r.standalone && !(r.safeT || r.safeB || r.safeL || r.safeR)) out.push('NO-SAFE');
	return out;
};

const selected = reports.filter(r => !ridFilter || r.rid === ridFilter);
if (asJson) {
	console.log(JSON.stringify(selected.map(r => ({ ...r, flags: flags(r) })), null, 1));
} else if (!selected.length) {
	console.log(`no diag.viewport reports in the last ${since} (container ${container})`);
} else {
	for (const r of selected) {
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
			`hdrY=${r.hdrScreenY} barGap=${r.barGap} shellH=${r.shellH}`,
			`appH=${r.appHeightVar}`,
			`focus=${r.focus} kb=${r.kbGuess ? 'Y' : 'n'}${r.kbApi ? `/api${r.kbApiH}` : ''}`,
			flags(r).join(',') || 'ok',
		].join(' | '));
	}
	const ua = selected[selected.length - 1].ua;
	console.log(`\n${selected.length} report(s); latest UA: ${ua}`);
}
