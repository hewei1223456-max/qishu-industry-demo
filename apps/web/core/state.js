import { get } from './api.js';
export const state = {
  user: null,
  config: { features: {} },
  dictionaries: {},
  providers: [],
  bootstrapError: null,
  pageState: new Map(),
  fontScale: 1
};
try {
  state.fontScale = Number(localStorage.getItem('qishu-font-scale')) || 1;
} catch {}
export async function refresh() {
  try {
    const data = await get('/bootstrap');
    Object.assign(state, data);
    state.bootstrapError = null;
    return data;
  } catch (error) {
    state.bootstrapError = error.message;
    throw error;
  }
}
export function feature(key) {
  return state.config?.features?.[key] !== false;
}
export function verified() {
  return state.user?.role === 'admin' || state.user?.verified === true;
}
export const isSupplier = () => state.user?.role === 'supplier';
export function saveFont(scale) {
  state.fontScale = scale;
  document.documentElement.style.setProperty('--font-scale', scale);
  try {
    localStorage.setItem('qishu-font-scale', scale);
  } catch {}
}
export const labels = { owner: '店主', supplier: '厂家', admin: '平台运营' };
