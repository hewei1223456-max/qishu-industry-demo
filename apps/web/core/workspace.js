export function workspaceScope() {
  const search = globalThis.location?.search || '';
  return new URLSearchParams(search).get('workspace') === 'back' ? 'back' : 'front';
}

export const isBackWorkspace = () => workspaceScope() === 'back';

export function workspaceHome(user) {
  if (!isBackWorkspace()) return '/info';
  return user?.role === 'admin' ? '/admin' : user?.role === 'supplier' ? '/manufacturer' : '/login';
}

export function privateMediaUrl(value) {
  const source = String(value || '');
  if (!source.startsWith('/api/')) return source;
  const url = new URL(source, 'http://workspace.local');
  url.searchParams.set('scope', workspaceScope());
  return url.pathname + url.search;
}
