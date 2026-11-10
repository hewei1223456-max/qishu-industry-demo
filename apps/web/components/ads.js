import { state, feature } from '../core/state.js';
import { esc, img, badge, modal } from './ui.js';
const destination = (href) =>
  String(href || '/sources').startsWith('https://')
    ? href
    : '#' + String(href || '/sources').replace(/^#/, '');
function markup(a) {
  return `<a class="placement-card" href="${esc(destination(a.href))}"><div class="placement-visual">${img(a.image, a.title)}${badge(a.disclosure || '商业推广', 'subtle')}</div><div class="placement-copy"><h3>${esc(a.title)}</h3>${a.subtitle ? `<p>${esc(a.subtitle)}</p>` : ''}<span>了解详情 →</span></div></a>`;
}
export function renderPlacements(ctx, root) {
  if (!feature('ads') || !['info', 'sources'].includes(ctx.args[0])) return;
  const ads = (state.config.ads || []).filter((a) => a.enabled === true);
  const top = ads.find((a) => a.position === 'top');
  if (top) root.insertAdjacentHTML('afterbegin', `<div class="top-placement">${markup(top)}</div>`);
  const inline = ads.find((a) => a.position === 'content');
  if (inline && ctx.args[0] === 'info')
    root
      .querySelector('.note-grid')
      ?.insertAdjacentHTML(
        'afterbegin',
        `<article class="note-card placement-note">${markup(inline)}</article>`
      );
  const splash = ads.find((a) => a.position === 'splash');
  if (splash) {
    const key = 'qishu-splash:' + splash.id;
    let seen = false;
    try {
      seen = !!sessionStorage.getItem(key);
      sessionStorage.setItem(key, '1');
    } catch {}
    if (!seen) modal(splash.disclosure || '商业推广', markup(splash), 'splash-modal');
  }
}
