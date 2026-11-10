const platform = require('../platform/wechat');
Component({
  data: {
    selected: 0,
    supplier: false,
    fontPx: 12,
    tabs: [
      { page: '/pages/info/index', name: '资讯', symbol: '◇' },
      { page: '/pages/market/index', name: '找货源', symbol: '▣' },
      { page: '/pages/workspace/index', name: '店铺诊断', symbol: '◎' },
      { page: '/pages/me/index', name: '我的', symbol: '○' }
    ]
  },
  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      if (index === this.data.selected) return;
      platform.tab(this.data.tabs[index].page).catch((e) => platform.toast(e.message));
    }
  }
});
