import { get, post, itemsOf, event } from '../core/api.js';
import { state, feature } from '../core/state.js';
import { icon } from '../components/icons.js';
import {
  esc,
  img,
  badge,
  pageHead,
  articleCard,
  empty,
  errorBlock,
  toast,
  submit
} from '../components/ui.js';

export async function feed(ctx) {
  if (!feature('content'))
    return {
      html:
        pageHead('资讯') +
        empty(
          '资讯正在调整',
          '你可以继续浏览货源或管理自己的资料。',
          '<a class="btn" href="#/sources">去找货源</a>'
        )
    };
  const query = ctx.query.get('q') || '',
    category = ctx.query.get('category') || '';
  let items = [],
    recommendation = null;
  const results = await Promise.allSettled([
    get('/content?' + new URLSearchParams({ query, category })),
    feature('recommendations') ? get('/recommendations?kind=content') : Promise.resolve(null)
  ]);
  if (results[0].status === 'rejected')
    return {
      html: pageHead('资讯', '行业消息与同行的经营经验') + errorBlock(results[0].reason.message, '/info')
    };
  items = itemsOf(results[0].value);
  if (results[1].status === 'fulfilled') recommendation = results[1].value;
  const categories = ['推荐', '行业资讯', '经营方法', '拿货选品', '大店方法', '一起游学', '店主经验'];
  if (!category && !query && recommendation?.items?.length) items = recommendation.items;
  return {
    html: `${pageHead('发现，下一步怎么做', '行业资讯、货源线索与门店里的真实问题。', '<a class="btn primary" href="#/publish?kind=content">' + icon('plus') + '发布资讯</a>')}<nav class="content-tabs" aria-label="资讯频道">${categories.map((c, i) => `<a class="${category === c || (!category && i === 0) ? 'active' : ''}" href="#/info${i ? '?category=' + encodeURIComponent(c) : ''}">${c}</a>`).join('')}</nav><div class="feed-toolbar"><span>${query ? '搜索“' + esc(query) + '” · ' : ''}${items.length} 篇内容</span><span>${recommendation?.strategy ? badge(recommendation.strategy, 'subtle') : ''}<button class="text-button" id="recommendation-preferences">调整偏好 ${icon('settings')}</button></span></div>${items.length ? `<div class="note-grid">${items.map(articleCard).join('')}</div>` : empty('没有找到相关内容', '试试其他关键词或频道。', '<a class="btn" href="#/info">查看全部资讯</a>')}`,
    bind(root) {
      root.querySelector('#recommendation-preferences').onclick = () => (location.hash = '/tags');
      if (query) event('search', query, 'content');
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              event('exposure', entry.target.dataset.contentId, 'content');
              observer.unobserve(entry.target);
            }
        },
        { threshold: 0.35 }
      );
      root.querySelectorAll('.note-card').forEach((el, i) => {
        el.dataset.contentId = items[i]?.id;
        observer.observe(el);
      });
      return () => observer.disconnect();
    }
  };
}

export async function article(ctx) {
  const data = await get('/content/' + encodeURIComponent(ctx.args[1])),
    a = data.item || data.content || data;
  event('click', a.id, 'content');
  let visibleStarted = document.hidden ? null : Date.now(),
    visibleMs = 0;
  const markVisibility = () => {
    if (visibleStarted !== null) visibleMs += Date.now() - visibleStarted;
    visibleStarted = document.hidden ? null : Date.now();
  };
  return {
    html: `<article class="article-layout"><div class="article-main">${badge(a.category || '经营分享')}<h1>${esc(a.title)}</h1><div class="article-byline"><strong>${esc(a.author || '七叔内容团队')}</strong><span>${esc(a.createdAt ? new Date(a.createdAt).toLocaleDateString('zh-CN') : '资料整理')}</span>${a.demo ? badge('示例内容', 'subtle') : ''}</div>${a.image || a.cover ? img(a.image || a.cover, a.title, 'article-hero') : ''}<div class="article-prose">${String(
      a.body || a.content || a.summary || '内容待补充。'
    )
      .split('\n')
      .filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`)
      .join(
        ''
      )}</div>${a.source ? `<div class="source-note">资料来源：${/^https?:/.test(a.source) ? `<a href="${esc(a.source)}" target="_blank" rel="noopener noreferrer">查看原始资料 ${icon('arrow')}</a>` : esc(a.source)}</div>` : ''}<div class="article-actions"><button class="btn" id="save-article">${icon('bookmark')}收藏这篇</button><a class="btn light" href="#/publish?kind=content">分享我的经验</a></div></div><aside class="article-rail"><div class="panel"><span class="eyebrow">回到店里怎么用</span><h3>先结合你的经营条件</h3><p>把客群、预算和团队情况一起考虑，再决定哪些做法值得试。</p><a class="text-link" href="#/diagnosis">带着问题做一次诊断 ${icon('arrow')}</a></div><div class="panel"><h3>找与你的店匹配的货</h3><p>按风格、产地和拿货条件逐项筛选。</p><a class="text-link" href="#/sources">进入货源广场 ${icon('arrow')}</a></div></aside></article>`,
    bind(root) {
      root.querySelector('#save-article').onclick = () => {
        event('save', a.id, 'content');
        toast('已记录收藏意向，可在行为记录中查看。');
      };
      document.addEventListener('visibilitychange', markVisibility);
      return () => {
        if (visibleStarted !== null) visibleMs += Date.now() - visibleStarted;
        document.removeEventListener('visibilitychange', markVisibility);
        const duration = Math.round(visibleMs / 1000);
        if (duration > 2) event('dwell', a.id, 'content', Math.min(duration, 600));
      };
    }
  };
}
