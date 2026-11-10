import { icon } from './icons.js';
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
export const statusLabel = (text) =>
  ({
    draft: '草稿',
    pending: '待审核',
    approved: '审核通过',
    rejected: '审核未通过',
    needs_info: '待补资料',
    published: '已发布',
    hidden: '已隐藏',
    active: '已启用',
    disabled: '已停用',
    queued: '排队中',
    running: '处理中',
    processing: '拆解中',
    completed: '已完成',
    failed: '失败',
    parsed: '待确认',
    understanding: '理解中',
    interrupted: '已中断',
    'pending-binding': '待本人绑定'
  })[text] || text;
export const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(statusLabel(text))}</span>`;
export const avatar = (name, cls = '') =>
  `<span class="avatar ${cls}">${esc(String(name || '七').slice(0, 1))}</span>`;
export const money = (n) =>
  n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n))
    ? '¥' + Number(n).toLocaleString('zh-CN')
    : '认证后可见';
const imagePlaceholder = (label, cls = '', hidden = false) =>
  `<span class="media-placeholder ${esc(cls)}" role="img" aria-label="${esc(label)}" ${hidden ? 'hidden' : ''}>${icon('image')}<span>${esc(label)}</span></span>`;
export function img(src, alt = '', cls = '', missingLabel = '暂无图片') {
  if (!String(src || '').trim()) return imagePlaceholder(missingLabel, cls);
  return `<img class="${esc(cls)}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onload="this.style.removeProperty('display');this.nextElementSibling.hidden=true" onerror="this.style.display='none';this.nextElementSibling.hidden=false">${imagePlaceholder('图片暂不可用', cls, true)}`;
}
export const empty = (title = '暂无内容', desc = '', action = '') =>
  `<div class="empty-state">${icon('folder')}<h3>${esc(title)}</h3><p>${esc(desc)}</p>${action}</div>`;
export const errorBlock = (message, retry = '') =>
  `<div class="error-state">${icon('refresh')}<div><strong>这个模块暂时没有响应</strong><p>${esc(message || '其他功能可以继续使用。')}</p></div>${retry ? `<a class="btn small" href="#${retry}">重新载入</a>` : ''}</div>`;
export const pageHead = (title, sub = '', actions = '') =>
  `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
export function toast(text) {
  const el = document.querySelector('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}
export function modal(title, html, cls = '') {
  const root = document.querySelector('#modal-root');
  if (!history.state?.qishuModal)
    history.pushState({ ...history.state, qishuModal: true }, '', location.href);
  root.innerHTML = `<div class="modal-overlay"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="icon-button" data-close-modal aria-label="关闭">${icon('close')}</button></header>${html}</section></div>`;
  const close = () => closeModal();
  root.querySelector('[data-close-modal]').onclick = close;
  root.querySelector('.modal-overlay').onclick = (e) => {
    if (e.target.classList.contains('modal-overlay')) close();
  };
  root.onclick = (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (a && history.state?.qishuModal) {
      e.preventDefault();
      root.innerHTML = '';
      const next = a.getAttribute('href');
      history.replaceState(null, '', next);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  };
  root.querySelector('button,input,textarea')?.focus({ preventScroll: true });
  return root.querySelector('.modal');
}
export function closeModal(navigate = true) {
  const root = document.querySelector('#modal-root');
  const open = !!root?.firstElementChild;
  if (root) root.innerHTML = '';
  if (navigate && history.state?.qishuModal) {
    history.back();
  } else if (!navigate && history.state?.qishuModal) {
    const { qishuModal, ...base } = history.state;
    history.replaceState(base, '');
  }
  return open;
}
if (typeof window !== 'undefined')
  window.addEventListener('popstate', () => {
    const root = document.querySelector('#modal-root');
    if (root?.firstElementChild && !history.state?.qishuModal) root.innerHTML = '';
  });
export function field(label, name, value = '', type = 'text', extra = '') {
  const id = 'f-' + name;
  return `<label class="field" for="${id}"><span>${esc(label)}</span>${type === 'textarea' ? `<textarea id="${id}" name="${name}" ${extra}>${esc(value)}</textarea>` : `<input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`}</label>`;
}
export function select(label, name, values, value = '') {
  return `<label class="field"><span>${esc(label)}</span><select name="${name}"><option value="">全部</option>${values
    .map((x) => {
      const v = typeof x === 'object' ? (x.value ?? x.id ?? x.name) : x;
      const text = typeof x === 'object' ? (x.label ?? x.name ?? v) : x;
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
    })
    .join('')}</select></label>`;
}
export const formData = (form) => Object.fromEntries(new FormData(form));
export async function submit(button, operation) {
  const old = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = '处理中…';
  try {
    return await operation();
  } catch (e) {
    toast(e.message);
    return null;
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = old;
    }
  }
}
export function productCard(p) {
  return `<a class="product-card" href="#/product/${esc(p.id)}"><div class="product-image">${img(p.image || p.images?.[0], p.title, '', '暂无款图')}<span class="photo-tag">${esc(p.style || p.category || '货源')}</span>${p.status === '预售' ? '<span class="photo-state">预售</span>' : ''}</div><div class="product-info"><h3>${esc(p.title)}</h3><div class="product-meta"><span>${esc(p.origin || '产地待补充')}</span><span>${p.moq ? esc(p.moq) + '件起' : '起批量待补充'}</span></div><div class="price-row"><strong>${money(p.price)}</strong><span>${esc(p.companyName || '认证供货商')}</span></div></div></a>`;
}
export function articleCard(a, i = 0) {
  return `<article class="note-card"><a class="note-cover ratio-${i % 3}" href="#/article/${esc(a.id)}">${img(a.image || a.cover, a.title, '', '内容笔记 · 暂无封面')}${a.kind === 'video' ? `<span class="play-mark">${icon('play')}</span>` : ''}<span class="photo-tag">${esc(a.category || '经营分享')}</span></a><div class="note-copy"><a href="#/article/${esc(a.id)}"><h3>${esc(a.title)}</h3></a><div class="note-author">${avatar(a.author || '七叔')}<span>${esc(a.author || '七叔内容团队')}</span><span class="like">${icon('heart')} ${esc(a.likes ?? '收藏')}</span></div></div></article>`;
}
export function jsonDescription(value) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function routeLink(path, label, cls = '') {
  return `<a class="${cls}" href="#${path}">${label}</a>`;
}
export function contactFields(contact = {}) {
  return contact.available
    ? `<div class="contact-channels">${(contact.channels || []).map((c) => (c.type === 'qrcode' ? `<figure>${img(c.value, '供货方授权联系二维码')}<figcaption>长按识别授权二维码</figcaption></figure>` : `<div class="contact-channel"><span>${c.type === 'phone' ? '电话' : '微信号'}</span><strong>${esc(c.value)}</strong><button class="btn small" data-copy-contact="${esc(c.value)}">复制</button></div>`)).join('')}</div><p class="tiny muted">复制或识别不会被计为已经添加好友。</p>`
    : `<div class="notice">${esc(contact.message || '当前没有可展示的真实联系方式；联系意向已记录，不代表已加微信。')}</div>`;
}
export function bindContact(root) {
  root.querySelectorAll('[data-copy-contact]').forEach(
    (b) =>
      (b.onclick = () =>
        submit(b, async () => {
          try {
            await navigator.clipboard.writeText(b.dataset.copyContact);
            toast('已复制联系方式。');
          } catch {
            toast('当前浏览器未开放复制，请长按联系方式选择复制。');
          }
        }))
  );
}
export function certificationPrecheck(application, compact = false) {
  const p = application.precheck || {},
    e = p.extracted,
    c = p.consistency || {},
    status =
      {
        'not-configured': '待配置',
        not_configured: '待配置',
        queued: '排队中',
        running: '识别中',
        processing: '识别中',
        completed: '识别完成',
        failed: '识别失败'
      }[p.ocrStatus] || '尚未识别';
  return `<div class="cert-precheck" data-cert-id="${esc(application.id)}"><details ${compact ? '' : 'open'}><summary><span>AI辅助预审</span>${badge(status, p.ocrStatus === 'failed' || /not.configured/.test(p.ocrStatus || '') ? 'warning' : 'subtle')}</summary><div class="cert-precheck-body">${p.jobId ? `<p class="cert-job-id">任务：${esc(p.jobId)}</p>` : ''}${p.industryScope ? `<p class="cert-rule">填报范围规则：${esc(p.industryScope)}</p>` : ''}${
    e
      ? `<dl class="cert-extracted">${[
          ['识别主体名称', e.companyName],
          ['识别经营范围', e.businessScope],
          ['识别信用代码', e.registrationNumber],
          ['主体名称对照', c.company],
          ['经营范围对照', c.scope],
          ['行业准入提示', c.industry]
        ]
          .map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value || '未识别或未返回')}</dd></div>`)
          .join(
            ''
          )}</dl>${e.uncertainFields?.length ? `<p class="cert-uncertain">待人工核对：${esc(e.uncertainFields.join('、'))}</p>` : ''}`
      : ''
  }${p.error ? `<p class="cert-ocr-error">${esc(p.error.message || p.error)}</p>` : ''}<p class="cert-precheck-notice">${esc(p.notice || 'AI仅辅助识别和信息对照，未验证执照真伪，最终由人工审核。')}</p><button type="button" class="btn small" data-refresh-cert="${esc(application.id)}">刷新预审状态</button></div></details></div>`;
}
