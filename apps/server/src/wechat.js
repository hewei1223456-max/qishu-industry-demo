import { createHash } from 'node:crypto';
import { AppError, uid, audit, now } from './db.js';
import { requireUser, issueSession } from './auth.js';

const digest = (x) => createHash('sha256').update(x).digest('hex');
const OFFICIAL = 'https://api.weixin.qq.com';

// All network destinations are fixed official endpoints. Tests inject HTTP transport only.
export function createWechatAuth({ db, appId, appSecret, fetchImpl = fetch }) {
  appId = appId || process.env.WX_APP_ID || process.env.WECHAT_APPID;
  appSecret = appSecret || process.env.WX_APP_SECRET || process.env.WECHAT_APPSECRET;
  let accessToken = null,
    tokenExpires = 0,
    tokenPending = null;
  const windows = new Map();
  function configured() {
    if (!appId || !appSecret)
      throw new AppError(
        503,
        'WECHAT_NOT_CONFIGURED',
        '微信服务端未配置WX_APP_ID/WX_APP_SECRET，请配置企业小程序并联调；不会使用演示身份冒充微信登录。'
      );
  }
  function rate(req, user, kind) {
    const key = `${kind}:${kind === 'phone' ? user?.id : req.socket.remoteAddress || 'unknown'}`,
      time = Date.now();
    let win = windows.get(key);
    if (!win || time > win.until) {
      win = { count: 0, until: time + 60000 };
      windows.set(key, win);
    }
    if (++win.count > (kind === 'phone' ? 12 : 40))
      throw new AppError(429, 'AUTH_RATE_LIMIT', '操作过于频繁，请稍后重试。');
    if (windows.size > 10000) for (const [k, v] of windows) if (v.until < time) windows.delete(k);
  }
  function claimCode(code, kind) {
    if (typeof code !== 'string' || code.length < 3 || code.length > 1024)
      throw new AppError(400, 'INVALID_AUTH_CODE', '请重新获取微信授权凭证。');
    const id = digest(`${appId}:${kind}:${code}`);
    if (db.get('auth_codes', id)) throw new AppError(409, 'AUTH_CODE_USED', '微信凭证已提交，请重新授权。');
    db.save('auth_codes', { id, kind, expiresAt: Date.now() + 5 * 60000 });
    for (const old of db.list('auth_codes')) if (old.expiresAt < Date.now()) db.remove('auth_codes', old.id);
  }
  async function request(path, options) {
    let response, data;
    try {
      response = await fetchImpl(OFFICIAL + path, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw Error();
      data = await response.json();
    } catch {
      throw new AppError(502, 'WECHAT_CONNECTION_FAILED', '微信授权服务连接失败，请重新获取授权后重试。');
    }
    return data;
  }
  function checked(data) {
    if (data.errcode && Number(data.errcode) !== 0)
      throw new AppError(
        400,
        'WECHAT_AUTH_REJECTED',
        `微信授权未通过（${Number(data.errcode) || '未知'}），请重新授权并检查小程序配置。`
      );
    return data;
  }
  async function token(refresh = false) {
    if (!refresh && accessToken && tokenExpires > Date.now()) return accessToken;
    if (tokenPending) return tokenPending;
    tokenPending = (async () => {
      const data = checked(
        await request('/cgi-bin/stable_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'client_credential',
            appid: appId,
            secret: appSecret,
            force_refresh: refresh
          })
        })
      );
      if (!data.access_token) throw new AppError(502, 'WECHAT_TOKEN_INVALID', '微信未返回有效的服务端令牌。');
      accessToken = data.access_token;
      tokenExpires = Date.now() + Math.max(30, (Number(data.expires_in) || 7200) - 120) * 1000;
      return accessToken;
    })();
    try {
      return await tokenPending;
    } finally {
      tokenPending = null;
    }
  }
  return {
    configured: () => !!appId && !!appSecret,
    async login(req, res, body) {
      configured();
      rate(req, null, 'login');
      claimCode(body.code, 'login');
      const query = new URLSearchParams({
        appid: appId,
        secret: appSecret,
        js_code: body.code,
        grant_type: 'authorization_code'
      });
      const wx = checked(await request('/sns/jscode2session?' + query));
      if (typeof wx.openid !== 'string' || !wx.openid || typeof wx.session_key !== 'string')
        throw new AppError(502, 'WECHAT_IDENTITY_INVALID', '微信没有返回完整身份信息。');
      let user = db.list('users').find((x) => x.wechatOpenId === wx.openid && x.wechatAppId === appId);
      if (user && ['disabled', 'suspended', 'deleted'].includes(user.status))
        throw new AppError(403, 'ACCOUNT_DISABLED', '账号暂不可用，请联系平台。');
      if (!user) {
        const role = body.role === 'supplier' ? 'supplier' : 'owner',
          id = uid('wxuser');
        user = db.save('users', {
          id,
          role,
          primaryRole: role,
          name: role === 'supplier' ? '厂家用户' : '店主用户',
          companyId: uid(role === 'supplier' ? 'supplier' : 'shop'),
          wechatAppId: appId,
          wechatOpenId: wx.openid,
          wechatUnionId: wx.unionid || null,
          authProvider: 'wechat',
          phoneVerified: false,
          verified: false,
          certificationStatus: 'not_submitted',
          tags: [],
          personalized: true,
          onboarded: false,
          demo: false
        });
      } else {
        if (user.role === 'admin' && user.adminGrantId) {
          const grant = db.get('admins', user.adminGrantId);
          user =
            grant?.status === 'active' && grant.bindingVerified && grant.userId === user.id
              ? { ...user, permissions: grant.permissions || [] }
              : { ...user, role: user.primaryRole || 'owner', permissions: [] };
        }
        user = db.save('users', { ...user, lastLoginAt: now() });
      }
      audit(db, user, 'wechat-login', user.id);
      return {
        ...issueSession(db, user, res),
        mode: 'wechat',
        notice: '已验证微信身份；手机号和经营资质需分别授权与审核。'
      };
    },
    async phone(req, res, body, user) {
      configured();
      requireUser(user);
      if (user.authProvider !== 'wechat' || !user.wechatOpenId)
        throw new AppError(403, 'WECHAT_LOGIN_REQUIRED', '请先使用真实微信授权登录。');
      rate(req, user, 'phone');
      claimCode(body.code, 'phone');
      let data = await request(
        '/wxa/business/getuserphonenumber?access_token=' + encodeURIComponent(await token()),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: body.code })
        }
      );
      if ([40001, 42001].includes(Number(data.errcode)))
        data = await request(
          '/wxa/business/getuserphonenumber?access_token=' + encodeURIComponent(await token(true)),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: body.code })
          }
        );
      checked(data);
      const info = data.phone_info,
        phone = String(info?.purePhoneNumber || '');
      if (
        !/^1\d{10}$/.test(phone) ||
        String(info?.countryCode || '86') !== '86' ||
        (info?.watermark?.appid && info.watermark.appid !== appId)
      )
        throw new AppError(400, 'PHONE_IDENTITY_INVALID', '未获得与当前小程序一致的中国大陆手机号授权。');
      const other = db.list('users').find((x) => x.id !== user.id && x.phoneVerified && x.phone === phone);
      if (other)
        throw new AppError(
          409,
          'PHONE_ALREADY_BOUND',
          '此手机号已绑定其他账号，请联系平台核查，不能自动合并。'
        );
      let updated = db.save('users', { ...user, phone, phoneVerified: true, phoneVerifiedAt: now() });
      const grant = db
        .list('admins')
        .find((x) => x.phone === phone && !['deleted', 'disabled', 'revoked'].includes(x.status));
      if (grant) {
        if (grant.bindingVerified && grant.userId !== user.id)
          throw new AppError(
            409,
            'ADMIN_ALREADY_BOUND',
            '该管理员名额已绑定其他微信账号，请由平台管理员核查。'
          );
        db.save('admins', {
          ...grant,
          userId: user.id,
          bindingVerified: true,
          boundAt: now(),
          status: 'active'
        });
        updated = db.save('users', {
          ...updated,
          primaryRole: user.primaryRole || user.role,
          role: 'admin',
          adminGrantId: grant.id,
          permissions: grant.permissions || ['*']
        });
      }
      audit(db, updated, 'verify-wechat-phone', updated.id, { adminGranted: !!grant });
      return {
        ...issueSession(db, updated, res),
        phoneVerified: true,
        mode: 'wechat',
        notice: grant ? '已核验手机号并加载平台授予的管理员权限。' : '手机号已核验；经营资料仍需提交审核。'
      };
    }
  };
}
