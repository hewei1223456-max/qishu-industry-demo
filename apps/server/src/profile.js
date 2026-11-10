import { AppError, audit } from './db.js';
import { requireUser, safeUser } from './auth.js';

const strings = { name: 80, shop: 120, city: 60, style: 60, customerAge: 60, retailPriceBand: 80 };
const keys = [...Object.keys(strings), 'area', 'businessYears', 'operationNeeds'];
export function profileOf(user) {
  requireUser(user);
  return Object.fromEntries(keys.map((k) => [k, user[k] ?? (k === 'operationNeeds' ? [] : '')]));
}
export function saveProfile(db, user, body) {
  requireUser(user);
  if (Object.keys(body).some((k) => !keys.includes(k)))
    throw new AppError(
      400,
      'READ_ONLY_PROFILE',
      '只允许修改经营资料；账号身份、手机、审核主体和权限需按相应授权流程处理。'
    );
  const fields = {};
  for (const [key, max] of Object.entries(strings))
    if (Object.hasOwn(body, key)) {
      if (typeof body[key] !== 'string' || body[key].length > max)
        throw new AppError(400, 'INVALID_PROFILE', `${key}格式或长度无效。`);
      fields[key] = body[key].trim();
    }
  for (const [key, min, max] of [
    ['area', 1, 100000],
    ['businessYears', 0, 100]
  ])
    if (Object.hasOwn(body, key)) {
      if (body[key] === '' || body[key] === null) {
        fields[key] = null;
        continue;
      }
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < min || n > max)
        throw new AppError(400, 'INVALID_PROFILE', `${key}应为${min}至${max}之间的数值。`);
      fields[key] = n;
    }
  if (body.operationNeeds !== undefined) {
    if (
      !Array.isArray(body.operationNeeds) ||
      body.operationNeeds.length > 20 ||
      body.operationNeeds.some((x) => typeof x !== 'string' || x.length > 80)
    )
      throw new AppError(400, 'INVALID_PROFILE', '经营需求应为最多20项的文字列表。');
    fields.operationNeeds = [...new Set(body.operationNeeds.map((x) => x.trim()).filter(Boolean))];
  }
  const updated = db.save('users', { ...user, ...fields });
  audit(db, user, 'update-profile', user.id, { fields: Object.keys(fields) });
  return { profile: profileOf(updated), user: safeUser(updated) };
}
