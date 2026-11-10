import { AppError } from './db.js';
import { hasAdminPermission } from './auth.js';

function references(item) {
  const values = [
    item.image,
    ...(item.images || []),
    ...(item.media || []),
    ...(item.fileIds || []),
    ...(item.files || []),
    item.fileId
  ];
  const ids = new Set();
  for (const value of values) {
    const text = typeof value === 'string' ? value : value?.id || value?.url;
    if (!text) continue;
    const match = /^\/api\/files\/([a-zA-Z0-9_-]+)(?:\?[^#]*)?$/.exec(text);
    if (match) ids.add(match[1]);
    else if (/^file_/.test(text)) ids.add(text);
  }
  return ids;
}
export function validateAttachments(db, user, item) {
  for (const key of ['images', 'media', 'fileIds', 'files'])
    if (item[key] !== undefined && !Array.isArray(item[key]))
      throw new AppError(400, 'INVALID_MEDIA', '素材列表格式错误。');
  for (const id of references(item)) {
    const file = db.get('files', id);
    const publishOperator =
      file?.purpose === 'content' &&
      ['content', 'products', 'fairs'].some((kind) => hasAdminPermission(user, kind + ':write'));
    if (
      !file ||
      (!file.public && file.ownerId !== user.id && !hasAdminPermission(user, '*') && !publishOperator)
    )
      throw new AppError(404, 'MEDIA_NOT_FOUND', '素材不存在或没有使用权限。');
    if (!file.public && file.purpose !== 'content')
      throw new AppError(
        403,
        'PRIVATE_SOURCE',
        '私有资料、执照及诊断原件不能作为公开内容素材；请单独上传授权发布的内容副本。'
      );
  }
  for (const field of ['image', 'images'])
    for (const value of field === 'images' ? item.images || [] : [item.image]) {
      const url = typeof value === 'string' ? value : value?.url;
      if (url && !/^(\/(?!\/)|https:\/\/)/.test(url))
        throw new AppError(400, 'INVALID_MEDIA_URL', '素材地址必须为站内路径或HTTPS链接。');
    }
}
export function normalizeAttachments(db, item) {
  const uploaded = [...references(item)]
    .map((id) => db.get('files', id))
    .filter(Boolean)
    .map(({ id, url, mime, name, size }) => ({ id, url, mime, name, size }));
  return uploaded.length ? { ...item, media: uploaded } : item;
}
export function refreshPublishedMedia(db, item) {
  for (const id of references(item)) {
    const file = db.get('files', id);
    if (!file || file.purpose !== 'content') continue;
    const published = ['content', 'products', 'fairs'].some((kind) =>
      db
        .list(kind)
        .some(
          (x) =>
            x.published === true &&
            x.status !== 'deleted' &&
            x.status !== 'hidden' &&
            x.state !== 'hidden' &&
            x.state !== 'deleted' &&
            references(x).has(id)
        )
    );
    db.save('files', { ...file, public: published });
  }
}
