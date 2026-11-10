/* 原生页面逻辑 + 隔离真实 HTTP/SQLite/媒体文件；微信 API 仍为桩，不是开发者工具或真机测试。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const nativeRoot = path.resolve(__dirname, '..'),
  repo = path.resolve(nativeRoot, '../..');
const state = new Map(),
  requests = [],
  chosen = [],
  checks = [];
let app,
  definition,
  materialTempDir = '',
  previewCount = 0;
global.wx = {
  getStorageSync: (k) => state.get(k),
  setStorageSync: (k, v) => state.set(k, v),
  removeStorageSync: (k) => state.delete(k),
  getAppBaseInfo: () => ({ fontSizeSetting: 16 }),
  getSystemInfoSync: () => ({ platform: 'android' }),
  setNavigationBarTitle: () => {},
  showToast: () => {},
  request(o) {
    requests.push({
      url: o.url,
      method: o.method || 'GET',
      data: o.data,
      headers: o.header,
      timeout: o.timeout
    });
    fetch(o.url, {
      method: o.method || 'GET',
      headers: o.header,
      body: o.method && o.method !== 'GET' ? JSON.stringify(o.data) : undefined
    })
      .then(async (r) => o.success({ statusCode: r.status, data: await r.json() }))
      .catch((e) => o.fail({ errMsg: e.message }));
  },
  uploadFile(o) {
    requests.push({ url: o.url, headers: o.header, formData: o.formData, timeout: o.timeout });
    const form = new FormData();
    for (const [k, v] of Object.entries(o.formData || {})) form.append(k, String(v));
    const bytes = fs.readFileSync(o.filePath),
      mime = o.filePath.endsWith('.mp4') ? 'video/mp4' : 'image/png';
    form.append('file', new Blob([bytes], { type: mime }), path.basename(o.filePath));
    fetch(o.url, { method: 'POST', headers: o.header, body: form })
      .then(async (r) => o.success({ statusCode: r.status, data: await r.text() }))
      .catch((e) => o.fail({ errMsg: e.message }));
  },
  downloadFile(o) {
    requests.push({ url: o.url, headers: o.header });
    fetch(o.url, { headers: o.header })
      .then(async (r) => {
        if (!r.ok) return o.success({ statusCode: r.status });
        const tempFilePath = path.join(materialTempDir, 'private-preview-' + ++previewCount + '.png');
        fs.writeFileSync(tempFilePath, Buffer.from(await r.arrayBuffer()));
        o.success({ statusCode: r.status, tempFilePath });
      })
      .catch((e) => o.fail({ errMsg: e.message }));
  },
  getFileSystemManager: () => ({
    unlink(o) {
      if (o.filePath.startsWith(materialTempDir + path.sep)) fs.rmSync(o.filePath, { force: true });
      o.complete({});
    }
  }),
  chooseMedia(o) {
    if (o.mediaType[0] === 'video') {
      assert.deepEqual(o.sourceType, ['camera']);
      assert(o.maxDuration >= 30);
    }
    const files = chosen.shift();
    if (!files) return o.fail({ errMsg: 'No selected fixture' });
    o.success({
      tempFiles: files.map((f) => ({
        tempFilePath: f.path,
        size: fs.statSync(f.path).size,
        duration: f.duration
      }))
    });
  },
  navigateTo: (o) => o.success({}),
  switchTab: (o) => o.success({}),
  navigateBack: (o) => o.success({}),
  login: (o) => o.success({ code: 'NOT_REAL_CODE' }),
  showModal: (o) => o.success({ confirm: true, cancel: false }),
  previewImage: (o) => o.success({})
};
global.getApp = () => app;
global.getCurrentPages = () => [{}];
global.App = (v) => (app = v);
global.Page = (v) => (definition = v);
require(path.join(nativeRoot, 'app.js'));
const api = require(path.join(nativeRoot, 'services/api.js')),
  ui = require(path.join(nativeRoot, 'services/ui.js'));
function page(name) {
  const file = path.join(nativeRoot, 'pages', name, 'index.js');
  delete require.cache[file];
  require(file);
  const p = { data: structuredClone(definition.data) };
  for (const [k, v] of Object.entries(definition)) if (typeof v === 'function') p[k] = v.bind(p);
  p.setData = (patch) => {
    for (const [k, v] of Object.entries(patch)) {
      const keys = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = p.data;
      for (const key of keys.slice(0, -1)) {
        target[key] ??= {};
        target = target[key];
      }
      target[keys.at(-1)] = v;
    }
  };
  return p;
}
function ok(label) {
  checks.push(label);
}
async function main() {
  const tempRoot = path.resolve(os.tmpdir()),
    dir = fs.mkdtempSync(path.join(tempRoot, 'qishu-native-registration-'));
  materialTempDir = dir;
  let server;
  try {
    const ffmpeg =
      process.env.QISHU_FFMPEG || (process.platform === 'win32' ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' : 'ffmpeg');
    const long = path.join(dir, 'venue31.mp4'),
      short = path.join(dir, 'venue10.mp4'),
      photos = [];
    for (const [file, duration] of [
      [long, 31],
      [short, 10]
    ])
      execFileSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=blue:s=64x64:r=1',
          '-t',
          String(duration),
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-y',
          file
        ],
        { windowsHide: true }
      );
    for (let i = 0; i < 6; i++) {
      const file = path.join(dir, 'photo' + i + '.png');
      execFileSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=0x' + ['FF0000', '00FF00', '0000FF', 'FFFF00', '00FFFF', 'FFFFFF'][i] + ':s=64x64:r=1',
          '-frames:v',
          '1',
          '-threads',
          '1',
          '-y',
          file
        ],
        { windowsHide: true }
      );
      photos.push(file);
    }
    const { createApp } = await import(pathToFileURL(path.join(repo, 'apps/server/src/server.js')).href);
    server = createApp({
      dataDir: path.join(dir, 'data'),
      dbPath: ':memory:',
      demoAuth: true,
      wechat: {
        appId: 'mock-native-app',
        appSecret: 'mock-not-real-secret',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ openid: 'mock-admin-intent-openid', session_key: 'mock-session-key' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      }
    });
    await new Promise((r) => server.server.listen(0, '127.0.0.1', r));
    state.set('qishu_api_base', 'http://127.0.0.1:' + server.server.address().port);
    const login = page('login');
    assert.deepEqual(
      login.data.roles.map((r) => r.id),
      ['owner', 'supplier', 'admin']
    );
    assert(!fs.readFileSync(path.join(nativeRoot, 'pages/me/index.wxml'), 'utf8').includes('切换演示身份'));
    ok('登录仅三个身份，无旧场景切换入口');
    await app.wechatLogin('admin');
    assert.equal(app.globalData.user.role, 'owner');
    assert.equal(app.globalData.adminAuthorizationRequired, true);
    assert.notEqual(server.db.get('users', app.globalData.user.id).role, 'admin');
    const pending = page('me');
    ui.sync(pending, 3);
    assert(pending.data.adminPending);
    assert.equal(pending.data.identityLabel, '管理员待授权');
    ok('管理员意向登录仅建立基础身份，待平台授权（官方HTTP传输为mock）');
    await app.demoLogin('admin');
    assert.equal(app.globalData.user.role, 'admin');
    let blocked = false;
    try {
      await api.get('/admin/config');
    } catch (e) {
      blocked = [401, 403].includes(e.status);
    }
    assert(blocked, 'front admin token must not access back management');
    const cross = await fetch(api.base() + '/api/admin/config', {
      headers: { Authorization: 'Bearer ' + state.get('qishu_token'), 'X-Qishu-Scope': 'back' }
    });
    assert.equal(cross.status, 401);
    ok('前台管理员会话不能跨入独立后台');
    await app.demoLogin('supplier');
    const supplierId = app.globalData.user.id,
      cert = page('certify');
    ui.sync(cert, -1);
    cert.setData({ company: '原生厂家材料测试', scope: '服装批发、零售' });
    await cert.submit();
    assert(cert.data.error.includes('营业执照'));
    assert(cert.data.missingFields.some((x) => x.includes('30秒')));
    assert(cert.data.missingFields.some((x) => x.includes('5张')));
    ok('厂家缺项检查覆盖执照、30秒视频及5张照片');
    chosen.push([{ path: photos[5] }]);
    await cert.chooseLicense();
    assert(cert.data.license, cert.data.error);
    chosen.push([{ path: short, duration: 999 }]);
    await cert.chooseVenueVideo();
    if (cert.data.venueVideo) {
      chosen.push(photos.slice(0, 5).map((p) => ({ path: p })));
      await cert.chooseVenuePhotos();
      assert.equal(cert.data.venuePhotos.length, 5, cert.data.error);
      await cert.submit();
      assert(cert.data.error, '伪报时长不得通过服务端材料核验');
      assert(/30|时长|视频/.test(cert.data.error), cert.data.error);
    } else assert(cert.data.error);
    assert.notEqual(server.db.get('users', supplierId).certificationStatus, 'approved');
    ok('相机入口与10秒视频伪报999秒的服务端拒绝');
    chosen.push([{ path: long, duration: 1 }]);
    await cert.chooseVenueVideo();
    assert(cert.data.venueVideo, cert.data.error);
    if (cert.data.venuePhotos.length < 5) {
      chosen.push(photos.slice(0, 5).map((p) => ({ path: p })));
      await cert.chooseVenuePhotos();
    }
    assert.equal(cert.data.venuePhotos.length, 5, cert.data.error);
    const beforeExtra = requests.length;
    await cert.chooseVenuePhotos();
    assert(cert.data.error.includes('只收5张'));
    assert.equal(requests.length, beforeExtra);
    ok('五张照片满额后拒绝继续选择，不漂移为5至10张');
    await cert.submit();
    assert(!cert.data.error, cert.data.error);
    await cert.load();
    const applications = await api.get('/certifications'),
      application = ui.list(applications)[0];
    assert(application);
    assert.equal(application.status, 'pending');
    assert.equal(application.videoVerification.status, 'verified');
    assert(application.videoVerification.durationSeconds >= 30);
    assert.equal(application.phoneReview.status, 'pending');
    assert.equal(server.db.get('users', supplierId).verified, false);
    const savedIds = [
      cert.data.license.id,
      cert.data.venueVideo.id,
      ...cert.data.venuePhotos.map((p) => p.id)
    ];
    assert(savedIds.every((id) => server.db.get('files', id).public === false));
    ok('真实31秒视频及五张不同照片私有上传，等待人工和电话回访');
    const submitted = requests
      .filter((r) => r.url.endsWith('/certifications') && r.method === 'POST')
      .at(-1).data;
    assert(!Object.hasOwn(submitted, 'duration'));
    assert.equal(submitted.venuePhotoFileIds.length, 5);
    assert(requests.some((r) => r.url.endsWith('/uploads?purpose=certification_video')));
    ok('提交文件ID，客户端时长不作为认证证据');
    const reopened = page('certify');
    ui.sync(reopened, -1);
    await reopened.load();
    assert(reopened.data.license.previewUrl.startsWith(api.base()));
    assert.equal(reopened.data.venuePhotos.length, 5);
    const preview = await fetch(reopened.data.venuePhotos[0].previewUrl);
    assert.equal(preview.status, 401);
    await reopened.previewMaterial({ currentTarget: { dataset: { kind: 'photo', index: 0 } } });
    assert(!reopened.data.error, reopened.data.error);
    assert(fs.existsSync(reopened.data.venuePhotos[0].localPath));
    assert.equal(server.db.get('files', reopened.data.venuePhotos[0].id).public, false);
    ok('私有材料链接游客被拒，本人Bearer下载临时副本预览');
    assert(
      requests
        .filter((r) => r.url.endsWith('/certifications') && r.method === 'POST')
        .every((r) => r.timeout === 240000)
    );
    assert.equal(
      requests.find((r) => r.url.endsWith('/bootstrap')).timeout,
      require(path.join(nativeRoot, 'config.js')).requestTimeout
    );
    assert(
      requests
        .filter((r) => r.url.endsWith('/uploads?purpose=certification_video'))
        .every((r) => r.timeout === 600000)
    );
    ok('认证核验专用240秒超时，普通请求不变慢');
    await app.demoLogin('owner');
    assert(!fs.existsSync(reopened.data.venuePhotos[0].localPath));
    ok('更换身份清理已下载的私有预览副本');
    const owner = page('certify');
    ui.sync(owner, -1);
    owner.setData({ company: '原生店主材料测试', scope: '服装零售' });
    chosen.push([{ path: photos[5] }]);
    await owner.chooseLicense();
    await owner.submit();
    assert(!owner.data.error, owner.data.error);
    const ownerPayload = requests
      .filter((r) => r.url.endsWith('/certifications') && r.method === 'POST')
      .at(-1).data;
    assert(!Object.hasOwn(ownerPayload, 'venueVideoFileId'));
    assert(!Object.hasOwn(ownerPayload, 'venuePhotoFileIds'));
    ok('店主认证不增加厂家视频与照片要求');
    assert(requests.every((r) => r.headers['X-Qishu-Scope'] === 'front'));
    assert(requests.filter((r) => r.url.endsWith('/auth/demo')).every((r) => r.data.scope === 'front'));
    ok('所有原生请求与上传固定前台scope');
    console.log(
      JSON.stringify(
        {
          check: 'native-registration-http',
          passed: true,
          checks,
          limits: [
            'Synthetic 64px PNG and real generated 10/31-second MP4 fixtures, not business proof',
            'wx UI/auth/navigation mocked; no DevTools or device',
            'Large-upload limit is not a 300MB throughput test',
            'No real WeChat credentials'
          ]
        },
        null,
        2
      )
    );
  } finally {
    if (server) await server.close();
    if (dir.startsWith(tempRoot + path.sep) && dir.includes('qishu-native-registration-'))
      fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
