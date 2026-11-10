import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const python = process.env.QISHU_PYTHON || 'python';
const extractor = fileURLToPath(new URL('../packages/ingestion/extract_material.py', import.meta.url));
test('PDF文本、扫描待OCR、音频待ASR与旧PPT不冒充理解', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qishu-format-test-'));
  try {
    const generate = spawnSync(
      python,
      [
        '-c',
        String.raw`
import sys
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
p=Path(sys.argv[1]);w=PdfWriter();page=w.add_blank_page(width=400,height=400)
font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(font)})})
stream=DecodedStreamObject();stream.set_data(b'BT /F1 18 Tf 20 300 Td (Wholesale checklist: MOQ and delivery) Tj ET');page[NameObject('/Contents')]=w._add_object(stream)
w.add_blank_page(width=400,height=400);w.write(p/'sample.pdf')
(p/'old.ppt').write_bytes(b'not-a-pptx')
(p/'audio.wav').write_bytes(b'RIFF'+bytes(100))
`,
        root
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(generate.status, 0, generate.stderr);
    for (const [file, check] of [
      [
        'sample.pdf',
        (r) => {
          assert.equal(r.cards.length, 2);
          assert.match(r.cards[0].body, /MOQ and delivery/);
          assert.equal(r.cards[1].requires, 'ocr');
        }
      ],
      ['old.ppt', (r) => assert.equal(r.cards[0].requires, 'office_converter')],
      ['audio.wav', (r) => assert.equal(r.cards[0].requires, 'asr')]
    ]) {
      const out = path.join(root, file + '-out');
      const parsed = spawnSync(python, [extractor, path.join(root, file), out, file], {
        encoding: 'utf8',
        windowsHide: true
      });
      assert.equal(parsed.status, 0, parsed.stderr);
      const result = JSON.parse(await fs.readFile(path.join(out, 'result.json'), 'utf8'));
      check(result);
      assert.equal(result.semanticAI, 'not_run');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('常见长Word的5MiB XML可提取，外部实体仍拒绝', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qishu-word-xml-test-'));
  try {
    const made = spawnSync(
      python,
      [
        '-c',
        String.raw`
import sys,zipfile
from pathlib import Path
p=Path(sys.argv[1]);ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
body='<w:document xmlns:w="'+ns+'"><w:body><w:p><w:r><w:t>Large Word source retained</w:t></w:r></w:p></w:body><!--'+'x'*(5*1024*1024)+'--></w:document>'
with zipfile.ZipFile(p/'large.docx','w') as z:z.writestr('word/document.xml',body)
bad='<!DOCTYPE x [<!ENTITY probe "blocked">]><w:document xmlns:w="'+ns+'"><w:t>&probe;</w:t></w:document>'
with zipfile.ZipFile(p/'entity.docx','w') as z:z.writestr('word/document.xml',bad)
`,
        root
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(made.status, 0, made.stderr);
    const good = spawnSync(
      python,
      [extractor, path.join(root, 'large.docx'), path.join(root, 'good'), 'large.docx'],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(good.status, 0, good.stderr);
    const result = JSON.parse(await fs.readFile(path.join(root, 'good/result.json'), 'utf8'));
    assert.match(result.cards[0].body, /Large Word source retained/);
    const bad = spawnSync(
      python,
      [extractor, path.join(root, 'entity.docx'), path.join(root, 'bad'), 'entity.docx'],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(bad.status, 1);
    const rejected = JSON.parse(await fs.readFile(path.join(root, 'bad/error.json'), 'utf8'));
    assert.match(rejected.message, /外部实体/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
