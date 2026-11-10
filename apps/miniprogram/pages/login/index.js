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
      { id: 'owner', title: '店主', desc: '资讯、找货源、店铺诊断、我的' },
      { id: 'supplier', title: '厂家', desc: '资讯、货源广场、找客户、我的；需完成厂家材料审核' },
      { id: 'admin', title: '平台管理员', desc: '身份须经平台授权；选择此项不会自动取得管理权限' }
    ]
  },
  onShow() {
    ui.sync(this, -1);
  },
  back() {
    ui.platform.back('/pages/me/index');
  },
  chooseRole(e) {
    const role = e.currentTarget.dataset.role;
    if (['owner', 'supplier', 'admin'].includes(role)) this.setData({ authRole: role });
  },
  async afterLogin() {
    const user = getApp().globalData.user;
    const adminPending = getApp().globalData.adminAuthorizationRequired || (user && user.adminAuthorizationRequired);
    if (user && user.role === 'supplier' && !user.verified && !adminPending) {
      await ui.platform.open('/pages/certify/index?onboarding=1');
    } else {
      await ui.platform.tab('/pages/me/index');
    }
  },
  async wechat() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await getApp().wechatLogin(this.data.authRole);
      ui.platform.toast(
        getApp().globalData.adminAuthorizationRequired ? '微信身份已验证，管理员权限待授权' : '微信登录已完成'
      );
      await this.afterLogin();
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
      await getApp().demoLogin(e.currentTarget.dataset.role || this.data.authRole);
      await this.afterLogin();
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
