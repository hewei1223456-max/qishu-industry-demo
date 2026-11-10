import { decorateCertificate } from './certificate-policy.js';
const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[\s，,。.;；:：()（）·_-]/g, '')
    .toLowerCase();
const industry = (value) => /服装|服饰|女装/.test(value) && /批发|零售/.test(value);

export function startCertificatePrecheck(db, ai, user, application) {
  const provider = db.list('providers').some((p) => p.enabled && p.secret && p.capabilities?.includes('ocr'));
  let precheck = {
    ...application.precheck,
    ocrStatus: provider ? 'queued' : 'not-configured',
    notice: 'AI仅辅助文字识别及填报一致性提示，不验证执照真伪；最终由人工审核。'
  };
  if (provider) {
    try {
      const job = ai.create(user, {
        task: 'ocr',
        fileId: application.licenseFileId,
        message:
          '识别这张营业执照，仅依据图片可辨认文字返回JSON：{"companyName":"经营主体名称","businessScope":"经营范围","registrationNumber":"统一社会信用代码或空字串","uncertainFields":[]}。看不清的字段留空并加入uncertainFields，不猜测补全，不判断真伪，不作认证通过结论。'
      });
      precheck = { ...precheck, jobId: job.id, ocrStatus: job.status };
    } catch (error) {
      precheck = {
        ...precheck,
        ocrStatus: 'failed',
        error: {
          code: error.code || 'OCR_QUEUE_FAILED',
          message: 'AI预审任务未创建，资料仍等待人工审核。'
        }
      };
    }
  }
  return db.save('certifications', { ...application, precheck });
}

function refreshCertificateOcr(db, application) {
  const id = application.precheck?.jobId;
  if (!id) return application;
  const job = db.get('jobs', id);
  if (!job) return application;
  const precheck = { ...application.precheck, ocrStatus: job.status };
  if (job.status === 'failed') {
    precheck.error = job.error;
    precheck.notice = 'AI识别失败或未接通，仍等待人工审核，不能视为资质通过。';
  }
  if (job.status === 'completed') {
    const text = String(job.result?.text || '').slice(0, 20000);
    let fields = null;
    try {
      fields = JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    } catch {}
    const companyName = typeof fields?.companyName === 'string' ? fields.companyName.slice(0, 300) : '',
      businessScope = typeof fields?.businessScope === 'string' ? fields.businessScope.slice(0, 3000) : '';
    const same = (extracted, submitted) =>
      !extracted
        ? '未识别，待人工核对'
        : normalize(extracted) === normalize(submitted)
          ? '识别文字与填报一致，仅供人工参考'
          : '识别文字与填报存在差异，需人工核对';
    precheck.extracted = {
      companyName,
      businessScope,
      registrationNumber:
        typeof fields?.registrationNumber === 'string' ? fields.registrationNumber.slice(0, 80) : '',
      uncertainFields: Array.isArray(fields?.uncertainFields)
        ? fields.uncertainFields.map((x) => String(x).slice(0, 100)).slice(0, 30)
        : ['未返回有效结构化识别字段']
    };
    precheck.consistency = {
      company: same(companyName, application.company),
      scope: same(businessScope, application.scope),
      industry: businessScope
        ? industry(businessScope)
          ? '识别范围符合服装批发/零售准入，无需另证女装'
          : '识别范围待人工判断'
        : '经营范围尚待识别'
    };
    precheck.ocrText = text;
    precheck.notice = 'AI识别完成，仅比对文字；未验证执照真伪，仍由人工决定认证状态。';
    delete precheck.error;
  }
  if (JSON.stringify(precheck) !== JSON.stringify(application.precheck))
    return db.save('certifications', { ...application, precheck });
  return { ...application, precheck };
}

export function certificationView(db, application, { scope = 'front' } = {}) {
  return decorateCertificate(db, refreshCertificateOcr(db, application), scope);
}
