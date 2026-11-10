import { get, post, patch, itemsOf } from '../core/api.js';
import {
  esc,
  img,
  badge,
  statusLabel,
  pageHead,
  empty,
  modal,
  toast,
  submit,
  field,
  formData
} from '../components/ui.js';
import { icon } from '../components/icons.js';

const runningFiles = new Map();
let fileQueue = Promise.resolve();
const sizes = (n) =>
  n >= 1024 ** 3
    ? (n / 1024 ** 3).toFixed(1) + ' GiB'
    : n >= 1024 ** 2
      ? (n / 1024 ** 2).toFixed(1) + ' MiB'
      : n >= 1024
        ? Math.round(n / 1024) + ' KiB'
        : n + ' 字节';
const resumeKey = (f) => 'qishu-upload:' + f.name + ':' + f.size + ':' + f.lastModified;
async function rawPart(id, index, blob) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const r = await fetch(`/api/ingestion/uploads/${encodeURIComponent(id)}/parts/${index}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
        signal: controller.signal
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error?.message || '分片未接收');
      return data;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
}
async function uploadFile(file, target, onProgress) {
  const key = resumeKey(file);
  let upload;
  try {
    const id = localStorage.getItem(key);
    if (id) {
      const r = await get('/ingestion/uploads/' + id);
      if (r.upload?.name === file.name && r.upload?.size === file.size) upload = r.upload;
    }
  } catch {}
  if (!upload) {
    const r = await post('/ingestion/uploads', { name: file.name, size: file.size, mime: file.type, target });
    upload = r.upload;
    try {
      localStorage.setItem(key, upload.id);
    } catch {}
  }
  const received = new Set((upload.parts || []).map((p) => p.part));
  let sent = [...received].reduce(
      (sum, p) => sum + Math.min(upload.chunkSize, file.size - p * upload.chunkSize),
      0
    ),
    cursor = 0;
  onProgress(sent, file.size, '正在上传分片');
  const work = async () => {
    while (cursor < upload.totalChunks) {
      const part = cursor++;
      if (received.has(part)) continue;
      const slice = file.slice(part * upload.chunkSize, Math.min((part + 1) * upload.chunkSize, file.size));
      await rawPart(upload.id, part, slice);
      sent += slice.size;
      onProgress(sent, file.size, '正在上传分片');
    }
  };
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(4, upload.totalChunks) }, work));
  const failed = outcomes.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  onProgress(file.size, file.size, '上传完成，正在提交拆解');
  const r = await post('/ingestion/uploads/' + upload.id + '/complete', {}, { timeout: 120000 });
  try {
    localStorage.removeItem(key);
  } catch {}
  return r.job;
}

export async function ingestion(ctx) {
  let status;
  try {
    status = await get('/ingestion/status');
  } catch (e) {
    return {
      html:
        pageHead('批量资料导入', 'PPTX、PDF、文档、图片与压缩包，先拆解为待确认卡片。') +
        empty('导入服务暂时不可用', e.message, '<a class="btn" href="#/admin/content">继续管理资讯</a>')
    };
  }
  const list = await get('/ingestion/jobs').catch(() => ({ items: [] })),
    jobs = itemsOf(list);
  const suppliers = itemsOf(await get('/admin/users').catch(() => ({ items: [] }))).filter(
    (u) => u.role === 'supplier'
  );
  const requested = ctx.query.get('job');
  const selected = requested ? jobs.find((j) => j.id === requested) : jobs[0];
  return {
    html:
      pageHead('批量资料导入', '上传原件 → 结构拆解 → 检查卡片 → 确认发布。原件默认私有。') +
      `<div class="sub-tabs"><a href="#/admin/content">资讯内容</a><a class="active" href="#/admin/content?tab=import">批量导入</a></div><section class="panel import-upload-panel"><div class="section-line"><div><h2>把分散的素材整理成可编辑内容</h2><p class="muted small">单文件容量上限 ${sizes(status.maxBytes || 1024 ** 3)}，${sizes(status.chunkSize || 8 * 1024 ** 2)} 分片；同文件最多4片、文件队列2个并行。</p></div>${badge(status.semanticAI === 'not_configured' ? 'AI理解待配置' : '理解接口已接，模型按配置', 'subtle')}</div><div class="import-controls"><label class="field"><span>这批资料准备进入</span><select id="import-target"><option value="content">资讯内容草稿</option><option value="product">货源草稿</option><option value="knowledge">平台内部知识库</option></select></label><label class="upload-drop import-drop"><input id="import-files" type="file" multiple accept=".pptx,.ppt,.pdf,.docx,.zip,.txt,.md,.csv,.json,image/*,audio/*,video/*">${icon('upload')}<strong>选择一个或多个文件</strong><span>图片比例自动保留；旧版PPT需先转PPTX</span></label></div><div id="import-progress"></div><div class="notice">解析成功只代表结构拆解完成。图片内容、扫描PDF及音视频需要相应模型完成理解；没有接通模型不会标成AI理解成功。</div></section><div class="import-workspace"><aside class="panel import-task-list"><div class="section-line"><h2>拆解任务</h2><button class="icon-button" id="refresh-imports" aria-label="刷新任务">${icon('refresh')}</button></div>${jobs.length ? jobs.map((j) => `<a data-import-task="${esc(j.id)}" class="import-task ${selected?.id === j.id ? 'active' : ''}" href="#/admin/content?tab=import&job=${esc(j.id)}"><strong>${esc(j.result?.source?.name || j.result?.name || j.result?.cards?.[0]?.source || j.uploadId?.slice(0, 12) || j.id.slice(0, 12))}</strong><span>${badge(j.status, 'subtle')}</span><small>${esc(j.progress || '')}</small></a>`).join('') : empty('还没有拆解任务', '上传后会自动进入解析队列。')}</aside><section class="panel import-result" id="import-result">${selected ? jobMarkup(selected) : empty('从一份资料开始', '完成拆解后，在这里检查每张卡片的来源、图片与文字。')}</section></div>`,
    bind(root) {
      const progress = root.querySelector('#import-progress');
      function drawProgress() {
        if (!root.isConnected) return;
        progress.innerHTML = [...runningFiles.values()]
          .map(
            (x) =>
              `<div class="upload-progress-row"><div><strong>${esc(x.name)}</strong><span>${esc(x.message)}</span></div><progress max="100" value="${x.percent}"></progress><small>${x.percent}% · ${sizes(x.size)}</small></div>`
          )
          .join('');
      }
      drawProgress();
      root.querySelector('#refresh-imports').onclick = () => window.dispatchEvent(new Event('qishu:refresh'));
      root.querySelector('#import-files').onchange = async (e) => {
        const files = [...e.target.files],
          target = root.querySelector('#import-target').value;
        e.target.value = '';
        const queue = async () => {
          let cursor = 0;
          const worker = async () => {
            while (cursor < files.length) {
              const file = files[cursor++],
                key = resumeKey(file);
              if (file.size > (status.maxBytes || 1024 ** 3)) {
                toast(file.name + ' 超过单文件容量上限。');
                continue;
              }
              const p = { name: file.name, size: file.size, percent: 0, message: '等待上传' };
              runningFiles.set(key, p);
              drawProgress();
              try {
                const j = await uploadFile(file, target, (sent, total, message) => {
                  p.percent = Math.round((sent / total) * 100);
                  p.message = message;
                  drawProgress();
                });
                p.message = '结构拆解任务已排队';
                p.jobId = j.id;
                drawProgress();
                toast(file.name + ' 已上传，开始拆解。');
              } catch (e) {
                p.message = e.message + '；重新选择同一原文件可续传';
                drawProgress();
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
          if (root.isConnected) window.dispatchEvent(new Event('qishu:refresh'));
        };
        fileQueue = fileQueue.then(queue, queue);
      };
      let timer;
      const bindJob = (j) => {
        clearTimeout(timer);
        const target = root.querySelector('#import-result');
        target.innerHTML = jobMarkup(j);
        const side = [...root.querySelectorAll('[data-import-task]')].find(
          (x) => x.dataset.importTask === j.id
        );
        if (side) {
          const label = side.querySelector('.badge');
          if (label) label.textContent = statusLabel(j.status);
          const progress = side.querySelector('small');
          if (progress) progress.textContent = j.progress || '';
        }
        target.querySelector('[data-understand]')?.addEventListener('click', (e) =>
          submit(e.currentTarget, async () => {
            const r = await post('/ingestion/jobs/' + j.id + '/understand', {}, { timeout: 90000 });
            bindJob(r.job);
            toast('理解任务已排队，结果将自动更新。');
          })
        );
        target
          .querySelectorAll('[data-edit-card]')
          .forEach((b) => (b.onclick = () => editCard(j, Number(b.dataset.editCard), bindJob, suppliers)));
        target.querySelector('#publish-import-cards')?.addEventListener('click', (e) =>
          submit(e.currentTarget, async () => {
            const indices = [...target.querySelectorAll('[name=card]:checked')].map((x) => Number(x.value));
            if (!indices.length) throw Error('先选择要发布的卡片。');
            const chosen = target.querySelector('#cards-target').value;
            const r = await post('/ingestion/jobs/' + j.id + '/publish', { indices, target: chosen });
            toast('已确认发布 ' + (r.records?.length || indices.length) + ' 张卡片。');
            const fresh = await get('/ingestion/jobs/' + j.id);
            bindJob(fresh.job);
          })
        );
        target
          .querySelector('#select-all-cards')
          ?.addEventListener('change', (e) =>
            target.querySelectorAll('[name=card]').forEach((x) => (x.checked = e.target.checked))
          );
        if (['queued', 'processing', 'understanding'].includes(j.status))
          timer = setTimeout(async () => {
            try {
              const r = await get('/ingestion/jobs/' + j.id);
              if (root.isConnected) bindJob(r.job);
            } catch {}
          }, 2500);
      };
      if (selected) bindJob(selected);
      return () => clearTimeout(timer);
    }
  };
}

function jobMarkup(j) {
  const cards = j.result?.cards || [],
    busy = j.status === 'understanding';
  return `<div class="section-line"><div><h2>核对拆解结果</h2><p class="muted small">${esc(j.progress || '等待处理')}</p></div>${badge(j.status, j.status === 'parsed' ? 'positive' : 'subtle')}</div>${j.error ? `<div class="notice warning">${esc(j.error)}</div>` : ''}${cards.length ? `<div class="import-result-meta"><span>${cards.length} 张卡片</span><span>AI理解：${esc({ not_run: '未运行', running: '理解中', provider_completed: '渠道理解完成', failed: '理解失败，原卡片保留', interrupted: '处理曾中断' }[j.result.semanticAI] || j.result.semanticAI || '尚未完成')}</span><button class="btn small" data-understand ${busy ? 'disabled' : ''}>${busy ? '正在理解' : '调用AI理解'}</button></div><div class="import-cards">${cards.map((c, i) => `<article class="import-card"><label class="check-field"><input type="checkbox" name="card" value="${i}" ${busy ? 'disabled' : ''}><strong>${esc(c.title || '第' + (i + 1) + '张卡片')}</strong></label>${c.image ? img(c.image, c.title) : ''}<p>${esc(String(c.body || c.text || '此卡片暂无可提取文本。').slice(0, 400))}</p><footer><small>${esc(c.page ? '来源 ' + String(c.source || '原件') + ' · 第 ' + c.page + ' 页' : c.sourcePage ? '来源第 ' + c.sourcePage + ' 页' : c.semanticStatus || '待确认')}</small><button class="btn small" data-edit-card="${i}" ${busy ? 'disabled' : ''}>编辑卡片</button></footer></article>`).join('')}</div><div class="import-publish-bar"><label class="check-field"><input type="checkbox" id="select-all-cards" ${busy ? 'disabled' : ''}><span>全选</span></label><select id="cards-target"><option value="content">发布至资讯</option><option value="product">发布至货源</option><option value="knowledge">保存平台知识</option></select><button class="btn primary" id="publish-import-cards" ${busy ? 'disabled' : ''}>确认发布选中卡片</button></div><p class="tiny muted">发布前核对内容和素材授权。货源缺少必要字段时服务端会拒绝发布，不自动补造。</p>` : j.status === 'failed' ? empty('拆解未完成', '原文件已保留，查看失败原因后重试。') : empty('结构拆解处理中', '任务由独立解析进程执行，前台其他功能可以继续使用。')}`;
}
function editCard(job, index, onSaved, suppliers = []) {
  const c = job.result.cards[index],
    m = modal(
      '编辑待确认卡片',
      `<form>${field('标题', 'title', c.title || '', 'text', 'required')}${field('正文', 'body', c.body || c.text || '', 'textarea', 'rows="8"')}<label class="field"><span>关联厂家（发布货源时必填）</span><select name="supplierId"><option value="">请选择厂家</option>${suppliers.map((u) => `<option value="${esc(u.id)}" ${c.supplierId === u.id ? 'selected' : ''}>${esc(u.companyName || u.name)} · ${esc(u.id)}</option>`).join('')}</select></label><div class="form-grid">${field('产地', 'origin', c.origin || '')}${field('风格', 'style', c.style || '')}${field('品类', 'category', c.category || '')}${field('拿货价', 'price', c.price ?? '', 'number', 'min="0" step="0.01"')}${field('起批量', 'moq', c.moq ?? '', 'number', 'min="1"')}${field('供货状态', 'status', c.status || '现货')}</div><button class="btn primary full">保存卡片</button></form>`
    );
  m.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    submit(e.submitter, async () => {
      const data = formData(e.target);
      for (const k of ['price', 'moq'])
        if (data[k] !== '') data[k] = Number(data[k]);
        else delete data[k];
      const r = await patch('/ingestion/jobs/' + job.id + '/cards', { index, ...data });
      onSaved(r.job);
      m.querySelector('[data-close-modal]').click();
      toast('卡片修改已保存。');
    });
  };
}
