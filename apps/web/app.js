import { state, refresh, saveFont, isSupplier, labels } from './core/state.js';
import { post } from './core/api.js';
import { isBackWorkspace, workspaceHome } from './core/workspace.js';
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
  return `<a class="brand" href="#${workspaceHome(state.user)}"><span class="brand-mark">七</span><span><strong>七叔</strong><small>${isBackWorkspace() ? '独立经营管理后台' : '女装行业平台'}</small></span></a>`;
}
function shell(ctx) {
  const backstage = isBackWorkspace(),
    user = state.user;
  const adminMode = backstage && user?.role === 'admin';
  const manufacturerMode = backstage && user?.role === 'supplier';
  const home = workspaceHome(user);
  const mode = adminMode
    ? 'admin-shell'
    : manufacturerMode
      ? 'manufacturer-shell'
      : backstage
        ? 'backstage-login-shell'
        : 'consumer-shell';
  let links = navItems()
    .map(
      ([path, name, title]) =>
        `<a href="#${path}" class="nav-item ${active(path, ctx) ? 'active' : ''}">${icon(name)}<span>${title}</span></a>`
    )
    .join('');
  if (adminMode)
    links = visibleAdminMenus(user)
      .map(
        ([path, name, title]) =>
          `<a href="#/admin${path ? '/' + path : ''}" class="nav-item ${(ctx.args[1] || '') === path ? 'active' : ''}">${icon(name)}<span>${title}</span></a>`
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
      ['/knowledge', 'folder', '主体知识库'],
      ['/account', 'user', '本后台账号']
    ]
      .map(
        ([path, name, title]) =>
          `<a href="#${path}" class="nav-item ${ctx.path === path.split('?')[0] ? 'active' : ''}">${icon(name)}<span>${title}</span></a>`
      )
      .join('');
  if (backstage && !adminMode && !manufacturerMode)
    links = '<a class="nav-item active" href="#/login">' + icon('shield') + '<span>后台登录</span></a>';
  const workspaceLinks = !backstage
    ? `<div class="nav-section-label">我的工作空间</div><nav class="side-nav workspace-nav"><a class="nav-item" href="#/creator">${icon('edit')}<span>创作中心</span></a><a class="nav-item" href="#/leads">${icon('message')}<span>联系与回访</span></a></nav>`
    : '';
  return `<div class="app-shell ${mode}" data-workspace="${backstage ? 'back' : 'front'}"><div class="drawer-scrim" id="drawer-scrim"></div><aside class="sidebar">${brand()}<div class="side-intro">${adminMode ? '平台管理员后台' : manufacturerMode ? '厂家经营后台' : backstage ? '后台独立登录' : '经验 · 货源 · 经营判断'}</div><nav class="side-nav">${links}</nav>${workspaceLinks}<footer class="sidebar-footer"><a href="#/login">${icon('shield')}${backstage ? '本后台登录 / 切换身份' : '前台登录 / 切换身份'}</a><small>${backstage ? '后台会话独立于前台' : '前台会话独立于后台'}</small></footer></aside><div class="main-shell"><header class="topbar"><button class="icon-button mobile-menu" id="mobile-menu" aria-label="打开导航">${icon('menu')}</button><a class="mobile-brand" href="#${home}"><span class="brand-mark">七</span><strong>${backstage ? '经营后台' : '七叔'}</strong></a>${!backstage ? `<form id="global-search" class="global-search">${icon('search')}<input name="query" placeholder="搜索货源、资讯和经营需求" aria-label="全站搜索" value="${esc(ctx.query.get('query') || ctx.query.get('q') || '')}"></form>` : '<span class="backstage-header-label">' + (adminMode ? '平台管理员后台' : manufacturerMode ? '厂家经营后台' : '后台登录') + '</span>'}<div class="topbar-actions"><a class="btn light small" href="#/login">${backstage ? '后台身份登录' : '前台身份登录'}</a>${user ? `<a class="account-link" href="#${backstage ? '/account' : '/my'}">${avatar(user.name)}<span>${esc(labels[user.role] || '我的')}</span></a><button class="text-button tiny" id="workspace-logout">退出${backstage ? '后台' : '前台'}</button>` : ''}${user && (!backstage || manufacturerMode) ? `<a class="btn primary top-publish" href="#/publish?kind=${isSupplier() ? 'product' : 'content'}">${icon('plus')}<span>发布</span></a>` : ''}</div></header><main class="page-content" id="page-content"><div class="navigation-line"><button class="text-button" data-back>${icon('back')}返回上一步</button><a href="#${home}">${backstage ? '后台首页' : '回到首页'}</a><span class="navigation-context">${backstage ? '独立后台会话' : '前台用户空间'}</span></div><div id="page-view"><div class="loading-state"><span></span>正在载入这个模块…</div></div></main></div>${
    !backstage
      ? `<nav class="bottom-nav" aria-label="主要导航">${navItems()
          .map(
            ([path, name, title]) =>
              `<a href="#${path}" class="${active(path, ctx) ? 'active' : ''}">${icon(name)}<span>${title}</span></a>`
          )
          .join('')}</nav>`
      : ''
  }</div>`;
}

async function resolve(ctx) {
  const [page, id] = ctx.args;
  const backstage = isBackWorkspace();
  if (page === 'login') return workspace.login(ctx);
  if (page === 'register') return workspace.registration(ctx);
  if (backstage) {
    if (!state.user) return workspace.login(ctx);
    if (!['supplier', 'admin'].includes(state.user.role))
      return {
        html: empty(
          '本账号没有后台身份',
          '本后台只开放厂家和平台管理员身份。',
          '<a class="btn" href="#/login">返回后台登录</a>'
        )
      };
    if (page === 'account' || (page === 'my' && !id)) return workspace.backAccount(ctx);
    if (['info', 'home', 'sources', 'article', 'supplier', 'fairs', 'diagnosis', 'tags'].includes(page))
      return {
        html: empty(
          '当前为独立经营后台',
          '本端不自动切换到前台，也不共用前台登录状态。',
          '<a class="btn" href="#' + workspaceHome(state.user) + '">返回后台首页</a>'
        )
      };
    if (page === 'manufacturer' && state.user.role !== 'supplier')
      return {
        html: empty(
          '当前不是厂家后台身份',
          '如需切换，请返回本后台登录页。',
          '<a class="btn" href="#/login">本后台登录</a>'
        )
      };
  } else if (['admin', 'manufacturer', 'account'].includes(page)) {
    return {
      html: empty(
        '当前为前台用户空间',
        '经营后台使用独立地址和会话，前台不会自动进入后台。',
        '<a class="btn" href="#/info">回到前台首页</a>'
      )
    };
  }
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
      '<a class="btn primary" href="#' + workspaceHome(state.user) + '">回到本端首页</a>'
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
  app.querySelector('#workspace-logout')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await post('/auth/logout', {});
      await refresh();
      location.hash = '/login';
      await render(false);
    } catch (error) {
      toast(error.message);
    }
  });
  app
    .querySelector('#mobile-menu')
    ?.addEventListener('click', () => document.querySelector('.app-shell').classList.toggle('drawer-open'));
  app
    .querySelector('#drawer-scrim')
    ?.addEventListener('click', () => document.querySelector('.app-shell').classList.remove('drawer-open'));
  app.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => back(workspaceHome(state.user))));
  const searchForm = app.querySelector('#global-search');
  if (searchForm)
    searchForm.onsubmit = (e) => {
      e.preventDefault();
      const q = new FormData(e.target).get('query');
      location.hash =
        (ctx.path === '/sources'
          ? '/sources?query='
          : ctx.path === '/buyers'
            ? '/buyers?query='
            : '/info?q=') + encodeURIComponent(q);
    };
  const view = app.querySelector('#page-view');
  try {
    const result = await resolve(ctx);
    if (version !== renderVersion) return;
    view.innerHTML = result.html || '';
    cleanup = result.bind?.(view);
    if (!isBackWorkspace()) renderPlacements(ctx, view);
    restoreScroll();
    document.title = (view.querySelector('h1')?.textContent || '七叔女装行业平台') + ' · 七叔';
  } catch (e) {
    if (version !== renderVersion) return;
    view.innerHTML =
      errorBlock(e.message, ctx.key) +
      `<div class="module-fallback"><p>当前模块未能加载，导航和其他功能仍然可用。</p><a class="btn" href="#${workspaceHome(state.user)}">返回本端首页</a></div>`;
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
