const ui = require('../../services/ui');
const config = require('../../config');
Page({
  data: {
    fontPx: 16,
    busy: false,
    error: '',
    authRole: 'owner',
    demoEnabled: config.demoEnabled,
    apiBase: ui.api.base(),
    roles: [
      { id: 'owner', title: '店主开发账号', desc: '资讯、找货源、店铺诊断、我的' },
      { id: 'supplier', title: '厂家开发账号', desc: '资讯、货源广场、找客户、我的' }
    ]
  },
  onShow() {
    ui.sync(this, -1);
  },
  back() {
    ui.platform.back('/pages/me/index');
  },
  chooseRole(e) {
    this.setData({ authRole: e.currentTarget.dataset.role });
  },
  async wechat() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await getApp().wechatLogin(this.data.authRole);
      ui.platform.toast('微信登录已完成');
      ui.platform.tab('/pages/me/index');
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async demo(e) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await getApp().demoLogin(e.currentTarget.dataset.role);
      ui.platform.tab('/pages/me/index');
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  baseInput(e) {
    this.setData({ apiBase: e.detail.value });
  },
  saveBase() {
    const value = this.data.apiBase.trim().replace(/\/$/, '');
    if (!/^https?:\/\/[a-zA-Z0-9[\]:.\-]+$/.test(value)) {
      this.setData({ error: '请填写服务源站，例如 https://api.example.com，不包含/api路径' });
      return;
    }
    ui.platform.write('qishu_api_base', value);
    ui.platform.remove('qishu_token');
    getApp().globalData.user = null;
    this.setData({ error: '' });
    ui.platform.toast('已保存，请重新登录');
  }
});
