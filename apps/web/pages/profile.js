import { get, patch } from '../core/api.js';
import { refresh, state } from '../core/state.js';
import { pageHead, field, esc, formData, submit, toast } from '../components/ui.js';

export async function businessProfile() {
  const [response, contactResponse] = await Promise.all([
    get('/profile'),
    get('/profile/contact').catch((error) => ({ error: error.message }))
  ]);
  const profile = response.profile || response.user || {},
    contact = contactResponse.contact || {},
    canWrite = state.user?.verified === true && !contactResponse.error;
  return {
    html:
      pageHead('经营资料', '用于匹配内容、货源和经营建议；不会变更经营资质与账号权限。') +
      `<form class="panel business-profile" id="business-profile"><div class="form-grid">${field('称呼', 'name', profile.name || '', 'text', 'required maxlength="80"')}${field('店铺或品牌名', 'shop', profile.shop || '', 'text', 'maxlength="100"')}${field('经营城市', 'city', profile.city || '', 'text', 'maxlength="80"')}${field('主营风格', 'style', profile.style || '', 'text', 'list="business-styles" maxlength="80"')}${field('面积（㎡）', 'area', profile.area ?? '', 'number', 'min="1" max="100000" step="0.1"')}${field('经营年限', 'businessYears', profile.businessYears ?? '', 'number', 'min="0" max="100" step="0.1"')}${field('主要客群年龄', 'customerAge', profile.customerAge || '', 'text', 'maxlength="80" placeholder="例如：25—35岁"')}${field('门店零售价带', 'retailPriceBand', profile.retailPriceBand || '', 'text', 'maxlength="80" placeholder="例如：199—499元"')}</div>${field('当前经营需求（逗号分隔）', 'operationNeeds', (profile.operationNeeds || []).join('，'), 'textarea', 'rows="3" placeholder="例如：小单快返、支持并单、库存周转、私域经营"')}<datalist id="business-styles">${(state.dictionaries.styles || []).map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist><div class="notice"><div><strong>已审核主体名称</strong><p>${esc(profile.companyName || state.user?.companyName || '尚未完成主体审核')}</p><span>主体名称需通过资质审核流程修改，本表不会覆盖认证结论。</span></div></div><div class="profile-form-actions"><button class="btn primary">保存经营资料</button><a class="btn" href="#/tags">调整推荐偏好标签</a></div></form><form class="panel business-profile" id="contact-profile" style="margin-top:24px"><div class="section-line"><h2>经营联络方式</h2><span class="muted tiny">仅本人设置</span></div><p class="small muted">不在公开列表直接展示；仅在对方具备联系权限、完成联系记录后提供。</p>${contactResponse.error ? `<div class="notice warning">联络信息暂不可读取：${esc(contactResponse.error)}</div>` : state.user?.verified !== true ? '<div class="notice warning">资质审核通过后才能设置联络方式。请先提交经营资质并等待人工审核。</div>' : ''}<fieldset ${canWrite ? '' : 'disabled'} style="border:0;margin:20px 0 0;padding:0;min-width:0"><div class="form-grid">${field('微信号', 'wechat', contact.wechat || '', 'text', 'maxlength="40" pattern="[A-Za-z][A-Za-z0-9_-]{5,39}" title="字母开头，6到40位字母、数字、下划线或连字符"')}${field('联系手机号', 'phone', contact.phone || '', 'tel', 'maxlength="11" pattern="1[0-9]{10}" title="填写11位大陆手机号"')}${field('联系二维码URL（选填）', 'qrUrl', contact.qrUrl || '', 'text', 'placeholder="https://… 或已上传的站内二维码地址"')}</div><label class="check-field"><input type="checkbox" name="consent" ${contact.consent === true ? 'checked' : ''}><span>同意将以上联络方式向取得联系权限的用户展示，用于本平台经营沟通。</span></label><button class="btn primary">保存联络方式</button></fieldset><p class="tiny muted" style="margin-top:15px">可以随时关闭展示同意。平台不自动联系对方，复制联系方式不代表已经加微信好友。</p></form>`,
    bind(root) {
      root.querySelector('#contact-profile').onsubmit = (e) => {
        e.preventDefault();
        if (!canWrite) {
          toast('资质审核通过后才能设置联络方式。');
          return;
        }
        submit(e.submitter, async () => {
          const fd = new FormData(e.target),
            data = {
              wechat: String(fd.get('wechat') || '').trim(),
              phone: String(fd.get('phone') || '').trim(),
              qrUrl: String(fd.get('qrUrl') || '').trim(),
              consent: fd.has('consent')
            };
          if (data.consent && !data.wechat && !data.phone && !data.qrUrl)
            throw Error('同意展示时，请至少填写一种联络方式。');
          await patch('/profile/contact', data);
          const saved = (await get('/profile/contact')).contact;
          if (
            !saved ||
            Object.entries(data).some(([key, value]) =>
              key === 'consent' ? saved.consent !== value : String(saved[key] || '') !== value
            )
          )
            throw Error('联络方式回读不一致，请刷新后检查。');
          toast('联络方式已保存并回读确认。');
          window.dispatchEvent(new Event('qishu:refresh'));
        });
      };
      root.querySelector('#business-profile').onsubmit = (e) => {
        e.preventDefault();
        submit(e.submitter, async () => {
          const data = formData(e.target);
          for (const key of ['area', 'businessYears'])
            if (data[key] === '') delete data[key];
            else data[key] = Number(data[key]);
          data.operationNeeds = String(data.operationNeeds || '')
            .split(/[,，、\n]/)
            .map((v) => v.trim())
            .filter(Boolean);
          await patch('/profile', data);
          const read = (await get('/profile')).profile;
          if (
            !read ||
            Object.entries(data).some(([k, v]) =>
              Array.isArray(v)
                ? JSON.stringify(read[k]) !== JSON.stringify(v)
                : String(read[k] ?? '') !== String(v)
            )
          )
            throw Error('经营资料回读与提交不一致，请刷新后检查。');
          await refresh();
          toast('经营资料已保存并回读确认。');
          window.dispatchEvent(new Event('qishu:refresh'));
        });
      };
    }
  };
}
