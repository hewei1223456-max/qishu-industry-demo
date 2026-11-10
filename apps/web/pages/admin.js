import { get, post, patch, put, del, itemsOf } from '../core/api.js';
import { state, refresh } from '../core/state.js';
import { icon } from '../components/icons.js';
import {
  esc,
  badge,
  pageHead,
  empty,
  toast,
  modal,
  closeModal,
  submit,
  field,
  formData,
  jsonDescription,
  certificationPrecheck
} from '../components/ui.js';

export { adminMenus } from '../core/menus.js';
const fields = {
  content: [
    ['标题', 'title'],
    ['频道', 'category'],
    ['正文', 'body', 'textarea'],
    ['封面图片地址', 'image'],
    ['作者', 'author'],
    ['状态', 'status', 'status']
  ],
  products: [
    ['款式名称', 'title'],
    ['品类', 'category'],
    ['产地', 'origin'],
    ['风格', 'style'],
    ['拿货价', 'price', 'number'],
    ['起批量', 'moq', 'number'],
    ['厂家主体', 'companyId'],
    ['厂家名称', 'companyName'],
    ['图片地址', 'image'],
    ['供货状态', 'supplyStatus', 'supply'],
    ['审核状态', 'status', 'status'],
    ['交期', 'delivery'],
    ['描述与条件', 'body', 'textarea']
  ],
  fairs: [
    ['主题', 'title'],
    ['地点', 'location'],
    ['时间说明', 'date'],
    ['厂家名称', 'companyName'],
    ['图片地址', 'image'],
    ['活动与条件', 'body', 'textarea'],
    ['状态', 'status', 'status']
  ],
  buyers: [
    ['店主称呼', 'name'],
    ['店铺', 'shop'],
    ['城市', 'city'],
    ['风格', 'style'],
    ['面积', 'area'],
    ['客群年龄', 'customerAge'],
    ['零售价带', 'priceBand'],
    ['公开拿货需求', 'need', 'textarea']
  ],
  plans: [
    ['版本名称', 'name'],
    ['每日主动联系次数', 'dailyLimit', 'number'],
    ['联系能力（逗号分隔：wechat、phone、qrcode）', 'contactMethods'],
    ['版本说明', 'description', 'textarea']
  ],
  entitlements: [
    ['用户账号ID', 'userId'],
    ['厂家主体ID', 'companyId'],
    ['权益版本', 'planId'],
    ['每日额度', 'dailyLimit', 'number'],
    ['到期时间', 'expiresAt'],
    ['线下确认依据', 'note', 'textarea']
  ],
  providers: [
    ['渠道名称', 'name'],
    ['供应商', 'provider'],
    ['适配器', 'adapter'],
    ['接口基础地址', 'baseUrl'],
    ['模型名称', 'model'],
    ['调用优先级（数值小优先）', 'priority', 'number'],
    ['渠道系统提示词', 'systemPrompt', 'textarea'],
    ['能力（逗号分隔）', 'capabilities'],
    ['API Key（留空不修改）', 'apiKey', 'password']
  ],
  knowledge: [
    ['知识标题', 'title'],
    ['知识范围', 'scope'],
    ['知识正文', 'body', 'textarea']
  ],
  admins: [
    ['姓名', 'name'],
    ['授权手机号', 'phone'],
    ['角色', 'role'],
    ['权限（逗号分隔；*最高，例content:read、content:write）', 'permissions'],
    ['状态', 'status', 'status']
  ],
  certifications: [
    ['主体名称', 'company'],
    ['经营范围', 'scope', 'textarea'],
    ['审核意见', 'reason', 'textarea'],
    ['状态', 'status', 'certStatus']
  ]
};
const titles = {
  content: '资讯内容',
  products: '货源管理',
  fairs: '订货会',
  buyers: '公开店主资料',
  plans: '版本方案',
  entitlements: '线下权益开通',
  providers: '模型渠道',
  knowledge: '平台知识',
  admins: '管理员授权',
  certifications: '经营资质审核'
};
const friendly = {
  users: '用户',
  products: '货源',
  content: '内容',
  fairs: '订货会',
  leads: '联系意向',
  jobs: 'AI任务',
  pendingCertifications: '待审核主体',
  pendingContent: '待审核内容',
  totalUsers: '用户数',
  totalProducts: '货源数',
  totalContent: '内容数',
  totalLeads: '联系意向',
  totalJobs: 'AI任务',
  certifications: '认证申请',
  providers: '模型渠道',
  audit: '操作记录',
  recommendation: '推荐服务'
};
const statValue = (v) =>
  typeof v === 'object' ? (Array.isArray(v) ? v.length : (v?.count ?? Object.keys(v || {}).length)) : v;
const refreshPage = () => window.dispatchEvent(new Event('qishu:refresh'));

export async function overview() {
  let metrics = {};
  try {
    metrics = await get('/admin/metrics');
  } catch {}
  const queues = await Promise.allSettled([
    get('/admin/certifications'),
    get('/admin/content'),
    get('/jobs')
  ]);
  const certs = queues[0].status === 'fulfilled' ? itemsOf(queues[0].value) : [],
    content = queues[1].status === 'fulfilled' ? itemsOf(queues[1].value) : [],
    jobs = queues[2].status === 'fulfilled' ? itemsOf(queues[2].value) : [];
  const stats = [
    [
      '待审经营资质',
      certs.filter((x) => !['approved', 'rejected'].includes(x.status)).length,
      '/admin/users'
    ],
    ['待审核内容', content.filter((x) => x.status === 'pending').length, '/admin/content'],
    [
      'AI待处理与失败',
      jobs.filter((x) => !['completed', 'succeeded'].includes(x.status)).length,
      '/admin/providers?tab=jobs'
    ],
    ['当前配置版本', state.config.version || 1, '/admin/config']
  ];
  return {
    html:
      pageHead(
        '先处理影响用户使用的事情',
        '平台运营工作台 · 测试数据库实时记录',
        '<a class="btn light" href="#/info">查看用户端</a>'
      ) +
      `<div class="admin-stats">${stats.map(([n, v, p]) => `<a class="panel" href="#${p}"><span>${n}</span><strong>${v}</strong><small>查看处理 ${icon('arrow')}</small></a>`).join('')}</div><div class="admin-overview-grid"><section class="panel table-panel"><div class="table-heading"><h2>待审核主体</h2><a class="text-link" href="#/admin/users">全部审核 ${icon('arrow')}</a></div>${
        certs.length
          ? `<div class="queue-list">${certs
              .slice(0, 5)
              .map(
                (x) =>
                  `<a href="#/admin/users"><div><strong>${esc(x.company || x.companyName || x.id)}</strong><small>${esc(x.scope || '经营范围待核对')}</small></div>${badge(x.status || 'pending', 'subtle')}</a>`
              )
              .join('')}</div>`
          : empty('暂无待审申请', '提交真实测试资料后会进入此队列。')
      }</section><section class="panel"><h2>运行与接入状态</h2><div class="health-list"><div><span>业务数据</span>${badge('本地数据库', 'positive')}</div><div><span>微信正式登录</span>${badge('待AppID与凭证', 'subtle')}</div><div><span>模型渠道</span>${badge((state.providers?.filter((x) => x.configured || x.hasKey).length || 0) + ' 个已配置', 'subtle')}</div><div><span>权益收款</span>${badge('线下确认后开通', 'subtle')}</div></div><a class="text-link" href="#/admin/providers">管理模型与任务 ${icon('arrow')}</a></section></div><section class="panel"><h2>运营快捷操作</h2><div class="admin-shortcuts">${[
        ['/admin/config', '调产地与页面顺序', 'layers'],
        ['/admin/rights', '配置版本及线下开通', 'shield'],
        ['/admin/ads', '编辑轮播和广告', 'flag'],
        ['/admin/knowledge', '维护平台知识与提示词', 'folder']
      ]
        .map(([p, t, i]) => `<a href="#${p}">${icon(i)}<span>${t}</span>${icon('arrow')}</a>`)
        .join('')}</div></section>`
  };
}

export async function resourcePage(resource, ctx) {
  const r = await get('/admin/' + resource),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        titles[resource] || resource,
        resource === 'providers'
          ? 'API Key仅服务端保存，读取时脱敏。未测试渠道不能标作已接入。'
          : resource === 'entitlements'
            ? '仅记录线下购买确认并开通权益，不接商品交易。'
            : '查询、编辑、审核和状态变更均由后端保存。',
        fields[resource]
          ? `<button class="btn primary" id="new-resource">${icon('plus')}${resource === 'entitlements' ? '开通权益' : '新增' + (titles[resource] || '记录')}</button>`
          : ''
      ) +
      resourceTabs(resource, ctx) +
      `<div class="panel table-panel"><div class="table-heading"><h2>${titles[resource] || '记录'}</h2><span>${items.length} 条</span></div>${items.length ? `<div class="table-scroll"><table><thead><tr><th>名称或主体</th><th>业务信息</th><th>状态</th><th>操作</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${esc(item.title || item.name || item.company || item.companyName || item.phone || item.id)}</strong><small>${esc(item.author || item.userId || item.companyId || '')}</small></td><td>${esc(resourceDescription(resource, item))}${resource === 'certifications' ? certificationPrecheck(item, true) : ''}</td><td>${badge(item.status || (item.published === false || item.enabled === false ? '已停用' : resource === 'providers' ? (item.configured || item.hasKey ? '已配置' : '未配置') : '启用'), 'subtle')}</td><td><div class="table-actions">${fields[resource] ? `<button class="btn small" data-edit="${esc(item.id)}">编辑</button>` : ''}${resource === 'certifications' ? `<button class="btn small" data-approve="${esc(item.id)}">通过</button>` : ''}${['content', 'products', 'fairs'].includes(resource) ? `<button class="btn small" data-publish="${esc(item.id)}">发布</button><button class="btn small" data-hide="${esc(item.id)}">隐藏</button>` : ''}${resource === 'providers' ? `<button class="btn small" data-provider-test="${esc(item.id)}">测试</button>` : ''}<button class="text-button danger-text" data-delete="${esc(item.id)}">移除</button></div></td></tr>`).join('')}</tbody></table></div>` : empty('暂无记录', '新增后会保存在测试数据库中。')}</div>`,
    bind(root) {
      if (resource === 'certifications')
        root.addEventListener('click', (e) => {
          const button = e.target.closest('[data-refresh-cert]');
          if (!button) return;
          submit(button, async () => {
            const r = await get('/admin/certifications/' + encodeURIComponent(button.dataset.refreshCert));
            button.closest('.cert-precheck').outerHTML = certificationPrecheck(r.item);
          });
        });
      const edit = (item) => openResourceEditor(resource, item);
      root.querySelector('#new-resource')?.addEventListener('click', () => edit({}));
      root
        .querySelectorAll('[data-edit]')
        .forEach((b) => (b.onclick = () => edit(items.find((x) => x.id === b.dataset.edit))));
      for (const [action, payload] of [
        ['approve', { status: 'approved' }],
        ['publish', { status: 'published', published: true }],
        ['hide', { status: 'hidden', published: false }]
      ])
        root.querySelectorAll('[data-' + action + ']').forEach(
          (b) =>
            (b.onclick = () =>
              submit(b, async () => {
                await patch('/admin/' + resource + '/' + b.dataset[action], payload);
                await refresh();
                refreshPage();
                toast('状态已更新。');
              }))
        );
      root.querySelectorAll('[data-delete]').forEach(
        (b) =>
          (b.onclick = () => {
            const m = modal(
              '移除这条记录？',
              '<p>请确认关联业务不再需要。受保护资源会由服务端拒绝删除，操作会记录审计。</p><button class="btn primary full" id="confirm-delete">确认移除</button>'
            );
            m.querySelector('#confirm-delete').onclick = (e) =>
              submit(e.currentTarget, async () => {
                await del('/admin/' + resource + '/' + b.dataset.delete);
                closeModal();
                await refresh();
                refreshPage();
                toast('记录已移除。');
              });
          })
      );
      root.querySelectorAll('[data-provider-test]').forEach(
        (b) =>
          (b.onclick = () =>
            submit(b, async () => {
              const result = await post('/admin/providers/' + b.dataset.providerTest + '/test', {});
              toast(result.message || result.status || '测试请求已完成，请检查渠道结果。');
            }))
      );
    }
  };
}

function resourceTabs(resource, ctx) {
  let entries = [];
  const area = ctx.args[1];
  if (area === 'content')
    entries = [
      ['content', '资讯内容'],
      ['import', '批量导入']
    ];
  if (area === 'users')
    entries = [
      ['certifications', '资质审核'],
      ['buyers', '公开店主资料'],
      ['admins', '管理员授权']
    ];
  if (area === 'products')
    entries = [
      ['products', '货源'],
      ['fairs', '订货会']
    ];
  if (area === 'rights')
    entries = [
      ['plans', '版本方案'],
      ['entitlements', '线下开通'],
      ['leads', '联系与回访']
    ];
  if (area === 'providers')
    entries = [
      ['providers', '模型渠道'],
      ['jobs', '处理任务']
    ];
  if (area === 'knowledge')
    entries = [
      ['knowledge', '平台知识'],
      ['prompts', '分层提示词']
    ];
  return entries.length
    ? `<div class="sub-tabs">${entries.map(([key, n]) => `<a class="${resource === key ? 'active' : ''}" href="#/admin/${area}?tab=${key}">${n}</a>`).join('')}</div>`
    : '';
}
function resourceDescription(resource, item) {
  if (resource === 'providers')
    return [
      item.provider,
      item.model,
      (item.capabilities || []).join?.('、') || item.capabilities,
      item.maskedKey || ''
    ]
      .filter(Boolean)
      .join(' · ');
  if (resource === 'products')
    return [
      item.origin,
      item.style,
      item.price != null ? '¥' + item.price : '',
      item.moq != null ? item.moq + '件起' : ''
    ]
      .filter(Boolean)
      .join(' · ');
  if (resource === 'plans')
    return `每日主动联系 ${item.dailyLimit ?? item.limit ?? '待配置'} 次 · ${item.description || ''}`;
  if (resource === 'entitlements')
    return `额度 ${item.dailyLimit ?? item.limit ?? '待配置'} · ${item.expiresAt || '有效期待配置'}`;
  return String(
    item.scope || item.category || item.need || item.description || item.location || item.body || ''
  ).slice(0, 90);
}
async function openResourceEditor(resource, item = {}) {
  let suppliers = [],
    plans = [];
  if (['products', 'entitlements'].includes(resource)) {
    const requests = await Promise.allSettled([get('/admin/users'), get('/admin/plans')]);
    if (requests[0].status === 'fulfilled')
      suppliers = itemsOf(requests[0].value).filter((u) => u.role === 'supplier');
    if (requests[1].status === 'fulfilled') plans = itemsOf(requests[1].value);
  }
  const input = (fields[resource] || [])
    .map(([label, key, type]) => {
      let value = item[key] ?? '';
      if (['capabilities', 'contactMethods', 'permissions'].includes(key) && Array.isArray(value))
        value = value.join(',');
      if (key === 'apiKey') value = '';
      if (key === 'companyId' && suppliers.length)
        return `<label class="field"><span>厂家主体</span><select name="companyId"><option value="">请选择厂家</option>${suppliers.map((u) => `<option value="${esc(u.companyId || u.id)}" ${value === (u.companyId || u.id) ? 'selected' : ''}>${esc(u.companyName || u.name)} · ${esc(u.companyId || u.id)}</option>`).join('')}</select></label>`;
      if (key === 'planId' && plans.length)
        return `<label class="field"><span>权益版本</span><select name="planId">${plans.map((p) => `<option value="${esc(p.id)}" ${value === p.id ? 'selected' : ''}>${esc(p.name)} · 每日${p.dailyLimit}次</option>`).join('')}</select></label>`;
      if (['status', 'supply', 'certStatus'].includes(type)) {
        const options =
          type === 'supply'
            ? ['现货', '预售']
            : type === 'certStatus'
              ? ['pending', 'approved', 'rejected', 'needs_info']
              : ['draft', 'pending', 'published', 'hidden', 'active', 'disabled'];
        return `<label class="field"><span>${label}</span><select name="${key}">${options.map((v) => `<option ${value === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
      }
      return field(
        label,
        key,
        value,
        type || 'text',
        type === 'textarea' ? 'rows="5"' : key === 'title' || key === 'name' ? 'required' : ''
      );
    })
    .join('');
  const m = modal(
    (item.id ? '编辑' : '新增') + (titles[resource] || '记录'),
    `<form id="resource-editor">${input}${resource === 'providers' ? `<label class="check-field"><input type="checkbox" name="enabled" ${item.enabled === false ? '' : 'checked'}><span>渠道启用（没有有效配置仍不可调用）</span></label>${item.hasKey ? '<label class="check-field"><input type="checkbox" name="clearKey"><span>清除服务端已保存的密钥</span></label>' : ''}<details class="provider-advanced"><summary>高级接口映射 · custom-json</summary>${field('请求路径', 'requestPath', item.requestPath || '')}${field('JSON请求模板', 'requestTemplate', item.requestTemplate ? JSON.stringify(item.requestTemplate, null, 2) : '', 'textarea', 'rows="6" placeholder="填写供应商实际请求JSON；支持 {{model}} {{prompt}} {{system}} {{task}} {{fileBase64}} {{mimeType}}"')}${field('响应数据路径', 'responsePath', item.responsePath || '')}${field('输出类型', 'resultType', item.resultType || 'text')}<p class="tiny muted">接口路径、模板与返回结构必须与供应商文档一致，保存配置不等于已经完成真实调用。</p></details>` : ''}<button class="btn primary full">保存${titles[resource] || '记录'}</button></form>`,
    'editor-modal'
  );
  m.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    submit(e.submitter, async () => {
      const data = formData(e.target);
      for (const key of ['price', 'moq', 'dailyLimit', 'priority'])
        if (data[key] !== undefined && data[key] !== '') data[key] = Number(data[key]);
      for (const key of ['capabilities', 'contactMethods', 'permissions'])
        if (data[key] !== undefined)
          data[key] = data[key]
            .split(/[,，、]/)
            .map((s) => s.trim())
            .filter(Boolean);
      if (!data.apiKey) delete data.apiKey;
      if (resource === 'products' && data.companyId) data.supplierId = data.companyId;
      if (resource === 'providers') {
        data.enabled = new FormData(e.target).has('enabled');
        data.clearKey = new FormData(e.target).has('clearKey');
        if (data.requestTemplate) {
          try {
            data.requestTemplate = JSON.parse(data.requestTemplate);
          } catch {
            throw new Error('请求模板必须是有效的JSON对象。');
          }
        } else delete data.requestTemplate;
      }
      if (item.id) await patch('/admin/' + resource + '/' + item.id, data);
      else await post('/admin/' + resource, data);
      await refresh();
      closeModal();
      refreshPage();
      toast('已保存，服务端记录已更新。');
    });
  };
}

export async function configuration() {
  const r = await get('/admin/config'),
    config = r.config || r;
  let origins = [...new Set([...(config.originOrder || []), ...(state.dictionaries.origins || [])])];
  const hidden = new Set(config.hiddenOrigins || []);
  const featureLabels = {
    content: '资讯',
    products: '货源广场',
    fairs: '订货会',
    buyers: '厂家找客户',
    diagnosis: '店铺诊断',
    ai: 'AI处理任务',
    recommendations: '个性化推荐',
    ads: '商业展示'
  };
  return {
    html:
      pageHead(
        '页面、频道与产地配置',
        '先预览业务范围，再发布配置。模块关闭只影响对应业务。',
        `<button class="btn light" id="rollback-config">${icon('refresh')}回退上一版</button>`
      ) +
      `<form id="config-form" class="config-layout"><section class="panel"><div class="section-line"><h2>产地顺序与可见性</h2>${badge('配置版本 ' + (config.version || 1), 'subtle')}</div><p class="muted small">春夏主推可前置广州、深圳；隐藏筛选项不会删除历史商品的产地。</p><div class="config-origin-list" id="origin-list">${origins.map((name, i) => `<div class="origin-row" data-origin="${esc(name)}"><label class="check-field"><input type="checkbox" ${hidden.has(name) ? '' : 'checked'}><span>${esc(name)}</span></label><span class="origin-order">${i + 1}</span><button type="button" class="icon-button" data-move="-1" aria-label="上移${esc(name)}">↑</button><button type="button" class="icon-button" data-move="1" aria-label="下移${esc(name)}">↓</button></div>`).join('')}</div><div class="add-inline"><input id="new-origin" placeholder="增加一个产地" aria-label="新产地"><button type="button" class="btn" id="add-origin">添加</button></div><details class="provider-advanced"><summary>风格、品类、标签与筛选区间</summary>${field('风格（每行一项）', 'dictionaryStyles', (config.styles || []).join('\n'), 'textarea', 'rows="4"')}${field('品类（每行一项）', 'dictionaryCategories', (config.categories || []).join('\n'), 'textarea', 'rows="4"')}${field('偏好标签（每行一项）', 'dictionaryTags', (config.tags || []).join('\n'), 'textarea', 'rows="5"')}${field('价格带JSON', 'priceBands', JSON.stringify(config.priceBands || [], null, 2), 'textarea', 'rows="6"')}${field('起批量区间JSON', 'moqBands', JSON.stringify(config.moqBands || [], null, 2), 'textarea', 'rows="5"')}<p class="tiny muted">区间用label、min、max字段，max为null表示不限。保存时会由服务端校验。</p></details></section><aside class="panel"><h2>模块开关</h2><p class="muted small">停用的功能会有明确提示，用户仍可返回和使用其他模块。</p><div class="feature-switches">${Object.entries(
        featureLabels
      )
        .map(
          ([key, n]) =>
            `<label class="setting-line"><span>${n}</span><span class="switch"><input type="checkbox" name="feature-${key}" ${config.features?.[key] !== false ? 'checked' : ''}><span></span></span></label>`
        )
        .join(
          ''
        )}</div>${field('示例免费每日主动联系额度', 'freeDailyLimit', config.freeDailyLimit ?? 10, 'number', 'min="0" max="10000"')}<button class="btn primary full">${icon('check')}发布配置</button><p class="tiny muted">权限和额度仍由后端校验。错误配置不会清空已有有效配置。</p></aside></form>`,
    bind(root) {
      const list = root.querySelector('#origin-list');
      const renumber = () =>
        list.querySelectorAll('.origin-order').forEach((el, i) => (el.textContent = i + 1));
      list.onclick = (e) => {
        const b = e.target.closest('[data-move]');
        if (!b) return;
        const row = b.closest('.origin-row'),
          direction = Number(b.dataset.move);
        if (direction < 0 && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        else if (direction > 0 && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        renumber();
      };
      root.querySelector('#add-origin').onclick = () => {
        const input = root.querySelector('#new-origin'),
          name = input.value.trim();
        if (!name || [...list.children].some((x) => x.dataset.origin === name)) return;
        list.insertAdjacentHTML(
          'beforeend',
          `<div class="origin-row" data-origin="${esc(name)}"><label class="check-field"><input type="checkbox" checked><span>${esc(name)}</span></label><span class="origin-order"></span><button type="button" class="icon-button" data-move="-1" aria-label="上移">↑</button><button type="button" class="icon-button" data-move="1" aria-label="下移">↓</button></div>`
        );
        input.value = '';
        renumber();
      };
      root.querySelector('#config-form').onsubmit = (e) => {
        e.preventDefault();
        submit(e.submitter, async () => {
          const rows = [...list.querySelectorAll('[data-origin]')];
          const next = {
            ...config,
            origins: rows.map((x, order) => ({
              name: x.dataset.origin,
              order,
              visible: x.querySelector('input').checked
            })),
            originOrder: rows.map((x) => x.dataset.origin),
            hiddenOrigins: rows.filter((x) => !x.querySelector('input').checked).map((x) => x.dataset.origin),
            freeDailyLimit: Number(new FormData(e.target).get('freeDailyLimit')),
            features: Object.fromEntries(
              Object.keys(featureLabels).map((key) => [key, new FormData(e.target).has('feature-' + key)])
            )
          };
          const fd = new FormData(e.target);
          for (const [key, name] of [
            ['styles', 'dictionaryStyles'],
            ['categories', 'dictionaryCategories'],
            ['tags', 'dictionaryTags']
          ])
            next[key] = String(fd.get(name) || '')
              .split(/\n/)
              .map((x) => x.trim())
              .filter(Boolean);
          for (const key of ['priceBands', 'moqBands']) {
            try {
              next[key] = JSON.parse(fd.get(key));
            } catch {
              throw Error('筛选区间必须是有效JSON。');
            }
          }
          await put('/admin/config', { config: next });
          const saved = (await get('/admin/config')).config;
          if (saved.originOrder.join('|') !== next.originOrder.join('|'))
            throw Error('产地排序回读不一致，请刷新后重试。');
          await refresh();
          toast('配置已发布并回读确认。');
          refreshPage();
        });
      };
      root.querySelector('#rollback-config').onclick = (e) =>
        submit(e.currentTarget, async () => {
          await post('/admin/config/rollback', {});
          await refresh();
          refreshPage();
          toast('已回退到上一份有效配置。');
        });
    }
  };
}

export { ads } from './ads.js';

export async function recommendations() {
  const r = await get('/recommendations?kind=products'),
    sample = r.items || [];
  return {
    html:
      pageHead(
        '推荐与画像',
        '查看实际召回策略与测试模型。测试效果不代表生产提升。',
        '<button class="btn primary" id="train-model">' + icon('layers') + '运行双塔训练</button>'
      ) +
      `<div class="two-columns"><section class="panel"><span class="eyebrow">当前服务状态</span><h2>${esc(r.strategy || '冷启动策略')}</h2><dl class="spec-list"><div><dt>模型版本</dt><dd>${esc(r.modelVersion || '未提供')}</dd></div><div><dt>候选数</dt><dd>${sample.length}</dd></div><div><dt>训练数据</dt><dd>开发测试样本及授权本站事件</dd></div></dl><div id="training-result" class="notice">点击运行后展示服务端返回的真实训练记录。没有调用不能算已训练。</div></section><section class="panel"><h2>推荐的三层依据</h2><ol class="ordered-flow"><li><strong>初始偏好</strong><p>认证后四至十个标签及主动填写资料。</p></li><li><strong>站内行为</strong><p>搜索、点击、前台有效停留、收藏与联系。</p></li><li><strong>授权融合</strong><p>账号、门店资料和获准使用的知识摘要；不跨主体读取私有原件。</p></li></ol><a class="text-link" href="#/tags">调整当前账号的偏好 ${icon('arrow')}</a></section></div><div class="panel table-panel"><div class="table-heading"><h2>当前召回样本</h2></div><div class="table-scroll"><table><thead><tr><th>货源</th><th>风格与产地</th><th>匹配值</th></tr></thead><tbody>${sample.map((p) => `<tr><td>${esc(p.title || p.id)}</td><td>${esc([p.style, p.origin].filter(Boolean).join(' · '))}</td><td>${(p.recommendationScore ?? p.score) != null ? Number(p.recommendationScore ?? p.score).toFixed(4) : '服务端未提供'}</td></tr>`).join('')}</tbody></table></div></div>`,
    bind(root) {
      root.querySelector('#train-model').onclick = (e) =>
        submit(e.currentTarget, async () => {
          const result = await post('/admin/models/train', {}),
            m = result.model || result;
          root.querySelector('#training-result').innerHTML =
            `<strong>训练记录已返回</strong><div class="metric-details">${Object.entries(m)
              .filter(([k]) => !/vector|weight|embedding/i.test(k))
              .map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(jsonDescription(v))}</strong></div>`)
              .join('')}</div>`;
          toast('训练完成，召回服务已更新。');
        });
    }
  };
}

export async function prompts() {
  const r = await get('/admin/config'),
    config = r.config || r;
  const prompts = config.systemPrompts || {};
  return {
    html:
      pageHead('平台分层系统提示词', '仅平台授权管理者可设置；用户资料不能覆盖平台权限。') +
      `<div class="sub-tabs"><a href="#/admin/knowledge">平台知识</a><a class="active" href="#/admin/knowledge?tab=prompts">分层提示词</a></div><form class="panel" id="prompt-form">${field('平台规则', 'platform', prompts.platform || config.systemPrompt || '', 'textarea', 'rows="6"')}${field('店铺诊断任务', 'diagnosis', prompts.diagnosis || '', 'textarea', 'rows="5"')}${field('知识库咨询任务', 'chat', prompts.chat || '', 'textarea', 'rows="5"')}<p class="tiny muted">各供应商的系统指令格式由服务端适配，保存后记录配置版本。</p><button class="btn primary">保存提示词版本</button></form>`,
    bind(root) {
      root.querySelector('form').onsubmit = (e) => {
        e.preventDefault();
        submit(e.submitter, async () => {
          await put('/admin/config', {
            config: { ...config, systemPrompts: { ...prompts, ...formData(e.target) } }
          });
          const saved = (await get('/admin/config')).config;
          if (Object.entries(formData(e.target)).some(([k, v]) => saved.systemPrompts?.[k] !== v))
            throw Error('服务端回读与提交不一致，请刷新后重试。');
          await refresh();
          toast('提示词配置已保存并回读确认。');
        });
      };
    }
  };
}
export async function reports() {
  const data = await get('/admin/metrics');
  return {
    html:
      pageHead('数据口径与业务记录', '测试数据库统计。联系意向、真实反馈与成交是不同口径。') +
      `<div class="report-metrics">${Object.entries(data.metrics || data)
        .map(
          ([k, v]) =>
            `<section class="panel"><span>${esc(friendly[k] || k)}</span><strong>${esc(jsonDescription(statValue(v)))}</strong></section>`
        )
        .join(
          ''
        )}</div><section class="panel"><h2>统计边界</h2><p>点击联系不计为已加微信；没有回访确认的需求保留未知。开发测试数据不代表平台真实经营表现。</p><a class="text-link" href="#/leads">查看联系与回访记录 ${icon('arrow')}</a></section>`
  };
}

export async function audit() {
  const r = await get('/admin/audit'),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        '系统与操作审计',
        '主体授权、配置发布和敏感操作需要留痕。',
        '<a class="btn light" href="#/admin/users?tab=admins">管理员授权</a>'
      ) +
      `<div class="panel table-panel"><div class="table-heading"><h2>操作记录</h2><span>${items.length} 条</span></div><div class="table-scroll"><table><thead><tr><th>操作</th><th>对象</th><th>操作者</th><th>时间</th></tr></thead><tbody>${items.map((a) => `<tr><td>${esc(a.action || a.type)}</td><td>${esc(a.resource || a.target || a.targetId || '')}</td><td>${esc(a.userName || a.actorId || a.userId || 'system')}</td><td>${esc(new Date(a.createdAt || a.time || Date.now()).toLocaleString('zh-CN'))}</td></tr>`).join('')}</tbody></table></div></div>`
  };
}

export async function manufacturer() {
  const r = await get('/creator'),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        '厂家经营后台',
        '管理本主体的货源、内容与客户跟进。',
        '<a class="btn primary" href="#/publish?kind=product">' + icon('plus') + '发布货源</a>'
      ) +
      `<div class="manufacturer-summary"><div class="panel"><span>我的内容</span><strong>${items.length}</strong><small>来源于本主体数据库记录</small></div><a class="panel" href="#/buyers"><span>主动找客户</span><strong>对照需求</strong><small>按可用额度发起联系 ${icon('arrow')}</small></a><a class="panel" href="#/my/rights"><span>版本与权益</span><strong>线下开通</strong><small>额度和期限由平台配置 ${icon('arrow')}</small></a></div><div class="my-grid">${[
        ['/creator', 'edit', '创作中心', '资讯、草稿及审核结果'],
        ['/publish?kind=product', 'box', '发布款式', '价格、起批和供货条件'],
        ['/publish?kind=fair', 'calendar', '发布订货会', '活动安排和招募'],
        ['/leads', 'message', '联系与回访', '只查看本主体获准信息'],
        ['/knowledge', 'folder', '主体私有知识', '用于授权范围内的咨询'],
        ['/auth', 'shield', '厂家资料与认证', '提交及查看审核进度']
      ]
        .map(
          ([p, i, t, d]) =>
            `<a class="panel my-entry" href="#${p}"><span class="entry-icon">${icon(i)}</span><div><h3>${t}</h3><p>${d}</p></div>${icon('arrow')}</a>`
        )
        .join('')}</div>`
  };
}
