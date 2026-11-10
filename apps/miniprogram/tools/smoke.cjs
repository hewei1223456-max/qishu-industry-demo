/* 页面逻辑通过真实本地 API；wx 导航/授权由桩提供，不是微信真机或编译测试。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const memory = new Map(),
  navigation = [],
  checks = [],
  requests = [],
  clipboard = [],
  previews = [];
if (process.env.QISHU_SMOKE_API_BASE) memory.set('qishu_api_base', process.env.QISHU_SMOKE_API_BASE);
let app,
  pageDefinition,
  failPath = '',
  fontSize = 16;
global.wx = {
  getStorageSync: (k) => memory.get(k),
  setStorageSync: (k, v) => memory.set(k, v),
  removeStorageSync: (k) => memory.delete(k),
  getAppBaseInfo: () => ({ fontSizeSetting: fontSize }),
  getSystemInfoSync: () => ({ platform: 'android' }),
  setNavigationBarTitle: () => {},
  showToast: () => {},
  request(o) {
    requests.push({ url: o.url, method: o.method || 'GET', data: o.data });
    if (failPath && o.url.includes(failPath)) {
      o.fail({ errMsg: 'request:fail injected module outage' });
      return;
    }
    fetch(o.url, {
      method: o.method || 'GET',
      headers: o.header,
      body: o.method && o.method !== 'GET' ? JSON.stringify(o.data) : undefined
    })
      .then(async (r) => o.success({ statusCode: r.status, data: await r.json() }))
      .catch((e) => o.fail({ errMsg: e.message }));
  },
  navigateTo: (o) => {
    navigation.push({ type: 'open', url: o.url });
    o.success({});
  },
  switchTab: (o) => {
    navigation.push({ type: 'tab', url: o.url });
    o.success({});
  },
  navigateBack: (o) => {
    navigation.push({ type: 'back', delta: o.delta });
    o.success({});
  },
  login: (o) => o.success({ code: 'NOT_A_REAL_WECHAT_CODE' }),
  showModal: (o) => o.success({ confirm: true, cancel: false }),
  setClipboardData: (o) => {
    clipboard.push(o.data);
    o.success({});
  },
  previewImage: (o) => {
    previews.push(o.current);
    o.success({});
  }
};
global.getCurrentPages = () => [{}, {}];
global.getApp = () => app;
global.App = (definition) => {
  app = definition;
};
global.Page = (definition) => {
  pageDefinition = definition;
};
require(path.join(root, 'app.js'));
const api = require(path.join(root, 'services/api.js'));
const ui = require(path.join(root, 'services/ui.js'));
function page(name) {
  const file = path.join(root, 'pages', name, 'index.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const p = { data: structuredClone(pageDefinition.data), _alive: true, _visible: true };
  for (const [k, v] of Object.entries(pageDefinition)) if (typeof v === 'function') p[k] = v.bind(p);
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
  p.getTabBar = () => ({ setData: () => {} });
  return p;
}
function ok(name) {
  checks.push(name);
}
async function main() {
  await app.refresh();
  assert.equal(app.globalData.user, null);
  ok('游客启动与服务端 bootstrap');
  const market = page('market');
  await market.load();
  assert(!market.data.error, market.data.error);
  assert(market.data.items.length > 0);
  assert.equal(market.data.columns.flatMap((c) => c.items).length, market.data.items.length);
  assert(market.data.items.every((i) => i.priceText && !i.priceText.includes('null')));
  assert(market.data.options.origin.includes('濮院'));
  assert(market.data.options.price.includes('100—200元'));
  assert(requests.some((r) => r.url.endsWith('/recommendations?kind=products')));
  ok('游客货源限权、双列与默认推荐');
  const before = market.data.filters;
  market.open({ currentTarget: { dataset: { id: market.data.items[0].id } } });
  assert(navigation.at(-1).url.includes('kind=product'));
  assert.deepEqual(market.data.filters, before);
  ok('列表进入详情保留筛选');
  const login = page('login');
  await login.wechat();
  assert(login.data.error);
  assert.equal(app.globalData.user, null);
  ok('缺凭证真实微信登录明确失败');
  await login.demo({ currentTarget: { dataset: { role: 'owner' } } });
  assert.equal(app.globalData.user.role, 'owner');
  assert(memory.get('qishu_token'));
  const ownerToken = memory.get('qishu_token');
  ok('演示登录与 Bearer 会话');
  const certify = page('certify');
  await certify.load();
  assert(!certify.data.error, certify.data.error);
  const originalProfile = structuredClone(certify.data.profile);
  const originalVerified = app.globalData.user.verified;
  certify.setData({
    profile: Object.assign({}, originalProfile, { city: '杭州', area: 88, style: '通勤' }),
    operationNeedsText: '小单快返、支持混批'
  });
  await certify.saveProfile();
  assert(!certify.data.error, certify.data.error);
  const savedProfile = await api.get('/profile');
  assert.equal(savedProfile.profile.area, 88);
  assert.equal(savedProfile.user.verified, originalVerified);
  await api.patch('/profile', originalProfile);
  await app.refresh();
  ok('经营资料保存回读且不提权');
  const info = page('info');
  requests.length = 0;
  await info.load();
  assert(!info.data.error, info.data.error);
  assert(info.data.items.length > 0);
  assert.equal(info.data.columns.flatMap((c) => c.items).length, info.data.items.length);
  assert(!requests.some((r) => r.data && r.data.type === 'impression'));
  ok('资讯推荐读取，不虚报列表曝光');
  market.setData({
    filters: {
      style: '全部',
      origin: '广州',
      category: '全部',
      price: '100—200元',
      moq: '全部',
      status: '全部'
    }
  });
  requests.length = 0;
  await market.load();
  assert(!market.data.error, market.data.error);
  assert(market.data.items.every((p) => p.origin === '广州' && p.price >= 100 && p.price <= 200));
  assert(requests.some((r) => r.url.includes('/products?')));
  assert(!requests.some((r) => r.url.includes('/recommendations?kind=products')));
  ok('主动组合筛选走严格货源查询');
  const tags = page('tags');
  tags.onShow();
  tags.setData({ count: 3, selected: ['通勤', '小单快返', '杭州'] });
  await tags.save();
  assert(tags.data.error.includes('四到十'));
  ok('经营标签最少四个校验');
  const compose = page('compose');
  ui.sync(compose, -1);
  compose.setData({
    form: {
      title: '原生接口联调草稿 ' + Date.now(),
      body: '仅用于接口联调，测试完成后归档。',
      category: '经营方法',
      price: '',
      moq: ''
    }
  });
  await compose.save({ currentTarget: { dataset: { status: 'draft' } } });
  assert(!compose.data.error, compose.data.error);
  assert(compose.data.notice.includes('草稿'));
  const mine = await api.get('/creator');
  const created = ui.list(mine).find((v) => v.title === compose.data.form.title);
  assert(created);
  const archived = await api.patch('/creator/' + created.id, { status: 'hidden', published: false });
  assert.equal(archived.item.status, 'hidden');
  ok('创作草稿实际写入并归档');
  failPath = '/api/jobs';
  const workspace = page('workspace');
  workspace.setData({ form: { question: '测试模块故障不应影响资讯' } });
  await workspace.submitDiagnosis();
  assert(workspace.data.error);
  assert.equal(workspace.data.busy, false);
  failPath = '';
  await info.load();
  assert(!info.data.error);
  ok('AI请求失败后资讯保持可读');
  const supplier = await api.post('/auth/demo', { role: 'supplier' });
  memory.set('qishu_token', supplier.token);
  await app.refresh();
  const buyers = page('workspace');
  await buyers.loadBuyers();
  assert(buyers.data.supplier);
  const supplierReady = app.globalData.user.verified === true;
  if (supplierReady) {
    assert(buyers.data.buyers.length > 0);
    assert.equal(typeof buyers.data.quota.remaining, 'number');
    ok('已审厂家独立客户视角与服务端额度');
  } else {
    assert(buyers.data.error);
    assert.equal(buyers.data.buyers.length, 0);
    ok('厂家材料未审完时找客户受到服务端限制');
  }
  const channels = ui.contactChannels({
    available: true,
    channels: [
      { type: 'wechat', value: 'smoke_wechat' },
      { type: 'phone', value: '18800000000' },
      { type: 'qrcode', value: 'https://example.com/qr.png' }
    ]
  });
  assert.equal(channels.length, 3);
  for (const c of channels) await ui.openContact(c);
  assert(clipboard.includes('smoke_wechat'));
  assert(clipboard.includes('18800000000'));
  assert(previews.includes('https://example.com/qr.png'));
  assert.equal(ui.contactValue({ available: false, channels }), '');
  ok('三种联系渠道解析及复制/二维码预览桩');
  const contactEditor = page('certify');
  await contactEditor.loadContact();
  assert(!contactEditor.data.error, contactEditor.data.error);
  const originalContact = structuredClone(contactEditor.data.publicContact);
  if (supplierReady) try {
    contactEditor.setData({
      publicContact: {
        wechat: 'native_smoke_contact',
        phone: '18800000000',
        qrUrl: 'https://example.com/native-contact-qr.png',
        consent: true
      }
    });
    await contactEditor.saveContact();
    assert(!contactEditor.data.error, contactEditor.data.error);
    const stored = await api.get('/profile/contact');
    assert.equal(stored.contact.consent, true);
    assert.equal(stored.contact.wechat, 'native_smoke_contact');
    memory.set('qishu_token', ownerToken);
    await app.refresh();
    const products = ui.list(await api.get('/products')),
      product = products.find(
        (p) => p.supplierId === supplier.user.id || p.companyId === supplier.user.companyId
      );
    assert(product);
    const detail = page('detail');
    detail.setData({ kind: 'product', id: product.id });
    await detail.load();
    await detail.contact();
    assert(
      detail.data.contactChannels.some((c) => c.type === 'wechat' && c.value === 'native_smoke_contact')
    );
    assert(detail.data.contactChannels.some((c) => c.type === 'qrcode'));
    await detail.useContact({
      currentTarget: { dataset: { index: detail.data.contactChannels.findIndex((c) => c.type === 'wechat') } }
    });
    assert(clipboard.includes('native_smoke_contact'));
    ok('公开联络显式同意保存回读及实际联系渠道');
  } finally {
    memory.set('qishu_token', supplier.token);
    await api.patch('/profile/contact', {
      wechat: originalContact.wechat || '',
      phone: originalContact.phone || '',
      qrUrl: originalContact.qrUrl || '',
      consent: originalContact.consent === true
    });
    await app.refresh();
  }
  else {
    contactEditor.setData({publicContact:{wechat:'native_smoke_contact',phone:'18800000000',qrUrl:'',consent:true}});
    await contactEditor.saveContact();
    assert(contactEditor.data.error);
    assert.deepEqual((await api.get('/profile/contact')).contact, originalContact);
    ok('厂家未通过新审核时不能绕过门禁公开联络资料');
  }
  fontSize = 32;
  ui.sync(buyers, 2);
  assert(buyers.data.large);
  assert(buyers.data.fontPx > 16);
  ok('系统大字号读取');
  await ui.platform.back('/pages/info/index');
  assert.equal(navigation.at(-1).type, 'back');
  global.getCurrentPages = () => [{}];
  await ui.platform.back('/pages/market/index');
  assert.equal(navigation.at(-1).url, '/pages/market/index');
  ok('原生返回与无历史 Tab 兜底');
  buyers.cleanup();
  workspace.cleanup();
  compose.onUnload();
  console.log(
    JSON.stringify(
      {
        check: 'native-page-api-smoke',
        passed: true,
        checks,
        limitations: [
          'wx APIs are mocked; no rendering',
          'No developer-tool compile or real device',
          'No real WeChat identity',
          'No upload/camera/microphone device test'
        ]
      },
      null,
      2
    )
  );
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
