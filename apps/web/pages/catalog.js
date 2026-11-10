import { get, post, itemsOf, event } from '../core/api.js';
import { state, feature, isSupplier } from '../core/state.js';
import { icon } from '../components/icons.js';
import {
  esc,
  img,
  badge,
  pageHead,
  productCard,
  empty,
  select,
  money,
  modal,
  toast,
  submit,
  contactFields,
  bindContact
} from '../components/ui.js';
const val = (v) => (typeof v === 'object' ? v.name || v.value : v);
function dictionary(key) {
  return (state.dictionaries?.[key] || []).map(val);
}
export async function catalog(ctx) {
  if (!feature('products'))
    return {
      html:
        pageHead('货源广场') +
        empty('货源模块正在维护', '资讯和其他功能仍可继续使用。', '<a class="btn" href="#/info">浏览资讯</a>')
    };
  const p = ctx.query;
  const q = Object.fromEntries(p);
  const [productResult, fairResult, recoResult] = await Promise.allSettled([
    get('/products?' + p.toString()),
    feature('fairs') ? get('/fairs') : Promise.resolve({ items: [] }),
    feature('recommendations') ? get('/recommendations?kind=products') : Promise.resolve({ items: [] })
  ]);
  if (productResult.status === 'rejected') throw productResult.reason;
  let products = itemsOf(productResult.value);
  const fairs = fairResult.status === 'fulfilled' ? itemsOf(fairResult.value) : [];
  const recommended = recoResult.status === 'fulfilled' ? itemsOf(recoResult.value) : [];
  if (!p.toString() && recommended.length) products = recommended;
  let origins = dictionary('origins');
  const order = state.config.originOrder || [];
  origins = [...new Set([...order, ...origins])].filter(
    (x) => !(state.config.hiddenOrigins || []).includes(x)
  );
  const banners = (state.config.banners || []).filter((x) => x.visible !== false);
  const slides = banners.length
    ? banners
    : fairs.slice(0, 3).map((f) => ({ ...f, subtitle: f.location || f.city, href: '/fair/' + f.id }));
  return {
    html: `${pageHead(isSupplier() ? '货源广场' : '找到适合你店里的货', '看款式，也看起批、供货和补单条件。', isSupplier() ? '<a class="btn primary" href="#/publish?kind=product">' + icon('plus') + '发布货源</a>' : '<a class="btn light" href="#/publish?kind=content">' + icon('edit') + '发布拿货需求</a>')}${slides.length ? `<section class="fair-banner" aria-label="订货会招募"><div class="fair-slides">${slides.map((s, i) => `<a href="${esc(String(s.href || '/fair/' + s.id).startsWith('https://') ? s.href : '#' + String(s.href || '/fair/' + s.id).replace(/^#/, ''))}" class="fair-slide ${i === 0 ? 'active' : ''}" data-slide="${i}">${img(s.image, s.title)}<div class="fair-shade"></div><div class="fair-slide-copy"><span class="eyebrow">订货会 · 招募中</span><h2>${esc(s.title)}</h2><p>${esc(s.subtitle || s.location || '集中看样，与供货方当面交流')}</p><span class="banner-link">查看招募详情 ${icon('arrow')}</span></div></a>`).join('')}</div><div class="fair-dots">${slides.map((s, i) => `<button class="${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="第${i + 1}张"></button>`).join('')}</div><span class="benefit-label">最高权益享有</span></section>` : ''}<form class="catalog-filters panel" id="catalog-filters"><div class="filter-top"><label class="search-field">${icon('search')}<input name="query" value="${esc(q.query || '')}" placeholder="搜索款式、厂家或拿货条件" aria-label="搜索货源"></label><button class="btn primary">筛选货源</button><a class="text-button" href="#/sources">重置</a></div><div class="filter-grid">${select('风格', 'style', dictionary('styles'), q.style)}${select('产地', 'origin', origins, q.origin)}${select('品类', 'category', dictionary('categories'), q.category)}<label class="field"><span>拿货价格带</span><select name="priceBand"><option value="">全部</option>${(
      state.dictionaries.priceBands || []
    )
      .map((b) => [b.min + '-' + (b.max ?? 99999), b.label])
      .map(([v, n]) => `<option value="${v}" ${q.priceBand === v ? 'selected' : ''}>${esc(n)}</option>`)
      .join(
        ''
      )}</select></label><label class="field"><span>起批量</span><select name="moqMax"><option value="">全部</option>${(state.dictionaries.moqBands || []).map((b) => `<option value="${b.max ?? ''}" ${String(q.moqMax) === String(b.max) ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>${select('供货状态', 'status', dictionary('status').length ? dictionary('status') : ['现货', '预售'], q.status)}</div></form><div class="section-line"><h2>适配货源 <span>${products.length} 款</span></h2><a class="text-link" href="#/fairs">全部订货会 ${icon('arrow')}</a></div>${products.length ? `<div class="product-grid">${products.map(productCard).join('')}</div>` : empty('没有匹配的货源', '试着放宽价格带、产地或起批量。', '<a class="btn" href="#/sources">清除筛选</a>')}`,
    bind(root) {
      root.querySelector('#catalog-filters').onsubmit = (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.target));
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(values)) if (v) params.set(k, v);
        if (values.priceBand) {
          const [min, max] = values.priceBand.split('-');
          params.set('priceMin', min);
          params.set('priceMax', max);
        }
        location.hash = '/sources?' + params.toString();
        if (values.query) event('search', values.query, 'product');
      };
      let index = 0;
      const show = (n) => {
        index = n;
        root.querySelectorAll('[data-slide]').forEach((el, i) => el.classList.toggle('active', i === n));
        root.querySelectorAll('[data-dot]').forEach((el, i) => el.classList.toggle('active', i === n));
      };
      root.querySelectorAll('[data-dot]').forEach((b) => (b.onclick = () => show(Number(b.dataset.dot))));
      const timer =
        slides.length > 1
          ? setInterval(
              () => {
                if (!document.hidden && !root.querySelector('.fair-banner:hover'))
                  show((index + 1) % slides.length);
              },
              Math.max(2000, Number(state.config.carouselSeconds || 3) * 1000)
            )
          : null;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              event('exposure', entry.target.dataset.productId, 'product');
              observer.unobserve(entry.target);
            }
        },
        { threshold: 0.35 }
      );
      root.querySelectorAll('.product-card').forEach((el, i) => {
        el.dataset.productId = products[i]?.id;
        observer.observe(el);
      });
      return () => {
        clearInterval(timer);
        observer.disconnect();
      };
    }
  };
}

export async function product(ctx) {
  const r = await get('/products/' + encodeURIComponent(ctx.args[1])),
    p = r.item || r.product || r;
  event('click', p.id, 'product');
  const images = p.images?.length ? p.images : [p.image];
  return {
    html: `<div class="product-detail"><section class="product-gallery"><div class="main-product-photo">${img(images[0], p.title)}</div><div class="thumbs">${images
      .filter(Boolean)
      .map((s) => `<button data-photo="${esc(s)}">${img(s, p.title)}</button>`)
      .join(
        ''
      )}</div></section><section class="product-detail-copy"><div class="label-row">${badge(p.style || '货源')}${badge(p.status || '供货待确认', 'subtle')}</div><h1>${esc(p.title)}</h1><p class="product-intro">${esc(p.description || p.body || '先确认拿货条件，再安排看样与试货。')}</p><div class="detail-price">${money(p.price)}<small>拿货参考价 · 联系时再次确认</small></div><dl class="spec-grid">${[
      ['产地', p.origin],
      ['品类', p.category],
      ['起批量', p.moq ? `${p.moq}件` : '待补充'],
      ['发货周期', p.delivery || '与厂家确认'],
      ['混批条件', p.mix || '联系确认'],
      ['供货状态', p.status]
    ]
      .map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b || '待补充')}</dd></div>`)
      .join(
        ''
      )}</dl><a class="supplier-line" href="#/supplier/${esc(p.supplierId || p.companyId)}"><span class="avatar">厂</span><span><strong>${esc(p.companyName || '认证供货商')}</strong><small>查看厂家资料和在架货源</small></span>${icon('arrow')}</a><div class="detail-actions"><button class="btn primary" id="contact-supplier">${icon('message')}添加厂家微信</button><button class="btn" id="save-product">${icon('bookmark')}收藏</button></div><p class="tiny muted">货源为开发演示数据，不代表真实库存或合作关系。点击联系会记录联系意向，不记为已加微信。</p></section></div>`,
    bind(root) {
      root
        .querySelectorAll('[data-photo]')
        .forEach(
          (b) => (b.onclick = () => (root.querySelector('.main-product-photo img').src = b.dataset.photo))
        );
      root.querySelector('#save-product').onclick = () => {
        event('save', p.id, 'product');
        toast('收藏意向已记录。');
      };
      root.querySelector('#contact-supplier').onclick = (e) =>
        submit(e.currentTarget, async () => {
          const result = await post('/leads', { supplierId: p.supplierId || p.companyId, productId: p.id });
          const lead = result.lead || result;
          const m = modal(
            '联系厂家',
            `<div class="contact-company"><h3>${esc(p.companyName || '供货方')}</h3><p>先说清风格、数量、预算和希望到货时间。</p></div>${contactFields(result.contact)}<a class="btn primary full" href="#/leads" data-close>查看联系记录</a>`
          );
          bindContact(m);
          event('contact', p.id, 'product');
        });
    }
  };
}

export async function supplier(ctx) {
  const result = await get('/products'),
    id = ctx.args[1],
    products = itemsOf(result).filter((p) => String(p.supplierId || p.companyId) === id);
  const first = products[0] || {};
  return {
    html: `<div class="supplier-profile panel"><span class="avatar large">厂</span><div><div class="label-row">${badge('厂家资料', 'subtle')}${badge('开发示例')}</div><h1>${esc(first.companyName || '供货方资料')}</h1><p>${esc(first.origin || '产地待完善')} · ${esc(first.style || '风格待完善')}</p></div></div><div class="section-line"><h2>在架货源 <span>${products.length} 款</span></h2></div><div class="product-grid">${products.map(productCard).join('')}</div>`
  };
}

export async function fairList() {
  const r = await get('/fairs'),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        '订货会',
        '集中看样、先确认条件再安排出行。',
        isSupplier() ? '<a class="btn primary" href="#/publish?kind=fair">发布订货会</a>' : ''
      ) +
      `<div class="fair-grid">${items.map((f) => `<a class="fair-card" href="#/fair/${esc(f.id)}">${img(f.image, f.title)}<div><span class="eyebrow">${esc(f.location || f.city || '地点待补充')}</span><h2>${esc(f.title)}</h2><p>${esc(f.date || '具体日期待确认')}</p><span class="text-link">查看活动 ${icon('arrow')}</span></div></a>`).join('')}</div>`
  };
}
export async function fair(ctx) {
  const r = await get('/fairs/' + encodeURIComponent(ctx.args[1])),
    f = r.item || r.fair || r;
  return {
    html: `<article class="fair-detail"><div class="fair-detail-cover">${img(f.image, f.title)}<div class="fair-cover-caption">${badge('订货会招募')}<h1>${esc(f.title)}</h1><p>${esc(f.companyName || '示例活动方')}</p></div></div><div class="fair-detail-columns"><div class="panel article-prose"><h2>一起把货盘看清楚</h2>${String(
      f.body || f.description || '围绕适合门店的风格、价格带与供货条件集中看样。'
    )
      .split('\n')
      .map((p) => `<p>${esc(p)}</p>`)
      .join(
        ''
      )}<h3>参加前请确认</h3><p>本页展示活动组织流程，不发生在线交易。请先核对官方日期、地址与参加条件。</p></div><aside class="panel fair-registration"><dl class="spec-list"><div><dt>时间</dt><dd>${esc(f.date || '待确认')}</dd></div><div><dt>地点</dt><dd>${esc(f.location || f.city || '待确认')}</dd></div><div><dt>参加方式</dt><dd>免费登记意向</dd></div></dl><button class="btn primary full" id="register-fair">登记参加意向</button><p class="tiny muted">不收取报名费，记录保存在演示数据库。</p></aside></div></article>`,
    bind(root) {
      root.querySelector('#register-fair').onclick = async (e) => {
        const button = e.currentTarget;
        const result = await submit(button, async () => {
          const r = await post('/fairs/' + encodeURIComponent(f.id) + '/register', {});
          toast(r.deduplicated ? '你已登记过本场订货会，无需重复登记。' : '参加意向已记录。');
          return r;
        });
        if (result) button.textContent = '已登记意向';
      };
    }
  };
}
