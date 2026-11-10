import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const PREFIX = '/api/ingestion';
const ALLOWED = new Set([
  '.pptx',
  '.ppt',
  '.pdf',
  '.docx',
  '.zip',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg'
]);
const TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4'
};
class Problem extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (s, c, m) => {
  throw new Problem(s, c, m);
};
function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}
async function body(req, limit = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'BODY_TOO_LARGE', '请求过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    fail(400, 'INVALID_JSON', '请提交有效JSON');
  }
}
const encode = (x) => JSON.stringify(x);
const decode = (x) => {
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
};
const cleanName = (x) =>
  path
    .basename(String(x || 'file').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 180);

export function createIngestionService(options = {}) {
  const home = path.resolve(options.dataDir || 'data', 'ingestion');
  for (const dir of ['', 'parts', 'files', 'jobs', 'public'])
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  const db = new DatabaseSync(path.join(home, 'state.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT,target TEXT,scope TEXT,chunkSize INTEGER,totalChunks INTEGER,status TEXT,createdAt TEXT,sha256 TEXT);
    CREATE TABLE IF NOT EXISTS parts(uploadId TEXT,part INTEGER,size INTEGER,PRIMARY KEY(uploadId,part));
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,uploadId TEXT UNIQUE,owner TEXT NOT NULL,status TEXT,progress TEXT,result TEXT,error TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE IF NOT EXISTS published(jobId TEXT,card INTEGER,target TEXT,record TEXT,PRIMARY KEY(jobId,card,target));
    CREATE TABLE IF NOT EXISTS public_assets(id TEXT PRIMARY KEY,source TEXT,mime TEXT,enabled INTEGER DEFAULT 0);
  `);
  db.prepare("UPDATE jobs SET status='queued',progress='服务恢复后重新排队' WHERE status='processing'").run();
  for (const interrupted of db.prepare("SELECT id,result FROM jobs WHERE status='understanding'").all()) {
    const saved = decode(interrupted.result) || {};
    saved.semanticAI = 'interrupted';
    db.prepare(
      "UPDATE jobs SET status='parsed',progress='AI处理已中断，结构结果保留，可重试理解',result=? WHERE id=?"
    ).run(encode(saved), interrupted.id);
  }
  const chunkSize = options.chunkSize || 8 * 1024 * 1024;
  const maxBytes = options.maxBytes || 1024 ** 3;
  const maxWorkers = options.workers || 1;
  let running = 0,
    closed = false,
    uploadsInFlight = 0;
  const partLocks = new Set(),
    completeLocks = new Set(),
    children = new Set(),
    semanticTasks = new Map();
  const now = () => new Date().toISOString();
  const row = (id) => db.prepare('SELECT * FROM uploads WHERE id=?').get(id);
  const jobRow = (id) => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const permitted = (user, action) =>
    user?.role === 'admin' &&
    (user.permissions === undefined ||
      (Array.isArray(user.permissions) &&
        user.permissions.some((p) => p === '*' || p === 'ingestion:*' || p === 'ingestion:' + action)));
  const owns = (user, record) => !!user && (permitted(user, 'read') || record?.owner === String(user.id));
  const assertOwn = (user, record) => {
    if (!record) fail(404, 'NOT_FOUND', '未找到资料');
    if (!owns(user, record)) fail(403, 'FORBIDDEN', '无权访问这份资料');
  };
  const admin = (user) => {
    if (!permitted(user, 'write')) fail(403, 'ADMIN_REQUIRED', '需要平台资料导入写入权限');
  };
  const publicUpload = (u) =>
    u
      ? { ...u, parts: db.prepare('SELECT part,size FROM parts WHERE uploadId=? ORDER BY part').all(u.id) }
      : null;
  function publicJob(j) {
    if (!j) return null;
    const parsed = decode(j.result);
    return { ...j, result: parsed ? decorateResult(j, parsed) : null };
  }
  function decorateResult(j, result) {
    return {
      ...result,
      cards: (result.cards || []).map((card, index) => ({
        ...card,
        index,
        images: (card.images || []).map((img) => ({
          ...img,
          url: `${PREFIX}/jobs/${j.id}/assets/${img.preview || img.path}`
        })),
        image: card.images?.[0]
          ? `${PREFIX}/jobs/${j.id}/assets/${card.images[0].preview || card.images[0].path}`
          : null
      }))
    };
  }
  function setJob(id, patch) {
    if (closed) return;
    const current = jobRow(id);
    if (!current) return;
    db.prepare('UPDATE jobs SET status=?,progress=?,result=?,error=?,updatedAt=? WHERE id=?').run(
      patch.status ?? current.status,
      patch.progress ?? current.progress,
      patch.result !== undefined ? encode(patch.result) : current.result,
      patch.error ?? current.error,
      now(),
      id
    );
  }
  async function next() {
    if (closed || running >= maxWorkers) return;
    const job = db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY createdAt LIMIT 1").get();
    if (!job) return;
    running++;
    setJob(job.id, { status: 'processing', progress: '拆解任务执行中' });
    const upload = row(job.uploadId),
      source = path.join(home, 'files', upload.id + path.extname(upload.name));
    const output = path.join(home, 'jobs', job.id);
    await fsp.mkdir(output, { recursive: true });
    const python = options.python || process.env.QISHU_PYTHON || 'python';
    const started = Date.now();
    await new Promise((resolve) => {
      const child = spawn(
        python,
        [path.join(import.meta.dirname, 'extract_material.py'), source, output, upload.name],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      children.add(child);
      let stdout = '',
        stderr = '',
        settled = false;
      const timeout = setTimeout(
        () => {
          child.kill();
          finish('解析任务超时；原文件保留，可调整资源后重试');
        },
        options.jobTimeout || 10 * 60 * 1000
      );
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        children.delete(child);
        if (error) {
          setJob(job.id, { status: 'failed', error, progress: '拆解未完成，原件已保留' });
          resolve();
          return;
        }
        try {
          const result = JSON.parse(fs.readFileSync(path.join(output, 'result.json'), 'utf8'));
          result.stats = { ...result.stats, durationMs: Date.now() - started, sourceBytes: upload.size };
          setJob(job.id, {
            status: 'parsed',
            progress: '结构拆解完成，待人工确认或AI理解',
            result,
            error: ''
          });
        } catch {
          setJob(job.id, { status: 'failed', error: '解析输出不可用', progress: '原件已保留' });
        }
        resolve();
      }
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        let line;
        while ((line = stdout.indexOf('\n')) >= 0) {
          const message = decode(stdout.slice(0, line));
          stdout = stdout.slice(line + 1);
          if (message?.progress) setJob(job.id, { progress: message.progress });
        }
        if (stdout.length > 16384) stdout = stdout.slice(-16384);
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-1200);
      });
      child.once('error', () => finish('Python解析器不可用，请配置QISHU_PYTHON及解析依赖'));
      child.once('exit', (code) => {
        if (code === 0) finish();
        else {
          let info;
          try {
            info = JSON.parse(fs.readFileSync(path.join(output, 'error.json'), 'utf8'));
          } catch {}
          finish(info?.message || `文件解析失败，退出状态${code}；${stderr.slice(-180)}`);
        }
      });
    });
    running--;
    setImmediate(() => next());
  }
  setImmediate(() => next());

  async function sendFile(req, res, filename, mime, disposition = 'inline') {
    let stat;
    try {
      stat = await fsp.stat(filename);
    } catch {
      fail(404, 'FILE_NOT_FOUND', '文件不存在');
    }
    const headers = {
      'content-type': mime || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-disposition': disposition,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=60'
    };
    let start = 0,
      end = stat.size - 1,
      status = 200;
    if (req.headers.range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!m) fail(416, 'INVALID_RANGE', '不支持的文件范围');
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), end) : end;
      if (start > end || start >= stat.size) fail(416, 'INVALID_RANGE', '文件范围无效');
      status = 206;
      headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['content-length'] = end - start + 1;
    res.writeHead(status, headers);
    await pipeline(fs.createReadStream(filename, { start, end }), res);
  }

  async function handle(req, res, user) {
    const url = new URL(req.url, 'http://local');
    if (!url.pathname.startsWith(PREFIX + '/')) return false;
    const parts = url.pathname
      .slice(PREFIX.length + 1)
      .split('/')
      .map((p) => decodeURIComponent(p));
    try {
      if (parts[0] === 'public' && req.method === 'GET') {
        const entry = db.prepare('SELECT * FROM public_assets WHERE id=? AND enabled=1').get(parts[1]);
        if (!entry) fail(404, 'NOT_FOUND', '素材未发布');
        await sendFile(req, res, path.join(home, 'public', entry.id), entry.mime);
        return true;
      }
      if (!user) fail(401, 'UNAUTHENTICATED', '请先登录');
      if (req.method !== 'GET') admin(user);
      if (parts[0] === 'status' && req.method === 'GET') {
        json(res, 200, {
          maxBytes,
          chunkSize,
          uploadConcurrency: 4,
          parseConcurrency: maxWorkers,
          running,
          formats: [...ALLOWED],
          semanticAI: typeof options.understand === 'function' ? 'adapter_available' : 'not_configured',
          legacyPpt: 'requires_office_converter',
          publication: typeof options.publishCard === 'function' ? 'adapter_available' : 'not_configured',
          limits: { pagesPerDocument: 300, cardsPerJob: 500 },
          note: '结构解析与AI理解分别记录；最大容量配置不等于所有大文件已实测'
        });
        return true;
      }
      if (parts[0] === 'uploads' && parts.length === 1 && req.method === 'GET') {
        const list = permitted(user, 'read')
          ? db.prepare('SELECT * FROM uploads ORDER BY createdAt DESC LIMIT 100').all()
          : db
              .prepare('SELECT * FROM uploads WHERE owner=? ORDER BY createdAt DESC LIMIT 100')
              .all(String(user.id));
        json(res, 200, { items: list.map(publicUpload) });
        return true;
      }
      if (parts[0] === 'uploads' && parts.length === 1 && req.method === 'POST') {
        admin(user);
        const data = await body(req),
          name = cleanName(data.name),
          size = Number(data.size);
        if (!ALLOWED.has(path.extname(name).toLowerCase()))
          fail(415, 'UNSUPPORTED_FORMAT', '不支持此格式，请转为PPTX、PDF或其他支持的素材');
        if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes)
          fail(413, 'FILE_TOO_LARGE', `文件大小需在1字节到${maxBytes}字节之间`);
        const id = randomUUID(),
          total = Math.ceil(size / chunkSize),
          target = ['content', 'product', 'knowledge'].includes(data.target) ? data.target : 'content';
        db.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
          id,
          String(user.id),
          name,
          size,
          String(data.mime || '').slice(0, 100),
          target,
          'private',
          chunkSize,
          total,
          'uploading',
          now(),
          null
        );
        await fsp.mkdir(path.join(home, 'parts', id), { recursive: true });
        json(res, 201, { upload: publicUpload(row(id)) });
        return true;
      }
      if (parts[0] === 'uploads' && parts[1]) {
        const upload = row(parts[1]);
        assertOwn(user, upload);
        if (parts.length === 2 && req.method === 'GET') {
          json(res, 200, {
            upload: publicUpload(upload),
            job: publicJob(db.prepare('SELECT * FROM jobs WHERE uploadId=?').get(upload.id))
          });
          return true;
        }
        if (parts[2] === 'parts' && req.method === 'PUT') {
          if (upload.status !== 'uploading') fail(409, 'UPLOAD_CLOSED', '上传已完成');
          const index = Number(parts[3]),
            expected = Math.min(chunkSize, upload.size - index * chunkSize);
          if (!Number.isInteger(index) || index < 0 || index >= upload.totalChunks)
            fail(400, 'INVALID_PART', '分片编号无效');
          const key = upload.id + ':' + index,
            existing = db.prepare('SELECT size FROM parts WHERE uploadId=? AND part=?').get(upload.id, index);
          if (existing?.size === expected) {
            req.resume();
            json(res, 200, { part: index, bytes: expected, duplicate: true });
            return true;
          }
          if (partLocks.has(key) || uploadsInFlight >= 8)
            fail(429, 'UPLOAD_BUSY', '分片正在写入，请稍后重试');
          partLocks.add(key);
          uploadsInFlight++;
          let count = 0;
          const temp = path.join(home, 'parts', upload.id, index + '.tmp'),
            final = path.join(home, 'parts', upload.id, index + '.part');
          try {
            const meter = new Transform({
              transform(chunk, encoding, callback) {
                count += chunk.length;
                if (count > expected) callback(new Problem(413, 'PART_TOO_LARGE', '分片过大'));
                else callback(null, chunk);
              }
            });
            await pipeline(req, meter, fs.createWriteStream(temp, { flags: 'w' }));
            if (count !== expected) fail(400, 'PART_SIZE_MISMATCH', '分片长度不匹配');
            await fsp.rename(temp, final);
            db.prepare('INSERT OR REPLACE INTO parts VALUES(?,?,?)').run(upload.id, index, count);
            json(res, 200, {
              part: index,
              bytes: count,
              received: db.prepare('SELECT SUM(size) n FROM parts WHERE uploadId=?').get(upload.id).n
            });
          } finally {
            partLocks.delete(key);
            uploadsInFlight--;
            await fsp.rm(temp, { force: true }).catch(() => {});
          }
          return true;
        }
        if (parts[2] === 'complete' && req.method === 'POST') {
          const oldJob = db.prepare('SELECT * FROM jobs WHERE uploadId=?').get(upload.id);
          if (oldJob) {
            json(res, 200, { job: publicJob(oldJob) });
            return true;
          }
          if (completeLocks.has(upload.id)) fail(409, 'COMPLETING', '正在合并分片，请稍后查看状态');
          const pieces = db.prepare('SELECT * FROM parts WHERE uploadId=? ORDER BY part').all(upload.id);
          if (pieces.length !== upload.totalChunks || pieces.reduce((n, p) => n + p.size, 0) !== upload.size)
            fail(409, 'MISSING_PARTS', '分片未完整上传');
          completeLocks.add(upload.id);
          const output = path.join(home, 'files', upload.id + path.extname(upload.name));
          const temp = output + '.assembling',
            hash = createHash('sha256');
          try {
            async function* input() {
              for (let index = 0; index < upload.totalChunks; index++)
                for await (const chunk of fs.createReadStream(
                  path.join(home, 'parts', upload.id, index + '.part')
                )) {
                  hash.update(chunk);
                  yield chunk;
                }
            }
            await pipeline(Readable.from(input()), fs.createWriteStream(temp));
            await fsp.rename(temp, output);
            const id = randomUUID();
            db.prepare("UPDATE uploads SET status='complete',sha256=? WHERE id=?").run(
              hash.digest('hex'),
              upload.id
            );
            db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)').run(
              id,
              upload.id,
              String(user.id),
              'queued',
              '等待拆解',
              null,
              '',
              now(),
              now()
            );
            // Only remove files inside this upload's generated part directory.
            for (let index = 0; index < upload.totalChunks; index++)
              await fsp.rm(path.join(home, 'parts', upload.id, index + '.part'), { force: true });
            setImmediate(() => next());
            json(res, 201, { job: publicJob(jobRow(id)) });
          } finally {
            completeLocks.delete(upload.id);
            await fsp.rm(temp, { force: true }).catch(() => {});
          }
          return true;
        }
        if (parts[2] === 'file' && req.method === 'GET') {
          await sendFile(
            req,
            res,
            path.join(home, 'files', upload.id + path.extname(upload.name)),
            upload.mime,
            'attachment; filename="source' + path.extname(upload.name) + '"'
          );
          return true;
        }
      }
      if (parts[0] === 'jobs' && parts.length === 1 && req.method === 'GET') {
        const list = permitted(user, 'read')
          ? db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC LIMIT 100').all()
          : db
              .prepare('SELECT * FROM jobs WHERE owner=? ORDER BY createdAt DESC LIMIT 100')
              .all(String(user.id));
        json(res, 200, { items: list.map(publicJob) });
        return true;
      }
      if (parts[0] === 'jobs' && parts[1]) {
        const job = jobRow(parts[1]);
        assertOwn(user, job);
        if (parts.length === 2 && req.method === 'GET') {
          json(res, 200, { job: publicJob(job) });
          return true;
        }
        if (parts[2] === 'assets' && req.method === 'GET') {
          const rel = parts.slice(3).join('/');
          if (!/^images\/[a-f0-9]{20}(?:-preview)?\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff)$/.test(rel))
            fail(400, 'INVALID_ASSET', '素材路径无效');
          await sendFile(
            req,
            res,
            path.join(home, 'jobs', job.id, rel),
            TYPES[path.extname(rel)] || 'application/octet-stream'
          );
          return true;
        }
        if (parts[2] === 'retry' && req.method === 'POST') {
          if (!['failed', 'parsed'].includes(job.status)) fail(409, 'TASK_BUSY', '任务尚未结束');
          setJob(job.id, { status: 'queued', error: '', progress: '重新排队' });
          setImmediate(() => next());
          json(res, 200, { job: publicJob(jobRow(job.id)) });
          return true;
        }
        if (parts[2] === 'cards' && req.method === 'PATCH') {
          if (job.status === 'understanding')
            fail(409, 'UNDERSTANDING_IN_PROGRESS', 'AI正在归类，请完成后再编辑，避免覆盖人工修改');
          const data = await body(req),
            result = decode(job.result);
          if (!result) fail(409, 'NOT_PARSED', '先完成结构拆解');
          const index = Number(data.index),
            card = result.cards?.[index];
          if (!card) fail(404, 'CARD_NOT_FOUND', '卡片不存在');
          for (const key of [
            'title',
            'body',
            'origin',
            'style',
            'category',
            'price',
            'moq',
            'status',
            'supplierId',
            'tags'
          ])
            if (data[key] !== undefined) card[key] = data[key];
          card.semanticStatus = 'human_edited';
          setJob(job.id, { result });
          json(res, 200, { job: publicJob(jobRow(job.id)) });
          return true;
        }
        if (parts[2] === 'understand' && req.method === 'POST') {
          admin(user);
          const result = decode(job.result);
          if (!result) fail(409, 'NOT_PARSED', '先完成结构拆解');
          if (typeof options.understand !== 'function')
            fail(503, 'AI_NOT_CONFIGURED', '结构拆解已完成；AI理解渠道尚未配置，不会冒充理解完成');
          if (semanticTasks.has(job.id)) {
            json(res, 202, { job: publicJob(jobRow(job.id)), deduplicated: true });
            return true;
          }
          if (semanticTasks.size >= 2) fail(429, 'AI_QUEUE_BUSY', '已有两份资料在理解中，请稍后提交');
          result.semanticAI = 'running';
          setJob(job.id, {
            status: 'understanding',
            error: '',
            result,
            progress: 'AI理解已排队，按批次处理'
          });
          const source = row(job.uploadId);
          const task = Promise.resolve()
            .then(() =>
              options.understand(user, {
                cards: result.cards,
                source,
                jobId: job.id,
                onProgress: (message) => setJob(job.id, { progress: String(message).slice(0, 300) })
              })
            )
            .then((refined) => {
              if (!refined || !Array.isArray(refined.cards) || refined.cards.length !== result.cards.length)
                fail(502, 'INVALID_AI_RESULT', 'AI返回卡片结构或数量不匹配');
              result.cards = refined.cards;
              result.semanticAI = refined.semanticAI || 'provider_completed';
              result.semanticSummary = refined.summary || null;
              result.pendingMediaCount = refined.pendingMediaCount || 0;
              setJob(job.id, {
                status: 'parsed',
                result,
                error: '',
                progress:
                  result.semanticAI === 'partial'
                    ? '文本归类完成；部分媒体待OCR/ASR或图像理解'
                    : 'AI归类完成，待人工确认'
              });
            })
            .catch((error) => {
              result.semanticAI = 'failed';
              setJob(job.id, {
                status: 'parsed',
                result,
                error: error.status ? error.message : 'AI理解失败，结构结果已保留',
                progress: 'AI理解未完成；可核对配置后重试或人工编辑'
              });
            })
            .finally(() => semanticTasks.delete(job.id));
          semanticTasks.set(job.id, task);
          json(res, 202, { job: publicJob(jobRow(job.id)) });
          return true;
        }
        if (parts[2] === 'publish' && req.method === 'POST') {
          if (job.status === 'understanding')
            fail(409, 'UNDERSTANDING_IN_PROGRESS', 'AI正在归类，请核对完成的结果后发布');
          admin(user);
          if (typeof options.publishCard !== 'function')
            fail(503, 'PUBLISH_NOT_CONFIGURED', '业务发布接口尚未接入，拆解结果仍为待确认草稿');
          const data = await body(req),
            result = decode(job.result);
          if (!result) fail(409, 'NOT_PARSED', '先完成拆解');
          const indices = Array.isArray(data.indices)
            ? [...new Set(data.indices.map(Number))]
            : [Number(data.index)];
          if (
            !indices.length ||
            indices.length > 100 ||
            indices.some((i) => !Number.isInteger(i) || !result.cards[i])
          )
            fail(400, 'INVALID_SELECTION', '请选择1至100张有效卡片');
          const target = ['content', 'product', 'knowledge'].includes(data.target)
            ? data.target
            : row(job.uploadId).target;
          const records = [];
          for (const index of indices) {
            const old = db
              .prepare('SELECT record FROM published WHERE jobId=? AND card=? AND target=?')
              .get(job.id, index, target);
            if (old) {
              records.push(decode(old.record));
              continue;
            }
            const card = { ...result.cards[index] },
              assets = [];
            if (target !== 'knowledge')
              for (const image of card.images || []) {
                const relative = image.preview || image.path;
                if (
                  !/^images\/[a-f0-9]{20}(?:-preview)?\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff)$/.test(relative)
                )
                  continue;
                const id = randomUUID() + path.extname(relative);
                await fsp.copyFile(path.join(home, 'jobs', job.id, relative), path.join(home, 'public', id));
                db.prepare('INSERT INTO public_assets VALUES(?,?,?,0)').run(
                  id,
                  job.id,
                  TYPES[path.extname(id)] || 'application/octet-stream'
                );
                assets.push(id);
              }
            card.image = assets[0] ? `${PREFIX}/public/${assets[0]}` : null;
            card.images = assets.map((id) => ({ url: `${PREFIX}/public/${id}` }));
            try {
              const record = await options.publishCard(user, {
                ...card,
                target,
                idempotencyKey: `ingest:${job.id}:${index}:${target}`,
                sourceUploadId: job.uploadId
              });
              for (const id of assets) db.prepare('UPDATE public_assets SET enabled=1 WHERE id=?').run(id);
              db.prepare('INSERT INTO published VALUES(?,?,?,?)').run(job.id, index, target, encode(record));
              records.push(record);
            } catch (error) {
              for (const id of assets) {
                db.prepare('DELETE FROM public_assets WHERE id=?').run(id);
                await fsp.rm(path.join(home, 'public', id), { force: true });
              }
              throw error;
            }
          }
          options.audit?.(user, 'ingestion.publish', { jobId: job.id, count: records.length, target });
          json(res, 200, { records });
          return true;
        }
      }
      fail(404, 'NOT_FOUND', '资料导入接口不存在');
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status || 500, {
          error: {
            code: error.code || 'INGESTION_ERROR',
            message: error.status ? error.message : '导入处理失败，原始资料和已完成分片保留'
          }
        });
      else if (!res.destroyed) res.destroy();
      return true;
    }
  }
  return {
    handle,
    status: () => ({ running, maxWorkers, maxBytes, chunkSize }),
    resolveFile(user, id) {
      const upload = row(id);
      assertOwn(user, upload);
      return { path: path.join(home, 'files', upload.id + path.extname(upload.name)), ...upload };
    },
    close() {
      closed = true;
      for (const child of children) child.kill();
      db.close();
    }
  };
}
