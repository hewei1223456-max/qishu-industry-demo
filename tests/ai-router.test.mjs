import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../apps/server/src/db.js';
import { createSecretStore } from '../apps/server/src/secrets.js';
import {
  createAiService,
  permittedKnowledge,
  ownKnowledge,
  validateProviderUrl
} from '../apps/server/src/ai.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (text) => json({ choices: [{ message: { content: text } }] });
function fixture(t, options = {}) {
  const root = resolve(tmpdir()),
    dir = mkdtempSync(join(root, 'qishu-ai-router-')),
    db = openDatabase(':memory:'),
    secrets = createSecretStore('', { memory: true });
  const user = db.save('users', { id: 'owner-a', role: 'owner', companyId: 'company-a', verified: true });
  const admin = db.save('users', { id: 'admin-a', role: 'admin', companyId: 'platform', verified: true });
  const config = {
    features: { ai: true },
    systemPrompts: {
      platform: '平台层规则',
      tasks: { chat: '聊天任务规则', ocr: 'OCR任务规则' },
      providers: { b: '渠道B平台配置' }
    }
  };
  options.beforeCreate?.(db, user);
  const ai = createAiService({ db, secrets, uploadDir: dir, getConfig: () => config, ...options });
  let dbClosed = false;
  t.after(() => {
    ai.close();
    if (!dbClosed) db.close();
    if (dir.startsWith(root + sep) && dir.includes('qishu-ai-router-'))
      rmSync(dir, { recursive: true, force: true });
  });
  function provider(id, fields = {}) {
    return db.save('providers', {
      id,
      enabled: true,
      adapter: 'openai',
      baseUrl: `https://${id}.example.com/v1`,
      model: 'model-' + id,
      capabilities: ['chat'],
      priority: 100,
      secret: secrets.encrypt('mock-provider-secret-' + id),
      ...fields
    });
  }
  function file(id, mime = 'image/png', ownerId = user.id, bytes = Buffer.from('mock-data')) {
    writeFileSync(join(dir, id), bytes);
    return db.save('files', { id, ownerId, mime, name: id, diskName: id, size: bytes.length, public: false });
  }
  return {
    db,
    ai,
    user,
    admin,
    config,
    provider,
    file,
    dir,
    closeDb() {
      dbClosed = true;
      db.close();
    }
  };
}
async function settled(f, job) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const current = f.ai.get(f.user, job.id);
    if (['completed', 'failed'].includes(current.status)) return current;
    await delay(5);
  }
  throw Error('test job did not finish');
}

test('route priority + capability matching + failure fallback + layered prompts + private knowledge', async (t) => {
  const calls = [];
  const f = fixture(t, {
    fetchImpl: async (url, o) => {
      calls.push({ url, body: JSON.parse(o.body) });
      return url.includes('a.example')
        ? json({ error: { message: 'echo mock-provider-secret-a' } }, 503)
        : completion('给出有条件的经营建议');
    }
  });
  f.provider('disabled', { enabled: false, priority: -10 });
  f.provider('wrong', { capabilities: ['image'], priority: -5 });
  f.provider('a', { priority: 1 });
  f.provider('b', { priority: 2, systemPrompt: '渠道B附加规则' });
  for (const doc of [
    { id: 'official-private-id', scope: 'platform', title: '不可公开的底库名称', body: '平台资料正文' },
    { id: 'mine', ownerId: f.user.id, scope: 'private', title: '本人资料', body: 'MY_PRIVATE_FACT' },
    { id: 'peer-company', companyId: 'company-a', scope: 'company', body: 'SAME_COMPANY_FACT' },
    { id: 'other', ownerId: 'owner-b', companyId: 'company-b', scope: 'private', body: 'OTHER_PRIVATE_FACT' },
    { id: 'null-company', scope: 'company', body: 'NULL_COMPANY_LEAK' }
  ])
    f.db.save('knowledge', doc);
  const done = await settled(f, f.ai.create(f.user, { task: 'chat', message: '如何改善拿货？' }));
  assert.equal(done.status, 'completed');
  assert.equal(done.providerId, 'b');
  assert.equal(done.model, 'model-b');
  assert.deepEqual(
    done.attempts.map((a) => [a.providerId, a.status]),
    [
      ['a', 'failed'],
      ['b', 'completed']
    ]
  );
  assert.equal(calls.length, 2);
  const system = calls[1].body.messages[0].content;
  for (const text of [
    '平台层规则',
    '聊天任务规则',
    '渠道B平台配置',
    '渠道B附加规则',
    'MY_PRIVATE_FACT',
    'SAME_COMPANY_FACT'
  ])
    assert(system.includes(text), text);
  assert(!system.includes('OTHER_PRIVATE_FACT'));
  assert(!system.includes('NULL_COMPANY_LEAK'));
  assert(!JSON.stringify(done).includes('mock-provider-secret-a'));
  assert(!JSON.stringify(done.sources).includes('official-private-id'));
  assert(!JSON.stringify(done.sources).includes('不可公开的底库名称'));
  assert(done.sources.some((s) => s.title === '平台经营知识'));
  assert(!ownKnowledge(f.db, f.user).some((d) => d.scope === 'platform'));
  assert(!permittedKnowledge(f.db, { id: 'x' }).some((d) => d.id === 'null-company'));
});

test('explicit provider never silently switches; missing capability is explicit', async (t) => {
  const calls = [];
  const f = fixture(t, {
    fetchImpl: async (url) => {
      calls.push(url);
      return json({ error: { message: 'SECRET' } }, 500);
    }
  });
  f.provider('a');
  f.provider('b');
  const done = await settled(f, f.ai.create(f.user, { task: 'chat', providerId: 'a', message: 'test' }));
  assert.equal(done.status, 'failed');
  assert.equal(done.attempts.length, 1);
  assert.equal(calls.length, 1);
  const mismatch = await settled(f, f.ai.create(f.user, { task: 'video', providerId: 'a', message: 'test' }));
  assert.equal(mismatch.error.code, 'CAPABILITY_MISMATCH');
  assert.equal(calls.length, 1);
});

test('openai compatible text/OCR/ASR/TTS/image paths use real protocol shapes with mocked HTTP', async (t) => {
  const calls = [];
  const f = fixture(t, {
    fetchImpl: async (url, o) => {
      calls.push({ url, options: o });
      if (url.endsWith('/audio/transcriptions')) {
        assert(o.body instanceof FormData);
        assert.equal(o.body.get('file').name, 'sound');
        return json({ text: '语音转写结果' });
      }
      if (url.endsWith('/audio/speech')) {
        const body = JSON.parse(o.body);
        assert.equal(body.input, '朗读这段文字');
        assert(!o.body.includes('平台层规则'));
        return new Response(Buffer.from('mock-audio'), { headers: { 'Content-Type': 'audio/mpeg' } });
      }
      if (url.endsWith('/images/generations'))
        return json({ data: [{ b64_json: Buffer.from('mock-png').toString('base64') }] });
      const body = JSON.parse(o.body);
      if (Array.isArray(body.messages[1].content))
        assert(body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'));
      return completion('识别或回答结果');
    }
  });
  f.provider('all', { capabilities: ['chat', 'ocr', 'asr', 'tts', 'image'] });
  f.file('picture');
  f.file('sound', 'audio/mpeg');
  for (const body of [
    { task: 'chat', message: '问题' },
    { task: 'ocr', fileId: 'picture', message: '识别文字' },
    { task: 'asr', fileId: 'sound' },
    { task: 'tts', message: '朗读这段文字' },
    { task: 'image', message: '服装陈列参考' }
  ]) {
    const done = await settled(f, f.ai.create(f.user, body));
    assert.equal(done.status, 'completed', JSON.stringify(done.error));
    if (['tts', 'image'].includes(body.task)) {
      const file = f.db.get('files', done.result.fileId);
      assert.equal(file.public, false);
      assert.equal(file.ownerId, f.user.id);
      assert(readFileSync(join(f.dir, file.diskName)).length > 0);
    }
  }
  assert.equal(calls.length, 5);
  assert(calls.some((c) => c.url.endsWith('/audio/transcriptions')));
});

test('gemini OCR + custom-json video preserve task/system and actual media URL', async (t) => {
  const calls = [];
  const f = fixture(t, {
    fetchImpl: async (url, o) => {
      const body = JSON.parse(o.body);
      calls.push({ url, body });
      if (url.includes('gemini')) {
        assert(body.contents[0].parts[1].inlineData.data);
        assert(body.systemInstruction.parts[0].text.includes('OCR任务规则'));
        return json({ candidates: [{ content: { parts: [{ text: 'OCR结果' }] } }] });
      }
      assert(body.system.includes('平台层规则'));
      assert.equal(body.task, 'video');
      assert(body.prompt.includes('用户输入'));
      return json({ data: { video: 'https://media.example.com/generated.mp4' } });
    }
  });
  f.provider('gemini', { adapter: 'gemini', capabilities: ['ocr'] });
  f.provider('video', {
    adapter: 'custom-json',
    capabilities: ['video'],
    requestPath: '/generate',
    requestTemplate: { model: '{{model}}', task: '{{task}}', prompt: '{{prompt}}', system: '{{system}}' },
    responsePath: 'data.video',
    resultType: 'video'
  });
  f.file('image');
  const ocr = await settled(f, f.ai.create(f.user, { task: 'ocr', fileId: 'image' }));
  assert.equal(ocr.result.text, 'OCR结果');
  const video = await settled(f, f.ai.create(f.user, { task: 'video', message: '陈列短片' }));
  assert.equal(video.result.type, 'video');
  assert.equal(video.result.url, 'https://media.example.com/generated.mp4');
  assert.equal(calls.length, 2);
});

test('timeout fallback is bounded even if injected fetch ignores abort', async (t) => {
  const f = fixture(t, {
    timeoutMs: 20,
    fetchImpl: async (url) => (url.includes('slow') ? new Promise(() => {}) : completion('降级后的回答'))
  });
  f.provider('slow', { priority: 1 });
  f.provider('fast', { priority: 2 });
  const done = await settled(f, f.ai.create(f.user, { task: 'chat', message: 'test' }));
  assert.equal(done.status, 'completed');
  assert.equal(done.providerId, 'fast');
  assert.equal(done.attempts[0].error.code, 'PROVIDER_TIMEOUT');
});

test('response declared length and streamed bytes have hard limits', async (t) => {
  let declared = true;
  const f = fixture(t, {
    maxResponseBytes: 64,
    fetchImpl: async () =>
      new Response('x'.repeat(128), { headers: declared ? { 'Content-Length': '128' } : {} })
  });
  f.provider('large');
  for (let i = 0; i < 2; i++) {
    const done = await settled(f, f.ai.create(f.user, { task: 'chat', providerId: 'large' }));
    assert.equal(done.error.code, 'RESPONSE_TOO_LARGE');
    declared = false;
  }
});

test('private file ownership, type, size and paths are checked before dispatch', (t) => {
  let calls = 0;
  const f = fixture(t, {
    maxInputBytes: 64,
    fetchImpl: async () => {
      calls++;
      return completion('unexpected');
    }
  });
  f.provider('a', { capabilities: ['ocr', 'asr'] });
  f.file('foreign', 'image/png', 'another-user');
  f.file('oversize', 'image/png', f.user.id, Buffer.alloc(128));
  f.file('audio', 'audio/mpeg');
  assert.throws(
    () => f.ai.create(f.user, { task: 'ocr', fileId: 'foreign' }),
    (e) => e.code === 'NOT_FOUND'
  );
  assert.throws(
    () => f.ai.create(f.user, { task: 'ocr', fileId: 'oversize' }),
    (e) => e.code === 'INPUT_TOO_LARGE'
  );
  assert.throws(
    () => f.ai.create(f.user, { task: 'ocr', fileId: 'audio' }),
    (e) => e.code === 'IMAGE_REQUIRED'
  );
  assert.throws(
    () => f.ai.create(f.user, { task: 'asr' }),
    (e) => e.code === 'AUDIO_REQUIRED'
  );
  f.db.save('files', { id: 'escape', ownerId: f.user.id, mime: 'image/png', diskName: '../escape' });
  assert.throws(
    () => f.ai.create(f.user, { task: 'ocr', fileId: 'escape' }),
    (e) => e.code === 'INVALID_FILE'
  );
  assert.equal(calls, 0);
});

test('queue concurrency and admission limit are bounded', async (t) => {
  let active = 0,
    maximum = 0;
  const releases = [];
  const f = fixture(t, {
    concurrency: 1,
    maxUserPending: 2,
    fetchImpl: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((r) => releases.push(r));
      active--;
      return completion('完成');
    }
  });
  f.provider('a');
  const first = f.ai.create(f.user, { task: 'chat' }),
    second = f.ai.create(f.user, { task: 'chat' });
  assert.throws(
    () => f.ai.create(f.user, { task: 'chat' }),
    (e) => e.code === 'QUEUE_FULL'
  );
  while (!releases.length) await delay(2);
  releases.shift()();
  await settled(f, first);
  while (!releases.length) await delay(2);
  releases.shift()();
  assert.equal((await settled(f, second)).status, 'completed');
  assert.equal(maximum, 1);
});

test('persisted queued/running tasks recover when service restarts', async (t) => {
  const f = fixture(t, {
    fetchImpl: async () => completion('恢复结果'),
    beforeCreate(db, user) {
      for (const status of ['queued', 'running'])
        db.save('jobs', { id: status, ownerId: user.id, task: 'chat', message: '恢复', status });
    }
  });
  f.provider('a');
  for (const id of ['queued', 'running']) {
    const done = await settled(f, { id });
    assert.equal(done.status, 'completed');
    assert(done.recoveredAt);
    if (id === 'running') assert.equal(done.interrupted, true);
  }
});

test('close aborts inflight calls and performs no DB access after DB is closed', async (t) => {
  let release,
    started = false;
  const f = fixture(t, {
    fetchImpl: async () => {
      started = true;
      await new Promise((r) => (release = r));
      return completion('迟到响应');
    }
  });
  f.provider('a');
  f.ai.create(f.user, { task: 'chat' });
  while (!started) await delay(2);
  let accesses = 0;
  for (const method of ['get', 'list', 'save']) {
    const original = f.db[method];
    f.db[method] = (...args) => {
      accesses++;
      return original(...args);
    };
  }
  f.ai.close();
  f.closeDb();
  const before = accesses;
  release();
  await delay(20);
  assert.equal(accesses, before);
  assert.throws(
    () => f.ai.create(f.user, { task: 'chat' }),
    (e) => e.code === 'SERVICE_CLOSED'
  );
});

test('secret echo is blocked and lack of real provider stays unconfigured', async (t) => {
  const f = fixture(t, { fetchImpl: async () => completion('mock-provider-secret-a') });
  const unconfigured = await settled(f, f.ai.create(f.user, { task: 'chat' }));
  assert.equal(unconfigured.error.code, 'MODEL_NOT_CONFIGURED');
  f.provider('a');
  const blocked = await settled(f, f.ai.create(f.user, { task: 'chat' }));
  assert.equal(blocked.error.code, 'OUTPUT_BLOCKED');
  assert(!JSON.stringify(blocked).includes('mock-provider-secret-a'));
});

test('verbatim multiline official knowledge cannot be returned as raw output', async (t) => {
  const body = '这是私有官方底库原文，普通用户不可直接获得。'.repeat(6) + '\n第二段底层原文。';
  const f = fixture(t, { fetchImpl: async () => completion(body) });
  f.provider('a');
  f.db.save('knowledge', { id: 'private-platform-doc', scope: 'platform', body });
  const done = await settled(f, f.ai.create(f.user, { task: 'chat' }));
  assert.equal(done.error.code, 'OUTPUT_BLOCKED');
  assert(!JSON.stringify(done).includes(body));
});

test('provider source URLs reject credentials, non-HTTPS and local networks', () => {
  for (const value of [
    'http://api.example.com',
    'https://user:pass@api.example.com',
    'https://127.0.0.1',
    'https://192.168.0.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[fd00::1]',
    'https://host.internal',
    'https://api.example.com?q=1'
  ])
    assert.throws(
      () => validateProviderUrl(value),
      (e) => e.code === 'INVALID_PROVIDER'
    );
  assert.equal(validateProviderUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
});

test('RBAC: limited admins cannot read platform KB, foreign jobs or test providers; active grants apply immediately', async (t) => {
  const f = fixture(t, { fetchImpl: async () => completion('权限测试回答') });
  f.provider('a');
  const limited = f.db.save('users', {
    id: 'limited',
    role: 'admin',
    primaryRole: 'owner',
    permissions: ['*'],
    adminGrantId: 'grant-limited',
    verified: true
  });
  const grant = {
    id: 'grant-limited',
    status: 'active',
    bindingVerified: true,
    userId: limited.id,
    permissions: []
  };
  f.db.save('admins', grant);
  f.db.save('knowledge', { id: 'official', scope: 'platform', title: '底层真实标题', body: '官方经营资料' });
  f.db.save('knowledge', { id: 'foreign-kb', scope: 'private', ownerId: f.user.id, body: '他人私有内容' });
  f.db.save('knowledge', { id: 'own-kb', scope: 'private', ownerId: limited.id, body: '本人内容' });
  f.db.save('jobs', { id: 'foreign-job', ownerId: f.user.id, status: 'completed' });
  f.db.save('jobs', { id: 'own-job', ownerId: limited.id, status: 'completed' });
  assert.deepEqual(
    ownKnowledge(f.db, limited).map((x) => x.id),
    ['own-kb']
  );
  assert.deepEqual(
    f.ai.list(limited).map((x) => x.id),
    ['own-job']
  );
  assert.throws(
    () => f.ai.get(limited, 'foreign-job'),
    (e) => e.code === 'NOT_FOUND'
  );
  await assert.rejects(
    () => f.ai.testProvider(limited, 'a'),
    (e) => e.code === 'FORBIDDEN'
  );
  const created = f.ai.create(limited, { task: 'chat', message: '测试' });
  let done;
  for (let i = 0; i < 100; i++) {
    done = f.ai.get(limited, created.id);
    if (done.status === 'completed') break;
    await delay(5);
  }
  assert.equal(done.status, 'completed');
  assert(!done.sources.some((x) => x.id === 'official'));
  assert(done.sources.some((x) => x.title === '平台经营知识'));
  f.db.save('admins', { ...grant, permissions: ['jobs:read', 'knowledge:*', 'providers:read'] });
  assert(f.ai.list(limited).some((x) => x.id === 'foreign-job'));
  assert.equal(f.ai.get(limited, 'foreign-job').id, 'foreign-job');
  assert(ownKnowledge(f.db, limited).some((x) => x.id === 'official'));
  await assert.rejects(
    () => f.ai.testProvider(limited, 'a'),
    (e) => e.code === 'FORBIDDEN'
  );
  const second = f.ai.create(limited, { task: 'chat', message: '再次测试' });
  for (let i = 0; i < 100; i++) {
    done = f.ai.get(limited, second.id);
    if (done.status === 'completed') break;
    await delay(5);
  }
  assert(done.sources.some((x) => x.id === 'official'));
  f.db.save('admins', { ...grant, permissions: ['providers:write'] });
  assert.equal((await f.ai.testProvider(limited, 'a')).ok, true);
  f.db.save('admins', { ...grant, status: 'disabled', permissions: ['*'] });
  assert.throws(
    () => f.ai.get(limited, 'foreign-job'),
    (e) => e.code === 'NOT_FOUND'
  );
  assert(!ownKnowledge(f.db, limited).some((x) => x.id === 'official'));
  await assert.rejects(
    () => f.ai.testProvider(limited, 'a'),
    (e) => e.code === 'FORBIDDEN'
  );
});
