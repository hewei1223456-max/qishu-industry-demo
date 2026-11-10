import { AppError, uid, audit, day, need } from './db.js';
import { requireUser, requireVerified, hasAdminPermission } from './auth.js';
import { validateAttachments, refreshPublishedMedia, normalizeAttachments } from './media.js';

export const isPublished = (x) =>
  !['hidden', 'deleted', 'rejected', 'pending', 'draft'].includes(x.state || '') &&
  (x.status === 'published' || x.published === true);
export const activeSubject = (x) =>
  !!x && x.enabled !== false && !['deleted', 'disabled', 'suspended', 'revoked'].includes(x.status);
const supplierAccount = (db, id) => {
  const direct = db.get('users', id);
  return direct?.role === 'supplier'
    ? direct
    : db
        .list('users')
        .find((x) => x.role === 'supplier' && x.companyId === id && activeSubject(x) && x.verified) || null;
};
export function publicItems(db, kind, query, config) {
  let items = db
    .list(kind)
    .filter(isPublished)
    .filter((x) => x.status !== 'hidden' && x.status !== 'deleted');
  const q = query.get('query') || query.get('q') || '';
  if (q)
    items = items.filter((x) =>
      (
        x.title +
        ' ' +
        (x.summary || '') +
        ' ' +
        (x.description || '') +
        ' ' +
        (x.body || '') +
        ' ' +
        (x.tags || []).join(' ')
      ).includes(q)
    );
  for (const key of ['style', 'origin', 'category', 'status']) {
    const value = query.get(key);
    if (value && value !== '全部') items = items.filter((x) => x[key] === value);
  }
  for (const [key, field, cmp] of [
    ['priceMin', 'price', (a, b) => a >= b],
    ['priceMax', 'price', (a, b) => a <= b],
    ['moqMax', 'moq', (a, b) => a <= b]
  ]) {
    const val = query.get(key);
    if (val !== null && val !== '' && Number.isFinite(Number(val)))
      items = items.filter((x) => cmp(Number(x[field]), Number(val)));
  }
  if (kind === 'products') {
    const order = config.originOrder || [];
    items.sort((a, b) => {
      const x = order.indexOf(a.origin),
        y = order.indexOf(b.origin);
      return (x < 0 ? 999 : x) - (y < 0 ? 999 : y);
    });
  }
  return items;
}
export function sanitizeItem(item, user, kind) {
  if (!item) return item;
  if (!user || (!user.verified && !hasAdminPermission(user, kind + ':read'))) {
    if (kind === 'products') {
      const { price, moq, supplierId, companyId, companyName, mix, delivery, ...safe } = item;
      return { ...safe, limited: true, price: null, moq: null, companyName: '认证后可见' };
    }
    return { ...item, body: String(item.summary || item.body || '').slice(0, 120), limited: true };
  }
  return item;
}
export function quota(db, user, config) {
  requireUser(user);
  if (hasAdminPermission(user, '*'))
    return { used: 0, limit: null, remaining: null, plan: '平台管理', unlimited: true };
  const company = user.companyId || user.id;
  const ent = db
    .list('entitlements')
    .filter(
      (x) =>
        x.companyId === company &&
        x.status === 'active' &&
        (!x.expiresAt || Date.parse(x.expiresAt) > Date.now())
    )
    .sort((a, b) => String(b.createdAt).localeCompare(a.createdAt))[0];
  const plan = ent ? db.get('plans', ent.planId) : db.get('plans', 'free');
  let limit = Number(
    ent?.dailyLimit ??
      (plan?.id === 'free' ? config.freeDailyLimit : plan?.dailyLimit) ??
      config.freeDailyLimit ??
      10
  );
  if (!Number.isFinite(limit) || limit < 0) limit = 0;
  const used = Number(
    db.raw.prepare('SELECT COUNT(*) AS n FROM quota_charges WHERE company_id=? AND day=?').get(company, day())
      .n
  );
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    plan: plan?.name || '免费版',
    planId: plan?.id || 'free',
    contactMethods: ent?.contactMethods ?? plan?.contactMethods ?? [],
    expiresAt: ent?.expiresAt || null,
    example: plan?.example === true
  };
}
export function createLead(db, user, body, config) {
  requireVerified(user);
  const supplier = user.role === 'supplier';
  if (!supplier && user.role !== 'owner' && user.role !== 'admin')
    throw new AppError(403, 'FORBIDDEN', '当前账号不能建立联系记录。');
  const requested = supplier ? need(body.buyerId, '请选择店主。') : need(body.supplierId, '请选择厂家。');
  const supplierTarget = supplier ? null : supplierAccount(db, requested);
  const recipient = supplier ? requested : supplierTarget?.id || requested;
  const buyer = supplier ? db.get('buyers', recipient) : null;
  if (
    supplier &&
    (!activeSubject(buyer) ||
      !buyer.public ||
      buyer.contactConsent !== true ||
      (buyer.userId &&
        (!activeSubject(db.get('users', buyer.userId)) || !db.get('users', buyer.userId)?.verified)))
  )
    throw new AppError(404, 'BUYER_UNAVAILABLE', '该店主暂不接受联系。');
  if (
    !supplier &&
    (!activeSubject(db.get('users', recipient)) ||
      db.get('users', recipient)?.role !== 'supplier' ||
      !db.get('users', recipient)?.verified)
  )
    throw new AppError(404, 'SUPPLIER_UNAVAILABLE', '厂家不存在。');
  return db.transaction(() => {
    const company = user.companyId || user.id;
    const existing = db
      .list('leads')
      .find(
        (x) =>
          x.createdBy === user.id &&
          (supplier ? x.buyerId === recipient : x.supplierId === recipient) &&
          x.day === day()
      );
    if (existing) return { lead: existing, quota: quota(db, user, config), deduplicated: true };
    if (supplier) {
      const q = quota(db, user, config);
      if (!q.contactMethods.length)
        throw new AppError(403, 'CONTACT_NOT_INCLUDED', '当前版本未开放主动联系，请联系平台调整权益。');
      const charge = db.raw
        .prepare('SELECT id FROM quota_charges WHERE company_id=? AND buyer_id=? AND day=?')
        .get(company, recipient, day());
      if (!charge) {
        if (q.remaining <= 0)
          throw new AppError(403, 'QUOTA_EXCEEDED', '今日免费额度已用完，可联系平台线下升级权益。');
        db.raw
          .prepare('INSERT INTO quota_charges(id,company_id,buyer_id,day) VALUES(?,?,?,?)')
          .run(uid('charge'), company, recipient, day());
      }
    }
    const lead = db.save('leads', {
      id: uid('lead'),
      createdBy: user.id,
      ownerId: user.id,
      companyId: supplier ? company : supplierTarget.companyId || recipient,
      supplierId: supplier ? company : recipient,
      buyerId: supplier ? recipient : null,
      buyerUserId: supplier ? buyer.userId : user.id,
      buyerName: supplier ? buyer.name : user.name,
      shop: supplier ? buyer.shop : user.shop,
      supplierName: supplier ? user.companyName : db.get('users', recipient)?.companyName,
      productId: body.productId || null,
      day: day(),
      status: '待回访',
      note: '',
      event: '联系意向',
      contactOutcome: '未知',
      friendAdded: false
    });
    audit(db, user, 'create-lead', lead.id, { charged: supplier });
    return {
      lead,
      quota: quota(db, user, config),
      notice: '已记录联系意向，不代表已添加微信或成交。'
    };
  });
}
export function visibleLeads(db, user) {
  requireUser(user);
  return db
    .list('leads')
    .filter(
      (x) =>
        hasAdminPermission(user, 'leads:read') ||
        x.createdBy === user.id ||
        x.companyId === user.companyId ||
        x.buyerUserId === user.id
    );
}
export function updateLead(db, user, id, body) {
  const lead = visibleLeads(db, user).find((x) => x.id === id);
  if (
    !lead ||
    (!hasAdminPermission(user, 'leads:write') &&
      lead.createdBy !== user.id &&
      lead.companyId !== user.companyId &&
      lead.buyerUserId !== user.id)
  )
    throw new AppError(404, 'NOT_FOUND', '联系记录不存在。');
  const statuses = ['待回访', '已回访', '待跟进', '无效', '已关闭', '已联系'];
  if (body.status && !statuses.includes(body.status)) throw new AppError(400, 'VALIDATION', '回访状态无效。');
  const updated = db.save('leads', {
    ...lead,
    status: body.status || lead.status,
    note: String(body.note ?? lead.note).slice(0, 3000),
    followedAt: new Date().toISOString(),
    contactOutcome: body.contactOutcome ? String(body.contactOutcome).slice(0, 100) : lead.contactOutcome
  });
  audit(db, user, 'update-lead', id);
  return updated;
}
export function leadContact(db, user, lead, config) {
  const record =
    user.role === 'supplier' ? db.get('buyers', lead.buyerId) : supplierAccount(db, lead.supplierId);
  const permitted =
    activeSubject(record) &&
    record.contactConsent === true &&
    (user.role === 'supplier'
      ? record.public === true &&
        (!record.userId ||
          (activeSubject(db.get('users', record.userId)) && db.get('users', record.userId)?.verified))
      : record.role === 'supplier' && record.verified);
  const c = permitted ? record?.publicContact : null;
  const methods = user.role === 'supplier' ? quota(db, user, config).contactMethods : ['wechat', 'qrcode'];
  const permits = (type) =>
    methods.includes(type) ||
    (type === 'wechat' && methods.some((x) => ['发起联系', '添加微信', '添加厂家微信'].includes(x))) ||
    (type === 'phone' && methods.includes('电话')) ||
    (type === 'qrcode' && methods.includes('二维码'));
  const channels = [];
  if (c?.wechat && permits('wechat'))
    channels.push({ type: 'wechat', value: String(c.wechat).slice(0, 100) });
  if (c?.phone && permits('phone')) channels.push({ type: 'phone', value: String(c.phone).slice(0, 30) });
  if (c?.qrUrl && permits('qrcode') && /^(\/|https:\/\/)/.test(c.qrUrl))
    channels.push({ type: 'qrcode', value: c.qrUrl });
  return {
    available: channels.length > 0,
    channels,
    message: channels.length
      ? '请通过以下已授权的方式联系，平台只记录意向。'
      : '当前权益内尚无可展示的真实联系信息，已记录联系意向；不能视为已加微信。'
  };
}
export function creatorList(db, user) {
  requireUser(user);
  return [
    ...db.list('content').map((x) => ({ ...x, kind: 'content' })),
    ...db.list('products').map((x) => ({ ...x, kind: 'product' })),
    ...db.list('fairs').map((x) => ({ ...x, kind: 'fair' }))
  ].filter(
    (x) =>
      hasAdminPermission(
        user,
        { content: 'content', product: 'products', fair: 'fairs' }[x.kind] + ':read'
      ) ||
      x.authorId === user.id ||
      (user.role === 'supplier' && x.companyId === user.companyId)
  );
}
export function saveCreation(db, user, body, id) {
  requireVerified(user);
  const kind = body.kind || 'content';
  const resource = {
    content: 'content',
    article: 'content',
    product: 'products',
    products: 'products',
    fair: 'fairs',
    fairs: 'fairs'
  }[kind];
  if (!resource) throw new AppError(400, 'VALIDATION', '发布类型无效。');
  if (resource !== 'content' && user.role !== 'supplier' && user.role !== 'admin')
    throw new AppError(403, 'FORBIDDEN', '货源和订货会需厂家身份。');
  const existing = id ? db.get(resource, id) : null;
  if (
    id &&
    (!existing ||
      (!hasAdminPermission(user, resource + ':write') &&
        existing.authorId !== user.id &&
        existing.companyId !== user.companyId))
  )
    throw new AppError(404, 'NOT_FOUND', '内容不存在。');
  need(String(body.title || existing?.title || '').trim(), '请填写标题。');
  const status = ['draft', 'hidden'].includes(body.status) ? body.status : 'pending';
  const allowed = [
    'title',
    'body',
    'summary',
    'description',
    'category',
    'image',
    'images',
    'media',
    'tags',
    'style',
    'origin',
    'price',
    'moq',
    'delivery',
    'mix',
    'location',
    'date',
    'capacity',
    'stockStatus',
    'supplyStatus',
    'fileId',
    'fileIds',
    'files'
  ];
  const fields = {};
  for (const key of allowed) if (Object.hasOwn(body, key)) fields[key] = body[key];
  if (fields.price !== undefined && (!Number.isFinite(Number(fields.price)) || Number(fields.price) < 0))
    throw new AppError(400, 'VALIDATION', '价格须为非负数。');
  if (fields.moq !== undefined && (!Number.isFinite(Number(fields.moq)) || Number(fields.moq) < 1))
    throw new AppError(400, 'VALIDATION', '起批量须大于零。');
  if (resource === 'products') {
    fields.supplyStatus =
      body.supplyStatus || body.stockStatus || existing?.supplyStatus || existing?.stockStatus || '现货';
    if (!['现货', '预售'].includes(fields.supplyStatus))
      throw new AppError(400, 'VALIDATION', '供货状态应为现货或预售。');
    fields.stockStatus = fields.supplyStatus;
    fields.state = status;
  }
  validateAttachments(db, user, { ...existing, ...fields });
  const item = db.save(resource, {
    ...existing,
    ...normalizeAttachments(db, fields),
    id: existing?.id || uid(resource),
    authorId: existing?.authorId || user.id,
    author: existing?.author || user.name,
    ownerId: existing?.ownerId || user.id,
    companyId: existing?.companyId || user.companyId,
    companyName: existing?.companyName || user.companyName || user.shop,
    ...(resource === 'products' ? { supplierId: existing?.supplierId || user.id } : {}),
    status: resource === 'products' ? fields.supplyStatus : status,
    published: false,
    demo: false,
    source: body.source || '用户发布'
  });
  if (existing) refreshPublishedMedia(db, existing);
  refreshPublishedMedia(db, item);
  audit(db, user, 'submit-content', item.id, { resource, status });
  return {
    ...item,
    status,
    kind: resource === 'products' ? 'product' : resource === 'fairs' ? 'fair' : 'content'
  };
}
