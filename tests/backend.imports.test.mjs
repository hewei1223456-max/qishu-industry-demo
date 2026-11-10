import test from 'node:test';
import assert from 'node:assert/strict';
import { importerBridge } from '../apps/server/src/imports.js';

test('semantic import batches long text, preserves sources and reports unprocessed media honestly', async () => {
  const jobs = new Map(),
    messages = [],
    progress = [];
  let i = 0;
  const ai = {
    create(user, { message }) {
      messages.push(message);
      const units = JSON.parse(message.slice(message.indexOf('\n') + 1));
      const id = 'job-' + i++;
      jobs.set(id, {
        status: 'completed',
        result: {
          text: JSON.stringify({
            cards: units.map((x) => ({
              index: x.index,
              segment: x.segment,
              tags: ['小单快返'],
              style: '通勤',
              category: '针织衫',
              body: '模型不能改掉原文'
            }))
          })
        }
      });
      return { id };
    },
    get(user, id) {
      return jobs.get(id);
    }
  };
  const long = '这是完整来源正文。'.repeat(2200);
  const cards = [
    ...Array.from({ length: 25 }, (_, n) => ({
      title: '来源页' + n,
      body: n === 0 ? long : '真实提取到的原文' + n,
      page: n + 1,
      images: n === 1 ? [{ path: 'images/test.png' }] : []
    })),
    { title: '纯图片', body: '', page: 26, images: [{ path: 'images/another.png' }] }
  ];
  const result = await importerBridge({}, ai).understand(
    { id: 'admin', role: 'admin' },
    { cards, onProgress: (x) => progress.push(x) }
  );
  assert.ok(messages.length > 1);
  assert.ok(messages.every((m) => m.length < 10000));
  assert.equal(progress.length, messages.length);
  assert.equal(result.cards.length, cards.length);
  assert.equal(result.cards[0].body, long);
  assert.equal(result.cards[1].page, 2);
  assert.deepEqual(result.cards[1].images, cards[1].images);
  assert.equal(result.cards[0].style, '通勤');
  assert.ok(result.cards[0].tags.includes('小单快返'));
  assert.equal(result.cards[25].semanticStatus, 'requires_ocr_asr');
  assert.equal(result.cards[25].semanticScope, 'not_understood');
  assert.equal(result.semanticAI, 'partial');
  assert.equal(result.pendingMediaCount, 2);
  assert.ok(result.summary.textSegments > 25);
});

test('semantic import rejects a model that reorders fragment indexes instead of silently corrupting classification', async () => {
  const ai = {
    create() {
      return { id: 'bad-model-job' };
    },
    get() {
      return {
        status: 'completed',
        result: { text: '{"cards":[{"index":999,"segment":0,"tags":["不应采用"]}]}' }
      };
    }
  };
  await assert.rejects(
    () =>
      importerBridge({}, ai).understand(
        { id: 'admin', role: 'admin' },
        { cards: [{ title: '原文', body: '经营资料' }] }
      ),
    (e) => e.code === 'INVALID_AI_RESULT'
  );
});
