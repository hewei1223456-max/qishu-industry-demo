import { AppError, audit, now } from './db.js';
import { defaultConfig, styles, origins, categories, preferenceTags } from './seed.js';

export function readConfig(db) {
  const r = db.raw.prepare('SELECT version,data FROM config_versions ORDER BY version DESC LIMIT 1').get();
  const c = r ? JSON.parse(r.data) : defaultConfig();
  return {
    ...c,
    version: r?.version || 1,
    features: { ...defaultConfig().features, ...c.features },
    origins: (c.originOrder || origins).map((name, i) => ({
      id: name,
      name,
      visible: !(c.hiddenOrigins || []).includes(name),
      order: i
    }))
  };
}
export function dictionaries(config) {
  return {
    styles: config.styles || styles,
    origins: (config.originOrder || origins).filter((n) => !(config.hiddenOrigins || []).includes(n)),
    allOrigins: config.originOrder || origins,
    categories: config.categories || categories,
    status: ['现货', '预售'],
    tags: config.tags || preferenceTags,
    priceBands: config.priceBands || [],
    moqBands: config.moqBands || []
  };
}
const editable = [
  'brand',
  'features',
  'originOrder',
  'hiddenOrigins',
  'styles',
  'categories',
  'tags',
  'priceBands',
  'moqBands',
  'banners',
  'ads',
  'freeDailyLimit',
  'carouselSeconds',
  'fontScale',
  'recommendation',
  'systemPrompts',
  'maintenance'
];
export function publishConfig(db, user, incoming) {
  const old = readConfig(db);
  const c = { ...old };
  if (incoming.version !== undefined && Number(incoming.version) !== old.version)
    throw new AppError(409, 'CONFIG_CONFLICT', '配置已被更新，请刷新后再保存。');
  for (const key of editable)
    if (Object.hasOwn(incoming, key))
      c[key] = key === 'features' ? { ...old.features, ...incoming.features } : incoming[key];
  if (incoming.origins) {
    if (!Array.isArray(incoming.origins)) throw new AppError(400, 'INVALID_CONFIG', '产地配置格式错误。');
    c.originOrder = [...incoming.origins]
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((x) => (typeof x === 'string' ? x : x.name));
    c.hiddenOrigins = incoming.origins
      .filter((x) => typeof x === 'object' && (x.visible === false || x.enabled === false))
      .map((x) => x.name);
  }
  if (
    !Number.isInteger(Number(c.freeDailyLimit)) ||
    Number(c.freeDailyLimit) < 0 ||
    Number(c.freeDailyLimit) > 10000
  )
    throw new AppError(400, 'INVALID_CONFIG', '每日额度应为0至10000的整数。');
  c.freeDailyLimit = Number(c.freeDailyLimit);
  for (const key of ['originOrder', 'hiddenOrigins', 'styles', 'categories', 'tags'])
    if (
      !Array.isArray(c[key]) ||
      c[key].some((x) => typeof x !== 'string' || x.length > 80) ||
      c[key].length > 500
    )
      throw new AppError(400, 'INVALID_CONFIG', `${key}配置必须是有效列表。`);
  for (const key of ['banners', 'ads'])
    if (!Array.isArray(c[key]) || c[key].length > 100)
      throw new AppError(400, 'INVALID_CONFIG', '展示位配置超出限制。');
  for (const key of ['priceBands', 'moqBands']) {
    if (!Array.isArray(c[key]) || c[key].length > 50)
      throw new AppError(400, 'INVALID_CONFIG', '筛选区间数量无效。');
    for (const band of c[key]) {
      if (!band || typeof band.label !== 'string' || !band.label.trim() || band.label.length > 80)
        throw new AppError(400, 'INVALID_CONFIG', '筛选区间需要名称。');
      for (const edge of ['min', 'max'])
        if (
          band[edge] !== undefined &&
          band[edge] !== null &&
          (!Number.isFinite(Number(band[edge])) || Number(band[edge]) < 0)
        )
          throw new AppError(400, 'INVALID_CONFIG', '筛选区间应为非负数。');
      if (band.min != null && band.max != null && Number(band.min) > Number(band.max))
        throw new AppError(400, 'INVALID_CONFIG', '筛选区间最小值不能大于最大值。');
    }
  }
  if (
    !c.features ||
    typeof c.features !== 'object' ||
    Object.values(c.features).some((x) => typeof x !== 'boolean')
  )
    throw new AppError(400, 'INVALID_CONFIG', '模块开关格式错误。');
  for (const item of [...c.banners, ...c.ads]) {
    if (item.href && !/^(\/|#\/|https:\/\/)/.test(item.href))
      throw new AppError(400, 'INVALID_CONFIG', '跳转必须使用站内路径或HTTPS。');
    if (item.image && !/^(\/|https:\/\/)/.test(item.image))
      throw new AppError(400, 'INVALID_CONFIG', '素材地址格式错误。');
  }
  if (
    !Number.isFinite(Number(c.carouselSeconds)) ||
    Number(c.carouselSeconds) < 2 ||
    Number(c.carouselSeconds) > 60
  )
    throw new AppError(400, 'INVALID_CONFIG', '轮播间隔应为2至60秒。');
  const id = db.raw
    .prepare('INSERT INTO config_versions(data,actor,created) VALUES(?,?,?)')
    .run(JSON.stringify(c), user.id, now());
  audit(db, user, 'publish-config', String(id.lastInsertRowid), { previousVersion: old.version });
  return readConfig(db);
}
export function rollbackConfig(db, user) {
  const rows = db.raw.prepare('SELECT data FROM config_versions ORDER BY version DESC LIMIT 2').all();
  if (rows.length < 2) throw new AppError(409, 'NO_PREVIOUS_CONFIG', '没有可回退的配置。');
  const old = JSON.parse(rows[1].data);
  delete old.version;
  return publishConfig(db, user, old);
}
export function publicConfig(c) {
  const { systemPrompts, ...safe } = c;
  return safe;
}
export function ensureFeature(config, feature) {
  if (config.features[feature] === false)
    throw new AppError(503, 'MODULE_DISABLED', '此功能暂未开放，其他功能可继续使用。');
}
