import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../apps/server/src/server.js';
import { trainModel, recommendations } from '../apps/server/src/recommendation.js';
import { readConfig } from '../apps/server/src/config.js';
import { importerBridge } from '../apps/server/src/imports.js';

const dataRoot = resolve('data');
async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(dataRoot, 'backend-test-'));
  const app = createApp({ dataDir, dbPath: ':memory:', ...options });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    if (dataDir.startsWith(dataRoot + '\\')) rmSync(dataDir, { recursive: true, force: true });
  });
  async function request(path, method = 'GET', body, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + path, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    });
    let json;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json, headers: response.headers };
  }
  const login = async (role, userId) => {
    const response = await request('/auth/demo', 'POST', { role, userId });
    assert.equal(response.status, 200);
    return response.json.token;
  };
  return { app, base, request, login, dataDir };
}

test('auth: real server sessions support Bearer and demo login is disabled explicitly', async (t) => {
  const f = await fixture(t);
  const auth = await f.request('/auth/demo', 'POST', { role: 'owner' });
  assert.match(auth.headers.get('set-cookie'), /HttpOnly/);
  assert.ok(auth.json.token);
  const me = await f.request('/auth/me', 'GET', undefined, auth.json.token);
  assert.equal(me.json.user.id, 'owner-01');
  assert.equal((await f.request('/admin/config', 'GET', undefined, auth.json.token)).status, 403);
  assert.equal((await f.request('/auth/wechat', 'POST', { code: 'not-real' })).status, 503);
  await f.request('/auth/logout', 'POST', {}, auth.json.token);
  assert.equal((await f.request('/auth/me', 'GET', undefined, auth.json.token)).json.user, null);
  const g = await fixture(t, { demoAuth: false });
  assert.equal((await g.request('/auth/demo', 'POST', { role: 'admin' })).status, 403);
});

test('CMS: bad config cannot replace valid config; flags isolate modules; version rollback works', async (t) => {
  const f = await fixture(t);
  const admin = await f.login('admin');
  const old = (await f.request('/admin/config', 'GET', undefined, admin)).json.config;
  assert.equal((await f.request('/admin/config', 'PUT', { freeDailyLimit: -2 }, admin)).status, 400);
  const changed = await f.request(
    '/admin/config',
    'PUT',
    {
      features: { ...old.features, content: false },
      hiddenOrigins: ['海宁'],
      originOrder: ['广州', '深圳', '海宁'],
      freeDailyLimit: 3,
      version: old.version
    },
    admin
  );
  assert.equal(changed.status, 200);
  assert.equal((await f.request('/content')).status, 503);
  assert.equal((await f.request('/products')).status, 200);
  const bootstrap = (await f.request('/bootstrap')).json;
  assert.deepEqual(bootstrap.dictionaries.origins, ['广州', '深圳']);
  assert.equal((await f.request('/admin/config', 'PUT', { version: old.version }, admin)).status, 409);
  assert.equal((await f.request('/admin/config/rollback', 'POST', {}, admin)).status, 200);
  assert.equal((await f.request('/content')).status, 200);
});

test('supplier quota: repeated contact is atomic/idempotent, independent company cannot read leads', async (t) => {
  const f = await fixture(t);
  const admin = await f.login('admin'),
    supplier = await f.login('supplier'),
    other = await f.login('supplier', 'supplier-02');
  await f.request('/admin/config', 'PUT', { freeDailyLimit: 1 }, admin);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => f.request('/leads', 'POST', { buyerId: 'buyer-01' }, supplier))
  );
  assert.equal(new Set(results.map((x) => x.json.lead.id)).size, 1);
  assert.equal(results.filter((x) => x.json.deduplicated).length, 7);
  assert.equal((await f.request('/quota', 'GET', undefined, supplier)).json.used, 1);
  assert.equal(
    (await f.request('/leads', 'POST', { buyerId: 'buyer-02' }, supplier)).json.error.code,
    'QUOTA_EXCEEDED'
  );
  assert.equal((await f.request('/leads', 'GET', undefined, other)).json.items.length, 0);
  const activated = await f.request(
    '/admin/entitlements',
    'POST',
    { companyId: 'supplier-01', planId: 'pro', dailyLimit: 7, confirmationRef: '线下确认测试' },
    admin
  );
  assert.equal(activated.json.item.activationMode, 'offline-confirmed');
  assert.equal((await f.request('/quota', 'GET', undefined, supplier)).json.limit, 7);
  assert.equal((await f.request('/leads', 'POST', { buyerId: 'buyer-02' }, supplier)).status, 201);
});

test('creator moderation: supplier cannot self-publish, cannot edit another company, stock filtering survives approval', async (t) => {
  const f = await fixture(t);
  const supplier = await f.login('supplier'),
    other = await f.login('supplier', 'supplier-02'),
    admin = await f.login('admin');
  const created = await f.request(
    '/creator',
    'POST',
    {
      kind: 'product',
      title: '测试预售针织衫',
      supplyStatus: '预售',
      status: 'published',
      price: 128,
      moq: 6,
      origin: '濮院',
      style: '通勤',
      category: '针织'
    },
    supplier
  );
  assert.equal(created.json.item.status, 'pending');
  const id = created.json.item.id;
  assert.equal((await f.request('/products/' + id)).status, 404);
  assert.equal(
    (await f.request('/creator/' + id, 'PATCH', { kind: 'product', title: '越权' }, other)).status,
    404
  );
  const approved = await f.request('/admin/products/' + id, 'PATCH', { status: 'published' }, admin);
  assert.equal(approved.json.item.supplyStatus, '预售');
  const publicList = await f.request('/products?status=' + encodeURIComponent('预售'));
  assert.ok(publicList.json.items.some((x) => x.id === id));
  const hidden = await f.request('/creator/' + id, 'PATCH', { kind: 'product', status: 'hidden' }, supplier);
  assert.equal(hidden.json.item.status, 'hidden');
  assert.equal((await f.request('/products/' + id)).status, 404);
});

test('private KB and upload isolation: users cannot read other users records or certificate images', async (t) => {
  const f = await fixture(t);
  const owner = await f.login('owner'),
    other = await f.login('owner', 'owner-02'),
    admin = await f.login('admin');
  const knowledge = await f.request(
    '/knowledge',
    'POST',
    { title: '我的私有信息', body: '绝不能给第二个店主', scope: 'private' },
    owner
  );
  assert.equal(knowledge.status, 201);
  const id = knowledge.json.item.id;
  assert.ok(!(await f.request('/knowledge', 'GET', undefined, other)).json.items.some((x) => x.id === id));
  assert.equal((await f.request('/knowledge/' + id, 'DELETE', {}, other)).status, 404);
  assert.ok(
    !(await f.request('/knowledge', 'GET', undefined, owner)).json.items.some((x) => x.scope === 'platform')
  );
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
    'license.png'
  );
  form.append('purpose', 'license');
  const file = (await f.request('/uploads', 'POST', form, owner)).json.file;
  assert.ok(file.id);
  assert.equal((await fetch(f.base + file.url)).status, 401);
  assert.equal(
    (await fetch(f.base + file.url, { headers: { Authorization: `Bearer ${other}` } })).status,
    404
  );
  assert.equal(
    (await fetch(f.base + file.url, { headers: { Authorization: `Bearer ${admin}` } })).status,
    200
  );
  const cert = await f.request(
    '/certifications',
    'POST',
    { company: '示例服饰店', scope: '服装零售', licenseFileId: file.id },
    owner
  );
  assert.equal(cert.json.application.status, 'pending');
  assert.match(cert.json.application.precheck.industryScope, /符合/);
  assert.equal(
    (await f.request('/creator', 'POST', { kind: 'content', title: '未审核发布' }, owner)).status,
    403
  );
  await f.request(
    '/admin/certifications/' + cert.json.application.id,
    'PATCH',
    { status: 'approved' },
    admin
  );
  assert.equal((await f.request('/auth/me', 'GET', undefined, owner)).json.user.verified, true);
});

test('AI: no credential fails clearly, jobs remain private, stored key is encrypted and never echoed', async (t) => {
  const f = await fixture(t);
  const owner = await f.login('owner'),
    other = await f.login('owner', 'owner-02'),
    admin = await f.login('admin');
  const created = await f.request('/jobs', 'POST', { task: 'diagnosis', profile: { area: 80 } }, owner);
  assert.equal(created.status, 202);
  let job;
  for (let i = 0; i < 30; i++) {
    job = (await f.request('/jobs/' + created.json.job.id, 'GET', undefined, owner)).json.job;
    if (job.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'MODEL_NOT_CONFIGURED');
  assert.equal(job.result, undefined);
  assert.equal((await f.request('/jobs/' + job.id, 'GET', undefined, other)).status, 404);
  const key = 'test-secret-do-not-return-abc123';
  const provider = await f.request(
    '/admin/providers/deepseek',
    'PATCH',
    { apiKey: key, enabled: false },
    admin
  );
  assert.equal(provider.status, 200);
  assert.equal(provider.json.item.hasKey, true);
  assert.ok(!JSON.stringify(provider.json).includes(key));
  assert.ok(!JSON.stringify((await f.request('/bootstrap')).json).includes(key));
  assert.ok(!f.app.db.get('providers', 'deepseek').secret.includes(key));
  assert.ok(!JSON.stringify((await f.request('/admin/audit', 'GET', undefined, admin)).json).includes(key));
});

test('two-tower: separate learned matrices reduce loss, persist checkpoint and produce different retrieval', async (t) => {
  const f = await fixture(t);
  const m = trainModel(f.app.db);
  assert.equal(m.kind, 'two-tower-feature-projection');
  assert.ok(m.samples > 10);
  assert.ok(m.trainingLoss < m.initialLoss);
  const model = f.app.db.get('models', 'two-tower');
  assert.equal(model.wu.length, 12);
  assert.equal(model.wi[0].length, 64);
  assert.notDeepEqual(model.wu, model.wi);
  const items = f.app.db.list('products'),
    config = readConfig(f.app.db);
  const a = recommendations(f.app.db, f.app.db.get('users', 'owner-01'), items, config);
  const b = recommendations(f.app.db, f.app.db.get('users', 'owner-02'), items, config);
  assert.equal(a.strategy, 'two-tower');
  assert.notDeepEqual(
    a.items.slice(0, 8).map((x) => x.id),
    b.items.slice(0, 8).map((x) => x.id)
  );
  assert.equal(
    recommendations(f.app.db, { id: 'x', personalized: false }, items, config).strategy,
    'non-personalized'
  );
  f.app.db.save('models', { id: 'two-tower', wu: null, wi: null });
  assert.equal(
    recommendations(f.app.db, f.app.db.get('users', 'owner-01'), items, config).strategy,
    'fallback-reviewed'
  );
});

test('ingestion bridge: confirmed content really publishes, products require human fields, source remains private', async (t) => {
  const f = await fixture(t);
  const admin = f.app.db.get('users', 'admin-01'),
    bridge = importerBridge(f.app.db, f.app.ai);
  const card = {
    target: 'content',
    title: '导入确认后的经营方法',
    body: '这段是编辑确认的公开正文。',
    idempotencyKey: 'ingest:test:0:content',
    sourceUploadId: 'private-source'
  };
  const published = await bridge.publishCard(admin, card);
  assert.equal(published.published, true);
  const retrieved = await f.request('/content/' + published.item.id);
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.json.item.title, card.title);
  assert.equal((await bridge.publishCard(admin, card)).item.id, published.item.id);
  await assert.rejects(
    () => bridge.publishCard(admin, { ...card, target: 'product', idempotencyKey: 'ingest:test:1:product' }),
    (e) => e.status === 400
  );
  const product = await bridge.publishCard(admin, {
    ...card,
    target: 'product',
    idempotencyKey: 'ingest:test:2:product',
    supplierId: 'supplier-01',
    origin: '广州',
    style: '韩系',
    category: '上装',
    price: 98,
    moq: 6
  });
  assert.equal((await f.request('/products/' + product.item.id)).status, 200);
  const kb = await bridge.publishCard(admin, {
    ...card,
    target: 'knowledge',
    idempotencyKey: 'ingest:test:3:knowledge'
  });
  const owner = await f.login('owner');
  assert.ok(
    !(await f.request('/knowledge', 'GET', undefined, owner)).json.items.some((x) => x.id === kb.item.id)
  );
  assert.equal((await f.request('/ingestion/uploads/private-source/file')).status, 401);
  await assert.rejects(
    () => bridge.understand(admin, { cards: [{ title: '待归类', body: '示例' }] }),
    (e) => e.code === 'MODEL_NOT_CONFIGURED'
  );
});

test('persistent SQLite: profiles, private records and learned checkpoint survive restart', async (t) => {
  const dataDir = mkdtempSync(join(dataRoot, 'backend-test-'));
  let app = createApp({ dataDir });
  app.db.save('knowledge', {
    id: 'restart-private',
    ownerId: 'owner-01',
    scope: 'private',
    body: 'restart value'
  });
  trainModel(app.db);
  const version = app.db.get('models', 'two-tower').version;
  await app.close();
  app = createApp({ dataDir });
  assert.equal(app.db.get('knowledge', 'restart-private').body, 'restart value');
  assert.equal(app.db.get('models', 'two-tower').version, version);
  assert.equal(app.db.list('products').length, 36);
  await app.close();
  if (dataDir.startsWith(dataRoot + '\\')) rmSync(dataDir, { recursive: true, force: true });
});

test('publication media lifecycle: only consented content uploads become public, all private originals remain private', async (t) => {
  const f = await fixture(t);
  const owner = await f.login('owner'),
    admin = await f.login('admin');
  async function upload(purpose) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
      'sample.png'
    );
    form.append('purpose', purpose);
    form.append('visibility', 'public');
    return (await f.request('/uploads', 'POST', form, owner)).json.file;
  }
  const content = await upload('content');
  assert.equal(content.public, false);
  assert.equal((await fetch(f.base + content.url)).status, 401);
  const first = (
    await f.request(
      '/creator',
      'POST',
      { kind: 'content', title: '授权发布的素材', image: content.url, media: [content] },
      owner
    )
  ).json.item;
  const second = (
    await f.request(
      '/creator',
      'POST',
      { kind: 'content', title: '复用已授权素材', image: content.url },
      owner
    )
  ).json.item;
  await f.request('/admin/content/' + first.id, 'PATCH', { status: 'published' }, admin);
  assert.equal((await fetch(f.base + content.url)).status, 200);
  await f.request('/admin/content/' + second.id, 'PATCH', { status: 'published' }, admin);
  await f.request('/admin/content/' + first.id, 'PATCH', { status: 'hidden' }, admin);
  assert.equal((await fetch(f.base + content.url)).status, 200);
  await f.request('/admin/content/' + second.id, 'DELETE', {}, admin);
  assert.equal((await fetch(f.base + content.url)).status, 401);
  for (const purpose of ['private', 'license', 'diagnosis', 'knowledge']) {
    const file = await upload(purpose);
    const post = await f.request(
      '/creator',
      'POST',
      { kind: 'content', title: '尝试公开私有原件', image: file.url },
      owner
    );
    assert.equal(post.status, 403);
    assert.equal(f.app.db.get('files', file.id).public, false);
  }
});

test('config and entitlement methods are enforced server-side; buyers list never bypasses contact quota', async (t) => {
  const f = await fixture(t);
  const admin = await f.login('admin'),
    supplier = await f.login('supplier');
  await f.request('/admin/config', 'PUT', { features: { content: false } }, admin);
  await f.request(
    '/admin/config',
    'PUT',
    {
      features: { diagnosis: false },
      priceBands: [{ label: '50至150元', min: 50, max: 150 }],
      moqBands: [{ label: '小批量', min: 1, max: 8 }]
    },
    admin
  );
  const config = (await f.request('/bootstrap')).json.config;
  assert.equal(config.features.content, false);
  assert.equal(config.features.products, true);
  assert.equal(config.features.diagnosis, false);
  assert.equal(config.priceBands[0].max, 150);
  assert.equal(
    (await f.request('/admin/config', 'PUT', { moqBands: [{ label: '错误', min: 50, max: 1 }] }, admin))
      .status,
    400
  );
  f.app.db.save('buyers', {
    ...f.app.db.get('buyers', 'buyer-01'),
    publicContact: { wechat: 'authorized_wechat', phone: '13800000004' }
  });
  const buyers = (await f.request('/buyers', 'GET', undefined, supplier)).json.items;
  assert.ok(!JSON.stringify(buyers).includes('authorized_wechat'));
  assert.ok(!JSON.stringify(buyers).includes('13800000004'));
  await f.request('/admin/plans/free', 'PATCH', { contactMethods: ['wechat'] }, admin);
  const contact = (await f.request('/leads', 'POST', { buyerId: 'buyer-01' }, supplier)).json.contact;
  assert.deepEqual(contact.channels, [{ type: 'wechat', value: 'authorized_wechat' }]);
  await f.request('/admin/plans/free', 'PATCH', { contactMethods: [] }, admin);
  assert.equal(
    (await f.request('/leads', 'POST', { buyerId: 'buyer-02' }, supplier)).json.error.code,
    'CONTACT_NOT_INCLUDED'
  );
});

test('production initialization contains no synthetic public content or accounts and refuses reuse of a demo database', async (t) => {
  const production = await fixture(t, { demoAuth: false });
  for (const resource of ['users', 'products', 'content', 'fairs', 'buyers', 'knowledge'])
    assert.equal(production.app.db.list(resource).length, 0);
  assert.equal((await production.request('/products')).json.items.length, 0);
  assert.equal((await production.request('/bootstrap')).json.config.banners.length, 0);
  const dataDir = mkdtempSync(join(dataRoot, 'backend-test-'));
  const demo = createApp({ dataDir });
  await demo.close();
  assert.throws(() => createApp({ dataDir, demoAuth: false }), /正式模式不能直接使用演示数据库/);
  if (dataDir.startsWith(dataRoot + '\\')) rmSync(dataDir, { recursive: true, force: true });
});

test('profile: validated account facts affect recommendation features and cannot change role or approved company', async (t) => {
  const f = await fixture(t);
  const owner = await f.login('owner');
  const before = (await f.request('/recommendations?kind=products', 'GET', undefined, owner)).json;
  const profile = {
    name: '资料测试店主',
    shop: '本人店铺',
    city: '深圳',
    style: '新中式',
    area: 120,
    customerAge: '35—45岁',
    retailPriceBand: '399—699元',
    businessYears: 5,
    operationNeeds: ['小单快返', '库存周转']
  };
  const updated = await f.request('/profile', 'PATCH', profile, owner);
  assert.equal(updated.status, 200);
  assert.equal(updated.json.profile.area, 120);
  assert.equal(updated.json.user.role, 'owner');
  assert.deepEqual((await f.request('/profile', 'GET', undefined, owner)).json.profile, profile);
  assert.equal((await f.request('/profile', 'PATCH', { role: 'admin' }, owner)).status, 400);
  assert.equal((await f.request('/profile', 'PATCH', { companyName: '未经审核改主体' }, owner)).status, 400);
  assert.equal((await f.request('/profile', 'PATCH', { area: -1 }, owner)).status, 400);
  const after = (await f.request('/recommendations?kind=products', 'GET', undefined, owner)).json;
  assert.notDeepEqual(
    before.items.map((x) => x.recommendationScore),
    after.items.map((x) => x.recommendationScore)
  );
});

test('private AI output previews: scoped temporary tickets allow native media without publicizing originals', async (t) => {
  const f = await fixture(t);
  const owner = await f.login('owner'),
    other = await f.login('owner', 'owner-02');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'test.png');
  form.append('purpose', 'private');
  const file = (await f.request('/uploads', 'POST', form, owner)).json.file;
  f.app.db.save('files', { ...f.app.db.get('files', file.id), purpose: 'generated' });
  f.app.db.save('jobs', {
    id: 'generated-preview-test',
    ownerId: 'owner-01',
    task: 'image',
    status: 'completed',
    result: { type: 'image', fileId: file.id, url: file.url, text: '测试用生成结果占位，不代表模型实测' }
  });
  assert.equal((await fetch(f.base + file.url)).status, 401);
  const job = (await f.request('/jobs/generated-preview-test', 'GET', undefined, owner)).json.job;
  assert.ok(job.result.url.includes('ticket='));
  assert.equal((await fetch(f.base + job.result.url)).status, 200);
  assert.equal(f.app.db.get('files', file.id).public, false);
  const tampered = new URL(f.base + job.result.url);
  const ticket = tampered.searchParams.get('ticket');
  tampered.searchParams.set('ticket', (ticket[0] === 'A' ? 'B' : 'A') + ticket.slice(1));
  assert.equal((await fetch(tampered)).status, 401);
  assert.equal((await f.request('/jobs/generated-preview-test', 'GET', undefined, other)).status, 404);
  assert.equal(
    (
      await f.request(
        '/creator',
        'POST',
        { kind: 'content', title: '不允许将私有生成原件直接公开', image: job.result.url },
        owner
      )
    ).status,
    403
  );
  f.app.db.save('files', { ...f.app.db.get('files', file.id), purpose: 'license' });
  assert.equal((await fetch(f.base + job.result.url)).status, 401);
});

test('certificate OCR workflow: automatically queues configured OCR, synchronizes extracted differences and never approves', async (t) => {
  let fail = false,
    company = 'OCR测试服饰店';
  const fetchImpl = async (url, options) => {
    assert.ok(String(url).endsWith('/chat/completions'));
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'test-ocr-model');
    assert.ok(
      body.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url'))
    );
    if (fail) return new Response('{"error":{"message":"private vendor error"}}', { status: 502 });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                companyName: company,
                businessScope: '服装零售',
                registrationNumber: 'TEST-ONLY-NOT-A-REAL-LICENSE',
                uncertainFields: []
              })
            }
          }
        ]
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  };
  const f = await fixture(t, { ai: { fetchImpl, timeoutMs: 1000 } }),
    admin = await f.login('admin'),
    owner = await f.login('owner', 'owner-guest');
  await f.request(
    '/admin/providers/openai',
    'PATCH',
    { enabled: true, apiKey: 'not-a-real-key-for-ocr-test', model: 'test-ocr-model', capabilities: ['ocr'] },
    admin
  );
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
    'fake-test-license.png'
  );
  form.append('purpose', 'license');
  const file = (await f.request('/uploads', 'POST', form, owner)).json.file;
  async function submitAndPoll() {
    const submitted = await f.request(
      '/certifications',
      'POST',
      { company: 'OCR测试服饰店', scope: '服装零售', licenseFileId: file.id },
      owner
    );
    assert.equal(submitted.status, 201);
    assert.ok(submitted.json.application.precheck.jobId);
    let cert;
    for (let i = 0; i < 50; i++) {
      cert = (await f.request('/certifications', 'GET', undefined, owner)).json.items.find(
        (x) => x.id === submitted.json.application.id
      );
      if (['completed', 'failed'].includes(cert.precheck.ocrStatus)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    return cert;
  }
  const match = await submitAndPoll();
  assert.equal(match.precheck.ocrStatus, 'completed');
  assert.match(match.precheck.consistency.company, /一致/);
  assert.match(match.precheck.consistency.industry, /无需另证女装/);
  assert.equal(match.status, 'pending');
  assert.equal((await f.request('/auth/me', 'GET', undefined, owner)).json.user.verified, false);
  company = '另一个主体名称';
  const mismatch = await submitAndPoll();
  assert.match(mismatch.precheck.consistency.company, /差异/);
  assert.equal(mismatch.status, 'pending');
  const adminRead = (await f.request('/admin/certifications/' + mismatch.id, 'GET', undefined, admin)).json
    .item;
  assert.equal(adminRead.precheck.extracted.companyName, '另一个主体名称');
  fail = true;
  const failure = await submitAndPoll();
  assert.equal(failure.precheck.ocrStatus, 'failed');
  assert.equal(failure.status, 'pending');
  assert.ok(!JSON.stringify(failure).includes('private vendor error'));
});

test('native generic MIME compatibility: PNG magic succeeds, EXE and HTML renamed as images stay rejected', async (t) => {
  const f = await fixture(t),
    owner = await f.login('owner');
  async function upload(bytes, name) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), name);
    form.append('purpose', 'license');
    return f.request('/uploads', 'POST', form, owner);
  }
  const png = await upload(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'native-upload.bin');
  assert.equal(png.status, 201);
  assert.equal(png.json.file.mime, 'image/png');
  assert.equal(png.json.file.public, false);
  assert.equal((await upload(new Uint8Array([77, 90, 0, 0, 0, 0]), 'renamed.png')).status, 400);
  assert.equal(
    (await upload(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'renamed.jpg')).status,
    400
  );
});

test('self contact enrollment: consent, certification, channel entitlement, QR privacy and revocation are enforced', async (t) => {
  const f = await fixture(t),
    admin = await f.login('admin'),
    supplier = await f.login('supplier'),
    owner = await f.login('owner'),
    guest = await f.login('owner', 'owner-guest');
  assert.equal(
    (await f.request('/profile/contact', 'PATCH', { wechat: 'guest_test', consent: true }, guest)).status,
    403
  );
  const contact = { wechat: 'supplier_wechat', phone: '13800000008', qrUrl: '', consent: false };
  assert.equal((await f.request('/profile/contact', 'PATCH', contact, supplier)).status, 200);
  assert.deepEqual((await f.request('/profile/contact', 'GET', undefined, supplier)).json.contact, contact);
  assert.equal(
    (await f.request('/leads', 'POST', { supplierId: 'supplier-01' }, owner)).json.contact.available,
    false
  );
  await f.request('/profile/contact', 'PATCH', { ...contact, consent: true }, supplier);
  const linked = (await f.request('/leads', 'POST', { supplierId: 'supplier-01' }, owner)).json;
  assert.deepEqual(linked.contact.channels, [{ type: 'wechat', value: contact.wechat }]);
  for (const path of ['/bootstrap', '/auth/me', '/admin/users', '/admin/users/supplier-01']) {
    const response = await f.request(path, 'GET', undefined, path.startsWith('/admin') ? admin : supplier);
    assert.ok(!JSON.stringify(response.json).includes(contact.wechat));
    assert.ok(!JSON.stringify(response.json).includes(contact.phone));
  }
  assert.equal(
    (await f.request('/profile/contact', 'PATCH', { wechat: 'bad<id>', consent: true }, supplier)).status,
    400
  );
  assert.equal(
    (await f.request('/profile/contact', 'PATCH', { phone: 'not-a-phone', consent: true }, supplier)).status,
    400
  );
  assert.equal((await f.request('/profile/contact', 'PATCH', { consent: 'yes' }, supplier)).status, 400);
  await f.request('/profile/contact', 'PATCH', { consent: false }, supplier);
  assert.equal(
    (await f.request('/leads', 'POST', { supplierId: 'supplier-01' }, owner)).json.contact.available,
    false
  );
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
    'qr.png'
  );
  form.append('purpose', 'content');
  const file = (await f.request('/uploads', 'POST', form, owner)).json.file;
  const buyersBefore = f.app.db.list('buyers').length;
  await f.request(
    '/profile/contact',
    'PATCH',
    { wechat: 'owner_wechat', phone: '13800000007', qrUrl: file.url, consent: true },
    owner
  );
  assert.equal(f.app.db.list('buyers').length, buyersBefore);
  assert.equal(f.app.db.get('buyers', 'buyer-01').publicContact.wechat, 'owner_wechat');
  await f.request('/admin/plans/free', 'PATCH', { contactMethods: ['wechat', 'phone', 'qrcode'] }, admin);
  const response = await f.request('/leads', 'POST', { buyerId: 'buyer-01' }, supplier);
  const qr = response.json.contact.channels.find((x) => x.type === 'qrcode');
  assert.ok(qr.value.includes('ticket='));
  assert.equal((await fetch(f.base + file.url)).status, 401);
  assert.equal((await fetch(f.base + qr.value)).status, 200);
  assert.equal(f.app.db.get('files', file.id).public, false);
  assert.ok(
    !JSON.stringify((await f.request('/buyers', 'GET', undefined, supplier)).json).includes('owner_wechat')
  );
  await f.request('/profile/contact', 'PATCH', { consent: false }, owner);
  assert.equal((await fetch(f.base + qr.value)).status, 401);
  const retry = await f.request('/leads', 'POST', { buyerId: 'buyer-01' }, supplier);
  assert.equal(retry.status, 404);
  assert.ok(!JSON.stringify(retry.json).includes('owner_wechat'));
});

test('real account shapes: supplier user ID differs from company ID, published product and contact lead retain correct ownership', async (t) => {
  const f = await fixture(t),
    owner = await f.login('owner'),
    admin = await f.login('admin');
  f.app.db.save('users', {
    id: 'supplier-real-shape',
    companyId: 'factory-distinct-company',
    role: 'supplier',
    name: '真实ID结构测试',
    companyName: '测试主体',
    verified: true,
    demo: true
  });
  const supplier = await f.login('supplier', 'supplier-real-shape');
  await f.request(
    '/profile/contact',
    'PATCH',
    { wechat: 'real_shape_test', phone: '', qrUrl: '', consent: true },
    supplier
  );
  const created = (
    await f.request(
      '/creator',
      'POST',
      { kind: 'product', title: '区别主体与用户ID的测试货源', price: 99, moq: 6, supplyStatus: '现货' },
      supplier
    )
  ).json.item;
  assert.equal(created.supplierId, 'supplier-real-shape');
  assert.equal(created.companyId, 'factory-distinct-company');
  await f.request('/admin/products/' + created.id, 'PATCH', { status: 'published' }, admin);
  const lead = await f.request(
    '/leads',
    'POST',
    { supplierId: 'factory-distinct-company', productId: created.id },
    owner
  );
  assert.equal(lead.status, 201);
  assert.equal(lead.json.lead.companyId, 'factory-distinct-company');
  assert.equal(lead.json.lead.supplierId, 'supplier-real-shape');
  assert.equal(lead.json.contact.channels[0].value, 'real_shape_test');
  assert.ok(
    (await f.request('/leads', 'GET', undefined, supplier)).json.items.some((x) => x.id === lead.json.lead.id)
  );
});
