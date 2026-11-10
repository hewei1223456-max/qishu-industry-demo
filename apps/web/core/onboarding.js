import { workspaceHome } from './workspace.js';

export function identityLanding(user, { registering = false } = {}) {
  if (!user) throw new Error('尚未取得本端登录状态，请重新登录。');
  if (['owner', 'supplier'].includes(user.role) && (registering || user.verified !== true)) {
    return '/auth';
  }
  return workspaceHome(user);
}
