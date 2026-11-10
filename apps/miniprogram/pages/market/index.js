const ui = require('../../services/ui');
function options(values) {
  return ['全部'].concat(
    (Array.isArray(values) ? values : [])
      .map((v) => (typeof v === 'string' ? v : v.label || v.name || v.value))
      .filter(Boolean)
  );
}
Page({
  data: {
    fontPx: 16,
    items: [],
    columns: [
      { id: 'left', items: [] },
      { id: 'right', items: [] }
    ],
    fairs: [],
    autoplay: false,
    loading: false,
    error: '',
    query: '',
    closed: false,
    filterOpen: false,
    filters: { style: '全部', origin: '全部', category: '全部', price: '全部', moq: '全部', status: '全部' },
    options: {
      style: ['全部', '通勤', '韩系', '新中式', '简约', '休闲'],
      origin: ['全部', '杭州', '濮院', '平湖', '海宁', '常熟', '广州', '深圳', '武汉'],
      category: ['全部', '大衣', '针织', '衬衫', '裤装', '连衣裙', '羽绒服'],
      price: ['全部', '100元以下', '100—199元', '200—399元', '400元以上'],
      moq: ['全部', '1件起', '5件以内', '10件以内', '20件以内'],
      status: ['全部', '现货', '预售']
    }
  },
  onLoad() {
    this.load();
  },
  onShow() {
    this.setData({ autoplay: true });
    ui.sync(this, 1);
    const r = this.data.user && this.data.user.role;
    if (this._role !== r) {
      this._role = r;
      this.load();
    }
  },
  onHide() {
    this.setData({ autoplay: false });
  },
  onUnload() {
    this.setData({ autoplay: false });
  },
  async load() {
    if (this._loading) return;
    this._loading = true;
    this.setData({ loading: true, error: '' });
    try {
      const b = await getApp().refresh();
      ui.sync(this, 1);
      if (!ui.flag('products')) {
        this.setData({ closed: true });
        return;
      }
      this.setData({ closed: false });
      const d = b.dictionaries || {},
        config = b.config || {},
        o = Object.assign({}, this.data.options);
      if (d.styles || d.style) o.style = options(d.styles || d.style);
      if (d.categories || d.category) o.category = options(d.categories || d.category);
      if (d.status) o.status = options(d.status);
      if (d.priceBands) o.price = options(d.priceBands);
      if (d.moqBands) o.moq = options(d.moqBands);
      let origins = d.origins || d.origin || o.origin.slice(1);
      if (config.originOrder && config.originOrder.length) origins = config.originOrder;
      origins = origins.filter(
        (v) => !(config.hiddenOrigins || []).includes(typeof v === 'string' ? v : v.value || v.name)
      );
      o.origin = options(origins);
      this.setData({ options: o });
      const f = this.data.filters,
        parts = [];
      ['style', 'origin', 'category', 'status'].forEach((k) => {
        if (f[k] !== '全部') parts.push(k + '=' + encodeURIComponent(f[k]));
      });
      if (this.data.query) parts.push('query=' + encodeURIComponent(this.data.query));
      const bands = {
        '100元以下': [0, 99],
        '100—199元': [100, 199],
        '200—399元': [200, 399],
        '400元以上': [400, 999999]
      };
      const band = (d.priceBands || []).find((v) => v.label === f.price);
      if (band) {
        if (band.min != null) parts.push('priceMin=' + band.min);
        if (band.max != null) parts.push('priceMax=' + band.max);
      } else if (bands[f.price]) parts.push('priceMin=' + bands[f.price][0], 'priceMax=' + bands[f.price][1]);
      const qty = { '1件起': 1, '5件以内': 5, '10件以内': 10, '20件以内': 20 },
        moqBand = (d.moqBands || []).find((v) => v.label === f.moq);
      if (moqBand) {
        if (moqBand.max != null) parts.push('moqMax=' + moqBand.max);
      } else if (qty[f.moq]) parts.push('moqMax=' + qty[f.moq]);
      const filtered = this.data.query.trim() || Object.values(f).some((v) => v !== '全部');
      let r;
      if (filtered) r = await ui.api.get('/products?' + parts.join('&'));
      else
        try {
          r = await ui.api.get('/recommendations?kind=products');
        } catch (_) {
          r = await ui.api.get('/products');
        }
      const items = ui.list(r).map(ui.decorate);
      this.setData({ items, columns: ui.masonry(items) });
      if (ui.flag('fairs'))
        try {
          const fairs = await ui.api.get('/fairs');
          this.setData({ fairs: ui.list(fairs).slice(0, 3).map(ui.decorate) });
        } catch (_) {
          this.setData({ fairs: [] });
        }
      else this.setData({ fairs: [] });
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
    if (this.data.query) ui.event('search', this.data.query, 'products');
    this.load();
  },
  toggleFilter() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },
  chooseFilter(e) {
    const k = e.currentTarget.dataset.key,
      values = this.data.options[k];
    this.setData({ ['filters.' + k]: values[Number(e.detail.value)] });
    this.load();
  },
  reset() {
    this.setData({
      query: '',
      filters: { style: '全部', origin: '全部', category: '全部', price: '全部', moq: '全部', status: '全部' }
    });
    this.load();
  },
  open(e) {
    const id = e.currentTarget.dataset.id;
    ui.event('click', id, 'products');
    ui.platform.open('/pages/detail/index?kind=product&id=' + encodeURIComponent(id));
  },
  openFair(e) {
    ui.platform.open('/pages/detail/index?kind=fair&id=' + encodeURIComponent(e.currentTarget.dataset.id));
  },
  publish() {
    ui.platform.open('/pages/compose/index?kind=' + (this.data.supplier ? 'product' : 'content'));
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
