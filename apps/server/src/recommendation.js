import { uid, now } from './db.js';
const D = 64,
  E = 12;
const tokenize = (s) =>
  String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s,，。；;·/|—\-]+/)
    .flatMap((x) => (x.length > 5 ? [x, ...Array.from(x.slice(0, 24))] : [x]))
    .filter(Boolean);
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}
function feature(tokens) {
  const x = Array(D).fill(0);
  for (const s of tokens) x[hash(s) % D] += 1;
  const n = Math.sqrt(x.reduce((s, v) => s + v * v, 0)) || 1;
  return x.map((v) => v / n);
}
function itemFeature(item) {
  return feature(tokenize([item.style, item.category, item.origin, ...(item.tags || [])].join(' ')));
}
function userFeature(db, user) {
  const tokens = tokenize(
    [
      ...(user.tags || []),
      user.city,
      user.style,
      user.customerAge,
      user.retailPriceBand,
      user.area != null ? '面积' + user.area : '',
      user.businessYears != null ? '经营' + user.businessYears + '年' : '',
      ...(user.operationNeeds || [])
    ]
      .filter(Boolean)
      .join(' ')
  );
  const events = db.raw
    .prepare('SELECT type,item_id,duration FROM events WHERE user_id=? ORDER BY created DESC LIMIT 80')
    .all(user.id);
  for (const ev of events) {
    if (ev.type === 'dwell' && Number(ev.duration) < 3) continue;
    if (ev.type === 'search') {
      tokens.push(...tokenize(ev.item_id));
      continue;
    }
    if (['impression', 'not_interested'].includes(ev.type)) continue;
    const item = db.get('products', ev.item_id) || db.get('content', ev.item_id);
    if (item) {
      const repetitions = ['contact', 'favorite'].includes(ev.type) ? 3 : 1;
      for (let i = 0; i < repetitions; i++)
        tokens.push(...tokenize([item.style, item.category, item.origin, ...(item.tags || [])].join(' ')));
    }
  }
  if (user.knowledgeForRecommendations === true) {
    for (const k of db.list('knowledge').filter((k) => k.ownerId === user.id && k.scope === 'private'))
      tokens.push(...tokenize((k.recommendationSummary || '').slice(0, 400)));
  }
  return feature(tokens);
}
function project(w, x) {
  return w.map((row) => Math.tanh(row.reduce((s, v, j) => s + v * x[j], 0)));
}
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
function rng(seed) {
  let v = seed;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    return v / 4294967296;
  };
}
export function trainModel(db) {
  const random = rng(20261110);
  const init = () =>
    Array.from({ length: E }, () => Array.from({ length: D }, () => (random() - 0.5) * 0.25));
  const wu = init(),
    wi = init();
  const users = db.list('users').filter((u) => u.role !== 'admin'),
    items = [...db.list('products'), ...db.list('content')].filter(
      (x) => x.published || x.status === 'published'
    );
  const pairs = [];
  for (const u of users) {
    const ux = userFeature(db, u);
    const affinity = items.map((item) => ({
      item,
      overlap:
        (item.tags || []).filter((t) => (u.tags || []).includes(t)).length +
        (u.tags || []).includes(item.style)
    }));
    const positive = affinity.filter((x) => x.overlap > 0).slice(0, 18),
      negative = affinity.filter((x) => !x.overlap).slice(0, 18);
    for (const p of positive) pairs.push({ u: ux, i: itemFeature(p.item), y: 1 });
    for (const n of negative) pairs.push({ u: ux, i: itemFeature(n.item), y: 0 });
  }
  const events = db.raw
    .prepare(
      "SELECT user_id,item_id,type FROM events WHERE type IN ('favorite','contact','click') ORDER BY created DESC LIMIT 400"
    )
    .all();
  for (const ev of events) {
    const user = db.get('users', ev.user_id),
      item = items.find((i) => i.id === ev.item_id);
    if (user && item) pairs.push({ u: userFeature(db, user), i: itemFeature(item), y: 1 });
  }
  const loss = () =>
    pairs.reduce((s, p) => {
      const z = dot(project(wu, p.u), project(wi, p.i)) * 2;
      const v = 1 / (1 + Math.exp(-z));
      return s - (p.y ? Math.log(v + 1e-8) : Math.log(1 - v + 1e-8));
    }, 0) / Math.max(1, pairs.length);
  const initialLoss = loss();
  for (let epoch = 0; epoch < 100; epoch++) {
    for (const p of pairs) {
      const a = project(wu, p.u),
        b = project(wi, p.i);
      const prediction = 1 / (1 + Math.exp(-dot(a, b) * 2));
      const error = (prediction - p.y) * 2;
      for (let k = 0; k < E; k++) {
        const du = error * b[k] * (1 - a[k] * a[k]),
          di = error * a[k] * (1 - b[k] * b[k]);
        for (let j = 0; j < D; j++) {
          wu[k][j] -= 0.055 * (du * p.u[j] + 0.0001 * wu[k][j]);
          wi[k][j] -= 0.055 * (di * p.i[j] + 0.0001 * wi[k][j]);
        }
      }
    }
  }
  const model = {
    id: 'two-tower',
    version: `tt-${Date.now()}`,
    kind: 'two-tower-feature-projection',
    dimensions: E,
    inputDimensions: D,
    wu,
    wi,
    trainedAt: now(),
    samples: pairs.length,
    epochs: 100,
    initialLoss,
    trainingLoss: loss(),
    trainingData: events.length ? '合成演示偏好与本站测试行为' : '合成演示偏好；非真实运营数据',
    realEvents: events.length,
    notice: '真实双塔投影训练及点积召回；演示样本验证流程，不代表生产推荐效果。'
  };
  db.save('models', model);
  return modelSummary(model);
}
export function modelSummary(m) {
  if (!m) return null;
  const { wu, wi, ...safe } = m;
  return safe;
}
export function recommendations(db, user, items, config) {
  if (!user?.personalized || config.features.recommendations === false || config.recommendation?.disabled)
    return {
      items: items.slice(0, 30),
      strategy: 'non-personalized',
      modelVersion: null,
      notice: '非个性化浏览；仅显示已审核内容。'
    };
  try {
    let model = db.get('models', 'two-tower');
    if (!model) {
      trainModel(db);
      model = db.get('models', 'two-tower');
    }
    const uv = project(model.wu, userFeature(db, user));
    const ranked = items
      .map((item) => ({ item, score: dot(uv, project(model.wi, itemFeature(item))) }))
      .sort((a, b) => b.score - a.score);
    const hidden = new Set(
      db.raw
        .prepare("SELECT item_id FROM events WHERE user_id=? AND type='not_interested'")
        .all(user.id)
        .map((x) => x.item_id)
    );
    return {
      items: ranked
        .filter((x) => !hidden.has(x.item.id))
        .slice(0, 30)
        .map((x) => ({ ...x.item, recommendationScore: Number(x.score.toFixed(4)) })),
      strategy: 'two-tower',
      modelVersion: model.version,
      model: modelSummary(model),
      notice: '基于已选标签与本站行为；模型使用演示样本初始化。'
    };
  } catch {
    return {
      items: items.slice(0, 30),
      strategy: 'fallback-reviewed',
      modelVersion: null,
      notice: '推荐暂不可用，已切换到审核内容。'
    };
  }
}
export function saveEvent(db, user, body) {
  const type = String(body.type || '');
  const allowed = ['impression', 'search', 'click', 'view', 'dwell', 'favorite', 'contact', 'not_interested'];
  if (!allowed.includes(type) || user.personalized === false) return { recorded: false };
  const itemId = String(type === 'search' ? body.query || body.itemId || '' : body.itemId || '').slice(
    0,
    100
  );
  const duration = type === 'dwell' ? Math.max(0, Math.min(1800, Number(body.duration) || 0)) : null;
  if (type === 'dwell' && duration < 1) return { recorded: false };
  const recent = db.raw
    .prepare('SELECT id FROM events WHERE user_id=? AND type=? AND item_id=? AND created>? LIMIT 1')
    .get(user.id, type, itemId, new Date(Date.now() - 1200).toISOString());
  if (recent) return { recorded: false, deduplicated: true };
  db.raw
    .prepare('INSERT INTO events(id,user_id,type,item_id,item_type,duration,created) VALUES(?,?,?,?,?,?,?)')
    .run(uid('event'), user.id, type, itemId, String(body.itemType || '').slice(0, 30), duration, now());
  return { recorded: true };
}
