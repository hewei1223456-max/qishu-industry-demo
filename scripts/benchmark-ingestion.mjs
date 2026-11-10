// Explicit opt-in disk/network benchmark. Synthetic padding is not semantic AI load.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createIngestionService } from '../packages/ingestion/index.mjs';

const sizes = process.argv.includes('--all') ? [300, 500, 1024] : [Number(process.argv[2] || 300)];
if (sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 1024)) throw Error('参数为1—1024 MiB，或 --all');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qishu-large-upload-'));
const python = process.env.QISHU_PYTHON || 'python';
const generator = String.raw`
import sys,zipfile,os
from pptx import Presentation
f=sys.argv[1]; target=int(sys.argv[2]); p=Presentation()
s=p.slides.add_slide(p.slide_layouts[1]);s.shapes.title.text='大文件传输合成测试';s.placeholders[1].text='春夏选品：先试销，再补单。此文件包含合成填充，不能用于评价真实大文件语义理解。'
p.save(f)
name='test-only-synthetic-padding.bin';pad=target-os.path.getsize(f)-76-2*len(name)
with zipfile.ZipFile(f,'a',compression=zipfile.ZIP_STORED) as z:
 with z.open(name,'w') as out:
  block=bytes(1024*1024)
  while pad>0:n=min(len(block),pad);out.write(block[:n]);pad-=n
assert os.path.getsize(f)==target,(os.path.getsize(f),target)
`;
let peakRss = process.memoryUsage().rss;
const memory = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 50);
const importer = createIngestionService({ dataDir, python });
const server = http.createServer(async (req, res) => {
  if (!(await importer.handle(req, res, { id: 'benchmark-admin', role: 'admin' }))) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/api/ingestion`;
const reports = [];
async function call(route, method = 'GET', body) {
  const res = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const value = await res.json();
  if (!res.ok) throw Error(JSON.stringify(value));
  return value;
}
try {
  for (const mib of sizes) {
    const size = mib * 1024 ** 2,
      file = path.join(dataDir, `synthetic-${mib}.pptx`);
    await new Promise((resolve, reject) => {
      const proc = spawn(python, ['-c', generator, file, String(size)], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
      let error = '';
      proc.stderr.on('data', (c) => (error += c));
      proc.on('error', reject);
      proc.on('exit', (code) => (code ? reject(Error(error)) : resolve()));
    });
    const { upload } = await call('/uploads', 'POST', { name: path.basename(file), size, target: 'content' });
    const source = await fs.open(file, 'r');
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < upload.totalChunks) {
          const index = next++,
            len = Math.min(upload.chunkSize, size - index * upload.chunkSize),
            buffer = Buffer.allocUnsafe(len);
          await source.read(buffer, 0, len, index * upload.chunkSize);
          const response = await fetch(`${base}/uploads/${upload.id}/parts/${index}`, {
            method: 'PUT',
            body: buffer
          });
          if (!response.ok) throw Error(await response.text());
          await response.arrayBuffer();
        }
      })
    );
    await source.close();
    const uploadedMs = performance.now() - started;
    const completed = await call(`/uploads/${upload.id}/complete`, 'POST', {});
    const combinedMs = performance.now() - started;
    let job;
    for (let n = 0; n < 1200; n++) {
      job = (await call('/jobs/' + completed.job.id)).job;
      if (['failed', 'parsed'].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const report = {
      source: 'synthetic_valid_pptx_with_unreferenced_padding',
      bytes: size,
      mib,
      uploadMs: Math.round(uploadedMs),
      uploadMiBPerSec: Number((mib / (uploadedMs / 1000)).toFixed(1)),
      uploadAndAssemblyMs: Math.round(combinedMs),
      jobStatus: job.status,
      parseMs: job.result?.stats.durationMs,
      cards: job.result?.cards.length,
      semanticAI: job.result?.semanticAI || 'not_run',
      peakNodeRssMiB: Math.round(peakRss / 1024 ** 2),
      error: job.error || null
    };
    reports.push(report);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (job.status !== 'parsed') process.exitCode = 1;
  }
  const reportPath = process.env.BENCHMARK_REPORT;
  if (reportPath)
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          reports,
          note: '同机环回网络合成传输；不代表公网速度或1GiB复杂PPT语义理解性能。'
        },
        null,
        2
      )
    );
} finally {
  clearInterval(memory);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  importer.close();
  await fs.rm(dataDir, { recursive: true, force: true });
}
