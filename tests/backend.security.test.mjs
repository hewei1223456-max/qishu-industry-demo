import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../apps/server/src/server.js';
import { requireAdmin } from '../apps/server/src/auth.js';
import { leadContact } from '../apps/server/src/catalog.js';
import { readConfig } from '../apps/server/src/config.js';

async function fixture(t) {
  const root = resolve('data'),
    dataDir = mkdtempSync(join(root, 'backend-security-'));
  const app = createApp({ dbPath: ':memory:', dataDir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    if (dataDir.startsWith(root + '\\')) rmSync(dataDir, { recursive: true, force: true });
  });
  const request = async (path, method = 'GET', body, token) => {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, json: await r.json() };
  };
  const login = async (role, userId) => (await request('/auth/demo', 'POST', { role, userId })).json.token;
  return { app, request, login };
}

test('RBAC: empty permission denies admin routes, grants update live, disabled binding immediately revokes sessions', async (t) => {
  assert.throws(
    () => requireAdmin({ id: 'limited', role: 'admin', permissions: [] }),
    (e) => e.status === 403
  );
  const f = await fixture(t),
    highest = await f.login('admin');
  f.app.db.save('users', {
    id: 'limited-test-admin',
    role: 'admin',
    primaryRole: 'owner',
    companyId: 'staff-test',
    verified: true,
    permissions: ['*'],
    adminGrantId: 'limited-test-grant',
    name: '受限管理员测试',
    demo: true
  });
  f.app.db.save('admins', {
    id: 'limited-test-grant',
    phone: '13800000009',
    userId: 'limited-test-admin',
    status: 'active',
    bindingVerified: true,
    permissions: []
  });
  const limited = await f.login('admin', 'limited-test-admin');
  assert.equal((await f.request('/admin/content', 'GET', undefined, limited)).status, 403);
  assert.equal((await f.request('/admin/providers', 'GET', undefined, limited)).status, 403);
  const bootstrap = (await f.request('/bootstrap', 'GET', undefined, limited)).json;
  assert.equal(bootstrap.config.systemPrompts, undefined);
  assert.deepEqual(bootstrap.user.permissions, []);
  f.app.db.save('admins', { ...f.app.db.get('admins', 'limited-test-grant'), permissions: ['content:read'] });
  assert.equal((await f.request('/admin/content', 'GET', undefined, limited)).status, 200);
  assert.equal(
    (await f.request('/admin/content/article-01', 'PATCH', { title: '禁止越权修改' }, limited)).status,
    403
  );
  assert.equal((await f.request('/admin/providers', 'GET', undefined, limited)).status, 403);
  assert.ok(
    !(await f.request('/knowledge', 'GET', undefined, limited)).json.items.some((x) => x.scope === 'platform')
  );
  assert.equal(
    (
      await f.request(
        '/knowledge',
        'POST',
        { title: '非法改平台知识', body: '不应写入', scope: 'platform' },
        limited
      )
    ).status,
    403
  );
  f.app.db.save('jobs', {
    id: 'another-private-job',
    ownerId: 'owner-01',
    status: 'completed',
    result: { type: 'text', text: '另一个用户的私密诊断' }
  });
  assert.equal((await f.request('/jobs/another-private-job', 'GET', undefined, limited)).status, 404);
  f.app.db.save('leads', {
    id: 'foreign-lead',
    createdBy: 'supplier-01',
    companyId: 'supplier-01',
    status: '待回访'
  });
  f.app.db.save('admins', { ...f.app.db.get('admins', 'limited-test-grant'), permissions: ['leads:read'] });
  assert.ok(
    (await f.request('/leads', 'GET', undefined, limited)).json.items.some((x) => x.id === 'foreign-lead')
  );
  assert.equal((await f.request('/leads/foreign-lead', 'PATCH', { status: '已回访' }, limited)).status, 404);
  const disabled = await f.request(
    '/admin/admins/limited-test-grant',
    'PATCH',
    { status: 'disabled' },
    highest
  );
  assert.equal(disabled.status, 200);
  assert.equal(disabled.json.item.status, 'disabled');
  assert.equal((await f.request('/auth/me', 'GET', undefined, limited)).json.user.role, 'owner');
  assert.equal((await f.request('/admin/content', 'GET', undefined, limited)).status, 403);
});

test('revoked contacts: deleted/disabled buyer and supplier cannot be contacted through known IDs or old leads', async (t) => {
  const f = await fixture(t),
    admin = await f.login('admin'),
    supplier = await f.login('supplier'),
    owner = await f.login('owner');
  f.app.db.save('buyers', {
    ...f.app.db.get('buyers', 'buyer-01'),
    publicContact: { wechat: 'REVOKED_CONTACT' }
  });
  const first = await f.request('/leads', 'POST', { buyerId: 'buyer-01' }, supplier);
  assert.equal(first.status, 201);
  assert.equal(first.json.contact.available, true);
  await f.request('/admin/buyers/buyer-01', 'DELETE', {}, admin);
  assert.equal((await f.request('/leads', 'POST', { buyerId: 'buyer-01' }, supplier)).status, 404);
  const oldContact = leadContact(
    f.app.db,
    f.app.db.get('users', 'supplier-01'),
    first.json.lead,
    readConfig(f.app.db)
  );
  assert.equal(oldContact.available, false);
  assert.ok(!JSON.stringify(oldContact).includes('REVOKED_CONTACT'));
  for (const status of ['disabled', 'suspended', 'revoked']) {
    f.app.db.save('buyers', { ...f.app.db.get('buyers', 'buyer-02'), status, public: true });
    assert.equal((await f.request('/leads', 'POST', { buyerId: 'buyer-02' }, supplier)).status, 404);
  }
  f.app.db.save('users', {
    ...f.app.db.get('users', 'supplier-02'),
    status: 'deleted',
    publicContact: { wechat: 'REMOVED_SUPPLIER' }
  });
  assert.equal((await f.request('/leads', 'POST', { supplierId: 'supplier-02' }, owner)).status, 404);
  assert.equal(
    leadContact(
      f.app.db,
      f.app.db.get('users', 'owner-01'),
      { supplierId: 'supplier-02' },
      readConfig(f.app.db)
    ).available,
    false
  );
});
