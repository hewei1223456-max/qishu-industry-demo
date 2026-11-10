const ui = require('../../services/ui');
Page({
  data: {
    fontPx: 16,
    item: null,
    error: '',
    loading: true,
    kind: 'content',
    contactResult: '',
    contactChannels: [],
    leadBusy: false
  },
  onLoad(q) {
    this.setData({ kind: q.kind || 'content', id: q.id || '' });
    this.load();
  },
  onShow() {
    this._started = Date.now();
    ui.sync(this, -1);
  },
  onHide() {
    this.trackDwell();
  },
  onUnload() {
    this.trackDwell();
  },
  trackDwell() {
    if (this._started) {
      ui.event(
        'dwell',
        this.data.id,
        this.data.kind,
        Math.min(300, Math.round((Date.now() - this._started) / 1000))
      );
      this._started = 0;
    }
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const paths = { content: '/content/', product: '/products/', fair: '/fairs/' };
      let r;
      if (this.data.kind === 'buyer') {
        const all = await ui.api.get('/buyers');
        r = ui.list(all).find((v) => v.id === this.data.id);
        if (!r) throw new Error('该公开需求暂不可见');
        r = Object.assign({}, r, { title: r.shop || r.name, body: r.need, category: '店主经营需求' });
      } else
        r = await ui.api.get((paths[this.data.kind] || paths.content) + encodeURIComponent(this.data.id));
      const item = ui.decorate(r.item || r);
      this.setData({ item });
      ui.platform.title(
        this.data.kind === 'product'
          ? '货源详情'
          : this.data.kind === 'fair'
            ? '订货会'
            : this.data.kind === 'buyer'
              ? '店主需求'
              : '资讯详情'
      );
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  back() {
    ui.platform.back(
      this.data.kind === 'content'
        ? '/pages/info/index'
        : this.data.kind === 'buyer'
          ? '/pages/workspace/index'
          : '/pages/market/index'
    );
  },
  async contact() {
    if (this.data.leadBusy) return;
    this.setData({ leadBusy: true, contactResult: '', contactChannels: [] });
    try {
      const p = this.data.item;
      const payload =
        this.data.kind === 'buyer'
          ? { buyerId: p.id }
          : { supplierId: p.supplierId || p.companyId, productId: p.id };
      const r = await ui.api.post('/leads', payload);
      const c = r.contact || (r.lead && r.lead.contact),
        channels = ui.contactChannels(c);
      this.setData({
        contactResult: ((c && c.message) || '联系意向已记录。') + ' 查看或复制联系方式不等于已添加好友。',
        contact: channels.length ? c : null,
        contactChannels: channels
      });
      ui.event('contact', p.id, this.data.kind === 'buyer' ? 'buyers' : 'products');
    } catch (e) {
      this.setData({ contactResult: e.message });
    } finally {
      this.setData({ leadBusy: false });
    }
  },
  async useContact(e) {
    const channel = this.data.contactChannels[Number(e.currentTarget.dataset.index)];
    try {
      await ui.openContact(channel);
      if (channel.type !== 'qrcode') ui.platform.toast('已复制，请自行确认联系结果');
    } catch (error) {
      ui.platform.toast(error.message);
    }
  },
  async copyContact() {
    const value = ui.contactValue(this.data.contact);
    if (!value) {
      ui.platform.toast('当前没有可公开复制的联系方式');
      return;
    }
    try {
      await ui.platform.copy(value);
      ui.platform.toast('已复制，请自行确认联系结果');
    } catch (e) {
      ui.platform.toast(e.message);
    }
  },
  async interest() {
    try {
      await ui.api.post('/fairs/' + encodeURIComponent(this.data.id) + '/register', {});
      ui.platform.toast('参加意向已提交');
    } catch (e) {
      ui.platform.toast(e.message);
    }
  },
  imageError() {
    this.setData({ 'item.imageUrl': '' });
  },
  preview() {
    const url = this.data.item.imageUrl;
    if (url) ui.platform.preview(url, [url]);
  }
});
