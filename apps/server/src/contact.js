import { AppError, audit } from './db.js';
import { requireUser, requireVerified } from './auth.js';
import { persistentUser } from './auth.js';

export function contactOf(user) {
  requireUser(user);
  const c = user.publicContact || {};
  return {
    wechat: c.wechat || '',
    phone: c.phone || '',
    qrUrl: c.qrUrl || '',
    consent: user.contactConsent === true
  };
}
export function saveContact(db, user, body) {
  requireVerified(user);
  if (Object.keys(body).some((k) => !['wechat', 'phone', 'qrUrl', 'consent'].includes(k)))
    throw new AppError(400, 'INVALID_CONTACT', '联系方式字段无效。');
  const old = contactOf(user),
    c = { ...old, ...body };
  if (typeof c.consent !== 'boolean')
    throw new AppError(400, 'CONTACT_CONSENT_REQUIRED', '请明确选择是否授权展示联系方式。');
  for (const key of ['wechat', 'phone', 'qrUrl']) {
    if (typeof c[key] !== 'string') throw new AppError(400, 'INVALID_CONTACT', '联系方式必须为文字。');
    c[key] = c[key].trim();
  }
  if (c.wechat && !/^[a-zA-Z][a-zA-Z0-9_-]{5,39}$/.test(c.wechat))
    throw new AppError(400, 'INVALID_WECHAT', '微信号应为字母开头的6至40位字母、数字、下划线或减号。');
  if (c.phone && !/^1[3-9]\d{9}$/.test(c.phone))
    throw new AppError(400, 'INVALID_PHONE', '联系电话应为有效格式的中国大陆11位手机号。');
  let qr = null;
  if (c.qrUrl) {
    if (c.qrUrl.length > 2000) throw new AppError(400, 'INVALID_QR', '二维码链接过长。');
    const local = /^\/api\/files\/([a-zA-Z0-9_-]+)$/.exec(c.qrUrl);
    if (local) {
      qr = db.get('files', local[1]);
      if (
        !qr ||
        qr.ownerId !== user.id ||
        qr.public ||
        !['content', 'contact'].includes(qr.purpose) ||
        !qr.mime?.startsWith('image/')
      )
        throw new AppError(
          403,
          'INVALID_QR',
          '请使用本人单独上传、尚未公开的联络二维码图片，不能复用执照或诊断原件。'
        );
    } else {
      let url;
      try {
        url = new URL(c.qrUrl);
      } catch {}
      if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new AppError(400, 'INVALID_QR', '二维码应使用HTTPS链接或本人上传的图片。');
    }
  }
  if (c.consent && !c.wechat && !c.phone && !c.qrUrl)
    throw new AppError(400, 'EMPTY_CONTACT', '授权展示时请至少填写一种联系方式。');
  return db.transaction(() => {
    if (qr) db.save('files', { ...qr, purpose: 'contact', public: false });
    const publicContact = { wechat: c.wechat, phone: c.phone, qrUrl: c.qrUrl };
    db.save('users', { ...persistentUser(db, user), publicContact, contactConsent: c.consent });
    const buyers = db.list('buyers').filter((x) => x.userId === user.id);
    for (const buyer of buyers) db.save('buyers', { ...buyer, publicContact, contactConsent: c.consent });
    audit(db, user, 'update-public-contact', user.id, {
      consent: c.consent,
      channels: ['wechat', 'phone', 'qrUrl'].filter((k) => c[k]),
      linkedBuyers: buyers.length
    });
    return {
      contact: c,
      linkedBuyers: buyers.length,
      notice: c.consent
        ? '已授权按身份、额度和渠道权限展示；不代表已经加微信。'
        : '已撤回对外联系方式授权，旧联系记录不会再次返回联系方式。'
    };
  });
}
