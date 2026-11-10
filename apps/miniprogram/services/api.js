const platform = require('../platform/wechat');
const config = require('../config');
function base() {
  return platform.read('qishu_api_base') || config.apiBase;
}
async function request(path, data, method) {
  const token = platform.read('qishu_token');
  const result = await platform.request({
    url: base() + '/api' + path,
    method: method || 'GET',
    data,
    timeout: config.requestTimeout,
    header: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  });
  if (result.statusCode < 200 || result.statusCode >= 300) {
    const error = result.data && result.data.error;
    const e = new Error(
      typeof error === 'string' ? error : (error && error.message) || '服务暂时不可用，请稍后重试'
    );
    e.code = error && error.code;
    e.status = result.statusCode;
    throw e;
  }
  return result.data;
}
function media(url) {
  return !url ? '' : /^https?:/.test(url) ? url : base() + (url[0] === '/' ? url : '/' + url);
}
async function upload(file, isPrivate, purpose) {
  const token = platform.read('qishu_token');
  const result = await platform.upload({
    url: base() + '/api/uploads',
    filePath: file.path,
    name: 'file',
    formData: {
      private: isPrivate ? 'true' : 'false',
      visibility: 'private',
      purpose: file.type === 'license' ? 'license' : purpose || (isPrivate ? 'private' : 'content'),
      kind: file.type || 'file'
    },
    header: token ? { Authorization: 'Bearer ' + token } : {}
  });
  let data;
  try {
    data = JSON.parse(result.data);
  } catch (_) {
    throw new Error('上传服务返回格式有误');
  }
  if (result.statusCode < 200 || result.statusCode >= 300)
    throw new Error((data.error && data.error.message) || '上传未完成');
  return data.file || data;
}
module.exports = {
  get: (path) => request(path),
  post: (path, data) => request(path, data, 'POST'),
  patch: (path, data) => request(path, data, 'PATCH'),
  delete: (path) => request(path, null, 'DELETE'),
  media,
  upload,
  base
};
