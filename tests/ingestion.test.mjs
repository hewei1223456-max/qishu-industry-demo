import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createIngestionService } from '../packages/ingestion/index.mjs';

const python = process.env.QISHU_PYTHON || 'python';
const fixtureScript = String.raw`
import zipfile,sys,base64
p=sys.argv[1]
with zipfile.ZipFile(p+'/sample.pptx','w') as z:
 z.writestr('ppt/slides/slide1.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:p><a:r><a:t>春夏选品</a:t></a:r></a:p><a:p><a:r><a:t>小单快返，先试销再补单。</a:t></a:r></a:p><a:blip r:embed="rId1"/></p:sld>')
 z.writestr('ppt/slides/_rels/slide1.xml.rels','<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>')
 z.writestr('ppt/media/image1.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLRkAAAAASUVORK5CYII='))
with zipfile.ZipFile(p+'/unsafe.zip','w') as z:z.writestr('../escape.txt','must not escape')
`;

test('分片续传、权限隔离、文档拆卡、人工发布和故障边界', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'qishu-import-test-'));
  const fixtures = spawnSync(python, ['-c', fixtureScript, folder], { encoding: 'utf8', windowsHide: true });
  assert.equal(fixtures.status, 0, fixtures.stderr);
  let published = 0;
  const service = createIngestionService({
    dataDir: folder,
    python,
    chunkSize: 512,
    publishCard: async (user, card) => {
      published++;
      return { id: 'published-' + published, published: true, title: card.title, image: card.image };
    }
  });
  const server = http.createServer(async (req, res) => {
    const role = req.headers['x-test-role'];
    const user = role
      ? role === 'limited'
        ? { id: 'limited', role: 'admin', permissions: [] }
        : { id: role === 'other' ? 'other' : 'admin', role: role === 'admin' ? 'admin' : 'owner' }
      : null;
    if (!(await service.handle(req, res, user))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    service.close();
    await fs.rm(folder, { recursive: true, force: true });
  });
  async function call(route, method = 'GET', data, role = 'admin', raw = false) {
    const res = await fetch(base + '/api/ingestion' + route, {
      method,
      headers: {
        ...(role ? { 'x-test-role': role } : {}),
        ...(data && !raw ? { 'content-type': 'application/json' } : {})
      },
      body: data ? (raw ? data : JSON.stringify(data)) : undefined
    });
    return { status: res.status, data: await res.json() };
  }
  async function upload(name, buffer) {
    const made = await call('/uploads', 'POST', { name, size: buffer.length });
    assert.equal(made.status, 201);
    const u = made.data.upload;
    assert.equal((await call('/uploads/' + u.id + '/complete', 'POST', {})).status, 409);
    for (let i = 0; i < u.totalChunks; i++) {
      const data = buffer.subarray(i * u.chunkSize, Math.min(buffer.length, (i + 1) * u.chunkSize));
      assert.equal((await call(`/uploads/${u.id}/parts/${i}`, 'PUT', data, 'admin', true)).status, 200);
    }
    const first = buffer.subarray(0, Math.min(buffer.length, u.chunkSize));
    assert.equal((await call(`/uploads/${u.id}/parts/0`, 'PUT', first, 'admin', true)).data.duplicate, true);
    const resumed = await call('/uploads/' + u.id);
    assert.equal(resumed.data.upload.parts.length, u.totalChunks);
    assert.equal((await call('/uploads/' + u.id, 'GET', undefined, 'other')).status, 403);
    const finish = await call('/uploads/' + u.id + '/complete', 'POST', {});
    assert.equal(finish.status, 201);
    let job;
    for (let i = 0; i < 200; i++) {
      job = (await call('/jobs/' + finish.data.job.id)).data.job;
      if (['parsed', 'failed'].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { u, job };
  }
  assert.equal((await call('/status', 'GET', undefined, null)).status, 401);
  assert.equal((await call('/uploads', 'POST', { name: 'x.txt', size: 5 }, 'other')).status, 403);
  assert.equal(
    (await call('/uploads', 'POST', { name: 'x.txt', size: 5 }, 'limited')).status,
    403,
    '空权限admin不能创建导入'
  );
  assert.equal((await call('/uploads', 'POST', { name: 'tool.exe', size: 5 })).status, 415);
  assert.equal((await call('/uploads', 'POST', { name: 'x.pptx', size: 1024 ** 3 + 1 })).status, 413);
  const { u, job } = await upload('sample.pptx', await fs.readFile(path.join(folder, 'sample.pptx')));
  assert.equal(job.status, 'parsed', job.error);
  assert.equal(job.result.cards.length, 1);
  assert.equal(job.result.cards[0].page, 1);
  assert.match(job.result.cards[0].body, /小单快返/);
  assert.equal(job.result.semanticAI, 'not_run');
  const privateImage = job.result.cards[0].image;
  assert.ok(privateImage);
  assert.equal((await fetch(base + privateImage)).status, 401);
  assert.equal((await fetch(base + privateImage, { headers: { 'x-test-role': 'other' } })).status, 403);
  assert.equal(
    (await fetch(base + privateImage, { headers: { 'x-test-role': 'limited' } })).status,
    403,
    '受限admin不能读他人资料'
  );
  assert.equal((await call('/uploads', 'GET', undefined, 'limited')).data.items.length, 0);
  assert.equal((await fetch(base + privateImage, { headers: { 'x-test-role': 'admin' } })).status, 200);
  assert.equal((await call('/jobs/' + job.id + '/understand', 'POST', {})).status, 503);
  const result = await call('/jobs/' + job.id + '/publish', 'POST', { indices: [0], target: 'content' });
  assert.equal(result.status, 200);
  assert.equal(published, 1);
  assert.equal((await fetch(base + result.data.records[0].image)).status, 200);
  await call('/jobs/' + job.id + '/publish', 'POST', { indices: [0], target: 'content' });
  assert.equal(published, 1, '重复确认不得重复创建内容');
  assert.equal((await call('/uploads/' + u.id + '/complete', 'POST', {})).data.job.id, job.id);
  const unsafe = await upload('unsafe.zip', await fs.readFile(path.join(folder, 'unsafe.zip')));
  assert.equal(unsafe.job.status, 'failed');
  assert.match(unsafe.job.error, /不安全路径/);
  assert.equal((await call('/status')).status, 200, '解析失败不影响其他接口');
  await assert.rejects(fs.stat(path.join(folder, 'escape.txt')));
});

test('AI理解异步返回、去重、编辑互斥及失败保留结构', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'qishu-understand-test-'));
  let finish,
    shouldFail = false;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const service = createIngestionService({
    dataDir: folder,
    python,
    understand: async (user, payload) => {
      if (shouldFail) throw Object.assign(new Error('模型未配置'), { status: 503 });
      payload.onProgress('处理第1批，共1批');
      await gate;
      return { cards: payload.cards.map((card) => ({ ...card, tags: ['小单快返'] })) };
    }
  });
  const server = http.createServer(async (req, res) => {
    await service.handle(req, res, { id: 'admin', role: 'admin' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/ingestion`;
  t.after(async () => {
    finish();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    service.close();
    await fs.rm(folder, { recursive: true, force: true });
  });
  async function call(route, method = 'GET', body, raw = false) {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': raw ? 'application/octet-stream' : 'application/json' },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined
    });
    return { status: response.status, data: await response.json() };
  }
  const data = Buffer.from('补单条件核对\n小单快返，先试款。');
  const upload = (await call('/uploads', 'POST', { name: 'selection.txt', size: data.length })).data.upload;
  await call('/uploads/' + upload.id + '/parts/0', 'PUT', data, true);
  const id = (await call('/uploads/' + upload.id + '/complete', 'POST', {})).data.job.id;
  let job;
  for (let i = 0; i < 200; i++) {
    job = (await call('/jobs/' + id)).data.job;
    if (job.status === 'parsed') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(job.status, 'parsed');
  const accepted = await call('/jobs/' + id + '/understand', 'POST', {});
  assert.equal(accepted.status, 202);
  assert.equal(accepted.data.job.status, 'understanding');
  assert.equal((await call('/jobs/' + id + '/understand', 'POST', {})).data.deduplicated, true);
  assert.equal(
    (await call('/jobs/' + id + '/cards', 'PATCH', { index: 0, title: '不得覆盖进行中任务' })).status,
    409
  );
  finish();
  for (let i = 0; i < 100; i++) {
    job = (await call('/jobs/' + id)).data.job;
    if (job.result.semanticAI === 'provider_completed') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.result.semanticAI, 'provider_completed');
  assert.deepEqual(job.result.cards[0].tags, ['小单快返']);
  shouldFail = true;
  await call('/jobs/' + id + '/understand', 'POST', {});
  for (let i = 0; i < 100; i++) {
    job = (await call('/jobs/' + id)).data.job;
    if (job.result.semanticAI === 'failed') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.status, 'parsed');
  assert.equal(job.result.semanticAI, 'failed');
  assert.match(job.result.cards[0].body, /先试款/);
  assert.equal(job.error, '模型未配置');
});
