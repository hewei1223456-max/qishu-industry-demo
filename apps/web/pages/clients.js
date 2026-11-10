import { get, post, patch, itemsOf, event } from '../core/api.js';
import { state, feature } from '../core/state.js';
import { icon } from '../components/icons.js';
import {
  esc,
  badge,
  avatar,
  pageHead,
  empty,
  modal,
  closeModal,
  toast,
  submit,
  field,
  formData,
  contactFields,
  bindContact
} from '../components/ui.js';
const detail = (b) =>
  `<div class="buyer-detail-head">${avatar(b.name, 'large')}<div><span class="eyebrow">${esc(b.city || '城市待完善')} · ${esc(b.style || '风格待完善')}</span><h2>${esc(b.shop || b.name)}</h2><p>${esc(b.name || '示例店主')} · 公开经营需求</p></div>${badge('示例资料', 'subtle')}</div><div class="buyer-detail-body"><dl class="buyer-stats">${[
    ['店铺面积', b.area],
    ['主要客群', b.customerAge],
    ['零售价带', b.priceBand]
  ]
    .map(([a, v]) => `<div><dt>${a}</dt><dd>${esc(v || '待补充')}</dd></div>`)
    .join(
      ''
    )}</dl><section><h3>这次想找什么</h3><h4>${esc(b.need || '希望了解适合本店的货源')}</h4><p>${esc(b.description || b.body || '欢迎提供与公开需求有关的实拍、拿货价、起批量和交期，先对照条件，再安排看样。')}</p><div class="chip-row">${(b.tags || []).map((t) => badge(t, 'subtle')).join('')}</div></section><section><h3>沟通前准备</h3><p>明确你能提供的风格、预算范围和补单条件。请只围绕公开需求联系，不发送无关信息。</p></section></div><div class="buyer-detail-footer"><button class="btn primary" data-contact="${esc(b.id)}">${icon('message')}针对需求主动联系</button><p class="tiny muted">真实扣次由后端处理，同一需求重复提交不会反复扣减。</p></div>`;
export async function buyers(ctx) {
  if (!feature('buyers'))
    return {
      html:
        pageHead('找客户') +
        empty(
          '找客户功能暂时关闭',
          '你仍可管理自己的货源和分享内容。',
          '<a class="btn" href="#/creator">去创作中心</a>'
        )
    };
  const [br, qr] = await Promise.all([get('/buyers?' + ctx.query), get('/quota')]);
  const buyers = itemsOf(br),
    quota = qr.quota || qr;
  const selected = buyers[0];
  const cities = [...new Set(buyers.map((x) => x.city).filter(Boolean))];
  return {
    html: `${pageHead('找到适配的店主，先把需求聊清楚', '从公开经营条件出发，联系真正适合的门店。', '<a class="btn light" href="#/leads">联系与回访记录</a>')}<div class="quota-strip"><div><strong>${esc(typeof quota.plan === 'object' ? quota.plan.name : quota.plan || '免费体验权益')}</strong><span>今日主动联系 <b id="quota-used">${quota.used ?? 0}</b> / ${quota.limit ?? 10} 次</span><span>剩余 <b id="quota-remaining">${quota.remaining ?? (quota.limit ?? 10) - (quota.used ?? 0)}</b> 次</span></div><a href="#/my/rights" class="text-link">查看权益 ${icon('arrow')}</a></div><form id="buyers-filters" class="buyer-filters panel"><label class="search-field">${icon('search')}<input name="query" placeholder="搜索店主、店铺或拿货需求" value="${esc(ctx.query.get('query') || '')}" aria-label="搜索店主"></label><label><span>城市</span><select name="city"><option value="">全部</option>${cities.map((c) => `<option ${ctx.query.get('city') === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label><span>风格</span><select name="style"><option value="">全部</option>${(state.dictionaries.styles || []).map((c) => `<option ${ctx.query.get('style') === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><button class="btn primary">筛选</button><a href="#/buyers" class="text-button">重置</a></form><div class="feed-toolbar"><span>公开店主需求 · ${buyers.length} 位</span><span>查看资料 → 对照条件 → 主动联系</span></div>${
      buyers.length
        ? `<div class="buyer-workspace"><div class="buyer-list">${buyers
            .map(
              (b, i) =>
                `<article class="buyer-card ${i === 0 ? 'selected' : ''}" data-buyer-card="${esc(b.id)}"><button class="buyer-open" data-buyer="${esc(b.id)}"><div class="buyer-card-head">${avatar(b.name)}<div><h3>${esc(b.name)}</h3><p>${esc(b.shop || '示例女装店')} · ${esc(b.city)}</p></div></div><div class="buyer-traits">${esc(b.style || '')} <span>·</span> ${esc(b.area || '面积待完善')}</div><h4>${esc(b.need || '寻找适配货源')}</h4><div class="chip-row">${(
                  b.tags || []
                )
                  .slice(0, 3)
                  .map((t) => badge(t, 'subtle'))
                  .join(
                    ''
                  )}</div></button><footer><span class="tiny muted">公开需求 · 开发示例</span><button class="btn small primary" data-contact="${esc(b.id)}">主动联系</button></footer></article>`
            )
            .join('')}</div><aside class="buyer-detail">${detail(selected)}</aside></div>`
        : empty('暂时没有匹配的店主', '放宽城市或风格，重新查看公开需求。')
    }`,
    bind(root) {
      const contact = async (button, id) =>
        submit(button, async () => {
          const r = await post('/leads', { buyerId: id });
          const b = buyers.find((x) => x.id === id);
          const q = r.quota || {};
          if (root.querySelector('#quota-used'))
            root.querySelector('#quota-used').textContent = q.used ?? quota.used;
          if (root.querySelector('#quota-remaining'))
            root.querySelector('#quota-remaining').textContent = q.remaining ?? quota.remaining;
          const m = modal(
            '联系意向已保存',
            `<div class="contact-company"><h3>${esc(b?.shop || b?.name || '店主')}</h3><p>${esc(b?.need || '围绕这次公开需求继续沟通。')}</p></div>${contactFields(r.contact)}<a class="btn primary full" href="#/leads">去填写回访记录 ${icon('arrow')}</a>`
          );
          bindContact(m);
        });
      const onClick = (e) => {
        const selectButton = e.target.closest('[data-buyer]');
        if (selectButton) {
          const b = buyers.find((x) => x.id === selectButton.dataset.buyer);
          if (!b) return;
          if (matchMedia('(max-width:900px)').matches) {
            const m = modal('店主拿货需求', detail(b), 'buyer-detail-modal');
            m.querySelector('[data-contact]').onclick = (e) => contact(e.currentTarget, b.id);
          } else {
            const scrollY = window.scrollY;
            root.querySelector('.buyer-detail').innerHTML = detail(b);
            root
              .querySelectorAll('[data-buyer-card]')
              .forEach((el) => el.classList.toggle('selected', el.dataset.buyerCard === b.id));
            window.scrollTo({ top: scrollY, behavior: 'instant' });
          }
          return;
        }
        const b = e.target.closest('[data-contact]');
        if (b) contact(b, b.dataset.contact);
      };
      root.addEventListener('click', onClick);
      root.querySelector('#buyers-filters').onsubmit = (e) => {
        e.preventDefault();
        const params = new URLSearchParams();
        for (const [k, v] of new FormData(e.target)) if (v) params.set(k, v);
        location.hash = '/buyers?' + params.toString();
      };
    }
  };
}

export async function leads() {
  const r = await get('/leads'),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        '联系记录与回访',
        '把联系意向、实际反馈与后续动作分开记录。',
        '<a class="btn light" href="#/my/rights">当前权益</a>'
      ) +
      `<div class="panel table-panel"><div class="table-heading"><h2>跟进中的联系</h2><span>${items.length} 条</span></div>${items.length ? `<div class="table-scroll"><table><thead><tr><th>联系对象</th><th>来源与记录</th><th>状态</th><th>最近时间</th><th>操作</th></tr></thead><tbody>${items.map((l) => `<tr><td><strong>${esc(l.buyerName || l.supplierName || l.name || l.buyerId || l.supplierId)}</strong><small>${esc(l.shop || l.companyName || '')}</small></td><td>${esc(l.note || l.productTitle || '主动联系意向')}<small>${l.duplicate ? '已存在记录 · 未重复扣次' : '不代表已加好友或已成交'}</small></td><td>${badge(l.status || '待回访', l.status === '已回访' ? 'positive' : 'subtle')}</td><td>${esc(new Date(l.updatedAt || l.createdAt || Date.now()).toLocaleDateString('zh-CN'))}</td><td><button class="btn small" data-edit-lead="${esc(l.id)}">回访记录</button></td></tr>`).join('')}</tbody></table></div>` : empty('尚未发起联系', '在厂家或店主需求中发起联系后，这里会保留记录。')}</div>`,
    bind(root) {
      root.querySelectorAll('[data-edit-lead]').forEach(
        (b) =>
          (b.onclick = () => {
            const l = items.find((x) => x.id === b.dataset.editLead);
            const m = modal(
              '记录回访',
              `<form id="lead-form"><label class="field"><span>跟进状态</span><select name="status">${['待回访', '已回访', '待跟进', '无效', '关闭'].map((s) => `<option ${l.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>${field('实际反馈和下一步', 'note', l.note || '', 'textarea', 'rows="5" required')}<p class="tiny muted">只记录实际反馈；未确认的信息请保留为未知。</p><button class="btn primary full">保存回访</button></form>`
            );
            m.querySelector('form').onsubmit = (e) => {
              e.preventDefault();
              submit(e.submitter, async () => {
                await patch('/leads/' + l.id, formData(e.target));
                toast('回访记录已保存。');
                closeModal();
                window.dispatchEvent(new Event('qishu:refresh'));
              });
            };
          })
      );
    }
  };
}
