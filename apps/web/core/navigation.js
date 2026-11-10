const positions = new Map();
let current = '',
  currentIndex = 0;
export function route() {
  const raw = location.hash.slice(1) || '/info';
  const [path, query = ''] = raw.split('?');
  return { path, args: path.split('/').filter(Boolean), query: new URLSearchParams(query), key: raw };
}
export function go(path) {
  if (!path.startsWith('/')) path = '/' + path;
  positions.set(current, window.scrollY);
  location.hash = path;
}
export function back(fallback = '/info') {
  const dialog = document.querySelector('.modal-overlay');
  if (dialog) {
    document.querySelector('#modal-root').innerHTML = '';
    if (history.state?.qishuModal) history.back();
    return;
  }
  if (history.state?.qishuIndex > 0) history.back();
  else go(fallback);
}
export function beginRoute() {
  const r = route();
  if (current) positions.set(current, window.scrollY);
  const isBack = history.state?.qishuRoute === r.key;
  if (isBack) currentIndex = history.state.qishuIndex || 0;
  else {
    currentIndex = current ? currentIndex + 1 : 0;
    history.replaceState({ qishuRoute: r.key, qishuIndex: currentIndex }, '');
  }
  current = r.key;
  return () =>
    requestAnimationFrame(() =>
      window.scrollTo({ top: isBack ? positions.get(r.key) || 0 : 0, behavior: 'instant' })
    );
}
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
