import { get, put } from '../core/api.js';
import { refresh } from '../core/state.js';
import {
  esc,
  img,
  badge,
  pageHead,
  modal,
  closeModal,
  toast,
  submit,
  field,
  formData
} from '../components/ui.js';
import { icon } from '../components/icons.js';

export async function ads() {
  const { config } = await get('/admin/config');
  const banners = config.banners || [],
    placements = config.ads || [];
  const sections = [
    ['banners', '货源订货会轮播', banners],
    ['ads', '开屏、置顶与资讯推广', placements]
  ];
  return {
    html:
      pageHead('轮播与商业展示', '展示位、素材、跳转、排序和开关由平台配置，商业内容单独标识。') +
      sections
        .map(
          ([key, title, rows]) =>
            `<section class="panel table-panel"><div class="table-heading"><h2>${title}</h2><button class="btn small primary" data-add="${key}">${icon('plus')}新增</button></div><div class="table-scroll"><table><thead><tr><th>素材与标题</th><th>位置与跳转</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map((a, i) => `<tr><td><div class="ad-row-identity">${img(a.image, a.title, 'banner-thumb')}<div><strong>${esc(a.title)}</strong><small>${esc(a.subtitle || a.disclosure || '商业推广')}</small></div></div></td><td>${esc(key === 'banners' ? '货源轮播' : { splash: '开屏', top: '页面置顶', content: '资讯内容流' }[a.position] || a.position)}<small>${esc(a.href || '未配置跳转')}</small></td><td>${badge((key === 'banners' ? a.visible !== false : a.enabled === true) ? '展示' : '隐藏', 'subtle')}</td><td><div class="table-actions"><button class="btn small" data-edit-placement="${key}:${i}">编辑</button><button class="btn small" data-toggle-placement="${key}:${i}">显示/隐藏</button><button class="btn small" data-move-placement="${key}:${i}" ${i === 0 ? 'disabled' : ''}>上移</button><button class="text-button danger-text" data-remove-placement="${key}:${i}">移除</button></div></td></tr>`).join('') || '<tr><td colspan="4">暂无展示位，点击新增设置。</td></tr>'}</tbody></table></div></section>`
        )
        .join('') +
      `<form class="panel" id="carousel-setting">${field('货源轮播间隔（秒）', 'carouselSeconds', config.carouselSeconds || 3, 'number', 'min="2" max="60" required')}<button class="btn primary">保存播放设置</button><p class="tiny muted">轮播间隔2至60秒。开屏可直接关闭，不拦截正常返回。首发广告合作在线下确认。</p></form>`,
    bind(root) {
      const save = async (next) => {
        const r = await put('/admin/config', { config: next });
        if (!r.config) throw Error('未收到保存后的配置版本。');
        await refresh();
        window.dispatchEvent(new Event('qishu:refresh'));
        toast('展示配置已保存并更新版本。');
      };
      const edit = (key, index) => {
        const item = (config[key] || [])[index] || {};
        const m = modal(
          index === undefined ? '新增展示位' : '编辑展示位',
          `<form>${field('标题', 'title', item.title || '', 'text', 'required')}${field('补充说明', 'subtitle', item.subtitle || '')}${field('图片地址', 'image', item.image || '/assets/boutique-interior.jpg', 'text', 'required')}${field('站内路径或HTTPS跳转', 'href', item.href || '/fairs')}${
            key === 'ads'
              ? `<label class="field"><span>展示位置</span><select name="position">${[
                  ['splash', '开屏展示'],
                  ['top', '页面置顶'],
                  ['content', '资讯内容流']
                ]
                  .map(
                    ([v, t]) => `<option value="${v}" ${item.position === v ? 'selected' : ''}>${t}</option>`
                  )
                  .join(
                    ''
                  )}</select></label>${field('推广标识', 'disclosure', item.disclosure || '商业推广')}`
              : ''
          }<label class="check-field"><input type="checkbox" name="enabled" ${(key === 'banners' ? item.visible !== false : item.enabled === true) ? 'checked' : ''}><span>启用展示</span></label><button class="btn primary full">保存展示位</button></form>`
        );
        m.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          submit(e.submitter, async () => {
            const enabled = new FormData(e.target).has('enabled'),
              arr = [...(config[key] || [])],
              data = {
                ...item,
                ...formData(e.target),
                id: item.id || 'placement-' + Date.now(),
                ...(key === 'banners' ? { visible: enabled } : { enabled })
              };
            if (index === undefined) arr.push(data);
            else arr[index] = data;
            await save({ ...config, [key]: arr });
            closeModal();
          });
        };
      };
      root.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => edit(b.dataset.add)));
      root.querySelectorAll('[data-edit-placement]').forEach(
        (b) =>
          (b.onclick = () => {
            const [key, index] = b.dataset.editPlacement.split(':');
            edit(key, Number(index));
          })
      );
      root.querySelectorAll('[data-toggle-placement],[data-move-placement],[data-remove-placement]').forEach(
        (b) =>
          (b.onclick = () =>
            submit(b, async () => {
              const [key, raw] = (
                  b.dataset.togglePlacement ||
                  b.dataset.movePlacement ||
                  b.dataset.removePlacement
                ).split(':'),
                index = Number(raw),
                arr = [...config[key]];
              if (b.dataset.togglePlacement)
                arr[index] = {
                  ...arr[index],
                  ...(key === 'banners'
                    ? { visible: arr[index].visible === false }
                    : { enabled: arr[index].enabled !== true })
                };
              if (b.dataset.movePlacement && index > 0)
                [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
              if (b.dataset.removePlacement) arr.splice(index, 1);
              await save({ ...config, [key]: arr });
            }))
      );
      root.querySelector('#carousel-setting').onsubmit = (e) => {
        e.preventDefault();
        submit(e.submitter, () =>
          save({ ...config, carouselSeconds: Number(new FormData(e.target).get('carouselSeconds')) })
        );
      };
    }
  };
}
