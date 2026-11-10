const api = require('./api');
const platform = require('../platform/wechat');
function list(value) {
  return Array.isArray(value) ? value : (value && (value.items || value.data)) || [];
}
function decorate(item) {
  return Object.assign({}, item, {
    imageUrl: api.media(item.image || item.cover),
    summary: item.summary || item.description || item.body || '',
    status: item.stockStatus || item.supplyStatus || item.status,
    priceText: item.price == null ? '认证后查看拿货价' : '¥ ' + item.price,
    tagText: (item.tags || []).join(' · '),
    demoLabel: item.demo ? '示例内容' : ''
  });
}
function masonry(items) {
  const columns = [
      { id: 'left', items: [] },
      { id: 'right', items: [] }
    ],
    heights = [0, 0];
  items.forEach((item) => {
    const col = heights[0] <= heights[1] ? 0 : 1;
    columns[col].items.push(item);
    heights[col] += (item.imageUrl ? 220 : 150) + Math.ceil((item.title || '').length / 10) * 24;
  });
  return columns;
}
function sync(page, selected) {
  const app = getApp();
  const adminPending = app.globalData.adminAuthorizationRequired || !!(app.globalData.user && (app.globalData.user.adminAuthorizationRequired || app.globalData.user.requestedRole === 'admin' && app.globalData.user.role !== 'admin'));
  page.setData({
    fontPx: Math.round(16 * platform.font()),
    large: platform.font() > 1.3,
    user: app.globalData.user,
    adminPending: !!adminPending,
    administrator: !!(app.globalData.user && app.globalData.user.role === 'admin'),
    identityLabel: adminPending ? '管理员待授权' : app.globalData.user ? ({owner:'店主',supplier:'厂家',admin:'平台管理员'}[app.globalData.user.role] || '用户') : '游客',
    needsTags: !!(
      app.globalData.user &&
      app.globalData.user.verified &&
      (app.globalData.user.tags || []).length < 4
    ),
    supplier: app.globalData.user && app.globalData.user.role === 'supplier'
  });
  if (typeof page.getTabBar === 'function' && page.getTabBar())
    page
      .getTabBar()
      .setData({
        selected,
        fontPx: Math.round(12 * platform.font()),
        supplier: app.globalData.user && app.globalData.user.role === 'supplier'
      });
}
function flag(name) {
  const c = getApp().globalData.config || {};
  return !c.features || c.features[name] !== false;
}
function event(type, itemId, itemType, duration) {
  return api.post('/events', { type, itemId, itemType, duration }).catch(() => {});
}
function jobText(job) {
  const r = job && (job.result || job.output || job.error);
  return typeof r === 'string' ? r : (r && (r.text || r.message || r.content)) || '';
}
function jobOutput(job) {
  const r = job && job.result;
  return { outputType: (r && r.type) || '', outputUrl: r && r.url ? api.media(r.url) : '' };
}
function contactChannels(contact) {
  if (!contact || contact.available === false) return [];
  if (typeof contact === 'string') return [{ type: 'wechat', label: '微信号', value: contact }];
  const source = Array.isArray(contact.channels)
    ? contact.channels
    : [
        { type: 'wechat', value: contact.wechat },
        { type: 'phone', value: contact.phone },
        { type: 'qrcode', value: contact.qrUrl }
      ];
  return source
    .filter(
      (c) =>
        c && ['wechat', 'phone', 'qrcode'].includes(c.type) && typeof c.value === 'string' && c.value.trim()
    )
    .slice(0, 6)
    .map((c) => ({
      type: c.type,
      label: c.type === 'phone' ? '联系电话' : c.type === 'qrcode' ? '联系二维码' : '微信号',
      value: c.type === 'qrcode' ? api.media(c.value) : c.value.trim()
    }));
}
function contactValue(contact, type) {
  const channel = contactChannels(contact).find((c) => (type ? c.type === type : c.type !== 'qrcode'));
  return channel ? channel.value : '';
}
function openContact(channel) {
  if (!channel || !channel.value) return Promise.reject(new Error('没有可使用的联系方式'));
  return channel.type === 'qrcode'
    ? platform.preview(channel.value, [channel.value])
    : platform.copy(channel.value);
}
function settled(promises) {
  return Promise.all(
    promises.map((p) =>
      Promise.resolve(p).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason })
      )
    )
  );
}
module.exports = {
  list,
  decorate,
  masonry,
  sync,
  flag,
  event,
  jobText,
  jobOutput,
  contactChannels,
  contactValue,
  openContact,
  settled,
  platform,
  api
};
