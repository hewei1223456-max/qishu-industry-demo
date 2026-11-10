import { workspaceScope } from './workspace.js';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api(path, options = {}) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), options.timeout ?? 15000);
  try {
    let body = options.body;
    if (path.startsWith('/auth/') && body && !(body instanceof FormData)) {
      body = { ...body, scope: workspaceScope() };
    }
    const response = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...options,
      signal: controller.signal,
      headers: {
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
        'X-Qishu-Scope': workspaceScope()
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError('服务返回了无法识别的内容，请稍后重试。', response.status, 'INVALID_RESPONSE');
    }
    if (!response.ok)
      throw new ApiError(
        data.error?.message || data.error || data.message || '暂时无法完成操作',
        response.status,
        data.error?.code
      );
    return data;
  } catch (error) {
    if (error.name === 'AbortError')
      throw new ApiError('响应超时，请重试。你填写的内容不会因此自动清空。', 408, 'TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export const get = (path) => api(path);
export const post = (path, body, options = {}) => api(path, { ...options, method: 'POST', body });
export const patch = (path, body, options = {}) => api(path, { ...options, method: 'PATCH', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });
export const itemsOf = (data) => data?.items || data?.data || [];
export const event = (type, itemId, itemType, duration) =>
  post('/events', {
    type: { exposure: 'impression', save: 'favorite' }[type] || type,
    itemId,
    itemType,
    duration
  }).catch(() => null);
export async function upload(file, privateFile = false, purpose = privateFile ? 'private' : 'content') {
  const body = new FormData();
  body.append('file', file);
  body.append('private', String(privateFile));
  body.append('purpose', purpose);
  body.append('visibility', 'private');
  const r = await api('/uploads?purpose=' + encodeURIComponent(purpose), {
    method: 'POST',
    body,
    timeout: purpose === 'certification_video' ? 300000 : 45000
  });
  return r.file || r;
}
