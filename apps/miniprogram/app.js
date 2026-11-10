const api = require('./services/api');
const platform = require('./platform/wechat');
App({
  globalData: { user: null, config: {}, dictionaries: {}, bootstrapError: '', adminAuthorizationRequired: false },
  onLaunch() {
    this.refresh().catch(() => {});
  },
  async refresh() {
    try {
      const b = await api.get('/bootstrap');
      this.globalData.user = b.user || null;
      if (!b.user || b.user.role === 'admin') this.globalData.adminAuthorizationRequired = false;
      this.globalData.config = b.config || {};
      this.globalData.dictionaries = b.dictionaries || {};
      this.globalData.bootstrapError = '';
      return b;
    } catch (e) {
      this.globalData.bootstrapError = e.message;
      throw e;
    }
  },
  async demoLogin(role) {
    const r = await api.post('/auth/demo', { role, scope: 'front' });
    if (!r.token) throw new Error('服务端未返回演示会话凭证');
    await platform.clearDownloads();
    platform.write('qishu_token', r.token);
    this.globalData.adminAuthorizationRequired = false;
    await this.refresh();
    return r.user;
  },
  async wechatLogin(role) {
    const r = await platform.login();
    const data = await api.post('/auth/wechat', {
      code: r.code,
      role: ['owner', 'supplier', 'admin'].includes(role) ? role : 'owner',
      scope: 'front'
    });
    if (!data.token) throw new Error('微信登录尚未完成配置');
    await platform.clearDownloads();
    platform.write('qishu_token', data.token);
    this.globalData.adminAuthorizationRequired = data.adminAuthorizationRequired === true;
    await this.refresh();
    return data.user;
  },
  async logout() {
    try {
      await api.post('/auth/logout', {});
    } finally {
      platform.remove('qishu_token');
      await platform.clearDownloads();
      this.globalData.user = null;
      this.globalData.adminAuthorizationRequired = false;
    }
  }
});
