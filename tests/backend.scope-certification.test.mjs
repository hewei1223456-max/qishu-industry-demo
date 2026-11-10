import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../apps/server/src/server.js';

async function fixture(t, options = {}) {
  const root = resolve('data'),
    dataDir = mkdtempSync(join(root, 'scope-cert-')),
    app = createApp({ dataDir, ...options });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`,
    scopes = new Map();
  const request = async (path, method = 'GET', body, token, scope = scopes.get(token) || 'front', cookie) => {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: {
        'X-Qishu-Scope': scope,
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie || '' })
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    });
    return { status: r.status, json: await r.json(), cookie: r.headers.get('set-cookie') };
  };
  const login = async (role, scope = 'front', userId) => {
    const r = await request('/auth/demo', 'POST', { role, scope, userId }, null, scope);
    if (r.status === 200) scopes.set(r.json.token, scope);
    return r;
  };
  const upload = async (filename, purpose, token) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([readFileSync(filename)], {
        type: filename.endsWith('.mp4') ? 'video/mp4' : 'image/png'
      }),
      filename.split(/[\\/]/).pop()
    );
    form.append('purpose', purpose);
    return request(
      '/uploads' + (purpose === 'certification_video' ? '?purpose=certification_video' : ''),
      'POST',
      form,
      token
    );
  };
  t.after(async () => {
    await app.close();
    if (dataDir.startsWith(root + '\\')) rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, base, request, login, upload, dataDir, scopes };
}

test('front/back sessions isolate cookies and Bearer, frontend admin cannot read management data', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/app.js')).headers.get('cache-control'), 'no-cache');
  const owner = await f.login('owner'),
    admin = await f.login('admin', 'back'),
    frontAdmin = await f.login('admin', 'front');
  assert.equal((await f.login('owner', 'back')).status, 403);
  assert.match(owner.cookie, /qishu_front_session=/);
  assert.match(admin.cookie, /qishu_back_session=/);
  const cookie = owner.cookie.split(';')[0] + '; ' + admin.cookie.split(';')[0];
  assert.equal(
    (await f.request('/auth/me', 'GET', undefined, null, 'front', cookie)).json.user.role,
    'owner'
  );
  assert.equal((await f.request('/auth/me', 'GET', undefined, null, 'back', cookie)).json.user.role, 'admin');
  assert.equal((await f.request('/auth/me', 'GET', undefined, admin.json.token, 'front')).json.user, null);
  assert.equal(
    (await f.request('/admin/config', 'GET', undefined, frontAdmin.json.token, 'front')).status,
    401
  );
  assert.equal((await f.request('/admin/config', 'GET', undefined, owner.json.token, 'back')).status, 401);
  assert.equal(
    (await f.request('/bootstrap', 'GET', undefined, frontAdmin.json.token)).json.config.systemPrompts,
    undefined
  );
  assert.ok(
    !(await f.request('/knowledge', 'GET', undefined, frontAdmin.json.token)).json.items.some(
      (x) => x.scope === 'platform'
    )
  );
  await f.request('/auth/logout', 'POST', {}, null, 'front', cookie);
  assert.equal((await f.request('/auth/me', 'GET', undefined, null, 'back', cookie)).json.user.role, 'admin');
  assert.equal(f.app.db.get('users', 'owner-01').role, 'owner');
});

test('supplier certification uses real media inspection, distinct private photos, and confirmed phone callback gate', async (t) => {
  const f = await fixture(t),
    supplier = (await f.login('supplier')).json.token,
    owner = (await f.login('owner')).json.token,
    admin = (await f.login('admin', 'back')).json.token;
  assert.equal(f.app.db.get('users', 'supplier-01').verified, false);
  assert.equal((await f.request('/buyers', 'GET', undefined, supplier)).status, 403);
  const ffmpeg = process.env.QISHU_FFMPEG || 'ffmpeg';
  const make = (name, args) => {
    const file = join(f.dataDir, name);
    execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, file], {
      windowsHide: true,
      timeout: 60000
    });
    return file;
  };
  const images = [];
  for (let i = 0; i < 6; i++)
    images.push(
      make('photo-' + i + '.png', [
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x96:rate=1',
        '-vf',
        `hue=h=${i * 43}`,
        '-frames:v',
        '1'
      ])
    );
  const short = make('short.mp4', [
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x96:rate=5',
    '-t',
    '10',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p'
  ]);
  const long = make('long.mp4', [
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x96:rate=5',
    '-t',
    '31',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p'
  ]);
  // Valid MP4 plus synthetic trailing padding verifies the dedicated stream does not retain the old 25MiB ceiling.
  appendFileSync(long, Buffer.alloc(26 * 1024 * 1024));
  const license = (await f.upload(images[0], 'license', supplier)).json.file.id,
    photos = [];
  for (const file of images.slice(1))
    photos.push((await f.upload(file, 'certification_photo', supplier)).json.file.id);
  const shortId = (await f.upload(short, 'certification_video', supplier)).json.file.id,
    longUpload = await f.upload(long, 'certification_video', supplier);
  assert.equal(longUpload.status, 201);
  assert.ok(longUpload.json.file.size > 25 * 1024 * 1024);
  const longId = longUpload.json.file.id;
  const body = {
    company: '真实媒体测试主体',
    scope: '服装批发',
    licenseFileId: license,
    venueVideoFileId: longId,
    venuePhotoFileIds: photos
  };
  assert.equal(
    (await f.request('/certifications', 'POST', { ...body, venuePhotoFileIds: photos.slice(0, 4) }, supplier))
      .status,
    400
  );
  assert.equal(
    (
      await f.request(
        '/certifications',
        'POST',
        { ...body, venuePhotoFileIds: [photos[0], photos[0], ...photos.slice(2)] },
        supplier
      )
    ).status,
    400
  );
  const duplicate = (await f.upload(images[2], 'certification_photo', supplier)).json.file.id;
  assert.equal(
    (
      await f.request(
        '/certifications',
        'POST',
        { ...body, venuePhotoFileIds: [duplicate, ...photos.slice(1)] },
        supplier
      )
    ).json.error.code,
    'DUPLICATE_CERTIFICATE_PHOTOS'
  );
  assert.equal(
    (
      await f.request(
        '/certifications',
        'POST',
        { ...body, venueVideoFileId: shortId, duration: 999 },
        supplier
      )
    ).json.error.code,
    'VIDEO_TOO_SHORT'
  );
  const foreign = (await f.upload(images[1], 'certification_photo', owner)).json.file.id;
  assert.equal(
    (
      await f.request(
        '/certifications',
        'POST',
        { ...body, venuePhotoFileIds: [foreign, ...photos.slice(1)] },
        supplier
      )
    ).status,
    400
  );
  const submitted = await f.request('/certifications', 'POST', body, supplier);
  assert.equal(submitted.status, 201);
  const item = submitted.json.application;
  assert.ok(item.videoVerification.durationSeconds >= 30);
  assert.equal(item.materials.venuePhotos.length, 5);
  assert.equal(item.status, 'pending');
  assert.equal(
    (
      await f.request(
        '/creator',
        'POST',
        { kind: 'content', title: '不得公开认证照片', image: '/api/files/' + photos[0] },
        supplier
      )
    ).status,
    403
  );
  assert.equal(
    (await f.request('/admin/certifications/' + item.id, 'PATCH', { status: 'approved' }, admin)).json.error
      .code,
    'PHONE_REVIEW_REQUIRED'
  );
  const unreachable = await f.request(
    '/admin/certifications/' + item.id + '/phone-review',
    'POST',
    { phone: '13800000009', result: 'unreachable', note: '人工拨打未接通', confirmedCall: true },
    admin
  );
  assert.equal(unreachable.json.item.phoneReview.status, 'pending');
  assert.equal(
    (await f.request('/admin/certifications/' + item.id, 'PATCH', { status: 'approved' }, admin)).status,
    409
  );
  await f.request(
    '/admin/certifications/' + item.id + '/phone-review',
    'POST',
    { phone: '13800000009', result: 'inconsistent', note: '人工核对不一致', confirmedCall: true },
    admin
  );
  assert.equal(f.app.db.get('users', 'supplier-01').verified, false);
  const confirmed = await f.request(
    '/admin/certifications/' + item.id + '/phone-review',
    'POST',
    {
      phone: '13800000009',
      result: 'confirmed',
      note: '人工已接通并核对一致',
      confirmedCall: true
    },
    admin
  );
  assert.equal(confirmed.json.item.phoneReview.reviewerId, 'admin-01');
  assert.equal(confirmed.json.item.phoneReview.status, 'passed');
  assert.equal(f.app.db.get('users', 'supplier-01').verified, false);
  const approved = await f.request(
    '/admin/certifications/' + item.id,
    'PATCH',
    { status: 'approved' },
    admin
  );
  assert.equal(approved.status, 200);
  assert.equal(f.app.db.get('users', 'supplier-01').verified, true);
  const backend = (await f.request('/admin/certifications/' + item.id, 'GET', undefined, admin)).json.item;
  const videoBytes = readFileSync(long),
    videoUrl = f.base + backend.materials.venueVideo.url;
  const rangeFetch = (range) =>
    fetch(videoUrl, { headers: { Authorization: `Bearer ${admin}`, Range: range } });
  const first = await rangeFetch('bytes=0-1');
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('accept-ranges'), 'bytes');
  assert.equal(first.headers.get('content-range'), `bytes 0-1/${videoBytes.length}`);
  assert.equal(first.headers.get('content-length'), '2');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), videoBytes.subarray(0, 2));
  const suffix = await rangeFetch('bytes=-3');
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), videoBytes.subarray(-3));
  const tail = await rangeFetch(`bytes=${videoBytes.length - 2}-`);
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-length'), '2');
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), videoBytes.subarray(-2));
  for (const range of [
    `bytes=${videoBytes.length}-`,
    'bytes=3-1',
    'bytes=-0',
    'bytes=0-1,3-4',
    'items=0-1',
    ''
  ]) {
    const rejected = await rangeFetch(range);
    assert.equal(rejected.status, 416);
    assert.equal(rejected.headers.get('content-range'), `bytes */${videoBytes.length}`);
    await rejected.arrayBuffer();
  }
  const anonymousRange = await fetch(videoUrl, { headers: { Range: 'bytes=0-1' } });
  assert.equal(anonymousRange.status, 401);
  assert.equal(anonymousRange.headers.get('content-range'), null);
  assert.equal(anonymousRange.headers.get('accept-ranges'), null);
  assert.equal(
    (
      await fetch(f.base + backend.materials.venueVideo.url, {
        headers: { Authorization: `Bearer ${admin}` }
      })
    ).status,
    200
  );
  assert.equal((await fetch(f.base + backend.materials.venueVideo.url)).status, 401);
  const forged = new URL(f.base + backend.materials.venueVideo.url);
  forged.searchParams.set('scope', 'front');
  assert.equal((await fetch(forged)).status, 401);
  await f.request('/admin/certifications/' + item.id, 'PATCH', { status: 'pending' }, admin);
  assert.equal(f.app.db.get('users', 'supplier-01').verified, false);
  await f.request('/admin/certifications/' + item.id, 'PATCH', { status: 'approved' }, admin);
  assert.equal(f.app.db.get('users', 'supplier-01').verified, true);
  await f.request(
    '/admin/certifications/' + item.id,
    'PATCH',
    { company: '变更主体资料', status: 'pending' },
    admin
  );
  assert.equal(f.app.db.get('users', 'supplier-01').verified, false);
  assert.equal(
    (await f.request('/admin/certifications/' + item.id, 'PATCH', { status: 'approved' }, admin)).json.error
      .code,
    'PHONE_REVIEW_REQUIRED'
  );
  await f.request(
    '/admin/certifications/' + item.id + '/phone-review',
    'POST',
    {
      phone: '13800000009',
      result: 'confirmed',
      note: '人工重新核对变更资料一致',
      confirmedCall: true
    },
    admin
  );
  await f.request('/admin/certifications/' + item.id, 'PATCH', { status: 'approved' }, admin);
  await f.request('/admin/certifications/' + item.id, 'DELETE', {}, admin);
  assert.equal(f.app.db.get('users', 'supplier-01').verified, false);
  const next = await f.request('/certifications', 'POST', body, supplier);
  assert.equal(next.status, 201);
  assert.equal(
    (await f.request('/admin/certifications/' + item.id, 'PATCH', { status: 'approved' }, admin)).json.error
      .code,
    'STALE_CERTIFICATION'
  );
  assert.equal((await f.request('/users', 'GET', undefined, owner)).status, 404);
});

test('legacy supplier approvals require new materials and user admin APIs cannot bypass certification', async (t) => {
  const f = await fixture(t),
    admin = (await f.login('admin', 'back')).json.token;
  f.app.db.save('users', {
    ...f.app.db.get('users', 'supplier-01'),
    verified: true,
    certificationPolicyVersion: 1
  });
  f.app.db.save('certifications', {
    id: 'legacy-approved',
    ownerId: 'supplier-01',
    company: '旧记录保留',
    status: 'approved',
    licenseFileId: null
  });
  const { migrateSupplierCertificationPolicy } = await import('../apps/server/src/certificate-policy.js');
  migrateSupplierCertificationPolicy(f.app.db);
  assert.equal(f.app.db.get('users', 'supplier-01').verified, false);
  assert.equal(f.app.db.get('certifications', 'legacy-approved').status, 'needs_more');
  assert.equal(f.app.db.get('certifications', 'legacy-approved').company, '旧记录保留');
  assert.equal((await f.request('/admin/users/supplier-01', 'PATCH', { verified: true }, admin)).status, 400);
  assert.equal(
    (await f.request('/admin/users', 'POST', { id: 'bypass', role: 'supplier', verified: true }, admin))
      .status,
    400
  );
});
