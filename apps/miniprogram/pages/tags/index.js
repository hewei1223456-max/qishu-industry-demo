const ui = require('../../services/ui');
const defaults = [
  '通勤',
  '韩系',
  '新中式',
  '简约',
  '休闲',
  '25—35岁',
  '35—45岁',
  '社区门店',
  '商场门店',
  '小单快返',
  '混批',
  '支持并单',
  '按需做货',
  '现货优先',
  '预售订货',
  '基础款',
  '设计款',
  '100—200元拿货',
  '200—400元拿货',
  '陈列方法',
  '库存周转',
  '客群经营',
  '短视频经营'
];
Page({
  data: { fontPx: 16, tags: [], selected: [], count: 0, error: '', busy: false },
  onShow() {
    ui.sync(this, -1);
    const user = this.data.user;
    const chosen = (user && user.tags) || [];
    const configured = getApp().globalData.dictionaries.tags;
    const source = Array.isArray(configured) && configured.length ? configured : defaults;
    this.setData({
      selected: chosen,
      count: chosen.length,
      tags: source.map((v) => {
        const label = typeof v === 'string' ? v : v.label || v.name || v.value;
        return { label, selected: chosen.includes(label) };
      })
    });
  },
  back() {
    ui.platform.back('/pages/me/index');
  },
  toggle(e) {
    const label = e.currentTarget.dataset.label;
    let selected = this.data.selected.slice();
    if (selected.includes(label)) selected = selected.filter((v) => v !== label);
    else {
      if (selected.length >= 10) {
        this.setData({ error: '最多选择十个经营标签' });
        return;
      }
      selected.push(label);
    }
    this.setData({
      selected,
      count: selected.length,
      error: '',
      tags: this.data.tags.map((t) => Object.assign({}, t, { selected: selected.includes(t.label) }))
    });
  },
  async save() {
    if (this.data.count < 4 || this.data.count > 10) {
      this.setData({ error: '请选择四到十个与你经营情况相符的标签' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await ui.api.post('/profile/tags', { tags: this.data.selected });
      await getApp().refresh();
      ui.platform.toast('经营偏好已更新');
      ui.platform.back('/pages/me/index');
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async nonPersonalized() {
    try {
      await ui.api.patch('/profile/preferences', { personalized: false });
      await getApp().refresh();
      ui.platform.toast('已选择非个性化浏览');
      ui.platform.tab('/pages/info/index');
    } catch (e) {
      this.setData({ error: e.message });
    }
  }
});
