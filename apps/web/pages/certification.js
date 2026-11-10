import { get, post, patch, upload, itemsOf } from '../core/api.js';
import { state, refresh } from '../core/state.js';
import { isBackWorkspace, privateMediaUrl } from '../core/workspace.js';
import { icon } from '../components/icons.js';
import {
  esc,
  img,
  badge,
  pageHead,
  empty,
  field,
  formData,
  submit,
  toast,
  modal,
  closeModal,
  certificationPrecheck
} from '../components/ui.js';

const missingLabel = (value) =>
  ({
    licenseFileId: '营业执照',
    venueVideoFileId: '场所视频',
    venuePhotoFileIds: '5张不同的场所照片',
    phoneReview: '电话回访',
    videoDuration: '不少于30秒的有效视频'
  })[value] || value;
const videoLabel = (status) =>
  ({ verified: '服务端时长已核验', invalid: '视频不符合要求', missing: '未提交有效视频' })[status] ||
  '等待服务端核验';
const reviewLabel = (status) =>
  ({ passed: '电话核对通过', failed: '电话核对未通过', pending: '待电话回访' })[status] || '待电话回访';
const fileUrl = (file) => file?.url || (file?.id ? '/api/files/' + encodeURIComponent(file.id) : '');
const supplierApplication = (application) =>
  application.applicantRole === 'supplier' ||
  !!application.venueVideoFileId ||
  application.missingFields?.some((value) => /场所|视频|照片|电话/.test(String(value)));

export function certificateApprovalReady(application) {
  const complete = Array.isArray(application.missingFields) && application.missingFields.length === 0;
  return (
    complete &&
    (!supplierApplication(application) ||
      (application.videoVerification?.status === 'verified' && application.phoneReview?.status === 'passed'))
  );
}

export function certificateMaterials(application) {
  const materials = application.materials || {},
    video = materials.venueVideo,
    photos = materials.venuePhotos || [];
  const verification = application.videoVerification || {},
    phone = application.phoneReview || {};
  const supplier = supplierApplication(application);
  return `<div class="certificate-materials"><div class="label-row">${supplier ? badge(videoLabel(verification.status), verification.status === 'verified' ? 'positive' : 'subtle') + badge(reviewLabel(phone.status), phone.status === 'passed' ? 'positive' : 'warning') : badge('店主营业执照材料', 'subtle')}</div>${application.missingFields?.length ? `<div class="notice warning">待补齐：${application.missingFields.map((value) => esc(missingLabel(value))).join('、')}</div>` : ''}<details><summary>查看审核材料（私有，仅本人和有审核权限的人员可见）</summary><div class="certificate-material-grid"><section><h4>营业执照</h4>${materials.license ? img(fileUrl(materials.license), '私有营业执照', 'certificate-license') : '<p class="muted small">尚未提供可查看的营业执照。</p>'}</section>${video ? `<section><h4>经营场所视频</h4><video controls playsinline preload="none" src="${esc(privateMediaUrl(fileUrl(video)))}"></video><p class="tiny muted">${verification.durationSeconds != null ? '服务端识别时长：' + Number(verification.durationSeconds).toFixed(1) + '秒' : '服务端尚未核验有效时长'}；来源：${esc(verification.source || '待核验')}</p></section>` : ''}${photos.length ? `<section class="certificate-photo-section"><h4>经营场所照片 · ${photos.length}张</h4><div class="certificate-photos">${photos.map((photo, index) => img(fileUrl(photo), '场所照片' + (index + 1))).join('')}</div></section>` : ''}</div></details>${phone.phone ? `<div class="phone-review-record"><h4>最近电话回访</h4><p>${esc(phone.phone)} · ${esc(reviewLabel(phone.status))}</p><p>${esc(phone.note || '')}</p><small>${esc(phone.reviewerName || phone.reviewerId || '审核人员')} · ${esc(phone.calledAt || phone.recordedAt || '')}</small></div>` : ''}</div>`;
}

async function browserVideoDuration(file) {
  return new Promise((resolve) => {
    const element = document.createElement('video'),
      url = URL.createObjectURL(file);
    const finish = (value) => {
      clearTimeout(timer);
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 12000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) ? element.duration : null);
    element.onerror = () => finish(null);
    element.src = url;
  });
}

export async function certification() {
  if (state.user?.role === 'admin')
    return {
      html:
        pageHead('平台管理员身份', '管理员权限由平台授权和本人微信、手机号绑定取得。') +
        '<section class="panel registration-panel"><h2>本页不能自助开通管理员权限</h2><p>经营资料认证不会将账号变为管理员，也不会扩大已有权限。请由最高权限管理员在独立后台登记手机号并分配权限。</p><a class="btn primary" href="#/login">返回本端登录</a></section>'
    };
  const supplier = state.user?.role === 'supplier';
  const applications = itemsOf(await get('/certifications'));
  const identityLabels = isBackWorkspace()
    ? [
        ['supplier', '厂家后台'],
        ['admin', '平台管理员后台']
      ]
    : [
        ['owner', '店主'],
        ['supplier', '厂家'],
        ['admin', '平台管理员']
      ];
  return {
    html:
      pageHead(
        supplier ? '厂家经营主体认证' : '店主经营主体认证',
        '材料上传后由服务端校验，AI辅助预审，平台人工终审。'
      ) +
      `<div class="label-row certification-identities">${identityLabels.map(([role, label]) => badge(label, state.user?.role === role ? 'positive' : 'subtle')).join('')}<a class="text-link tiny" href="#/login">更换身份请返回本端登录</a></div><div class="two-columns"><form class="panel" id="certification-form"><h2>提交经营资料</h2>${field('企业或店铺主体名称', 'company', state.user?.companyName || '', 'text', 'required')}${field('营业执照经营范围', 'scope', '', 'textarea', 'required rows="4" placeholder="例如：服装批发、服装零售"')}<label class="field"><span>营业执照图片</span><input type="file" id="license-file" accept="image/jpeg,image/png,image/webp" required><small>证照私有保存，不进入公开内容。</small></label><div id="license-preview"></div>${supplier ? `<section class="venue-material-form"><h3>经营场所材料</h3><p class="muted small">档口、展厅、公司、车间任选，视频应能看清实际经营场所。</p><label class="field"><span>场所视频 · 至少30秒</span><input type="file" id="venue-video-file" accept="video/mp4,video/webm,video/quicktime" required><small>建议MP4，单文件不超过300MB。浏览器只作即时预检，最终时长由服务端读取。</small></label><p class="tiny muted" id="venue-video-status">尚未选择视频。</p><div id="venue-video-preview"></div><label class="field"><span>5张不同的场所照片</span><input type="file" id="venue-photo-files" accept="image/jpeg,image/png,image/webp" multiple required><small>请选择5张不同的照片，服务端还会检查文件归属和真实图片。</small></label><div class="certificate-photos" id="venue-photo-preview"></div></section>` : ''}<label class="check-field"><input type="checkbox" required><span>我确认已获主体授权，并同意平台在审核范围内处理这些私有材料。</span></label><div class="notice">材料仅本人及有审核权限的工作人员可查看。文件上传、视频时长校验或AI识别完成，都不等于审核通过。</div><button class="btn primary full">提交人工审核</button><p class="tiny muted" id="certification-upload-progress"></p></form><section class="panel"><h2>审核记录</h2>${applications.length ? applications.map((application) => `<article class="audit-record" data-application="${esc(application.id)}"><div class="section-line"><strong>${esc(application.company)}</strong>${badge(application.status || 'pending', 'subtle')}</div><p>${esc(application.scope)}</p>${application.reason ? `<p class="small muted">${esc(application.reason)}</p>` : ''}${certificateMaterials(application)}${certificationPrecheck(application)}</article>`).join('') : empty('尚未提交材料', '提交后可查看服务端校验、AI预审和人工审核状态。')}</section></div>`,
    bind(root) {
      let license = null,
        venueVideo = null,
        venuePhotos = [],
        duration = null,
        checking = false;
      const previewUrls = [];
      const previewUrl = (file) => {
        const url = URL.createObjectURL(file);
        previewUrls.push(url);
        return url;
      };
      root.querySelector('#license-file').onchange = (event) => {
        license = event.target.files[0];
        root.querySelector('#license-preview').innerHTML = license
          ? img(previewUrl(license), '待提交营业执照', 'license-preview')
          : '';
      };
      root.querySelector('#venue-video-file')?.addEventListener('change', async (event) => {
        venueVideo = event.target.files[0] || null;
        duration = null;
        checking = false;
        const file = venueVideo,
          status = root.querySelector('#venue-video-status');
        root.querySelector('#venue-video-preview').innerHTML = '';
        if (!file) {
          status.textContent = '尚未选择视频。';
          return;
        }
        if (file.size > 300 * 1024 * 1024) {
          status.textContent = '视频超过300MB，请压缩后重新选择。';
          return;
        }
        checking = true;
        status.textContent = '浏览器正在预读视频时长…';
        const value = await browserVideoDuration(file);
        if (venueVideo !== file || !root.isConnected) return;
        checking = false;
        duration = value;
        status.textContent =
          value == null
            ? '浏览器未能读取时长，上传后仍需服务端校验。'
            : value < 30
              ? `当前视频约${value.toFixed(1)}秒，不足30秒，请重新选择。`
              : `浏览器预读约${value.toFixed(1)}秒；此结果不代替服务端验证。`;
        root.querySelector('#venue-video-preview').innerHTML =
          `<video controls playsinline preload="metadata" src="${esc(previewUrl(file))}"></video>`;
      });
      root.querySelector('#venue-photo-files')?.addEventListener('change', (event) => {
        venuePhotos = [...event.target.files];
        root.querySelector('#venue-photo-preview').innerHTML = venuePhotos
          .map((file, index) => img(previewUrl(file), '待提交场所照片' + (index + 1)))
          .join('');
      });
      root.querySelector('#certification-form').onsubmit = (event) => {
        event.preventDefault();
        submit(event.submitter, async () => {
          if (!license) throw Error('请先选择营业执照图片。');
          if (supplier) {
            if (!venueVideo) throw Error('请先选择至少30秒的场所视频。');
            if (checking) throw Error('视频即时预检尚未结束，请稍候。');
            if (venueVideo.size > 300 * 1024 * 1024) throw Error('视频超过300MB。');
            if (duration != null && duration < 30) throw Error('场所视频不足30秒，请重新选择。');
            if (venuePhotos.length !== 5) throw Error('请选择5张不同的场所照片。');
            if (new Set(venuePhotos.map((file) => `${file.name}:${file.size}:${file.lastModified}`)).size < 5)
              throw Error('请至少选择5张不同场所照片。');
          }
          const progress = root.querySelector('#certification-upload-progress');
          progress.textContent = '正在上传营业执照…';
          const body = {
            ...formData(event.target),
            licenseFileId: (await upload(license, true, 'license')).id
          };
          if (supplier) {
            progress.textContent = '正在上传场所视频，请保持页面打开…';
            body.venueVideoFileId = (await upload(venueVideo, true, 'certification_video')).id;
            body.venuePhotoFileIds = [];
            for (const photo of venuePhotos) {
              progress.textContent = `正在上传场所照片 ${body.venuePhotoFileIds.length + 1}/${venuePhotos.length}…`;
              body.venuePhotoFileIds.push((await upload(photo, true, 'certification_photo')).id);
            }
          }
          progress.textContent = '正在提交材料，等待服务端校验…';
          await post('/certifications', body, { timeout: 240000 });
          await refresh();
          toast('材料已提交，等待服务端核验与人工审核。');
          window.dispatchEvent(new Event('qishu:refresh'));
        });
      };
      root.addEventListener('click', (event) => {
        const button = event.target.closest('[data-refresh-cert]');
        if (!button) return;
        submit(button, async () => {
          const fresh = itemsOf(await get('/certifications')).find(
            (application) => application.id === button.dataset.refreshCert
          );
          if (!fresh) throw Error('未找到本人可查看的认证申请。');
          const article = button.closest('[data-application]');
          article.querySelector('.certificate-materials').outerHTML = certificateMaterials(fresh);
          button.closest('.cert-precheck').outerHTML = certificationPrecheck(fresh);
        });
      });
      return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
    }
  };
}

function canReview() {
  const permissions = state.user?.permissions;
  return (
    state.user?.role === 'admin' &&
    (!Array.isArray(permissions) ||
      permissions.some((value) => ['*', 'certifications:*', 'certifications:write'].includes(value)))
  );
}

export async function reviewCertifications() {
  const applications = itemsOf(await get('/admin/certifications'));
  return {
    html:
      pageHead('经营资质审核', '查看私有材料、服务端校验和电话回访记录，再作人工决定。') +
      '<div class="sub-tabs"><a class="active" href="#/admin/users">资质审核</a><a href="#/admin/users?tab=buyers">公开店主资料</a><a href="#/admin/users?tab=admins">管理员授权</a></div>' +
      `<section class="panel table-panel"><div class="table-heading"><h2>待处理与历史申请</h2><span>${applications.length} 条</span></div>${applications.length ? `<div class="table-scroll"><table><thead><tr><th>经营主体</th><th>材料校验</th><th>电话回访</th><th>人工审核</th><th>操作</th></tr></thead><tbody>${applications.map((application) => `<tr><td><strong>${esc(application.company)}</strong><small>${esc(application.scope)}</small></td><td>${badge(application.missingFields?.length ? '材料待补齐' : '查看服务端核验', application.missingFields?.length ? 'warning' : 'subtle')}<small>${esc(supplierApplication(application) ? videoLabel(application.videoVerification?.status) : '店主营业执照材料')}</small></td><td>${supplierApplication(application) ? badge(reviewLabel(application.phoneReview?.status), application.phoneReview?.status === 'passed' ? 'positive' : 'warning') : badge('按店主材料审核', 'subtle')}</td><td>${badge(application.status || 'pending')}</td><td><button class="btn small" data-review-application="${esc(application.id)}">查看材料与回访</button></td></tr>`).join('')}</tbody></table></div>` : empty('暂无认证申请', '厂家或店主提交后会在这里进入审核队列。')}</section>`,
    bind(root) {
      root.querySelectorAll('[data-review-application]').forEach((button) => {
        button.onclick = () =>
          submit(button, async () => {
            const response = await get(
              '/admin/certifications/' + encodeURIComponent(button.dataset.reviewApplication)
            );
            openReview(response.item);
          });
      });
    }
  };
}

function openReview(application) {
  const supplier = supplierApplication(application);
  const canApprove = canReview() && certificateApprovalReady(application);
  const phone = application.phoneReview || {};
  const root = modal(
    '经营资质材料与电话回访',
    `<div class="section-line"><h3>${esc(application.company)}</h3>${badge(application.status || 'pending')}</div><p>${esc(application.scope)}</p>${certificateMaterials(application)}${certificationPrecheck(application)}${canReview() ? `${supplier ? `<form id="phone-review-form" class="phone-review-form"><h3>记录实际电话回访</h3>${field('实际拨打的联系手机号', 'phone', phone.phone || '', 'tel', 'required pattern="1[0-9]{10}" maxlength="11"')}<label class="field"><span>核对结果</span><select name="result"><option value="confirmed">已接通，核对一致</option><option value="unreachable">未接通，待再次回访</option><option value="inconsistent">信息不一致</option><option value="rejected">拒绝核对</option></select></label>${field('实际回访记录与核对依据', 'note', '', 'textarea', 'required rows="4"')}<label class="check-field"><input type="checkbox" name="confirmedCall" required><span>我确认已实际拨打电话，并按事实记录结果。</span></label><button class="btn primary full">保存电话回访记录</button></form>` : ''}<div class="review-decision"><div class="notice">${canApprove ? (supplier ? '材料条件与电话核对已满足，可由人工作出最终审核决定。' : '店主营业执照材料条件已满足，由人工作出最终审核决定。') : '材料缺失、视频校验未通过或电话回访未通过时，不能批准。'}AI预审不能自动批准。</div><button class="btn primary" id="approve-certification" ${canApprove ? '' : 'disabled'}>人工审核通过</button><button class="btn" id="reject-certification">退回补充 / 不通过</button></div>` : '<div class="notice">当前账号仅可查看材料，不能记录回访或审批。</div>'}`,
    'certificate-review-modal'
  );
  root.querySelector('[data-refresh-cert]')?.addEventListener('click', (event) =>
    submit(event.currentTarget, async () => {
      const response = await get('/admin/certifications/' + encodeURIComponent(application.id));
      openReview(response.item);
    })
  );
  root.querySelector('#phone-review-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(event.submitter, async () => {
      const data = formData(event.target);
      data.confirmedCall = new FormData(event.target).has('confirmedCall');
      await post('/admin/certifications/' + encodeURIComponent(application.id) + '/phone-review', data);
      const response = await get('/admin/certifications/' + encodeURIComponent(application.id));
      openReview(response.item);
      toast('电话回访已保存，服务端已更新审核条件。');
    });
  });
  root.querySelector('#approve-certification')?.addEventListener('click', (event) =>
    submit(event.currentTarget, async () => {
      root.querySelector('#approve-certification').textContent = '正在核验材料并提交审批…';
      await patch(
        '/admin/certifications/' + encodeURIComponent(application.id),
        { status: 'approved' },
        { timeout: 240000 }
      );
      closeModal();
      toast('人工审核结果已保存。');
      window.dispatchEvent(new Event('qishu:refresh'));
    })
  );
  root.querySelector('#reject-certification')?.addEventListener('click', () => {
    const reasonModal = modal(
      '退回补充 / 不通过',
      `<form id="reject-cert-form"><label class="field"><span>审核决定</span><select name="status"><option value="needs_info">退回补充</option><option value="rejected">审核不通过</option></select></label>${field('具体原因', 'reason', '', 'textarea', 'required rows="4"')}<button class="btn primary full">保存人工审核决定</button></form>`
    );
    reasonModal.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      submit(event.submitter, async () => {
        await patch('/admin/certifications/' + encodeURIComponent(application.id), formData(event.target));
        closeModal();
        window.dispatchEvent(new Event('qishu:refresh'));
        toast('人工审核结果已保存。');
      });
    };
  });
}
