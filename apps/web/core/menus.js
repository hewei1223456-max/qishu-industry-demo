export const adminMenus = [
  ['', 'chart', '运营总览'],
  ['users', 'users', '用户与主体'],
  ['content', 'edit', '内容与素材'],
  ['products', 'box', '货源与订货会'],
  ['rights', 'shield', '客户与权益'],
  ['config', 'layers', '页面与频道'],
  ['ads', 'flag', '广告与推广'],
  ['knowledge', 'folder', '诊断与知识库'],
  ['providers', 'spark', 'AI模型与任务'],
  ['recommendations', 'layers', '推荐与画像'],
  ['reports', 'chart', '数据报表'],
  ['audit', 'settings', '系统与审计']
];
const menuResources = {
  '': ['metrics'],
  users: ['users', 'certifications', 'buyers', 'admins'],
  content: ['content', 'ingestion'],
  products: ['products', 'fairs'],
  rights: ['plans', 'entitlements', 'leads'],
  config: ['config'],
  ads: ['config', 'ads'],
  knowledge: ['knowledge', 'config'],
  providers: ['providers', 'jobs'],
  recommendations: ['models'],
  reports: ['metrics'],
  audit: ['audit']
};
export function visibleAdminMenus(user) {
  const permissions = user?.permissions;
  if (!Array.isArray(permissions) || permissions.includes('*')) return adminMenus;
  return adminMenus.filter(([key]) =>
    (menuResources[key] || []).some((resource) =>
      ['read', 'write', '*'].some((action) => permissions.includes(resource + ':' + action))
    )
  );
}
