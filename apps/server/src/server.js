import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase, AppError, uid, now, audit, need } from './db.js';
import { seed } from './seed.js';
import {
  readConfig,
  publicConfig,
  dictionaries,
  publishConfig,
  rollbackConfig,
  ensureFeature
} from './config.js';
import {
  userForRequest,
  requireUser,
  requireAdmin,
  requireVerified,
  demoLogin,
  logout,
  safeUser,
  hasAdminPermission,
  requestScope,
  persistentUser,
  projectIdentity
} from './auth.js';
import {
  publicItems,
  sanitizeItem,
  quota,
  createLead,
  visibleLeads,
  updateLead,
  creatorList,
  saveCreation,
  leadContact,
  activeSubject
} from './catalog.js';
import { trainModel, recommendations, saveEvent, modelSummary } from './recommendation.js';
import { createSecretStore, safeProvider } from './secrets.js';
import { createAiService, ownKnowledge, validateProviderUrl } from './ai.js';
import { importerBridge } from './imports.js';
import { createWechatAuth } from './wechat.js';
import { validateAttachments, refreshPublishedMedia } from './media.js';
import { profileOf, saveProfile } from './profile.js';
import { createMediaPreviews } from './previews.js';
import { startCertificatePrecheck, certificationView } from './certification.js';
import { sniffMime } from './file-types.js';
import { contactOf, saveContact } from './contact.js';
import {
  migrateSupplierCertificationPolicy,
  validateCertificateMaterials,
  assertCertificateApprovable,
  recordPhoneReview
} from './certificate-policy.js';
import { uploadCertificateVideo, CERT_VIDEO_LIMIT } from './certificate-upload.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}
async function bufferBody(req, limit = 2 * 1024 * 1024) {
  let total = 0;
  const parts = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new AppError(413, 'TOO_LARGE', '请求过大，请分片上传大文件。');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
async function bodyJson(req) {
  const buffer = await bufferBody(req);
  if (!buffer.length) return {};
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw new AppError(400, 'INVALID_JSON', '请求内容不是有效JSON对象。');
  }
}
function cleanProvider(p) {
  return { ...safeProvider(p), hasKey: !!p.secret, maskedKey: p.secret ? '••••••••' : null };
}
function checkOwned(user, item) {
  if (!item || (item.ownerId !== user.id && !hasAdminPermission(user, '*')))
    throw new AppError(404, 'NOT_FOUND', '资料不存在。');
}
function canReviewFile(user, file) {
  return (
    hasAdminPermission(user, 'files:read') ||
    (['license', 'certification_photo', 'certification_video'].includes(file.purpose) &&
      hasAdminPermission(user, 'certifications:read')) ||
    (file.purpose === 'content' &&
      ['content', 'products', 'fairs'].some(
        (kind) => hasAdminPermission(user, kind + ':read') || hasAdminPermission(user, kind + ':write')
      )) ||
    (file.purpose === 'generated' && hasAdminPermission(user, 'jobs:read')) ||
    (file.purpose === 'knowledge' && hasAdminPermission(user, 'knowledge:read'))
  );
}
function creatorShape(item, kind) {
  return {
    ...item,
    kind,
    status: kind === 'product' ? item.state || 'pending' : item.status,
    supplyStatus: kind === 'product' ? item.supplyStatus || item.stockStatus || item.status : undefined
  };
}

export function createApp(options = {}) {
  const demoEnabled =
    options.demoAuth ?? (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEMO_AUTH !== 'false');
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || join(ROOT, 'data'));
  mkdirSync(dataDir, { recursive: true });
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(options.dbPath || process.env.DB_PATH || join(dataDir, 'platform.sqlite'));
  try {
    seed(db, { demo: options.seedDemo ?? demoEnabled });
  } catch (error) {
    db.close();
    throw error;
  }
  const secrets = createSecretStore(join(dataDir, 'secrets.key'), {
    memory: options.dbPath === ':memory:'
  });
  const previews = createMediaPreviews(db, secrets);
  const ai = createAiService({
    db,
    secrets,
    uploadDir,
    getConfig: () => readConfig(db),
    ...options.ai
  });
  const wechat = createWechatAuth({ db, ...options.wechat });
  migrateSupplierCertificationPolicy(db);
  function presentCertificate(req, user, item) {
    const scope = requestScope(req),
      value = certificationView(db, item, { scope });
    const attach = (file) => {
      if (!file || !user?.authSessionHash) return file;
      const ticket = secrets.encrypt(
        JSON.stringify({
          kind: 'certification-material',
          fileId: file.id,
          viewerId: user.id,
          sessionHash: user.authSessionHash,
          scope,
          expiresAt: Date.now() + 10 * 60 * 1000
        })
      );
      return {
        ...file,
        url: `/api/files/${file.id}?scope=${scope}&certificateTicket=${encodeURIComponent(ticket)}`
      };
    };
    return {
      ...value,
      materials: {
        license: attach(value.materials?.license),
        venueVideo: attach(value.materials?.venueVideo),
        venuePhotos: (value.materials?.venuePhotos || []).map(attach)
      }
    };
  }
  function certificateTicketPermits(req, file, url) {
    const token = url.searchParams.get('certificateTicket');
    if (
      !token ||
      token.length > 2500 ||
      !['license', 'certification_photo', 'certification_video'].includes(file.purpose)
    )
      return false;
    try {
      const t = JSON.parse(secrets.decrypt(token));
      if (
        t.kind !== 'certification-material' ||
        t.fileId !== file.id ||
        t.scope !== requestScope(req) ||
        t.expiresAt < Date.now() ||
        t.expiresAt > Date.now() + 605000
      )
        return false;
      const current = userForRequest(db, req);
      if (!current || current.authSessionHash !== t.sessionHash || current.id !== t.viewerId) return false;
      const s = db.raw
        .prepare('SELECT user_id,requested_role FROM sessions WHERE hash=? AND scope=? AND expires>?')
        .get(t.sessionHash, t.scope, Date.now());
      if (!s || s.user_id !== t.viewerId) return false;
      const viewer = projectIdentity(db, db.get('users', s.user_id), t.scope, s.requested_role);
      return (
        viewer &&
        (file.ownerId === viewer.id ||
          (t.scope === 'back' && hasAdminPermission(viewer, 'certifications:read')))
      );
    } catch {
      return false;
    }
  }
  if (
    process.env.BOOTSTRAP_ADMIN_PHONE &&
    db.list('admins').length === 0 &&
    !db.get('meta', 'bootstrap-admin-initialized')
  ) {
    if (!/^1\d{10}$/.test(process.env.BOOTSTRAP_ADMIN_PHONE))
      throw Error('BOOTSTRAP_ADMIN_PHONE must be an 11 digit mainland phone number');
    db.save('admins', {
      id: 'bootstrap-admin',
      name: '首次初始化平台管理员',
      phone: process.env.BOOTSTRAP_ADMIN_PHONE,
      permissions: ['*'],
      status: 'pending-binding',
      bindingVerified: false
    });
    db.save('meta', { id: 'bootstrap-admin-initialized', at: now() });
  }
  let importer = null;
  const ingestionReady = import(new URL('../../../packages/ingestion/index.mjs', import.meta.url).href)
    .then((mod) => {
      if (mod.createIngestionService)
        importer = mod.createIngestionService({ dataDir, ...importerBridge(db, ai) });
    })
    .catch(() => {});

  async function handleAdmin(req, res, url, user, parts) {
    const resource = parts[2],
      id = parts[3],
      method = req.method;
    requireAdmin(user, `${resource}:${method === 'GET' ? 'read' : 'write'}`);
    if (resource === 'certifications' && id && parts[4] === 'phone-review' && method === 'POST') {
      const old = db.get('certifications', id);
      if (!old) throw new AppError(404, 'NOT_FOUND', '认证申请不存在。');
      const item = recordPhoneReview(db, user, old, await bodyJson(req));
      return json(res, 200, { item: presentCertificate(req, user, item) });
    }
    if (resource === 'admins' && method !== 'GET') requireAdmin(user, '*');
    if (resource === 'config') {
      if (method === 'GET') return json(res, 200, { config: readConfig(db) });
      if (method === 'POST' && id === 'rollback') return json(res, 200, { config: rollbackConfig(db, user) });
      if (['PUT', 'PATCH', 'POST'].includes(method)) {
        const b = await bodyJson(req);
        return json(res, 200, { config: publishConfig(db, user, b.config || b) });
      }
    }
    if (resource === 'metrics' && method === 'GET') {
      const events = db.raw.prepare('SELECT type,COUNT(*) count FROM events GROUP BY type').all();
      return json(res, 200, {
        users: db.list('users').length,
        products: db.list('products').length,
        content: db.list('content').length,
        pending:
          db.list('content').filter((x) => x.status === 'pending').length +
          db.list('certifications').filter((x) => x.status === 'pending').length,
        leads: db.list('leads').length,
        jobs: db.list('jobs').length,
        events,
        model: modelSummary(db.get('models', 'two-tower')),
        mode: demoEnabled ? 'development-demo' : 'production',
        source: demoEnabled ? '真实本地操作统计；初始商家和内容为示例种子。' : '本站实际操作统计。'
      });
    }
    if (resource === 'audit' && method === 'GET')
      return json(res, 200, { items: db.list('audit').slice(0, 300) });
    if (resource === 'models' && id === 'train' && method === 'POST') {
      const model = trainModel(db);
      audit(db, user, 'train-model', model.version, { samples: model.samples });
      return json(res, 200, { model });
    }
    if (resource === 'models' && method === 'GET')
      return json(res, 200, { items: db.list('models').map(modelSummary) });
    if (resource === 'providers' && parts[4] === 'test' && method === 'POST')
      return json(res, 200, await ai.testProvider(user, id));
    const allowed = [
      'users',
      'content',
      'products',
      'fairs',
      'buyers',
      'certifications',
      'plans',
      'entitlements',
      'providers',
      'knowledge',
      'admins',
      'ads',
      'tags'
    ];
    if (!allowed.includes(resource)) throw new AppError(404, 'NOT_FOUND', '管理接口不存在。');
    if (method === 'GET') {
      let items = db.list(resource);
      if (id) {
        let item = items.find((x) => x.id === id);
        if (!item) throw new AppError(404, 'NOT_FOUND', '记录不存在。');
        return json(res, 200, {
          item:
            resource === 'providers'
              ? cleanProvider(item)
              : resource === 'certifications'
                ? presentCertificate(req, user, item)
                : resource === 'users'
                  ? safeUser(item)
                  : resource === 'buyers'
                    ? (({ publicContact, phone, wechat, ...safe }) => safe)(item)
                    : item
        });
      }
      if (resource === 'providers') items = items.map(cleanProvider);
      if (resource === 'products') items = items.map((x) => creatorShape(x, 'product'));
      if (resource === 'users') items = items.map(safeUser);
      if (resource === 'buyers') items = items.map(({ publicContact, phone, wechat, ...safe }) => safe);
      if (resource === 'certifications') items = items.map((x) => presentCertificate(req, user, x));
      return json(res, 200, { items });
    }
    if (method === 'DELETE') {
      const old = db.get(resource, id);
      if (!old) throw new AppError(404, 'NOT_FOUND', '记录不存在。');
      if (resource === 'users' && id === user.id)
        throw new AppError(409, 'SELF_DELETE_BLOCKED', '不能删除当前管理账号。');
      if (resource === 'providers') db.remove(resource, id);
      else
        db.save(resource, {
          ...old,
          status: 'deleted',
          state: 'deleted',
          published: false,
          enabled: false,
          deletedAt: now()
        });
      if (['content', 'products', 'fairs'].includes(resource)) refreshPublishedMedia(db, old);
      if (resource === 'certifications') {
        const account = db.get('users', old.ownerId);
        if (account && (!account.currentCertificationId || account.currentCertificationId === old.id))
          db.save('users', { ...account, verified: false, certificationStatus: 'deleted' });
      }
      audit(db, user, 'delete-' + resource, id);
      return json(res, 200, { ok: true });
    }
    if (!['POST', 'PATCH', 'PUT'].includes(method))
      throw new AppError(405, 'METHOD_NOT_ALLOWED', '不支持该操作。');
    const b = await bodyJson(req);
    const old = id ? db.get(resource, id) : null;
    if (id && !old) throw new AppError(404, 'NOT_FOUND', '记录不存在。');
    let item = { ...old, ...b, id: id || b.id || uid(resource) };
    if (
      resource === 'users' &&
      ['verified', 'certificationStatus', 'certificationPolicyVersion'].some((k) => Object.hasOwn(b, k))
    )
      throw new AppError(400, 'USE_CERTIFICATION_REVIEW', '经营认证只能通过完整材料审核流程开通。');
    if (resource === 'admins') requireAdmin(user, '*');
    if (
      resource === 'users' &&
      Object.keys(b).some((k) =>
        [
          'role',
          'permissions',
          'adminGrantId',
          'primaryRole',
          'phone',
          'phoneVerified',
          'wechatOpenId',
          'wechatAppId',
          'wechatUnionId',
          'authProvider',
          'demo'
        ].includes(k)
      )
    )
      requireAdmin(user, '*');
    if (resource === 'providers') {
      const value = String(b.apiKey || b.key || '').trim();
      delete item.apiKey;
      delete item.key;
      delete item.secret;
      if (value && !/^[•*]+$/.test(value)) item.secret = secrets.encrypt(value);
      else item.secret = old?.secret || null;
      if (b.clearKey === true) item.secret = null;
      delete item.clearKey;
      if (item.baseUrl) item.baseUrl = validateProviderUrl(item.baseUrl);
      item.configured = !!item.secret;
      item.enabled = item.enabled === true;
    }
    if (resource === 'entitlements') {
      need(item.companyId, '请选择厂家主体。');
      const plan = db.get('plans', need(item.planId, '请选择版本方案。'));
      if (!plan) throw new AppError(400, 'INVALID_PLAN', '版本方案不存在。');
      item.dailyLimit = Number(item.dailyLimit ?? plan.dailyLimit);
      if (!Number.isFinite(item.dailyLimit) || item.dailyLimit < 0)
        throw new AppError(400, 'INVALID_QUOTA', '额度无效。');
      item.status = item.status || 'active';
      item.activationMode = 'offline-confirmed';
      item.confirmedBy = user.id;
      item.confirmationRef = String(item.confirmationRef || item.note || '管理员确认线下开通').slice(0, 500);
      if (!item.expiresAt && plan.days > 0)
        item.expiresAt = new Date(Date.now() + plan.days * 86400000).toISOString();
    }
    if (resource === 'plans') {
      need(item.name, '请填写版本名称。');
      item.dailyLimit = Number(item.dailyLimit);
      if (!Number.isInteger(item.dailyLimit) || item.dailyLimit < 0 || item.dailyLimit > 10000)
        throw new AppError(400, 'INVALID_QUOTA', '额度应为0至10000整数。');
    }
    if (
      ['plans', 'entitlements'].includes(resource) &&
      item.contactMethods !== undefined &&
      (!Array.isArray(item.contactMethods) ||
        item.contactMethods.length > 30 ||
        item.contactMethods.some((x) => typeof x !== 'string' || x.length > 80))
    )
      throw new AppError(
        400,
        'INVALID_CONTACT_METHODS',
        '联系能力应为最多30项的文字列表，支持wechat/phone/qrcode。'
      );
    if (resource === 'products') {
      const workflow = ['draft', 'pending', 'published', 'hidden', 'deleted', 'rejected'];
      const flow = workflow.includes(b.status) ? b.status : b.state || old?.state || 'draft';
      item.state = flow;
      item.supplyStatus =
        b.supplyStatus ||
        b.stockStatus ||
        (!workflow.includes(b.status) ? b.status : null) ||
        old?.supplyStatus ||
        old?.stockStatus ||
        '现货';
      item.stockStatus = item.supplyStatus;
      item.status = item.supplyStatus;
      item.published = flow === 'published';
    }
    if (['content', 'fairs'].includes(resource) && b.status) item.published = b.status === 'published';
    if (resource === 'certifications') {
      if (b.phoneReview !== undefined)
        throw new AppError(
          400,
          'USE_PHONE_REVIEW_ACTION',
          '请通过人工回访专用入口记录，不能直接填造回访结果。'
        );
      if (
        old &&
        ['ownerId', 'companyId', 'applicantRole'].some((k) => Object.hasOwn(b, k) && b[k] !== old[k])
      )
        throw new AppError(
          400,
          'CERTIFICATE_IDENTITY_IMMUTABLE',
          '认证账号与主体归属不能通过编辑申请来变更。'
        );
      const changedMaterials =
        old &&
        ['licenseFileId', 'venueVideoFileId', 'venuePhotoFileIds', 'company', 'scope'].some(
          (k) => Object.hasOwn(b, k) && JSON.stringify(b[k]) !== JSON.stringify(old[k])
        );
      if (changedMaterials) {
        if (b.status === 'approved')
          throw new AppError(
            409,
            'RECERTIFICATION_REQUIRED',
            '材料或填报主体变更后须重新核验与回访，不能同一操作直接通过。'
          );
        item = {
          ...item,
          status: 'pending',
          phoneReview: { status: 'pending', result: null },
          videoVerification: { status: 'missing', durationSeconds: null, source: 'ffprobe' },
          materialsVerification: { status: 'pending' }
        };
      }
      if (item.status === 'approved') item = await assertCertificateApprovable(db, item, uploadDir);
      if (item.status) {
        item.reviewedBy = user.id;
        item.reviewedAt = now();
        const account = db.get('users', item.ownerId);
        if (account && (!account.currentCertificationId || account.currentCertificationId === item.id))
          db.save('users', {
            ...account,
            verified: item.status === 'approved',
            certificationPolicyVersion: item.certificationPolicyVersion,
            certificationStatus: item.status,
            companyName: item.company || account.companyName
          });
      }
    }
    if (resource === 'admins') {
      if (item.phone && !/^1\d{10}$/.test(item.phone))
        throw new AppError(400, 'INVALID_PHONE', '请填写有效手机号。');
      item.permissions = item.permissions ?? [];
      if (
        !Array.isArray(item.permissions) ||
        item.permissions.length > 100 ||
        item.permissions.some((x) => typeof x !== 'string' || !/^\*$|^[a-z]+:(read|write|\*)$/.test(x))
      )
        throw new AppError(400, 'INVALID_PERMISSIONS', '权限格式应为*或资源:read/write/*的列表。');
      const unchangedPhone = old?.phone === item.phone;
      item.bindingVerified = !!old?.bindingVerified && unchangedPhone;
      item.userId = item.bindingVerified ? old.userId : null;
      item.status = ['deleted', 'disabled', 'revoked'].includes(b.status)
        ? b.status
        : item.bindingVerified
          ? 'active'
          : 'pending-binding';
      delete item.wechatId;
    }
    if (resource === 'knowledge') {
      item.scope = item.scope || 'platform';
      item.ownerId = item.ownerId || 'platform';
      item.status = item.status || 'published';
    }
    if (['content', 'products', 'fairs'].includes(resource)) validateAttachments(db, user, item);
    item = db.save(resource, item);
    if (['content', 'products', 'fairs'].includes(resource)) {
      if (old) refreshPublishedMedia(db, old);
      refreshPublishedMedia(db, item);
    }
    if (resource === 'plans' && item.id === 'free')
      publishConfig(db, user, { freeDailyLimit: item.dailyLimit });
    audit(db, user, 'save-' + resource, item.id, {
      fields: Object.keys(b).filter((k) => !['apiKey', 'key', 'secret', 'phone', 'body'].includes(k))
    });
    return json(res, old ? 200 : 201, {
      item:
        resource === 'providers'
          ? cleanProvider(item)
          : resource === 'products'
            ? creatorShape(item, 'product')
            : resource === 'users'
              ? safeUser(item)
              : resource === 'buyers'
                ? (({ publicContact, phone, wechat, ...safe }) => safe)(item)
                : item
    });
  }

  async function route(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method;
    const origin = req.headers.origin;
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Qishu-Scope');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.writeHead(204);
      res.end();
      return;
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    const user = userForRequest(db, req);
    const authScope = requestScope(req);
    if (
      (parts[1] === 'admin' ||
        (url.pathname.startsWith('/api/ingestion/') && !url.pathname.startsWith('/api/ingestion/public/'))) &&
      authScope !== 'back'
    )
      throw new AppError(401, 'BACK_SCOPE_REQUIRED', '此接口只接受独立后台会话，前台登录不能跨入后台。');
    if (
      authScope === 'back' &&
      user &&
      (user.adminAuthorizationRequired || !['supplier', 'admin'].includes(user.role)) &&
      !['/api/auth/me', '/api/auth/phone', '/api/auth/logout', '/api/bootstrap', '/api/profile'].includes(
        url.pathname
      )
    )
      throw new AppError(
        403,
        'BACK_AUTHORIZATION_REQUIRED',
        '后台只开放厂家与已授权平台管理员；请先完成手机号核验与平台授权。'
      );
    const config = readConfig(db);
    if (url.pathname.startsWith('/api/ingestion')) {
      await ingestionReady;
      if (importer && (await importer.handle(req, res, user))) return;
      throw new AppError(503, 'INGESTION_UNAVAILABLE', '导入服务尚未配置，其他模块可继续使用。');
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    if (url.pathname === '/api/health')
      return json(res, 200, {
        ok: true,
        mode: demoEnabled ? 'development-demo' : 'production',
        database: 'sqlite',
        features: config.features,
        ingestion: !!importer
      });
    if (url.pathname === '/api/auth/demo' && method === 'POST')
      return json(res, 200, demoLogin(db, await bodyJson(req), req, res, demoEnabled));
    if (url.pathname === '/api/auth/wechat' && method === 'POST')
      return json(res, 200, await wechat.login(req, res, await bodyJson(req)));
    if (url.pathname === '/api/auth/phone' && method === 'POST')
      return json(res, 200, await wechat.phone(req, res, await bodyJson(req), user));
    if (url.pathname === '/api/auth/me')
      return json(res, 200, {
        user: safeUser(user),
        mode: demoEnabled ? 'development-demo' : 'production'
      });
    if (url.pathname === '/api/auth/logout' && method === 'POST') return json(res, 200, logout(db, req, res));
    if (url.pathname === '/api/bootstrap')
      return json(res, 200, {
        user: safeUser(user),
        config: hasAdminPermission(user, 'config:read') ? config : publicConfig(config),
        dictionaries: dictionaries(config),
        providers: db.list('providers').map((p) => ({
          id: p.id,
          name: p.name,
          adapter: p.adapter,
          capabilities: p.capabilities,
          enabled: p.enabled,
          configured: !!p.secret,
          connectionStatus: p.enabled ? (p.secret ? 'configured-not-verified' : 'unconfigured') : 'disabled'
        })),
        modules: config.features,
        mode: demoEnabled ? 'development-demo' : 'production',
        notice: demoEnabled
          ? '开发演示：示例身份及资料不是正式微信认证；真实模型按渠道配置状态显示。'
          : '经营资料经平台审核后开放相应权限。'
      });
    if (parts[1] === 'admin') return handleAdmin(req, res, url, user, parts);
    if (['content', 'products', 'fairs'].includes(parts[1]) && method === 'GET') {
      const kind = parts[1];
      ensureFeature(config, kind);
      const items = publicItems(db, kind, url.searchParams, config);
      if (parts[2]) {
        const item = items.find((x) => x.id === parts[2]);
        if (!item) throw new AppError(404, 'NOT_FOUND', '内容不存在或已下架。');
        return json(res, 200, { item: sanitizeItem(item, user, kind) });
      }
      return json(res, 200, { items: items.map((x) => sanitizeItem(x, user, kind)) });
    }
    if (parts[1] === 'fairs' && parts[3] === 'register' && method === 'POST') {
      requireVerified(user);
      const fair = db.get('fairs', parts[2]);
      if (!fair || !fair.published) throw new AppError(404, 'NOT_FOUND', '活动不存在。');
      const existing = db.list('registrations').find((x) => x.fairId === fair.id && x.ownerId === user.id);
      if (existing) return json(res, 200, { item: existing, deduplicated: true });
      const count = db.list('registrations').filter((x) => x.fairId === fair.id).length;
      if (fair.capacity && count >= fair.capacity)
        throw new AppError(409, 'CAPACITY_FULL', '示例活动名额已满。');
      return json(res, 201, {
        item: db.save('registrations', {
          id: uid('registration'),
          ownerId: user.id,
          fairId: fair.id,
          status: '意向登记',
          noPayment: true
        })
      });
    }
    if (parts[1] === 'buyers' && method === 'GET') {
      requireUser(user);
      if (!hasAdminPermission(user, 'buyers:read')) requireVerified(user);
      if (user.role === 'admin') requireAdmin(user, 'buyers:read');
      else if (user.role !== 'supplier') throw new AppError(403, 'FORBIDDEN', '找客户功能仅向认证厂家开放。');
      ensureFeature(config, 'buyers');
      let items = db.list('buyers').filter((x) => x.public && activeSubject(x));
      for (const k of ['city', 'style'])
        if (url.searchParams.get(k) && url.searchParams.get(k) !== '全部')
          items = items.filter((x) => x[k] === url.searchParams.get(k));
      const q = url.searchParams.get('query') || '';
      if (q) items = items.filter((x) => (x.name + x.shop + x.need + x.city).includes(q));
      items = items.map(({ publicContact, phone, wechat, licenseFileId, ...safe }) => safe);
      return json(res, 200, { items });
    }
    if (parts[1] === 'quota' && method === 'GET') return json(res, 200, quota(db, requireUser(user), config));
    if (parts[1] === 'leads') {
      requireUser(user);
      if (method === 'GET') return json(res, 200, { items: visibleLeads(db, user) });
      if (method === 'POST') {
        if (user.role === 'supplier') ensureFeature(config, 'buyers');
        const result = createLead(db, user, await bodyJson(req), config);
        const contact = leadContact(db, user, result.lead, config);
        contact.channels = contact.channels.map((channel) => {
          const id =
            channel.type === 'qrcode' ? /^\/api\/files\/([a-zA-Z0-9_-]+)$/.exec(channel.value)?.[1] : null;
          const file = id ? db.get('files', id) : null;
          return file?.purpose === 'contact'
            ? { ...channel, value: previews.urlFor(file, 'contact').url }
            : channel;
        });
        return json(res, 201, { ...result, contact });
      }
      if (method === 'PATCH' && parts[2])
        return json(res, 200, { lead: updateLead(db, user, parts[2], await bodyJson(req)) });
    }
    if (parts[1] === 'creator') {
      requireUser(user);
      if (method === 'GET')
        return json(res, 200, { items: creatorList(db, user).map((x) => creatorShape(x, x.kind)) });
      if (['POST', 'PATCH'].includes(method))
        return json(res, 200, { item: saveCreation(db, user, await bodyJson(req), parts[2]) });
    }
    if (parts[1] === 'events' && method === 'POST')
      return json(res, 200, saveEvent(db, requireUser(user), await bodyJson(req)));
    if (url.pathname === '/api/profile') {
      requireUser(user);
      if (method === 'GET') return json(res, 200, { profile: profileOf(user), user: safeUser(user) });
      if (method === 'PATCH') return json(res, 200, saveProfile(db, user, await bodyJson(req)));
    }
    if (url.pathname === '/api/profile/contact') {
      requireUser(user);
      if (method === 'PATCH') return json(res, 200, saveContact(db, user, await bodyJson(req)));
      if (method === 'GET') {
        const contact = contactOf(user),
          id = /^\/api\/files\/([a-zA-Z0-9_-]+)$/.exec(contact.qrUrl)?.[1],
          file = id ? db.get('files', id) : null;
        return json(res, 200, {
          contact,
          ...(file?.ownerId === user.id && file.purpose === 'contact'
            ? { qrPreviewUrl: previews.urlFor(file, 'owner-contact').url }
            : {})
        });
      }
    }
    if (parts[1] === 'recommendations' && method === 'GET') {
      const kind = url.searchParams.get('kind') === 'products' ? 'products' : 'content';
      ensureFeature(config, kind);
      const items = publicItems(db, kind, new URLSearchParams(), config);
      const result = recommendations(db, user, items, config);
      result.items = result.items.map((x) => sanitizeItem(x, user, kind));
      return json(res, 200, result);
    }
    if (url.pathname === '/api/profile/tags' && method === 'POST') {
      requireUser(user);
      const b = await bodyJson(req);
      const tags = [...new Set((b.tags || []).map((x) => String(x).slice(0, 60)))];
      if (tags.length < 4 || tags.length > 10)
        throw new AppError(400, 'TAG_LIMIT', '请选择至少4个、最多10个标签。');
      const updated = db.save('users', { ...persistentUser(db, user), tags, onboarded: true });
      return json(res, 200, {
        user: safeUser(
          projectIdentity(db, updated, user.authScope || 'front', user.authRequestedRole || user.role)
        )
      });
    }
    if (url.pathname === '/api/profile/preferences' && ['PATCH', 'POST'].includes(method)) {
      requireUser(user);
      const b = await bodyJson(req);
      const updated = db.save('users', {
        ...persistentUser(db, user),
        personalized: b.personalized !== undefined ? b.personalized === true : user.personalized,
        knowledgeForRecommendations:
          b.knowledgeForRecommendations !== undefined
            ? b.knowledgeForRecommendations === true
            : user.knowledgeForRecommendations
      });
      return json(res, 200, {
        user: safeUser(
          projectIdentity(db, updated, user.authScope || 'front', user.authRequestedRole || user.role)
        )
      });
    }
    if (parts[1] === 'knowledge') {
      requireUser(user);
      if (method === 'GET') return json(res, 200, { items: ownKnowledge(db, user) });
      if (method === 'POST') {
        const b = await bodyJson(req);
        need(b.title, '请填写知识标题。');
        need(b.body, '请填写知识内容。');
        if (b.scope === 'platform') requireAdmin(user, 'knowledge:write');
        const scope =
          hasAdminPermission(user, 'knowledge:write') && b.scope === 'platform'
            ? 'platform'
            : b.scope === 'company'
              ? 'company'
              : 'private';
        const item = db.save('knowledge', {
          id: uid('knowledge'),
          ownerId: user.id,
          companyId: user.companyId,
          scope,
          title: String(b.title).slice(0, 200),
          body: String(b.body).slice(0, 100000),
          status: 'published',
          recommendationSummary: b.recommendationSummary ? String(b.recommendationSummary).slice(0, 400) : ''
        });
        audit(db, user, 'create-knowledge', item.id, { scope });
        return json(res, 201, { item });
      }
      if (method === 'DELETE' && parts[2]) {
        const item = db.get('knowledge', parts[2]);
        checkOwned(user, item);
        db.remove('knowledge', item.id);
        audit(db, user, 'delete-knowledge', item.id);
        return json(res, 200, { ok: true });
      }
    }
    if (parts[1] === 'jobs') {
      requireUser(user);
      if (method !== 'GET' || !hasAdminPermission(user, 'jobs:read')) requireVerified(user);
      if (method === 'POST') {
        const b = await bodyJson(req);
        if (b.task === 'diagnosis') ensureFeature(config, 'diagnosis');
        ensureFeature(config, 'ai');
        return json(res, 202, { job: ai.create(user, b) });
      }
      if (method === 'GET')
        return json(
          res,
          200,
          parts[2]
            ? { job: previews.present(ai.get(user, parts[2])) }
            : { items: ai.list(user).map(previews.present) }
        );
    }
    if (parts[1] === 'uploads' && method === 'POST') {
      requireUser(user);
      return json(res, 201, { file: await uploadFile(req, url, user) });
    }
    if (parts[1] === 'files' && parts[2] && method === 'GET') {
      const file = db.get('files', parts[2]);
      if (!file) throw new AppError(404, 'NOT_FOUND', '文件不存在。');
      if (
        !file.public &&
        !previews.permits(file, url.searchParams.get('ticket')) &&
        !certificateTicketPermits(req, file, url)
      ) {
        requireUser(user);
        if (file.ownerId !== user.id && (requestScope(req) !== 'back' || !canReviewFile(user, file)))
          throw new AppError(404, 'NOT_FOUND', '资料不存在。');
      }
      const filename = join(uploadDir, file.diskName);
      if (!existsSync(filename)) throw new AppError(404, 'NOT_FOUND', '文件不存在。');
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Length': file.size,
        'Cache-Control': file.public ? 'public,max-age=300' : 'private,no-store',
        'Content-Disposition':
          file.mime.startsWith('image/') || file.mime.startsWith('audio/') || file.mime.startsWith('video/')
            ? 'inline'
            : 'attachment'
      });
      createReadStream(filename).pipe(res);
      return;
    }
    if (parts[1] === 'certifications') {
      requireUser(user);
      if (method === 'GET')
        return json(res, 200, {
          items: db
            .list('certifications')
            .filter((x) => x.ownerId === user.id)
            .map((x) => presentCertificate(req, user, x))
        });
      if (method === 'POST') {
        if (user.authProvider === 'wechat' && !user.phoneVerified)
          throw new AppError(403, 'PHONE_VERIFICATION_REQUIRED', '提交经营资质前请先完成本人手机号授权。');
        const b = await bodyJson(req);
        need(b.company, '请填写经营主体名称。');
        need(b.scope, '请填写经营范围。');
        const materials = await validateCertificateMaterials(db, user, b, uploadDir);
        const file = db.get('files', materials.licenseFileId);
        db.save('files', { ...file, public: false, purpose: 'license' });
        const relevant = /服装|服饰|女装/.test(b.scope) && /批发|零售/.test(b.scope);
        const item = db.save('certifications', {
          id: uid('certification'),
          ownerId: user.id,
          companyId: user.companyId,
          company: String(b.company).slice(0, 200),
          scope: String(b.scope).slice(0, 2000),
          ...materials,
          status: 'pending',
          phoneReview: { status: 'pending', result: null },
          precheck: {
            industryScope: relevant ? '符合服装批发零售准入' : '待人工判断',
            ocrStatus: 'not-configured'
          }
        });
        db.save('users', {
          ...persistentUser(db, user),
          verified: false,
          certificationStatus: 'pending',
          currentCertificationId: item.id
        });
        const checked = startCertificatePrecheck(db, ai, user, item);
        audit(db, user, 'submit-certification', item.id);
        return json(res, 201, { application: presentCertificate(req, user, checked) });
      }
    }
    throw new AppError(404, 'NOT_FOUND', '接口不存在。');
  }

  async function uploadFile(req, url, user) {
    if (url.searchParams.get('purpose') === 'certification_video')
      return uploadCertificateVideo(req, user, db, uploadDir);
    const type = req.headers['content-type'] || '';
    const boundary = type
      .match(/boundary=(?:"([^"]+)"|([^;]+))/i)
      ?.slice(1)
      .find(Boolean);
    if (!boundary) throw new AppError(400, 'INVALID_UPLOAD', '请使用multipart文件上传。');
    const buffer = await bufferBody(req, 25 * 1024 * 1024);
    const marker = Buffer.from('--' + boundary);
    let start = buffer.indexOf(marker);
    let file = null;
    const fields = {};
    while (start >= 0) {
      start += marker.length;
      if (buffer.subarray(start, start + 2).toString() === '--') break;
      if (buffer.subarray(start, start + 2).toString() === '\r\n') start += 2;
      const headersEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
      if (headersEnd < 0) break;
      const header = buffer.subarray(start, headersEnd).toString();
      const next = buffer.indexOf(marker, headersEnd + 4);
      if (next < 0) break;
      const content = buffer.subarray(headersEnd + 4, next - 2);
      const name = header.match(/name="([^"]+)"/)?.[1];
      const filename = header.match(/filename="([^"]*)"/)?.[1];
      if (filename) {
        if (file) throw new AppError(400, 'SINGLE_FILE_ONLY', '一次只上传一个文件。');
        file = {
          name: filename.replace(/[\\/]/g, '_').slice(0, 180),
          content,
          mime: header.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream'
        };
      } else if (name) fields[name] = content.toString('utf8').slice(0, 2000);
      start = next;
    }
    if (!file || !file.content.length) throw new AppError(400, 'EMPTY_FILE', '未收到文件。');
    if (
      !file.mime ||
      ['application/octet-stream', 'binary/octet-stream'].includes(
        file.mime.toLowerCase().split(';')[0].trim()
      )
    )
      file.mime = sniffMime(file.content) || 'application/octet-stream';
    const allowed =
      /^(image\/(jpeg|png|webp|avif)|audio\/(mpeg|mp3|wav|x-wav|mp4|webm|ogg)|video\/(mp4|webm|quicktime)|application\/(pdf|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation))|text\/(plain|markdown))$/i;
    if (!allowed.test(file.mime))
      throw new AppError(
        400,
        'UNSUPPORTED_FILE',
        '支持图片、音视频、PDF、Word、PPTX及文本；大文件使用分片导入。'
      );
    const id = uid('file'),
      extension = extname(file.name).slice(0, 12) || '.bin',
      diskName = id + extension;
    writeFileSync(join(uploadDir, diskName), file.content);
    const purpose =
      fields.kind === 'license'
        ? 'license'
        : ['content', 'license', 'certification_photo', 'diagnosis', 'knowledge', 'private'].includes(
              fields.purpose
            )
          ? fields.purpose
          : 'private';
    const isPublic = false;
    const saved = db.save('files', {
      id,
      ownerId: user.id,
      companyId: user.companyId,
      name: file.name,
      mime: file.mime,
      size: file.content.length,
      diskName,
      public: isPublic,
      purpose,
      url: `/api/files/${id}`
    });
    audit(db, user, 'upload-file', id, { mime: file.mime, size: file.content.length, purpose });
    const { diskName: _, ...safe } = saved;
    return safe;
  }

  function serveStatic(req, res, url) {
    const webRoot = resolve(ROOT, 'apps/web');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw new AppError(400, 'INVALID_PATH', '路径无效。');
    }
    const candidate = resolve(webRoot, '.' + pathname);
    if (candidate !== webRoot && !candidate.startsWith(webRoot + sep))
      throw new AppError(403, 'FORBIDDEN', '路径不可访问。');
    let file = candidate;
    if (pathname.endsWith('/')) file = join(candidate, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(pathname)) throw new AppError(404, 'NOT_FOUND', '静态文件不存在。');
      file = join(webRoot, 'index.html');
    }
    if (!existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('七叔平台后端已运行，用户界面正在整合。接口：/api/health');
      return;
    }
    const size = statSync(file).size;
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public,max-age=60'
    });
    createReadStream(file).pipe(res);
  }
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = err instanceof AppError ? err.status : 500;
      const message = err instanceof AppError ? err.message : '该模块暂时不可用，请返回其他功能或稍后重试。';
      if (status === 500) console.error('[module-error]', err.name, err.message);
      json(res, status, { error: { code: err.code || 'INTERNAL_ERROR', message } });
    });
  });
  return {
    server,
    db,
    ai,
    dataDir,
    async close() {
      ai.close();
      if (server.listening) await new Promise((r) => server.close(r));
      await ingestionReady;
      importer?.close();
      db.close();
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createApp();
  const port = Number(process.env.PORT || 4188);
  const host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () =>
    console.log(
      `七叔平台 http://${host}:${port} · ${process.env.NODE_ENV === 'production' ? '正式环境，演示登录禁用' : '开发演示环境，非正式微信登录'}`
    )
  );
  const stop = () => app.close().then(() => process.exit());
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
