const ui = require('../../services/ui');
const config = require('../../config');
Page({
  data: {
    fontPx: 16,
    demoEnabled: config.demoEnabled === true,
    items: [],
    leads: [],
    quota: null,
    loading: false,
    error: '',
    personalized: true,
    profileTab: 'creator'
  },
  onShow() {
    this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await getApp().refresh();
      ui.sync(this, 3);
      this.setData({ personalized: this.data.user ? this.data.user.personalized !== false : true });
      if (!this.data.user) {
        this.setData({ items: [], leads: [], quota: null });
        return;
      }
      const rs = await ui.settled([ui.api.get('/creator'), ui.api.get('/leads'), ui.api.get('/quota')]);
      this.setData({
        items: rs[0].status === 'fulfilled' ? ui.list(rs[0].value) : [],
        leads: rs[1].status === 'fulfilled' ? ui.list(rs[1].value) : [],
        quota: rs[2].status === 'fulfilled' ? rs[2].value.quota || rs[2].value : null
      });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(e) {
    const page = e.currentTarget.dataset.page;
    ui.platform.open('/pages/' + page + '/index');
  },
  compose(e) {
    ui.platform.open('/pages/compose/index?kind=' + (e.currentTarget.dataset.kind || 'content'));
  },
  switchTab(e) {
    this.setData({ profileTab: e.currentTarget.dataset.tab });
  },
  async preferences(e) {
    try {
      await ui.api.patch('/profile/preferences', { personalized: e.detail.value });
      this.setData({ personalized: e.detail.value });
      getApp().globalData.user.personalized = e.detail.value;
      ui.platform.toast(e.detail.value ? '已开启个性化' : '已关闭个性化');
    } catch (error) {
      ui.platform.toast(error.message);
    }
  },
  async followup(e) {
    try {
      await ui.api.patch('/leads/' + encodeURIComponent(e.currentTarget.dataset.id), {
        status: '已回访',
        note: '由当前用户确认已完成回访，未自动认定好友或成交'
      });
      ui.platform.toast('回访状态已记录');
      this.load();
    } catch (error) {
      ui.platform.toast(error.message);
    }
  },
  async logout() {
    try {
      await getApp().logout();
    } catch (error) {
      ui.platform.toast(error.message);
    } finally {
      this.load();
    }
  },
  async removeContent(e) {
    const id = e.currentTarget.dataset.id;
    const confirm = await ui.platform.confirm(
      '归档这条内容？',
      '归档后不再公开展示，操作仅针对本人或本主体内容。'
    );
    if (!confirm.confirm) return;
    try {
      await ui.api.patch('/creator/' + id, { status: 'hidden', published: false });
      this.load();
    } catch (error) {
      ui.platform.toast(error.message);
    }
  },
  backend() {
    ui.platform.toast('厂家经营和平台管理完整界面请在电脑浏览器打开');
  }
});
