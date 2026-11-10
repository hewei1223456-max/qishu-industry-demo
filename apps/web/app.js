import { state, refresh, saveFont, isSupplier, labels } from './core/state.js';
import { post } from './core/api.js';
import { route, beginRoute, back } from './core/navigation.js';
import { icon } from './components/icons.js';
import { esc, avatar, errorBlock, empty, closeModal, toast } from './components/ui.js';
import { visibleAdminMenus } from './core/menus.js';
// Page modules load independently so a failed optional module cannot stop the shell.
const lazyPage = (path) =>
  new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) =>
          import(path).then((module) => module[name](...args))
    }
  );
const content = lazyPage('./pages/content.js'),
  catalog = lazyPage('./pages/catalog.js'),
  clients = lazyPage('./pages/clients.js'),
  workspace = lazyPage('./pages/workspace.js'),
  admin = lazyPage('./pages/admin.js');
const ingestion = (ctx) => import('./pages/ingestion.js').then((module) => module.ingestion(ctx));
import { renderPlacements } from './components/ads.js';

const app = document.querySelector('#app');
let cleanup,
  renderVersion = 0;
const demoViews = {
  owner: { role: 'owner', path: '/info' },
  supplier: { role: 'supplier', path: '/info' },
  manufacturer: { role: 'supplier', path: '/manufacturer' },
  admin: { role: 'admin', path: '/admin' },
  unverified: { role: 'owner', userId: 'owner-guest', path: '/info' },
  guest: { path: '/info' }
};
async function switchDemoView(value) {
  if (state.mode !== 'development-demo') throw new Error('仅开发演示环境可切换视角。');
  const view = demoViews[value];
  if (!view) throw new Error('请选择有效的演示视角。');
  if (view.role) {
    await post('/auth/demo', { role: view.role, ...(view.userId ? { userId: view.userId } : {}) });
  } else {
    await post('/auth/logout', {});
  }
  await refresh();
  if (location.hash === '#' + view.path) await render(false);
  else location.hash = view.path;
}
function demoViewControl() {
  return state.mode === 'development-demo'
    ? `<select class="demo-view-switch" id="demo-view-switch" aria-label="切换演示视角"><option value="" selected disabled>切换演示视角</option><option value="owner">店主前台</option><option value="supplier">厂家前台</option><option value="manufacturer">厂家经营后台</option><option value="admin">平台运营后台</option><option value="unverified">未认证店主</option><option value="guest">游客</option></select>`
    : '';
}
const navItems = () =>
  isSupplier()
    ? [
        ['/info', 'news', '资讯'],
        ['/sources', 'box', '货源广场'],
        ['/buyers', 'users', '找客户'],
        ['/my', 'user', '我的']
      ]
    : [
        ['/info', 'news', '资讯'],
        ['/sources', 'box', '找货源'],
        ['/diagnosis', 'spark', '店铺诊断'],
        ['/my', 'user', '我的']
      ];
const active = (path, current) =>
  path === '/my'
    ? ['my', 'creator', 'tags', 'auth', 'knowledge', 'leads', 'jobs', 'manufacturer'].includes(
        current.args[0]
      )
    : current.path === path ||
      (path === '/info' && current.args[0] === 'article') ||
      (path === '/sources' && ['product', 'supplier', 'fair', 'fairs'].includes(current.args[0]));
function brand() {
  return '<a class="brand" href="#/info"><span class="brand-mark">七</span><span><strong>七叔</strong><small>女装行业平台</small></span></a>';
}
function shell(ctx) {
  const adminMode = ctx.args[0] === 'admin',
    manufacturerMode = ctx.args[0] === 'manufacturer';
  const mode = adminMode ? 'admin-shell' : manufacturerMode ? 'manufacturer-shell' : 'consumer-shell';
  let links = navItems()
    .map(
      ([p, i, t]) =>
        `<a href="#${p}" class="nav-item ${active(p, ctx) ? 'active' : ''}">${icon(i)}<span>${t}</span></a>`
    )
    .join('');
  if (adminMode)
    links = visibleAdminMenus(state.user)
      .map(
        ([p, i, t]) =>
          `<a href="#/admin${p ? '/' + p : ''}" class="nav-item ${(ctx.args[1] || '') === p ? 'active' : ''}">${icon(i)}<span>${t}</span></a>`
      )
      .join('');
  if (manufacturerMode)
    links = [
      ['/manufacturer', 'chart', '经营概览'],
      ['/creator?kind=product', 'box', '我的货源与订货会'],
      ['/buyers', 'users', '寻找店主'],
      ['/leads', 'message', '联系与回访'],
      ['/creator', 'edit', '创作中心'],
      ['/my/rights', 'shield', '额度与权益'],
      ['/knowledge', 'folder', '主体知识库']
    ]
      .map(
        ([p, i, t], i0) =>
          `<a href="#${p}" class="nav-item ${i0 === 0 ? 'active' : ''}">${icon(i)}<span>${t}</span></a>`
      )
      .join('');
  const u = state.user;
  return `<div class="app-shell ${mode}"><div class="drawer-scrim" id="drawer-scrim"></div><aside class="sidebar">${brand()}<div class="side-intro">${adminMode ? '平台运营管理' : manufacturerMode ? '厂家经营管理' : '经验 · 货源 · 经营判断'}</div><nav class="side-nav">${links}</nav>${!adminMode && !manufacturerMode ? `<div class="nav-section-label">我的工作空间</div><nav class="side-nav workspace-nav"><a class="nav-item ${ctx.path === '/creator' ? 'active' : ''}" href="#/creator">${icon('edit')}<span>创作中心</span></a><a class="nav-item" href="#/leads">${icon('message')}<span>联系与回访</span></a>${isSupplier() ? `<a class="nav-item" href="#/manufacturer">${icon('chart')}<span>厂家经营后台</span></a>` : ''}${u?.role === 'admin' ? `<a class="nav-item" href="#/admin">${icon('settings')}<span>平台运营后台</span></a>` : ''}</nav>` : ''}<footer class="sidebar-footer"><a href="#${adminMode || manufacturerMode ? '/info' : '/login'}">${icon(adminMode || manufacturerMode ? 'back' : 'shield')}${adminMode || manufacturerMode ? '回到用户端' : '开发体验入口'}</a><small>开发预览 · 独立测试数据</small></footer></aside><div class="main-shell"><header class="topbar"><button class="icon-button mobile-menu" id="mobile-menu" aria-label="打开导航">${icon('menu')}</button><a class="mobile-brand" href="#/info"><span class="brand-mark">七</span><strong>${adminMode ? '运营后台' : '七叔'}</strong></a><form id="global-search" class="global-search">${icon('search')}<input name="query" placeholder="${adminMode ? '浏览当前管理模块' : isSupplier() ? '搜索货源、资讯或店主需求' : '搜索货源、经验和经营方法'}" aria-label="全站搜索" value="${esc(ctx.query.get('query') || ctx.query.get('q') || '')}"></form><div class="topbar-actions${state.mode === 'development-demo' ? ' has-demo-switch' : ''}">${demoViewControl()}<span class="preview-label">开发预览</span>${u ? `<a class="account-link" href="#/my">${avatar(u.name)}<span>${esc(labels[u.role] || '我的')}</span></a>` : '<a class="text-link login-link" href="#/login">登录演示</a>'}${!adminMode ? `<a class="btn primary top-publish" href="#/publish?kind=${isSupplier() ? 'product' : 'content'}">${icon('plus')}<span>发布</span></a>` : ''}</div></header><main class="page-content" id="page-content"><div class="navigation-line"><button class="text-button" data-back>${icon('back')}返回上一步</button><a href="#${adminMode ? '/admin' : '/info'}">${adminMode ? '运营总览' : '回到首页'}</a><span class="navigation-context">${adminMode ? (Array.isArray(u?.permissions) && !u.permissions.includes('*') ? '按账号授权管理' : '平台最高管理权限') : manufacturerMode ? '厂家经营工作空间' : '开发演示 · 样例资料'}</span></div><div id="page-view"><div class="loading-state"><span></span>正在载入这个模块…</div></div></main></div>${
    !adminMode && !manufacturerMode
      ? `<nav class="bottom-nav" aria-label="主要导航">${navItems()
          .map(
            ([p, i, t]) =>
              `<a href="#${p}" class="${active(p, ctx) ? 'active' : ''}">${icon(i)}<span>${t}</span></a>`
          )
          .join('')}</nav>`
      : ''
  }</div>`;
}

async function resolve(ctx) {
  const [page, id] = ctx.args;
  const publicPages = [
    'info',
    'home',
    'article',
    'sources',
    'product',
    'supplier',
    'fair',
    'fairs',
    'login',
    'my'
  ];
  if (!state.user && !publicPages.includes(page))
    return {
      html: empty(
        '登录后进入这个工作空间',
        '先选择开发测试账号，再体验发布、认证与管理流程。',
        '<a class="btn primary" href="#/login">进入开发体验</a>'
      )
    };
  if (page === 'admin') {
    if (state.user?.role !== 'admin')
      return {
        html: empty(
          '当前账号没有平台管理权限',
          '平台权限由服务端校验。',
          '<a class="btn" href="#/my">返回我的</a>'
        )
      };
    const tab = ctx.query.get('tab');
    switch (id) {
      case undefined:
        return admin.overview(ctx);
      case 'users':
        return admin.resourcePage(['buyers', 'admins'].includes(tab) ? tab : 'certifications', ctx);
      case 'content':
        return tab === 'import' ? ingestion(ctx) : admin.resourcePage('content', ctx);
      case 'products':
        return admin.resourcePage(tab === 'fairs' ? 'fairs' : 'products', ctx);
      case 'rights':
        return tab === 'leads'
          ? clients.leads(ctx)
          : admin.resourcePage(tab === 'entitlements' ? 'entitlements' : 'plans', ctx);
      case 'config':
        return admin.configuration(ctx);
      case 'ads':
        return admin.ads(ctx);
      case 'knowledge':
        return tab === 'prompts' ? admin.prompts(ctx) : admin.resourcePage('knowledge', ctx);
      case 'providers':
        return tab === 'jobs' ? workspace.jobs(ctx) : admin.resourcePage('providers', ctx);
      case 'recommendations':
        return admin.recommendations(ctx);
      case 'reports':
        return admin.reports(ctx);
      case 'audit':
        return admin.audit(ctx);
    }
  }
  switch (page) {
    case 'info':
    case 'home':
      return content.feed(ctx);
    case 'article':
      return content.article(ctx);
    case 'sources':
      return catalog.catalog(ctx);
    case 'product':
      return catalog.product(ctx);
    case 'supplier':
      return catalog.supplier(ctx);
    case 'fairs':
      return catalog.fairList(ctx);
    case 'fair':
      return catalog.fair(ctx);
    case 'buyers':
      return isSupplier() || state.user?.role === 'admin'
        ? clients.buyers(ctx)
        : {
            html: empty(
              '找客户属于厂家工作空间',
              '店主可以从货源页了解供货方。',
              '<a class="btn" href="#/sources">找货源</a>'
            )
          };
    case 'leads':
      return clients.leads(ctx);
    case 'login':
      return workspace.login(ctx);
    case 'my':
      return !state.user
        ? workspace.profile(ctx)
        : id === 'business'
          ? import('./pages/profile.js').then((module) => module.businessProfile(ctx))
          : id === 'rights'
            ? workspace.rights(ctx)
            : workspace.profile(ctx);
    case 'auth':
      return workspace.certification(ctx);
    case 'tags':
      return workspace.tags(ctx);
    case 'creator':
      return workspace.creator(ctx);
    case 'publish':
      return workspace.publish(ctx);
    case 'diagnosis':
      return workspace.diagnosis(ctx);
    case 'jobs':
      return workspace.jobs(ctx);
    case 'knowledge':
      return workspace.knowledge(ctx);
    case 'manufacturer':
      return isSupplier() || state.user?.role === 'admin'
        ? admin.manufacturer(ctx)
        : {
            html: empty(
              '当前账号不是厂家',
              '在我的页面使用店主功能。',
              '<a class="btn" href="#/my">返回我的</a>'
            )
          };
  }
  return {
    html: empty(
      '没有找到这个页面',
      '这个功能可能已经下架，其他模块仍可以继续使用。',
      '<a class="btn primary" href="#/info">回到首页</a>'
    )
  };
}

async function render(restore = true) {
  const version = ++renderVersion;
  cleanup?.();
  cleanup = null;
  closeModal(false);
  const ctx = route(),
    restoreScroll = restore ? beginRoute() : () => {};
  app.innerHTML = shell(ctx);
  const demoSwitch = app.querySelector('#demo-view-switch');
  if (demoSwitch) {
    demoSwitch.onchange = async () => {
      const value = demoSwitch.value;
      demoSwitch.value = '';
      demoSwitch.disabled = true;
      try {
        await switchDemoView(value);
      } catch (error) {
        toast(error.message);
      } finally {
        demoSwitch.value = '';
        demoSwitch.disabled = false;
      }
    };
  }
  app
    .querySelector('#mobile-menu')
    ?.addEventListener('click', () => document.querySelector('.app-shell').classList.toggle('drawer-open'));
  app
    .querySelector('#drawer-scrim')
    ?.addEventListener('click', () => document.querySelector('.app-shell').classList.remove('drawer-open'));
  app
    .querySelectorAll('[data-back]')
    .forEach((b) => (b.onclick = () => back(ctx.args[0] === 'admin' ? '/admin' : '/info')));
  app.querySelector('#global-search').onsubmit = (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('query');
    location.hash =
      (ctx.path === '/sources' ? '/sources?query=' : ctx.path === '/buyers' ? '/buyers?query=' : '/info?q=') +
      encodeURIComponent(q);
  };
  const view = app.querySelector('#page-view');
  try {
    const result = await resolve(ctx);
    if (version !== renderVersion) return;
    view.innerHTML = result.html || '';
    cleanup = result.bind?.(view);
    renderPlacements(ctx, view);
    restoreScroll();
    document.title = (view.querySelector('h1')?.textContent || '七叔女装行业平台') + ' · 七叔';
  } catch (e) {
    if (version !== renderVersion) return;
    view.innerHTML =
      errorBlock(e.message, ctx.key) +
      `<div class="module-fallback"><p>当前模块未能加载，导航和其他功能仍然可用。</p><a class="btn" href="#/info">浏览资讯</a><a class="btn" href="#/sources">查看货源</a></div>`;
    restoreScroll();
  }
}
window.addEventListener('hashchange', () => render());
window.addEventListener('qishu:refresh', async () => {
  try {
    await refresh();
  } catch {}
  render(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
saveFont(state.fontScale);
try {
  await refresh();
} catch (e) {
  state.bootstrapError = e.message;
}
await render();
