import { open, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { uid, AppError, audit } from './db.js';
export const CERT_VIDEO_LIMIT = 300 * 1024 * 1024;
// Incremental multipart parser: retains one boundary and a small header, never the whole video.
export async function uploadCertificateVideo(req, user, db, uploadDir) {
  const boundary = req.headers['content-type']
    ?.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    ?.slice(1)
    .find(Boolean);
  if (!boundary || boundary.length > 200)
    throw new AppError(400, 'INVALID_UPLOAD', '请使用multipart file字段上传视频。');
  const marker = Buffer.from('\r\n--' + boundary),
    start = Buffer.from('--' + boundary);
  let pending = Buffer.alloc(0),
    state = 'boundary',
    handle = null,
    file = null,
    size = 0,
    total = 0,
    head = Buffer.alloc(0);
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > CERT_VIDEO_LIMIT + 65536)
        throw new AppError(413, 'VIDEO_TOO_LARGE', '场所视频最多300MB，请压缩后重新上传。');
      pending = Buffer.concat([pending, chunk]);
      while (true) {
        if (state === 'boundary') {
          const at = pending.indexOf(start);
          if (at < 0) {
            if (pending.length > 1024) throw new AppError(400, 'INVALID_UPLOAD', '上传边界无效。');
            break;
          }
          if (pending.length < at + start.length + 2) break;
          pending = pending.subarray(at + start.length);
          if (pending.subarray(0, 2).toString() === '--') {
            state = 'done';
            break;
          }
          if (pending.subarray(0, 2).toString() === '\r\n') pending = pending.subarray(2);
          state = 'headers';
        }
        if (state === 'headers') {
          const at = pending.indexOf('\r\n\r\n');
          if (at < 0) {
            if (pending.length > 16384) throw new AppError(400, 'INVALID_UPLOAD', '上传头过长。');
            break;
          }
          const headers = pending.subarray(0, at).toString();
          pending = pending.subarray(at + 4);
          const filename = headers.match(/filename="([^"]*)"/)?.[1];
          if (filename) {
            if (file) throw new AppError(400, 'SINGLE_FILE_ONLY', '一次只上传一个场所视频。');
            const id = uid('file'),
              name = filename.replace(/[\\/]/g, '_').slice(0, 180),
              extension = extname(name).slice(0, 12) || '.mp4';
            file = {
              id,
              name,
              diskName: id + extension,
              mime: headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream'
            };
            handle = await open(join(uploadDir, file.diskName), 'wx');
            state = 'file';
          } else state = 'field';
        }
        if (state === 'file' || state === 'field') {
          const at = pending.indexOf(marker);
          if (at >= 0) {
            const content = pending.subarray(0, at);
            if (state === 'file') {
              size += content.length;
              if (head.length < 32) head = Buffer.concat([head, content.subarray(0, 32 - head.length)]);
              await handle.writeFile(content);
              await handle.close();
              handle = null;
            }
            pending = pending.subarray(at + 2);
            state = 'boundary';
            continue;
          }
          const safe = pending.length - marker.length - 4;
          if (safe > 0) {
            const content = pending.subarray(0, safe);
            if (state === 'file') {
              size += content.length;
              if (head.length < 32) head = Buffer.concat([head, content.subarray(0, 32 - head.length)]);
              await handle.writeFile(content);
            }
            pending = pending.subarray(safe);
          }
          break;
        }
        if (state === 'done') break;
      }
    }
    if (!file || !size || state !== 'done')
      throw new AppError(400, 'INCOMPLETE_UPLOAD', '视频未完整上传，请重试。');
    let mime = file.mime.toLowerCase().split(';')[0].trim();
    if (mime === 'application/octet-stream') {
      if (head.toString('ascii', 4, 8) === 'ftyp') mime = 'video/mp4';
      else if (head.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) mime = 'video/webm';
    }
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(mime))
      throw new AppError(400, 'VIDEO_FORMAT_REQUIRED', '场所视频支持MP4、MOV或WebM，不能用其他文件代替。');
    const saved = db.save('files', {
      ...file,
      mime,
      size,
      ownerId: user.id,
      companyId: user.companyId,
      purpose: 'certification_video',
      public: false,
      url: `/api/files/${file.id}`
    });
    audit(db, user, 'upload-certificate-video', file.id, { size });
    const { diskName, ...safe } = saved;
    return { ...safe, maxBytes: CERT_VIDEO_LIMIT };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (file) await unlink(join(uploadDir, file.diskName)).catch(() => {});
    throw error;
  }
}
