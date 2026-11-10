const ui = require('../../services/ui');
Page({
  data: { fontPx: 16, items: [], title: '', body: '', error: '', busy: false, notice: '' },
  onShow() {
    ui.sync(this, -1);
    this.load();
  },
  back() {
    ui.platform.back('/pages/me/index');
  },
  async load() {
    try {
      const r = await ui.api.get('/knowledge');
      this.setData({ items: ui.list(r) });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async save() {
    if (!this.data.title.trim() || !this.data.body.trim()) {
      this.setData({ error: '请填写标题和知识内容' });
      return;
    }
    this.setData({ busy: true, error: '', notice: '' });
    try {
      await ui.api.post('/knowledge', { title: this.data.title, body: this.data.body, scope: 'private' });
      this.setData({ title: '', body: '', notice: '已保存为本账号或主体私有知识，不自动进入公共知识库。' });
      this.load();
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove(e) {
    const confirm = await ui.platform.confirm('移除私有知识？', '该条知识将不再用于你的后续检索。');
    if (!confirm.confirm) return;
    try {
      await ui.api.delete('/knowledge/' + e.currentTarget.dataset.id);
      this.load();
    } catch (error) {
      this.setData({ error: error.message });
    }
  }
});
