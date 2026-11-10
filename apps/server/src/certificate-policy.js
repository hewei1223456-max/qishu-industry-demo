import { join } from 'node:path';
import { AppError, now, audit } from './db.js';
import { inspectMedia } from './media-inspection.js';
import { persistentUser } from './auth.js';
export const SUPPLIER_POLICY_VERSION = 2;
const supplier = (user) => (user.primaryRole || user.role) === 'supplier';
const requiredFile = (db, user, id, mime) => {
  const f = id ? db.get('files', id) : null;
  if (!f || f.ownerId !== user.id || f.public || !f.mime?.startsWith(mime))
    throw new AppError(
      400,
      'CERTIFICATE_MATERIAL_REQUIRED',
      '认证材料必须是本人上传的私有执照、场所照片或视频，不能借用其他账号材料。'
    );
  return f;
};
export function missingCertificateMaterials(db, item) {
  const role = item.applicantRole || (supplier(db.get('users', item.ownerId) || {}) ? 'supplier' : 'owner'),
    missing = [];
  if (!item.licenseFileId || !db.get('files', item.licenseFileId)) missing.push('营业执照');
  if (role === 'supplier') {
    if (!item.venueVideoFileId || !db.get('files', item.venueVideoFileId)) missing.push('至少30秒场所视频');
    if (!Array.isArray(item.venuePhotoFileIds) || item.venuePhotoFileIds.length !== 5)
      missing.push('5张不重复的场所照片');
    if (item.videoVerification?.status !== 'verified' || item.videoVerification?.durationSeconds < 30)
      missing.push('服务端真实视频时长核验');
    if (item.materialsVerification?.status !== 'verified') missing.push('服务端照片真实图像与重复核验');
    if (item.phoneReview?.status !== 'passed' || item.phoneReview?.result !== 'confirmed')
      missing.push('已接通且核对一致的人工电话回访');
  }
  return missing;
}
export async function validateCertificateMaterials(db, user, body, uploadDir) {
  const raw = persistentUser(db, user),
    license = requiredFile(db, raw, body.licenseFileId, 'image/'),
    role = supplier(raw) ? 'supplier' : 'owner';
  if (role !== 'supplier')
    return { applicantRole: role, licenseFileId: license.id, certificationPolicyVersion: 1 };
  const ids = body.venuePhotoFileIds;
  if (!Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== ids.length)
    throw new AppError(
      400,
      'FIVE_DISTINCT_PHOTOS_REQUIRED',
      '厂家认证必须提供5张不重复照片，不能重复提交同一文件。'
    );
  const video = requiredFile(db, raw, body.venueVideoFileId, 'video/'),
    photos = ids.map((id) => requiredFile(db, raw, id, 'image/'));
  if (ids.includes(license.id) || video.id === license.id)
    throw new AppError(400, 'DUPLICATE_CERTIFICATE_MEDIA', '执照与场所材料不能复用同一文件。');
  const videoVerification = await inspectMedia(join(uploadDir, video.diskName), 'video');
  const licenseCheck = await inspectMedia(join(uploadDir, license.diskName), 'image');
  const imageChecks = [];
  const hashes = new Set([licenseCheck.sha256]),
    pixels = new Set([licenseCheck.pixelHash]);
  for (const photo of photos) {
    const check = await inspectMedia(join(uploadDir, photo.diskName), 'image');
    if (hashes.has(check.sha256) || pixels.has(check.pixelHash))
      throw new AppError(
        400,
        'DUPLICATE_CERTIFICATE_PHOTOS',
        '场所照片或执照存在重复图片，换文件名、修改图片元数据也不能重复计数。'
      );
    hashes.add(check.sha256);
    pixels.add(check.pixelHash);
    imageChecks.push({ fileId: photo.id, ...check });
  }
  for (const file of [license, video, ...photos])
    db.save('files', {
      ...file,
      public: false,
      purpose:
        file.id === license.id
          ? 'license'
          : file.id === video.id
            ? 'certification_video'
            : 'certification_photo'
    });
  return {
    applicantRole: role,
    licenseFileId: license.id,
    venueVideoFileId: video.id,
    venuePhotoFileIds: ids,
    certificationPolicyVersion: SUPPLIER_POLICY_VERSION,
    videoVerification,
    materialsVerification: {
      status: 'verified',
      source: 'ffprobe+ffmpeg',
      checkedAt: now(),
      photoCount: photos.length,
      photos: imageChecks
    }
  };
}
export async function assertCertificateApprovable(db, item, uploadDir) {
  const account = db.get('users', item.ownerId);
  if (!account) throw new AppError(404, 'CERTIFICATE_USER_MISSING', '认证账号不存在。');
  if (account.currentCertificationId && account.currentCertificationId !== item.id)
    throw new AppError(409, 'STALE_CERTIFICATION', '存在更新的认证申请，旧申请不能覆盖当前审核状态。');
  if (supplier(account)) {
    const validated = await validateCertificateMaterials(db, account, item, uploadDir);
    if (
      item.phoneReview?.status !== 'passed' ||
      item.phoneReview?.result !== 'confirmed' ||
      !item.phoneReview?.reviewerId ||
      !item.phoneReview?.calledAt
    )
      throw new AppError(
        409,
        'PHONE_REVIEW_REQUIRED',
        '厂家材料合格后仍须人工电话已接通且核对一致，未接通或未回访不能通过。'
      );
    return { ...item, ...validated };
  }
  requiredFile(db, account, item.licenseFileId, 'image/');
  return item;
}
export function recordPhoneReview(db, reviewer, item, body) {
  if (
    !['confirmed', 'unreachable', 'inconsistent', 'rejected'].includes(body.result) ||
    body.confirmedCall !== true ||
    !/^1[3-9]\d{9}$/.test(String(body.phone || '')) ||
    typeof body.note !== 'string' ||
    !body.note.trim() ||
    body.note.length > 3000
  )
    throw new AppError(
      400,
      'INVALID_PHONE_REVIEW',
      '请人工完成回访后填写电话、结果、备注并确认真实记录，系统不会假称已经拨打。'
    );
  const calledAt = body.calledAt ? new Date(body.calledAt) : new Date();
  if (!Number.isFinite(calledAt.getTime()) || calledAt.getTime() > Date.now() + 60000)
    throw new AppError(400, 'INVALID_REVIEW_TIME', '回访时间无效或在未来。');
  const phoneReview = {
    status: body.result === 'confirmed' ? 'passed' : body.result === 'unreachable' ? 'pending' : 'failed',
    phone: body.phone,
    result: body.result,
    note: body.note.trim(),
    calledAt: calledAt.toISOString(),
    recordedAt: now(),
    reviewerId: reviewer.id,
    reviewerName: reviewer.name || reviewer.id,
    manualDeclaration: true
  };
  const updated = db.save('certifications', {
    ...item,
    phoneReview,
    ...(phoneReview.status !== 'passed'
      ? { status: body.result === 'unreachable' ? 'pending' : 'needs_more' }
      : {})
  });
  if (phoneReview.status !== 'passed') {
    const account = db.get('users', item.ownerId);
    if (account && (!account.currentCertificationId || account.currentCertificationId === item.id))
      db.save('users', { ...account, verified: false, certificationStatus: updated.status });
  }
  audit(db, reviewer, 'record-phone-review', item.id, {
    result: phoneReview.result,
    status: phoneReview.status
  });
  return updated;
}
export function migrateSupplierCertificationPolicy(db) {
  for (const user of db.list('users').filter(supplier)) {
    const valid = db
      .list('certifications')
      .some(
        (x) =>
          x.ownerId === user.id &&
          x.status === 'approved' &&
          x.certificationPolicyVersion === SUPPLIER_POLICY_VERSION &&
          !missingCertificateMaterials(db, x).length
      );
    if (!valid && (user.verified || user.certificationPolicyVersion !== SUPPLIER_POLICY_VERSION))
      db.save('users', {
        ...user,
        verified: false,
        certificationStatus: 'needs_more',
        certificationPolicyVersion: SUPPLIER_POLICY_VERSION
      });
  }
  for (const item of db.list('certifications')) {
    const account = db.get('users', item.ownerId);
    if (
      account &&
      supplier(account) &&
      item.status === 'approved' &&
      (item.certificationPolicyVersion !== SUPPLIER_POLICY_VERSION ||
        missingCertificateMaterials(db, item).length)
    )
      db.save('certifications', {
        ...item,
        status: 'needs_more',
        previousApproval: { status: 'approved', reviewedAt: item.reviewedAt },
        policyUpgradeRequired: true
      });
  }
}
export function decorateCertificate(db, item, scope = 'front') {
  const expose = (id) => {
    const f = id ? db.get('files', id) : null;
    return f
      ? {
          id: f.id,
          name: f.name,
          mime: f.mime,
          size: f.size,
          url: `/api/files/${f.id}?scope=${scope}`
        }
      : null;
  };
  return {
    ...item,
    materials: {
      license: expose(item.licenseFileId),
      venueVideo: expose(item.venueVideoFileId),
      venuePhotos: (item.venuePhotoFileIds || []).map(expose).filter(Boolean)
    },
    videoVerification: item.videoVerification || {
      status: 'missing',
      durationSeconds: null,
      source: 'ffprobe'
    },
    missingFields: missingCertificateMaterials(db, item),
    phoneReview: item.phoneReview || { status: 'pending', result: null }
  };
}
