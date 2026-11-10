import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { AppError } from './db.js';

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { start: Math.max(0, size - suffix), end: size - 1 }
      : null;
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= size ||
    start > requestedEnd
  )
    return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

// Called only after the route has authorized this file. Range errors may then reveal its size.
export async function sendAuthorizedFile(req, res, filename, headers) {
  let file;
  try {
    file = await open(filename, 'r');
  } catch (error) {
    throw new AppError(error.code === 'ENOENT' ? 404 : 503, 'FILE_UNAVAILABLE', '文件暂时不可读取。');
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new AppError(404, 'FILE_UNAVAILABLE', '文件不存在。');
    const size = stat.size;
    const base = { ...headers, 'Accept-Ranges': 'bytes' };
    const range = req.headers.range === undefined ? undefined : parseRange(req.headers.range, size);
    if (range === null) {
      const body = Buffer.from(
        JSON.stringify({ error: { code: 'INVALID_RANGE', message: '请求的文件范围不可用。' } })
      );
      res.writeHead(416, {
        ...base,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Range': `bytes */${size}`,
        'Content-Length': body.length
      });
      res.end(body);
      return;
    }
    res.writeHead(range ? 206 : 200, {
      ...base,
      'Content-Length': range ? range.end - range.start + 1 : size,
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {})
    });
    if (!size) {
      res.end();
      return;
    }
    // pipeline handles read failures and client disconnects; the route catches the rejection.
    await pipeline(file.createReadStream({ ...(range || {}), autoClose: false }), res);
  } finally {
    await file.close().catch(() => {});
  }
}
