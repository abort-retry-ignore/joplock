const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let hasPandoc = false;
try {
	execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
	hasPandoc = true;
} catch {}

const pandoc = (args, stdin) => {
	return new Promise((resolve, reject) => {
		const p = spawn('pandoc', args, { stdio: ['pipe', 'pipe', 'pipe'] });
		if (stdin !== undefined) { p.stdin.write(stdin); p.stdin.end(); }
		const chunks = [], errs = [];
		p.stdout.on('data', c => chunks.push(c));
		p.stderr.on('data', c => errs.push(c));
		p.on('close', code => {
			if (code !== 0) reject(new Error('pandoc exit ' + code + ': ' + Buffer.concat(errs).toString()));
			else resolve(Buffer.concat(chunks));
		});
		p.on('error', reject);
	});
};

const pandocMdToDocx = (md, refDoc) =>
	pandoc(refDoc ? ['-f','markdown','-t','docx','--wrap=none','--reference-doc',refDoc] : ['-f','markdown','-t','docx','--wrap=none'], md);

const docxToMarkdown = async (docxBuf) => {
	const tmp = path.join(os.tmpdir(), 'docx-test-' + Date.now() + '.docx');
	fs.writeFileSync(tmp, docxBuf);
	try {
		return execFileSync('pandoc', ['-f','docx','-t','markdown','--wrap=none',tmp], { encoding: 'utf-8' });
	} finally { fs.unlinkSync(tmp); }
};

const docxIsValid = buf => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;

if (hasPandoc) {

describe('DOCX export', () => {

	test('pandoc produces valid DOCX from markdown', async () => {
		const docx = await pandocMdToDocx('# Heading\n\n**Bold** text with *italic*.');
		assert.ok(docxIsValid(docx), 'should be valid DOCX (ZIP)');
		assert.ok(docx.length > 5000, 'should be >5KB');
	});

	test('pandoc produces valid DOCX from HTML', async () => {
		const html = '<h1>Heading</h1><p><strong>Bold</strong> text.</p>';
		const docx = await pandoc(['-f','html','-t','docx','--wrap=none'], html);
		assert.ok(docxIsValid(docx), 'should be valid DOCX');
		assert.ok(docx.length > 5000, 'should be >5KB');
	});

	test('DOCX heading survives round-trip', async () => {
		const docx = await pandocMdToDocx('# My Heading\n\nSome text.');
		const md = await docxToMarkdown(docx);
		assert.ok(md.includes('My Heading'), 'heading text should survive');
		assert.ok(md.match(/^# /m), 'should have heading marker');
	});

	test('DOCX bold survives round-trip', async () => {
		const docx = await pandocMdToDocx('text **bold word** more');
		const md = await docxToMarkdown(docx);
		assert.ok(md.includes('bold word'), 'bold text should survive');
		assert.ok(md.includes('**'), 'should have bold markers');
	});

	test('DOCX italic survives round-trip', async () => {
		const docx = await pandocMdToDocx('text *italic word* more');
		const md = await docxToMarkdown(docx);
		assert.ok(md.includes('italic word'), 'italic text should survive');
		assert.ok(md.includes('*'), 'should have italic markers');
	});

	test('reference doc preserves formatting', async () => {
		const docx = await pandocMdToDocx('# Ref heading\n\nnormal **bold**', 'public/reference.docx');
		assert.ok(docxIsValid(docx), 'should be valid with reference doc');
		const md = await docxToMarkdown(docx);
		assert.ok(md.includes('Ref heading'), 'heading should survive reference doc');
		assert.ok(md.includes('**'), 'bold should survive reference doc');
	});

	test('pandoc rejects invalid format gracefully', async () => {
		try {
			await pandoc(['-f','nonexistent','-t','docx'], '# test');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok(e.message.includes('pandoc exit'), 'should return error');
		}
	});

});

} else {

test('DOCX export tests skipped (pandoc not installed)', () => {});

}
