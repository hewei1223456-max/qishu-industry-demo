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
    const body = options.body;
    const response = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...options,
      signal: controller.signal,
      headers: {
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers
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
export const patch = (path, body) => api(path, { method: 'PATCH', body });
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
export async function upload(file, privateFile = false) {
  const body = new FormData();
  body.append('file', file);
  body.append('private', String(privateFile));
  body.append('purpose', privateFile ? 'private' : 'content');
  body.append('visibility', 'private');
  const r = await api('/uploads', { method: 'POST', body, timeout: 45000 });
  return r.file || r;
}
