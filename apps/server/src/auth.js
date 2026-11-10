import { randomBytes, createHash } from 'node:crypto';
import { AppError, audit } from './db.js';

const hash = (token) => createHash('sha256').update(token).digest('hex');
export function issueSession(db, user, res, { secure = process.env.NODE_ENV === 'production' } = {}) {
  const token = randomBytes(32).toString('base64url');
  db.raw
    .prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)')
    .run(hash(token), user.id, Date.now() + 24 * 3600_000);
  res.setHeader(
    'Set-Cookie',
    `qishu_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure ? '; Secure' : ''}`
  );
  return { user: safeUser(user), token };
}
export function userForRequest(db, req) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookie = req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('qishu_session='))
    ?.slice(14);
  const token = bearer || cookie;
  if (!token) return null;
  const session = db.raw
    .prepare('SELECT user_id FROM sessions WHERE hash=? AND expires>?')
    .get(hash(token), Date.now());
  if (!session) return null;
  let user = db.get('users', session.user_id);
  if (user?.role === 'admin' && user.adminGrantId) {
    const grant = db.get('admins', user.adminGrantId);
    if (!grant || grant.status !== 'active' || grant.userId !== user.id || !grant.bindingVerified)
      user = { ...user, role: user.primaryRole || 'owner', permissions: [] };
    else user = { ...user, permissions: grant.permissions || ['*'] };
  }
  return ['deleted', 'disabled', 'suspended'].includes(user?.status) ? null : user;
}
export function requireUser(user) {
  if (!user) throw new AppError(401, 'LOGIN_REQUIRED', '请先登录。');
  return user;
}
export function hasAdminPermission(user, permission = '*') {
  if (user?.role !== 'admin') return false;
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
  if (!enabled) throw new AppError(403, 'DEMO_DISABLED', '正式环境不开放演示登录。');
  const role = ['owner', 'supplier', 'admin'].includes(body.role) ? body.role : 'owner';
  const id = body.userId || { owner: 'owner-01', supplier: 'supplier-01', admin: 'admin-01' }[role];
  const user = db.get('users', id);
  if (!user || user.role !== role || user.demo !== true)
    throw new AppError(400, 'UNKNOWN_DEMO_USER', '演示账号不存在。');
  const token = randomBytes(32).toString('base64url');
  db.raw
    .prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)')
    .run(hash(token), user.id, Date.now() + 24 * 3600_000);
  res.setHeader(
    'Set-Cookie',
    `qishu_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
  );
  audit(db, user, 'demo-login', user.id, { notice: '开发账号，不代表真实微信认证' });
  return {
    user: safeUser(user),
    token,
    mode: 'development-demo',
    notice: '开发测试账号；非微信正式登录或资质认证结果。'
  };
}
export function logout(db, req, res) {
  const token =
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
    req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('qishu_session='))
      ?.slice(14);
  if (token) db.raw.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
  res.setHeader('Set-Cookie', 'qishu_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
}
export function safeUser(user) {
  if (!user) return null;
  const { phone, wechatOpenId, wechatUnionId, sessionKey, publicContact, contactConsent, ...safe } = user;
  return { ...safe, phoneMasked: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null };
}
