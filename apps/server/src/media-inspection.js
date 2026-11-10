import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { AppError } from './db.js';
function command(exe, args, { timeout = 60000, max = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false,
      bytes = 0;
    const out = [];
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(Buffer.concat(out));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new AppError(422, 'MEDIA_INSPECTION_TIMEOUT', '媒体核验超时，请压缩后重新上传。'));
    }, timeout);
    child.on('error', () =>
      finish(
        new AppError(
          503,
          'MEDIA_INSPECTOR_UNAVAILABLE',
          '服务器媒体核验器不可用，无法自动认定材料合格，请联系平台。'
        )
      )
    );
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > max) {
        child.kill();
        finish(new AppError(422, 'INVALID_MEDIA', '媒体解析输出超出限制。'));
      } else out.push(chunk);
    });
    child.stderr.resume();
    child.on('close', (code) =>
      finish(code ? new AppError(422, 'INVALID_MEDIA', '文件不是可正常解码的照片或视频。') : null)
    );
  });
}
async function digestFile(filename) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(filename)) h.update(chunk);
  return h.digest('hex');
}
export async function inspectMedia(filename, kind) {
  const probe = process.env.QISHU_FFPROBE || 'ffprobe',
    ffmpeg = process.env.QISHU_FFMPEG || 'ffmpeg';
  let data;
  try {
    data = JSON.parse(
      (
        await command(probe, [
          '-v',
          'error',
          ...(kind === 'video' ? ['-count_frames'] : []),
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          filename
        ])
      ).toString()
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'INVALID_MEDIA', '媒体解析结果不可用。');
  }
  const stream = data.streams?.find((x) => x.codec_type === 'video');
  if (
    !stream ||
    !stream.width ||
    !stream.height ||
    stream.width > 20000 ||
    stream.height > 20000 ||
    stream.width * stream.height > 80000000
  )
    throw new AppError(422, 'INVALID_MEDIA', '请上传可正常解码的照片或视频画面。');
  const sha256 = await digestFile(filename);
  if (kind === 'image') {
    if (!['png', 'mjpeg', 'webp', 'jpeg2000', 'av1'].includes(stream.codec_name))
      throw new AppError(422, 'INVALID_IMAGE', '场所照片必须是实际图片，不能用视频或伪装文件。');
    const pixels = await command(
      ffmpeg,
      [
        '-v',
        'error',
        '-threads',
        '2',
        '-i',
        filename,
        '-frames:v',
        '1',
        '-vf',
        'scale=32:32:flags=bilinear,format=rgb24',
        '-f',
        'rawvideo',
        'pipe:1'
      ],
      { timeout: 15000, max: 4096 }
    );
    if (pixels.length !== 3072) throw new AppError(422, 'INVALID_IMAGE', '照片不能被完整解码。');
    return {
      status: 'verified',
      source: 'ffprobe+ffmpeg',
      kind,
      width: stream.width,
      height: stream.height,
      sha256,
      pixelHash: createHash('sha256').update(pixels).digest('hex')
    };
  }
  const durations = [Number(data.format?.duration), Number(stream.duration)];
  const [num, den] = String(stream.avg_frame_rate || '0/1')
      .split('/')
      .map(Number),
    fps = num / den,
    count = Number(stream.nb_read_frames || stream.nb_frames);
  if (fps > 0 && count > 0) durations.push(count / fps);
  const valid = durations.filter((x) => Number.isFinite(x) && x > 0);
  if (!valid.length)
    throw new AppError(422, 'INVALID_VIDEO_DURATION', '无法核验视频真实时长，请重新拍摄上传。');
  const durationSeconds = Math.min(...valid);
  if (durationSeconds < 30)
    throw new AppError(
      422,
      'VIDEO_TOO_SHORT',
      `厂家场所视频实际${durationSeconds.toFixed(2)}秒，必须至少30秒；客户端填写时长不参与核验。`
    );
  return {
    status: 'verified',
    source: 'ffprobe',
    kind,
    durationSeconds,
    width: stream.width,
    height: stream.height,
    frames: count || null,
    sha256
  };
}
