#!/bin/sh
# Regenerate public/reference.docx from pandoc's default reference and patch
# the "Table" table style to include visible cell gridlines. Idempotent;
# run from anywhere, requires pandoc + python3 + unzip. POSIX sh (no bashisms)
# so it also runs inside the alpine-based app container.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# 1. Get pandoc's default reference doc (has a real Table Grid-capable style)
pandoc -o "$TMPDIR/reference.docx" --print-default-data-file reference.docx

# 2. Unzip so we can patch styles.xml
cd "$TMPDIR"
unzip -q reference.docx -d unpacked

# 3. Patch: inject <w:tblPr><w:tblBorders> into the "Table" table style so
#    every table pandoc emits gets visible single-line gridlines by default.
python3 <<'PYEOF'
import re

path = 'unpacked/word/styles.xml'
with open(path, 'r', encoding='utf-8') as f:
    xml = f.read()

BORDERS = (
    '<w:tblPr>'
    '<w:tblBorders>'
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="444444"/>'
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="444444"/>'
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="444444"/>'
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="444444"/>'
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="888888"/>'
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="888888"/>'
    '</w:tblBorders>'
    '</w:tblPr>'
)

def patch_table_style(match):
    block = match.group(0)
    block = re.sub(r'<w:tblPr>.*?</w:tblPr>', '', block, flags=re.DOTALL)
    block = block.replace('</w:style>', BORDERS + '</w:style>')
    return block

xml_new, count = re.subn(
    r'<w:style\s+w:type="table"[^>]*\bw:styleId="Table"[^>]*>.*?</w:style>',
    patch_table_style,
    xml,
    flags=re.DOTALL,
)

if count == 0:
    raise SystemExit('ERROR: could not find <w:style w:type="table" w:styleId="Table"> in styles.xml')

with open(path, 'w', encoding='utf-8') as f:
    f.write(xml_new)
print('Patched Table style with visible borders.')
PYEOF

# 4. Re-zip (docx files are just zip archives). Use python's zipfile module
#    to avoid depending on the external `zip` binary.
python3 <<'PYEOF'
import zipfile, os

src_dir = 'unpacked'
out_path = 'reference-patched.docx'

with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _dirs, files in os.walk(src_dir):
        for name in files:
            full = os.path.join(root, name)
            arcname = os.path.relpath(full, src_dir)
            zf.write(full, arcname)
PYEOF

# 5. Move into place
cp reference-patched.docx "$REPO_ROOT/public/reference.docx"
echo "Wrote $REPO_ROOT/public/reference.docx ($(wc -c < reference-patched.docx) bytes)"
