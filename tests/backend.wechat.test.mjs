import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../apps/server/src/server.js';

async function setup(t, officialHandler) {
  const root = resolve('data'),
    dataDir = mkdtempSync(join(root, 'backend-wx-test-'));
  const calls = [];
  const mock = async (url, options = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.weixin.qq.com');
    calls.push({ url: u, options });
    const data = await officialHandler(u, options);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const app = createApp({
    dbPath: ':memory:',
    dataDir,
    wechat: { appId: 'wx-app-test', appSecret: 'wx-private-test-secret', fetchImpl: mock }
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    if (dataDir.startsWith(root + '\\')) rmSync(dataDir, { recursive: true, force: true });
  });
  const req = async (path, body, token, method = 'POST') => {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, json: await r.json(), headers: r.headers };
  };
  return { app, req, calls };
}

test('WeChat official protocol: login creates server identity, phone code validates, no secret/session_key leaks', async (t) => {
  const f = await setup(t, (url, options) => {
    if (url.pathname === '/sns/jscode2session') {
      assert.equal(url.searchParams.get('appid'), 'wx-app-test');
      assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
      assert.equal(url.searchParams.get('secret'), 'wx-private-test-secret');
      return { openid: 'openid-one', session_key: 'private-session-key-one' };
    }
    if (url.pathname === '/cgi-bin/stable_token') {
      const b = JSON.parse(options.body);
      assert.equal(b.grant_type, 'client_credential');
      assert.equal(b.secret, 'wx-private-test-secret');
      return { access_token: 'official-access-token', expires_in: 7200 };
    }
    if (url.pathname === '/wxa/business/getuserphonenumber') {
      assert.equal(url.searchParams.get('access_token'), 'official-access-token');
      assert.ok(JSON.parse(options.body).code);
      return {
        errcode: 0,
        phone_info: { purePhoneNumber: '13800000001', countryCode: '86', watermark: { appid: 'wx-app-test' } }
      };
    }
    throw Error('unexpected endpoint');
  });
  const login = await f.req('/auth/wechat', { code: 'login-code-01', role: 'supplier' });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.role, 'supplier');
  assert.equal(login.json.user.verified, false);
  assert.equal(login.json.user.phoneVerified, false);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.ok(!JSON.stringify(login.json).includes('private-session-key'));
  assert.ok(!JSON.stringify(login.json).includes('openid-one'));
  assert.ok(!JSON.stringify(login.json).includes('wx-private-test-secret'));
  assert.equal((await f.req('/auth/demo', { role: 'supplier', userId: login.json.user.id })).status, 400);
  assert.equal((await f.req('/auth/wechat', { code: 'login-code-01', role: 'admin' })).status, 409);
  const phone = await f.req('/auth/phone', { code: 'phone-code-01', phone: '19999999999' }, login.json.token);
  assert.equal(phone.status, 200);
  assert.equal(phone.json.user.phoneMasked, '138****0001');
  assert.equal(phone.json.user.phoneVerified, true);
  assert.equal(phone.json.user.verified, false);
  assert.equal((await f.req('/auth/phone', { code: 'phone-code-01' }, phone.json.token)).status, 409);
  const second = await f.req('/auth/wechat', { code: 'login-code-02', role: 'admin' });
  assert.equal(second.json.user.id, login.json.user.id);
  assert.equal(second.json.user.role, 'supplier');
  assert.equal(f.calls.filter((c) => c.url.pathname === '/cgi-bin/stable_token').length, 1);
});

test('WeChat admin: only verified matching phone whitelist grants permission; revocation applies to existing session', async (t) => {
  const f = await setup(t, (url) =>
    url.pathname === '/sns/jscode2session'
      ? { openid: 'admin-wechat-one', session_key: 'never-client' }
      : url.pathname === '/cgi-bin/stable_token'
        ? { access_token: 'cached-token', expires_in: 7200 }
        : {
            errcode: 0,
            phone_info: {
              purePhoneNumber: '13800000002',
              countryCode: '86',
              watermark: { appid: 'wx-app-test' }
            }
          }
  );
  const admin = (await f.req('/auth/demo', { role: 'admin' })).json.token;
  const grant = await f.req(
    '/admin/admins',
    { name: '已授权运营', phone: '13800000002', permissions: ['*'] },
    admin
  );
  assert.equal(grant.status, 201);
  assert.equal(grant.json.item.bindingVerified, false);
  const login = await f.req('/auth/wechat', { code: 'admin-login-code', role: 'admin' });
  assert.equal(login.json.user.role, 'owner');
  assert.equal((await f.req('/admin/config', undefined, login.json.token, 'GET')).status, 403);
  const phone = await f.req('/auth/phone', { code: 'admin-phone-code' }, login.json.token);
  assert.equal(phone.json.user.role, 'admin');
  assert.equal(phone.json.user.adminGrantId, grant.json.item.id);
  assert.equal((await f.req('/admin/config', undefined, phone.json.token, 'GET')).status, 200);
  await f.req('/admin/admins/' + grant.json.item.id, {}, admin, 'DELETE');
  assert.equal((await f.req('/admin/config', undefined, phone.json.token, 'GET')).status, 403);
});

test('WeChat invalid identity/watermark and official errors never open verification or admin rights', async (t) => {
  const f = await setup(t, (url) =>
    url.pathname === '/sns/jscode2session'
      ? url.searchParams.get('js_code') === 'invalid-code'
        ? { errcode: 40029, errmsg: 'must not echo private secret' }
        : { openid: 'ordinary-one', session_key: 'never-client' }
      : url.pathname === '/cgi-bin/stable_token'
        ? { access_token: 'test-access', expires_in: 7200 }
        : {
            errcode: 0,
            phone_info: {
              purePhoneNumber: '13800000003',
              countryCode: '86',
              watermark: { appid: 'wrong-app' }
            }
          }
  );
  const bad = await f.req('/auth/wechat', { code: 'invalid-code' });
  assert.equal(bad.status, 400);
  assert.ok(!JSON.stringify(bad.json).includes('private secret'));
  const login = await f.req('/auth/wechat', { code: 'ordinary-login-code', role: 'admin' });
  assert.equal(login.json.user.role, 'owner');
  assert.equal((await f.req('/auth/phone', { code: 'wrong-watermark-code' }, login.json.token)).status, 400);
  assert.equal(f.app.db.get('users', login.json.user.id).phoneVerified, false);
  assert.equal((await f.req('/leads', { supplierId: 'supplier-01' }, login.json.token)).status, 403);
});
