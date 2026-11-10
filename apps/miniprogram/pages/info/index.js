const ui = require('../../services/ui');
Page({
  data: {
    fontPx: 16,
    items: [],
    columns: [
      { id: 'left', items: [] },
      { id: 'right', items: [] }
    ],
    channels: ['全部', '行业动态', '经营方法', '厂家分享', '店主经验'],
    category: '全部',
    query: '',
    loading: false,
    error: '',
    strategy: '',
    closed: false
  },
  onLoad() {
    this.load();
  },
  onShow() {
    ui.sync(this, 0);
    const role = this.data.user && this.data.user.role;
    if (this._role !== role) {
      this._role = role;
      this.load();
    }
  },
  async load() {
    if (this._loading) return;
    this._loading = true;
    this.setData({ loading: true, error: '' });
    try {
      await getApp().refresh();
      ui.sync(this, 0);
      if (!ui.flag('content')) {
        this.setData({ closed: true });
        return;
      }
      this.setData({ closed: false });
      const query = this.data.query.trim(),
        category = this.data.category;
      let r;
      if (!query && category === '全部') {
        try {
          r = await ui.api.get('/recommendations?kind=content');
          this.setData({ strategy: r.strategy || '经营推荐' });
        } catch (_) {
          r = await ui.api.get('/content');
          this.setData({ strategy: '最新内容' });
        }
      } else
        r = await ui.api.get(
          '/content?query=' +
            encodeURIComponent(query) +
            '&category=' +
            encodeURIComponent(category === '全部' ? '' : category)
        );
      const items = ui.list(r).map(ui.decorate);
      this.setData({ items, columns: ui.masonry(items) });
      // 未经可见性观测不报告曝光；本端仅记录搜索、点击和详情前台停留。
      this._loaded = true;
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this._loading = false;
      this.setData({ loading: false });
    }
  },
  queryInput(e) {
    this.setData({ query: e.detail.value });
  },
  search() {
    if (this.data.query) ui.event('search', this.data.query, 'content');
    this.load();
  },
  chooseCategory(e) {
    this.setData({ category: e.currentTarget.dataset.value });
    this.load();
  },
  open(e) {
    const id = e.currentTarget.dataset.id;
    ui.event('click', id, 'content');
    ui.platform
      .open('/pages/detail/index?kind=content&id=' + encodeURIComponent(id))
      .catch((e) => ui.platform.toast(e.message));
  },
  publish() {
    ui.platform.open('/pages/compose/index?kind=content').catch((e) => ui.platform.toast(e.message));
  },
  login() {
    ui.platform.open('/pages/login/index');
  },
  imageError(e) {
    this.setData({
      ['columns[' +
      e.currentTarget.dataset.column +
      '].items[' +
      e.currentTarget.dataset.index +
      '].imageUrl']: ''
    });
  }
});
