import { randomBytes, createHash } from 'node:crypto';
import { AppError, audit } from './db.js';
const hash = (token) => createHash('sha256').update(token).digest('hex');
export function requestScope(req) {
  const value =
    req.headers['x-qishu-scope'] ||
    new URL(req.url || '/', 'http://local').searchParams.get('scope') ||
    'front';
  if (!['front', 'back'].includes(value))
    throw new AppError(400, 'INVALID_SCOPE', '请选择前台或后台登录入口。');
  return value;
}
export function loginSelection(req, body) {
  const scope = body.scope || requestScope(req),
    requestedRole = body.requestedRole || body.role || 'owner';
  if (!['front', 'back'].includes(scope) || !['owner', 'supplier', 'admin'].includes(requestedRole))
    throw new AppError(400, 'INVALID_LOGIN', '登录身份或端口无效。');
  if (req.headers['x-qishu-scope'] && scope !== requestScope(req))
    throw new AppError(400, 'SCOPE_MISMATCH', '登录端口与请求端口不一致。');
  if (scope === 'back' && requestedRole === 'owner')
    throw new AppError(403, 'BACK_ROLE_REQUIRED', '店主请从前台入口登录，后台只开放厂家和平台管理员。');
  return { scope, requestedRole };
}
export function persistentUser(db, user) {
  return db.get('users', user.id) || user;
}
export function projectIdentity(db, raw, scope, requestedRole) {
  if (!raw || ['deleted', 'disabled', 'suspended'].includes(raw.status)) return null;
  const role = requestedRole || raw.primaryRole || raw.role;
  const grant = raw.adminGrantId
    ? db.get('admins', raw.adminGrantId)
    : db.list('admins').find((g) => g.userId === raw.id);
  const validGrant = grant?.status === 'active' && grant.userId === raw.id && grant.bindingVerified;
  let user = { ...raw, authScope: scope, authRequestedRole: role };
  if (role === 'admin') {
    if (raw.demo && raw.role === 'admin' && !raw.adminGrantId)
      user = { ...user, role: 'admin', permissions: raw.permissions ?? ['*'] };
    else if (validGrant) user = { ...user, role: 'admin', permissions: grant.permissions ?? [] };
    else
      user = {
        ...user,
        role: raw.primaryRole === 'supplier' ? 'supplier' : 'owner',
        permissions: [],
        adminAuthorizationRequired: true
      };
  } else {
    const businessRole = raw.primaryRole || raw.role;
    if (businessRole !== role) return null;
    user = { ...user, role, permissions: [] };
  }
  if (scope === 'front') user = { ...user, permissions: [] };
  return user;
}
export function issueSession(
  db,
  user,
  res,
  {
    secure = process.env.NODE_ENV === 'production',
    scope = 'front',
    requestedRole = user.authRequestedRole || user.role
  } = {}
) {
  if (!['front', 'back'].includes(scope)) throw new AppError(400, 'INVALID_SCOPE', '登录端口无效。');
  if (scope === 'back' && requestedRole === 'owner')
    throw new AppError(403, 'BACK_ROLE_REQUIRED', '店主不能登录后台。');
  const token = randomBytes(32).toString('base64url');
  db.raw
    .prepare('INSERT INTO sessions(hash,user_id,expires,scope,requested_role) VALUES(?,?,?,?,?)')
    .run(hash(token), user.id, Date.now() + 24 * 3600_000, scope, requestedRole);
  res.setHeader(
    'Set-Cookie',
    `qishu_${scope}_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure ? '; Secure' : ''}`
  );
  const projected = projectIdentity(db, persistentUser(db, user), scope, requestedRole);
  return {
    user: safeUser(projected),
    token,
    scope,
    requestedRole,
    ...(projected?.adminAuthorizationRequired ? { adminAuthorizationRequired: true } : {})
  };
}
function requestToken(req, scope) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1],
    name = `qishu_${scope}_session=`;
  return (
    bearer ||
    req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(name))
      ?.slice(name.length)
  );
}
export function userForRequest(db, req) {
  const scope = requestScope(req),
    token = requestToken(req, scope);
  if (!token) return null;
  const session = db.raw
    .prepare('SELECT hash,user_id,requested_role FROM sessions WHERE hash=? AND expires>? AND scope=?')
    .get(hash(token), Date.now(), scope);
  const user = session
    ? projectIdentity(db, db.get('users', session.user_id), scope, session.requested_role)
    : null;
  return user ? { ...user, authSessionHash: session.hash } : null;
}
export function requireUser(user) {
  if (!user) throw new AppError(401, 'LOGIN_REQUIRED', '请从当前端口登录。');
  return user;
}
export function hasAdminPermission(user, permission = '*') {
  if (user?.role !== 'admin' || user.authScope === 'front') return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : ['*'];
  return (
    permissions.includes('*') ||
    permissions.includes(permission) ||
    (permission.includes(':') && permissions.includes(permission.split(':')[0] + ':*'))
  );
}
export function requireAdmin(user, permission = '*') {
  requireUser(user);
  if (!hasAdminPermission(user, permission))
    throw new AppError(403, 'FORBIDDEN', '当前账号没有此项平台管理权限。');
  return user;
}
export function requireVerified(user) {
  requireUser(user);
  if (!hasAdminPermission(user, '*') && user.authProvider === 'wechat' && !user.phoneVerified)
    throw new AppError(403, 'PHONE_VERIFICATION_REQUIRED', '请先完成本人手机号授权核验。');
  if (!user.verified && !hasAdminPermission(user, '*'))
    throw new AppError(403, 'CERTIFICATION_REQUIRED', '资料审核通过后开放此功能。');
  return user;
}
export function demoLogin(db, body, req, res, enabled) {
  if (!enabled) throw new AppError(403, 'DEMO_DISABLED', '正式环境不开放开发账号登录。');
  const { scope, requestedRole } = loginSelection(req, body),
    id = body.userId || { owner: 'owner-01', supplier: 'supplier-01', admin: 'admin-01' }[requestedRole],
    user = db.get('users', id);
  if (!user || user.role !== requestedRole || user.demo !== true)
    throw new AppError(400, 'UNKNOWN_DEMO_USER', '开发账号不存在。');
  audit(db, user, 'demo-login', id, { scope, notice: '开发账号，不代表真实微信认证' });
  return {
    ...issueSession(db, user, res, { scope, requestedRole }),
    mode: 'development-demo',
    notice: '开发测试账号；非微信正式登录或资质认证结果。'
  };
}
export function logout(db, req, res) {
  const scope = requestScope(req),
    token = requestToken(req, scope);
  if (token) db.raw.prepare('DELETE FROM sessions WHERE hash=? AND scope=?').run(hash(token), scope);
  res.setHeader('Set-Cookie', `qishu_${scope}_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return { ok: true, scope };
}
export function safeUser(user) {
  if (!user) return null;
  const {
    phone,
    wechatOpenId,
    wechatUnionId,
    sessionKey,
    authSessionHash,
    publicContact,
    contactConsent,
    ...safe
  } = user;
  return { ...safe, phoneMasked: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null };
}
