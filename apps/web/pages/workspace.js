import { get, post, patch, del, itemsOf, upload, event } from '../core/api.js';
import { state, refresh, verified, isSupplier, labels, saveFont, feature } from '../core/state.js';
import { icon } from '../components/icons.js';
import {
  esc,
  img,
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
  jsonDescription,
  certificationPrecheck
} from '../components/ui.js';

export async function login(ctx = {}) {
  const entry = ctx.query?.get('entry') || '';
  const front = [
    ['owner', 'user', '店主前台', '看资讯、找货源、诊断门店', '', '/info'],
    ['supplier', 'box', '厂家前台', '看资讯、货源广场、找客户', '', '/info'],
    ['owner', 'shield', '未认证店主', '查看审核前后的信息权限', 'owner-guest', '/info'],
    ['guest', 'user', '游客浏览', '退出演示账号，查看公开信息', '', '/info']
  ];
  const backstage = [
    ['supplier', 'chart', '厂家经营后台', '管理货源、订货会、内容与回访', '', '/manufacturer'],
    ['admin', 'settings', '平台运营后台', '审核、内容、权益、模型与配置', '', '/admin']
  ];
  const views = entry === 'back' ? backstage : entry === 'front' ? front : [...front, ...backstage];
  const demo = state.mode === 'development-demo';
  const title = entry === 'back' ? '后台演示入口' : entry === 'front' ? '前台演示入口' : '进入开发演示';
  return {
    html: `<div class="login-layout"><div class="login-story"><span class="brand-mark">七</span><span class="eyebrow">七叔女装行业平台</span><h1>把经验、货源<br>和合适的人连接起来。</h1><p>先了解你的身份，再进入适合的工作空间。</p><div class="login-photo">${img('/assets/boutique-interior.jpg', '女装门店参考照片')}</div></div><section class="panel login-panel"><h2>${title}</h2><p class="muted">${demo ? '这些账号仅用于开发演示，不代表真实微信登录或经营资质。' : '当前为正式环境，不开放演示角色切换。'}</p><div class="login-roles">${demo ? views.map(([role, i, label, sub, userId, path]) => `<button class="login-role" data-login="${role}" data-user-id="${userId || ''}" data-route="${path}">${icon(i)}<span><strong>${label}</strong><small>${sub}</small></span>${icon('arrow')}</button>`).join('') : ''}</div>${demo ? '<div class="creator-shortcuts"><a class="btn small" href="#/login?entry=front">前台入口</a><a class="btn small" href="#/login?entry=back">后台入口</a></div>' : ''}<div class="login-divider"><span>正式接入状态</span></div><button class="btn full" id="wechat-login">微信正式登录 · 查看配置状态</button><p class="tiny muted">正式上线需要企业小程序 AppID、微信授权和服务端凭证；开发账号不会绕过生产认证。</p></section></div>`,
    bind(root) {
      root.querySelectorAll('[data-login]').forEach((button) => {
        button.onclick = () => submit(button, async () => {
          if (state.mode !== 'development-demo') throw new Error('正式环境不开放演示登录。');
          if (button.dataset.login === 'guest') await post('/auth/logout', {});
          else await post('/auth/demo', {
            role: button.dataset.login,
            ...(button.dataset.userId ? { userId: button.dataset.userId } : {})
          });
          await refresh();
          location.hash = button.dataset.route;
          window.dispatchEvent(new Event('qishu:refresh'));
        });
      });
      root.querySelector('#wechat-login').onclick = (event) => submit(event.currentTarget, async () => {
        const result = await post('/auth/wechat', {});
        toast(result.message || '请在微信小程序中发起正式授权。');
      });
    }
  };
}

export async function profile() {
  if (!state.user)
    return {
      html:
        pageHead('我的') +
        empty(
          '先进入你的工作空间',
          '登录后保存发布内容、收藏和经营资料。',
          '<a class="btn primary" href="#/login">选择开发体验账号</a>'
        )
    };
  const u = state.user;
  return {
    html: `<div class="profile-banner"><div class="profile-identity">${avatar(u.name, 'large')}<div><div class="label-row">${badge(labels[u.role] || '用户')}${badge(verified() ? '资质审核通过 · 测试账号' : '待认证', verified() ? 'positive' : 'warning')}</div><h1>${esc(u.name)}</h1><p>${esc(u.companyName || u.companyId || '我的经营空间')}</p></div></div><a class="btn light" href="#/auth">${icon('shield')}认证与资料</a></div><div class="my-grid">${[
      ['/my/business', 'user', '经营资料', '城市、风格、面积与当前经营需求'],
      ['/creator', 'edit', '创作中心', '草稿、审核与已发布内容'],
      ['/tags', 'layers', '经营偏好', '四到十个标签，调整初始推荐'],
      ['/knowledge', 'folder', '我的知识库', '只用于本账号或主体的私有资料'],
      ['/leads', 'message', '联系与回访', '区分联系意向和实际反馈'],
      ['/diagnosis', 'spark', '诊断与咨询', '门店资料和历史任务'],
      ['/jobs', 'chart', '处理任务', '多模态任务结果和失败状态'],
      ...(u.role === 'supplier'
        ? [
            ['/manufacturer', 'box', '厂家经营后台', '货源、订货会、内容与获客权益'],
            ['/my/rights', 'shield', '额度与权益', '线下购买后由平台开通']
          ]
        : []),
      ...(u.role === 'admin' ? [['/admin', 'settings', '平台运营后台', '按一级及二级菜单管理平台']] : [])
    ]
      .map(
        ([p, i, t, d]) =>
          `<a class="my-entry panel" href="#${p}"><span class="entry-icon">${icon(i)}</span><div><h3>${t}</h3><p>${d}</p></div>${icon('arrow')}</a>`
      )
      .join(
        ''
      )}</div><section class="panel settings-panel"><div><h2>阅读与推荐设置</h2><p>字体放大时，页面和按钮会随内容重排。</p></div><div class="setting-line"><label for="font-scale">阅读字号</label><select id="font-scale">${[
      [1, '标准'],
      [1.4, '大字'],
      [1.65, '更大字体']
    ]
      .map(([v, t]) => `<option value="${v}" ${state.fontScale === v ? 'selected' : ''}>${t}</option>`)
      .join(
        ''
      )}</select></div><div class="setting-line"><div><strong>个性化推荐</strong><small>关闭后以非个性化方式浏览；仍可手动筛选。</small></div><label class="switch"><input id="personalized" type="checkbox" ${u.personalized !== false ? 'checked' : ''}><span></span></label></div><button class="btn" id="logout">${icon('logout')}退出当前体验账号</button></section>`,
    bind(root) {
      root.querySelector('#font-scale').onchange = (e) => {
        saveFont(Number(e.target.value));
        toast('阅读字号已调整。');
      };
      root.querySelector('#personalized').onchange = (e) =>
        submit(e.target, async () => {
          await patch('/profile/preferences', { personalized: e.target.checked });
          await refresh();
          toast(e.target.checked ? '个性化推荐已开启。' : '已切换为非个性化浏览。');
        });
      root.querySelector('#logout').onclick = (e) =>
        submit(e.currentTarget, async () => {
          await post('/auth/logout', {});
          await refresh();
          location.hash = '/info';
          window.dispatchEvent(new Event('qishu:refresh'));
        });
    }
  };
}

export async function tags() {
  const tags = state.dictionaries.tags || [
    '韩系',
    '通勤',
    '新中式',
    '轻熟',
    '休闲',
    '小单快返',
    '支持并单',
    '现货补单',
    '预售做货',
    '低起批量',
    '面料细节',
    '年轻客群',
    '成熟客群',
    '商品结构',
    '库存周转',
    '店铺服务'
  ];
  const selected = new Set(state.user?.tags || []);
  return {
    html: `${pageHead('让推荐先了解你的经营', '选择4到10个标签。之后可以随时回来调整。')}<div class="panel preference-panel"><span class="eyebrow">风格 · 客群 · 采购方式 · 经营问题</span><div class="preference-tags">${tags.map((t) => `<label class="tag-check"><input type="checkbox" name="tag" value="${esc(t)}" ${selected.has(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div><div class="preference-footer"><p>已选择 <strong id="tag-count">${selected.size}</strong> 个 / 最多10个</p><button class="btn primary" id="save-tags">保存偏好并继续 ${icon('arrow')}</button></div><p class="tiny muted">标签用于本平台的内容和货源匹配；私有知识库不会因此自动公开。</p></div>`,
    bind(root) {
      const update = () => {
        const checked = [...root.querySelectorAll('[name=tag]:checked')];
        root.querySelector('#tag-count').textContent = checked.length;
        root.querySelectorAll('[name=tag]:not(:checked)').forEach((x) => (x.disabled = checked.length >= 10));
      };
      root.querySelectorAll('[name=tag]').forEach((x) => (x.onchange = update));
      update();
      root.querySelector('#save-tags').onclick = (e) =>
        submit(e.currentTarget, async () => {
          const chosen = [...root.querySelectorAll('[name=tag]:checked')].map((x) => x.value);
          if (chosen.length < 4 || chosen.length > 10) throw new Error('请选择至少4个、最多10个标签。');
          await post('/profile/tags', { tags: chosen });
          await refresh();
          toast('偏好已保存，后续推荐会结合本站行为更新。');
          location.hash = '/info';
        });
    }
  };
}

export async function certification() {
  const r = state.user ? await get('/certifications').catch(() => ({ items: [] })) : { items: [] };
  const applications = itemsOf(r);
  return {
    html:
      pageHead('经营资料认证', 'AI辅助预审，平台人工终审。批发或零售经营范围满足行业准入。') +
      `<div class="two-columns"><form class="panel" id="certification-form"><h2>提交营业执照</h2>${field('企业或店铺主体名称', 'company', state.user?.companyName || '', 'text', 'required')}${field('营业执照经营范围', 'scope', '', 'textarea', 'required placeholder="例如：服装批发、服装零售" rows="4"')}<label class="field"><span>营业执照图片</span><input type="file" id="license-file" accept="image/jpeg,image/png,image/webp" required><small>证照按私有文件上传，不向其他用户公开。</small></label><div id="license-preview"></div><label class="check-field"><input type="checkbox" required><span>我确认提供的资料可用于经营资质审核，并已获相应主体授权。</span></label><button class="btn primary full">提交人工审核</button><p class="tiny muted">模型未配置时不会编造OCR或验真结果；平台仍可按资料人工处理。演示账户不能代表真实资格。</p></form><section class="panel"><h2>审核记录</h2>${applications.length ? applications.map((a) => `<div class="audit-record"><div class="section-line"><strong>${esc(a.company || a.companyName)}</strong>${badge(a.status || 'pending', 'subtle')}</div><p>${esc(a.scope || '')}</p><small>${esc(a.reason || a.precheck?.industryScope || a.aiNote || '等待审核记录')}</small>${certificationPrecheck(a)}</div>`).join('') : empty('尚未提交资料', '提交后可查看AI处理状态及人工审核结果。')}<div class="notice">资质审核通过不代表对所有内容或商品质量作出担保。证照不因公开分享而公开。</div></section></div>`,
    bind(root) {
      root.addEventListener('click', (e) => {
        const button = e.target.closest('[data-refresh-cert]');
        if (!button) return;
        submit(button, async () => {
          const fresh = itemsOf(await get('/certifications')).find(
            (a) => a.id === button.dataset.refreshCert
          );
          if (!fresh) throw Error('未找到本人可查看的审核资料。');
          button.closest('.cert-precheck').outerHTML = certificationPrecheck(fresh);
        });
      });
      let file = null;
      root.querySelector('#license-file').onchange = (e) => {
        file = e.target.files[0];
        if (file) {
          const url = URL.createObjectURL(file);
          root.querySelector('#license-preview').innerHTML = img(url, '待提交执照图片', 'license-preview');
        }
      };
      root.querySelector('#certification-form').onsubmit = (e) => {
        e.preventDefault();
        submit(e.submitter, async () => {
          if (!file) throw new Error('请先选择执照图片。');
          const uploaded = await upload(file, true);
          await post('/certifications', { ...formData(e.target), licenseFileId: uploaded.id });
          toast('资料已提交，等待人工审核。');
          await refresh();
          window.dispatchEvent(new Event('qishu:refresh'));
        });
      };
    }
  };
}

export async function creator() {
  const r = await get('/creator'),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        '创作中心',
        '厂家与店主都可以分享经验、管理自己的内容。',
        `<a class="btn primary" href="#/publish?kind=content">${icon('plus')}发布内容</a>`
      ) +
      `<div class="creator-shortcuts"><a class="panel" href="#/publish?kind=content">${icon('edit')}<strong>写一篇资讯或经验</strong><span>图片、文字、视频、音频均可提交</span></a>${isSupplier() ? `<a class="panel" href="#/publish?kind=product">${icon('box')}<strong>发布一款货源</strong><span>把价格、起批和供货条件写清楚</span></a><a class="panel" href="#/publish?kind=fair">${icon('calendar')}<strong>发起订货会招募</strong><span>先存草稿，审核后发布</span></a>` : ''}</div><div class="panel table-panel"><div class="table-heading"><h2>我的内容</h2><span>${items.length} 条</span></div>${items.length ? `<div class="table-scroll"><table><thead><tr><th>内容</th><th>类型</th><th>审核状态</th><th>操作</th></tr></thead><tbody>${items.map((a) => `<tr><td><strong>${esc(a.title)}</strong><small>${esc(a.category || a.origin || '')}</small></td><td>${esc(a.kind || a.type || '资讯')}</td><td>${badge(a.status || 'draft', a.status === 'published' ? 'positive' : 'subtle')}</td><td><a class="btn small" href="#/publish?kind=${esc(a.kind || 'content')}&id=${esc(a.id)}">编辑</a><button class="btn small" data-hide="${esc(a.id)}">下架</button></td></tr>`).join('')}</tbody></table></div>` : empty('从第一篇分享开始', '先写清要解决的问题与成立条件。')}</div>`,
    bind(root) {
      root.querySelectorAll('[data-hide]').forEach(
        (b) =>
          (b.onclick = () =>
            submit(b, async () => {
              await patch('/creator/' + b.dataset.hide, { status: 'hidden' });
              toast('内容已下架。');
              window.dispatchEvent(new Event('qishu:refresh'));
            }))
      );
    }
  };
}

export async function publish(ctx) {
  let kind = ctx.query.get('kind') || 'content';
  if (!['content', 'product', 'fair'].includes(kind)) kind = 'content';
  let item = {};
  if (ctx.query.get('id')) {
    const r = await get('/creator');
    item = itemsOf(r).find((x) => x.id === ctx.query.get('id')) || {};
  }
  const supplier = isSupplier() || state.user?.role === 'admin';
  return {
    html:
      pageHead(
        item.id ? '编辑内容' : { content: '发布资讯或经验', product: '发布货源', fair: '发布订货会' }[kind],
        '多模态素材统一录入，确认字段后提交审核。'
      ) +
      `<form id="publish-form" class="publish-layout"><section class="panel"><div class="field"><span>发布类型</span><div class="segmented">${[
        ['content', '资讯经验'],
        ...(supplier
          ? [
              ['product', '货源'],
              ['fair', '订货会']
            ]
          : [])
      ]
        .map(([v, t]) => `<a href="#/publish?kind=${v}" class="${kind === v ? 'active' : ''}">${t}</a>`)
        .join(
          ''
        )}</div></div>${field('标题', 'title', item.title || '', 'text', 'required maxlength="100"')}${field(kind === 'content' ? '正文与适用条件' : kind === 'product' ? '商品说明与拿货条件' : '活动安排与参加条件', 'body', item.body || item.description || '', 'textarea', 'rows="9" required')}${kind === 'product' ? `<div class="form-grid">${field('产地', 'origin', item.origin || '')}${field('风格', 'style', item.style || '')}${field('品类', 'category', item.category || '')}${field('拿货价（元）', 'price', item.price ?? '', 'number', 'min="0" step="0.01"')}${field('起批量（件）', 'moq', item.moq ?? '', 'number', 'min="1"')}<label class="field"><span>供货状态</span><select name="supplyStatus"><option>现货</option><option ${item.supplyStatus === '预售' ? 'selected' : ''}>预售</option></select></label>${field('交期与补单说明', 'delivery', item.delivery || '')}</div>` : kind === 'fair' ? `<div class="form-grid">${field('地点', 'location', item.location || '')}${field('日期或时间说明', 'date', item.date || '')}${field('参加名额', 'capacity', item.capacity || '', 'number', 'min="1"')}</div>` : `${field('内容频道', 'category', item.category || '经营方法')}`}</section><aside class="panel publish-aside"><h2>关联素材</h2><p class="muted small">支持图片、音频与视频。原件和业务字段分别保存。</p><label class="upload-drop"><input type="file" id="publish-file" accept="image/*,audio/*,video/*">${icon('upload')}<strong>选择素材</strong><span>不限制图片比例，详情完整查看</span></label><div id="publish-media">${item.image ? img(item.image, item.title) : ''}</div><div class="publish-actions"><button class="btn primary full" type="submit" name="submitAction" value="pending">提交审核</button><button class="btn full" type="submit" name="submitAction" value="draft">保存草稿</button></div><p class="tiny muted">发布由后端校验角色和主体。AI不会补造缺失的价格或产地。</p></aside></form>`,
    bind(root) {
      let mediaFile = null;
      root.querySelector('#publish-file').onchange = (e) => {
        mediaFile = e.target.files[0];
        if (mediaFile) {
          root.querySelector('#publish-media').innerHTML = mediaFile.type.startsWith('image/')
            ? img(URL.createObjectURL(mediaFile), mediaFile.name)
            : `<div class="notice">${icon(mediaFile.type.startsWith('video/') ? 'play' : 'folder')} ${esc(mediaFile.name)}</div>`;
        }
      };
      root.querySelector('#publish-form').onsubmit = (e) => {
        e.preventDefault();
        const action = e.submitter?.value || 'pending';
        submit(e.submitter, async () => {
          const data = formData(e.target);
          data.kind = kind;
          data.status = action;
          for (const k of ['price', 'moq', 'capacity'])
            if (data[k] !== undefined && data[k] !== '') data[k] = Number(data[k]);
          if (mediaFile) {
            const file = await upload(mediaFile);
            data.media = [file];
            data.fileId = file.id;
            if (file.mime?.startsWith('image/')) data.image = file.url;
          }
          const result = item.id ? await patch('/creator/' + item.id, data) : await post('/creator', data);
          toast(action === 'draft' ? '草稿已保存。' : '已提交，等待平台审核。');
          location.hash = '/creator';
        });
      };
    }
  };
}

export async function diagnosis() {
  if (!feature('diagnosis'))
    return {
      html:
        pageHead('店铺诊断') +
        empty('诊断服务暂时关闭', '资讯和货源仍然可以继续浏览。', '<a class="btn" href="#/info">回到资讯</a>')
    };
  return {
    html: `${pageHead('从店里的具体问题开始', '填写经营情况，或带着素材直接向知识库提问。')}<div class="diagnosis-mode-tabs segmented"><button class="active" data-diag-mode="form">填写资料诊断</button><button data-diag-mode="chat">知识库咨询</button></div><div class="diagnosis-layout"><section class="panel diagnosis-form-panel" data-diag-panel="form"><div class="section-line"><h2>门店经营诊断</h2>${badge('结构化资料', 'subtle')}</div><form id="diagnosis-form"><div class="form-grid">${field('城市', 'city', '', 'text', 'placeholder="例如：杭州"')}${field('经营时长', 'operatingTime', '', 'text', 'placeholder="例如：3年"')}${field('店铺面积（㎡）', 'area', '', 'number', 'min="1"')}${field('主要客群', 'customer', '', 'text', 'placeholder="年龄、场景和风格"')}${field('零售价带', 'priceBand', '', 'text', 'placeholder="例如：199—499元"')}${field('主营风格', 'style', '', 'text', 'placeholder="例如：通勤、韩系"')}</div>${field('最希望解决的问题', 'problem', '', 'textarea', 'required rows="4" placeholder="写清具体情况、统计周期，以及已经尝试过的动作"')}<label class="field"><span>补充图片、音频或视频</span><input type="file" id="diagnosis-file" accept="image/*,audio/*,video/*"><small>按私有资料处理，仅本人及授权服务人员可见。</small></label><button class="btn primary full">${icon('spark')}提交诊断任务</button></form><div id="diagnosis-result" class="diagnosis-result"><h3>报告会告诉你什么</h3><p>结合输入资料和知识依据，整理主要问题、适用条件、可执行动作与观察指标。资料不足时先补充，不编造结论。</p></div></section><section class="panel knowledge-chat-panel" data-diag-panel="chat"><div class="section-line"><h2>知识库咨询</h2><a class="text-link tiny" href="#/knowledge">管理我的知识</a></div><div class="chat-messages" id="chat-messages"><div class="chat-answer"><span class="chat-author">七叔经营知识助手</span><p>可以描述你店里的问题，也可以上传现场图片、音频或视频。资料越具体，越容易判断哪些方法适合你。</p><small>使用平台授权知识与自己的私有知识，不会公开你的原始资料。</small></div></div><form id="knowledge-chat-form" class="chat-input"><textarea name="message" required placeholder="例如：春夏上新很好看，为什么补单后库存却变多了？" rows="3"></textarea><div><label class="attach-button">${icon('plus')}<span id="chat-file-label">添加素材</span><input type="file" id="chat-file" accept="image/*,audio/*,video/*"></label><button class="btn primary">发送 ${icon('arrow')}</button></div></form><div class="tiny muted chat-footer">实际调用取决于后台模型配置；未接通时会明确返回状态，不生成假答案。</div></section></div>`,
    bind(root) {
      let file = null,
        chatFile = null;
      root.querySelector('#diagnosis-file').onchange = (e) => (file = e.target.files[0]);
      root.querySelector('#chat-file').onchange = (e) => {
        chatFile = e.target.files[0];
        root.querySelector('#chat-file-label').textContent = chatFile?.name || '添加素材';
      };
      root.querySelectorAll('[data-diag-mode]').forEach(
        (b) =>
          (b.onclick = () => {
            root.querySelectorAll('[data-diag-mode]').forEach((x) => x.classList.toggle('active', x === b));
            root.querySelector('.diagnosis-layout').dataset.mode = b.dataset.diagMode;
          })
      );
      root.querySelector('#diagnosis-form').onsubmit = (e) => {
        e.preventDefault();
        submit(e.submitter, async () => {
          const profile = formData(e.target);
          let fileId;
          if (file) fileId = (await upload(file, true)).id;
          const r = await post('/jobs', { task: 'diagnosis', message: profile.problem, profile, fileId });
          const j = r.job || r;
          renderJob(root.querySelector('#diagnosis-result'), j);
          toast('诊断任务已保存，可在处理任务中继续查看。');
        });
      };
      root.querySelector('#knowledge-chat-form').onsubmit = (e) => {
        e.preventDefault();
        const message = new FormData(e.target).get('message');
        submit(e.submitter, async () => {
          const msgs = root.querySelector('#chat-messages');
          msgs.insertAdjacentHTML('beforeend', `<div class="chat-question">${esc(message)}</div>`);
          let fileId;
          if (chatFile) fileId = (await upload(chatFile, true)).id;
          const r = await post('/jobs', { task: 'chat', message, fileId });
          const j = r.job || r;
          const node = document.createElement('div');
          node.className = 'chat-answer';
          msgs.append(node);
          renderJob(node, j);
          e.target.reset();
          chatFile = null;
          root.querySelector('#chat-file-label').textContent = '添加素材';
          msgs.scrollTop = msgs.scrollHeight;
        });
      };
    }
  };
}

function renderJob(target, j) {
  if (!target) return;
  const result = j.result || j.output;
  const mediaUrl =
    result?.url ||
    (['image', 'audio', 'video'].includes(result?.type) && typeof result?.data === 'string'
      ? result.data
      : null);
  const media =
    mediaUrl && /^(https?:\/\/|\/api\/)/.test(mediaUrl)
      ? result.type === 'image'
        ? img(mediaUrl, 'AI生成图像', 'generated-image')
        : result.type === 'audio'
          ? `<audio controls preload="metadata" src="${esc(mediaUrl)}"></audio>`
          : result.type === 'video'
            ? `<video controls playsinline preload="metadata" src="${esc(mediaUrl)}"></video>`
            : ''
      : '';
  target.innerHTML = `<div class="section-line"><strong>${esc({ chat: '知识库咨询', diagnosis: '门店经营诊断', ocr: 'OCR文字识别', asr: '语音识别', tts: '语音合成', image: '图像生成', video: '视频生成' }[j.task] || j.task || '处理任务')}</strong>${badge(j.status || 'queued', j.status === 'completed' ? 'positive' : 'subtle')}</div>${media ? '<div class="generated-media">' + media + '</div>' : ''}${result ? `<div class="result-prose">${esc(typeof result === 'object' ? result.text || result.content || JSON.stringify(result, null, 2) : result)}</div>` : `<p>${esc(j.error?.message || j.error || j.message || '任务已创建，正在等待处理。')}</p>`}${mediaUrl ? `<a class="text-link" href="${esc(mediaUrl)}" target="_blank" rel="noopener">打开生成结果 ${icon('arrow')}</a>` : ''}<a class="text-link tiny" href="#/jobs">查看任务状态 ${icon('arrow')}</a>`;
  if (['queued', 'running', 'processing'].includes(j.status))
    setTimeout(async () => {
      if (!target.isConnected) return;
      try {
        const r = await get('/jobs/' + j.id);
        if (target.isConnected) renderJob(target, r.job || r);
      } catch (e) {
        if (target.isConnected)
          target.insertAdjacentHTML(
            'beforeend',
            `<p class="tiny muted">${esc(e.message)}，可稍后在处理任务中重试查看。</p>`
          );
      }
    }, 1800);
}

export async function jobs() {
  const r = await get('/jobs'),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        '处理任务',
        '真实模型结果与失败状态分别保存。素材按私有资料处理。',
        '<button class="btn primary" id="new-ai-task">' + icon('plus') + '新建处理任务</button>'
      ) +
      `<div class="jobs-list">${items.length ? items.map((j) => `<article class="panel job-card" data-job="${esc(j.id)}"></article>`).join('') : empty('还没有处理任务', '从店铺诊断、知识库咨询或素材处理开始。')}</div>`,
    bind(root) {
      items.forEach((j) => renderJob(root.querySelector(`[data-job="${CSS.escape(j.id)}"]`), j));
      root.querySelector('#new-ai-task').onclick = () => {
        const m = modal(
          '新建AI处理任务',
          `<form><label class="field"><span>处理能力</span><select name="task">${[
            ['ocr', 'OCR图文识别'],
            ['asr', '音频转文字'],
            ['tts', '文字转语音'],
            ['image', '生成图片'],
            ['video', '生成视频'],
            ['chat', '知识库咨询']
          ]
            .map(([v, t]) => `<option value="${v}">${t}</option>`)
            .join(
              ''
            )}</select></label>${field('处理说明或提示词', 'message', '', 'textarea', 'rows="5"')}<label class="field"><span>补充素材（按任务选填）</span><input type="file" id="task-file" accept="image/*,audio/*,video/*"></label><div class="notice">使用平台已配置渠道。没有有效模型时会返回明确失败，不会生成替代结果。</div><button class="btn primary full">提交处理任务</button></form>`
        );
        m.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          submit(e.submitter, async () => {
            const data = formData(e.target),
              file = m.querySelector('#task-file').files[0];
            if (file) data.fileId = (await upload(file, true)).id;
            await post('/jobs', data);
            m.querySelector('[data-close-modal]').click();
            toast('任务已提交。');
            window.dispatchEvent(new Event('qishu:refresh'));
          });
        };
      };
    }
  };
}

export async function knowledge() {
  const r = await get('/knowledge'),
    items = itemsOf(r);
  return {
    html:
      pageHead(
        '我的知识库',
        '平台私有底库不向用户开放；你可以维护自己的经营资料。',
        '<button class="btn primary" id="add-knowledge">' + icon('plus') + '添加知识</button>'
      ) +
      `<div class="knowledge-list">${items.length ? items.map((k) => `<article class="panel knowledge-card"><div class="section-line"><h2>${esc(k.title)}</h2>${badge(k.scope === 'platform' ? '平台授权摘要' : '我的私有知识', 'subtle')}</div><p>${esc(String(k.body || k.content || '').slice(0, 240))}</p><footer><span class="tiny muted">${esc(k.scope || 'private')} · 不自动进入公共训练</span><button class="text-button danger-text" data-delete-knowledge="${esc(k.id)}">移除</button></footer></article>`).join('') : empty('把门店资料整理在这里', '可添加你自己的经营方法、商品结构或服务规则。')}</div>`,
    bind(root) {
      root.querySelector('#add-knowledge').onclick = () => {
        const m = modal(
          '添加私有知识',
          `<form>${field('资料标题', 'title', '', 'text', 'required')}${field('资料内容', 'body', '', 'textarea', 'rows="8" required')}${field('用于推荐的经营摘要（选填）', 'recommendationSummary', '', 'textarea', 'rows="3" placeholder="只填写希望参与自己账号推荐的经营需求，不填私密原件"')}<label class="check-field"><input type="checkbox" name="allowRecommendation"><span>允许以上摘要参与本账号的个性化推荐，不公开原文、不用于跨用户训练。</span></label><div class="notice">仅存入当前账号或主体的私有知识库，不自动用于跨用户训练。</div><button class="btn primary full">保存私有资料</button></form>`
        );
        m.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          submit(e.submitter, async () => {
            const data = formData(e.target);
            data.recommendationSummary = new FormData(e.target).has('allowRecommendation')
              ? data.recommendationSummary
              : '';
            delete data.allowRecommendation;
            await post('/knowledge', { ...data, scope: 'private' });
            closeModal();
            window.dispatchEvent(new Event('qishu:refresh'));
            toast('私有知识已保存。');
          });
        };
      };
      root.querySelectorAll('[data-delete-knowledge]').forEach(
        (b) =>
          (b.onclick = () => {
            const m = modal(
              '移除这条私有知识？',
              '<p>删除后不再用于后续检索。此操作仅针对当前账号可管理的资料。</p><button class="btn primary full" id="confirm-delete-kb">确认移除</button>'
            );
            m.querySelector('#confirm-delete-kb').onclick = (e) =>
              submit(e.currentTarget, async () => {
                await del('/knowledge/' + b.dataset.deleteKnowledge);
                closeModal();
                window.dispatchEvent(new Event('qishu:refresh'));
              });
          })
      );
    }
  };
}

export async function rights() {
  const r = await get('/quota'),
    q = r.quota || r;
  return {
    html:
      pageHead('额度与权益', '首发线下购买后，由平台确认并开通。') +
      `<div class="rights-layout"><section class="panel"><span class="eyebrow">当前权益</span><h2>${esc(typeof q.plan === 'object' ? q.plan.name : q.plan || '免费版')}</h2><div class="quota-large"><strong>${q.remaining ?? Math.max(0, (q.limit ?? 10) - (q.used ?? 0))}</strong><span>今日剩余主动联系次数</span></div><dl class="spec-list"><div><dt>今日已用</dt><dd>${q.used ?? 0} 次</dd></div><div><dt>今日额度</dt><dd>${q.limit ?? 10} 次</dd></div><div><dt>生效规则</dt><dd>由后台配置并记录变更</dd></div></dl></section><section class="panel"><h2>需要更多联系机会？</h2><p>联系平台了解适合你的权益。完成线下购买和确认后，由平台后台开通。</p><div class="notice">这里不收款，不产生货品订单。后续可独立增加平台权益的在线购买和续费。</div><a class="btn primary" href="#/leads">查看联系与回访记录</a></section></div>`
  };
}
