import { post } from '../core/api.js';
import { state, refresh, labels } from '../core/state.js';
import { isBackWorkspace } from '../core/workspace.js';
import { identityLanding } from '../core/onboarding.js';
import { icon } from '../components/icons.js';
import { esc, badge, pageHead, modal, submit, toast } from '../components/ui.js';

const identities = () =>
  isBackWorkspace()
    ? [
        ['supplier', 'box', '厂家后台', '管理自己的货源、订货会与客户回访'],
        ['admin', 'shield', '平台管理员后台', '仅限获得平台授权的管理人员']
      ]
    : [
        ['owner', 'user', '店主', '资讯、货源与店铺经营诊断'],
        ['supplier', 'box', '厂家', '未认证先提交执照、场所视频与5张照片'],
        ['admin', 'shield', '平台管理员', '已受邀授权的管理员身份']
      ];

async function loginIdentity(role, register = false) {
  let result;
  if (state.mode === 'development-demo') {
    result = await post('/auth/demo', {
      role,
      ...(register && role === 'owner' ? { userId: 'owner-guest' } : {}),
      ...(register && role === 'supplier' ? { userId: 'supplier-guest' } : {})
    });
  } else {
    throw new Error('当前网页尚未接入正式微信扫码登录，请使用已部署的微信小程序完成授权。');
  }
  await refresh();
  if (result.adminAuthorizationRequired || (role === 'admin' && state.user?.role !== 'admin')) {
    modal(
      '需要平台管理员授权',
      '<p>选择管理员身份不会创建管理权限。请由已有最高权限管理员登记本人手机号，完成微信绑定及授权后再登录。</p><a class="btn primary full" href="#/login">返回本端登录</a>'
    );
    return;
  }
  location.hash = identityLanding(state.user, { registering: register });
  window.dispatchEvent(new Event('qishu:refresh'));
}

export async function login() {
  const backstage = isBackWorkspace();
  return {
    html: `<div class="login-layout"><div class="login-story"><span class="brand-mark">七</span><span class="eyebrow">七叔女装行业平台</span><h1>${backstage ? '后台独立登录' : '前台用户登录'}</h1><p>${backstage ? '厂家后台与平台管理员后台，仅使用本端登录会话。' : '选择店主、厂家或已授权的平台管理员身份。'}</p><div class="notice">本端切换身份或退出，不会改变另一端的登录状态。</div></div><section class="panel login-panel"><h2>${backstage ? '后台入口' : '前台入口'}</h2><p class="muted">${state.mode === 'development-demo' ? '开发演示账号由服务端创建会话；未认证店主和厂家登录后先进入资料提交。' : '当前网页尚未接入正式微信扫码登录；正式授权请使用已部署的小程序。'}</p><div class="login-roles">${identities()
      .map(
        ([role, name, title, text]) =>
          `<button class="login-role" data-login-role="${role}">${icon(name)}<span><strong>${title}</strong><small>${text}</small></span>${icon('arrow')}</button>`
      )
      .join(
        ''
      )}</div><div class="login-divider"><span>首次使用</span></div><a class="btn full" href="#/register">${backstage ? '注册并提交资料 / 管理员授权说明' : '注册并提交资料'}</a>${!backstage ? '<a class="text-link" href="#/info">先浏览前台有限公开信息 →</a>' : ''}<p class="tiny muted">管理员注册入口仅说明申请流程，不能自行开通权限。开发演示不代表正式注册或资质通过。</p></section></div>`,
    bind(root) {
      root.querySelectorAll('[data-login-role]').forEach((button) => {
        button.onclick = () => submit(button, () => loginIdentity(button.dataset.loginRole));
      });
    }
  };
}

export async function registration(ctx = {}) {
  const available = identities(),
    requested = ctx.query?.get('role');
  const role = available.some((item) => item[0] === requested) ? requested : available[0][0];
  const isAdmin = role === 'admin',
    backstage = isBackWorkspace();
  return {
    html:
      pageHead(backstage ? '后台开通与授权' : '注册并提交资料', '身份选择不会直接改变账号权限。') +
      `<div class="sub-tabs identity-tabs">${available.map(([value, name, title]) => `<a class="${role === value ? 'active' : ''}" href="#/register?role=${value}">${icon(name)} ${title}</a>`).join('')}</div><section class="panel registration-panel"><h2>${isAdmin ? '申请平台管理员授权' : role === 'supplier' ? '厂家经营主体认证' : '店主经营主体认证'}</h2>${isAdmin ? '<p>平台管理员不能自助注册为最高权限账号。请联系已有最高权限管理员，在独立管理后台登记本人手机号、分配权限；本人完成微信及手机号绑定后，再从本端登录页进入。</p><div class="notice">填写管理员意向、提交营业执照或选择管理员标签，都不会生成管理权限。</div><a class="btn primary" href="#/login">已获授权，返回本端登录</a>' : `<p>先完成微信登录和手机号核验，再提交经营资料。${role === 'supplier' ? '厂家需营业执照、至少30秒的档口/展厅/公司/车间场所视频，以及5张不同的场所照片。' : '店主需提交营业执照及经营资料。'}资料由平台人工审核。</p><div class="notice">${state.mode === 'development-demo' ? '当前仅建立开发演示会话。请继续填写资料并提交人工审核，材料提交后仍需平台审核。' : '正式注册使用微信授权，不收集微信密码；手机号须由本人核验。'}</div><button class="btn primary" id="start-registration" data-role="${role}">${state.mode === 'development-demo' ? '注册并提交' + (role === 'supplier' ? '厂家' : '店主') + '资料' : '正式注册尚未接入（说明）'}</button>`}<div class="profile-form-actions"><a class="btn" href="#/login">返回本端登录</a></div></section>`,
    bind(root) {
      root.querySelector('#start-registration')?.addEventListener('click', (event) => {
        return submit(event.currentTarget, () => loginIdentity(role, true));
      });
    }
  };
}

export async function backAccount() {
  const user = state.user;
  return {
    html:
      pageHead('本后台账号', '登录、身份与退出仅作用于后台会话。') +
      `<section class="panel registration-panel"><div class="label-row">${badge(labels[user?.role] || '未登录')}${badge(user?.verified ? '经营资质已审核' : '经营资质待审核', 'subtle')}</div><h2 style="margin-top:18px">${esc(user?.name || '未登录')}</h2><p>${esc(user?.companyName || user?.companyId || '')}</p><div class="creator-shortcuts"><a class="btn" href="#/my/business">经营资料与联络方式</a>${user?.role === 'supplier' ? '<a class="btn" href="#/auth">厂家认证材料</a>' : ''}<a class="btn" href="#/login">返回本后台登录 / 切换身份</a><button class="btn" id="back-account-logout">退出本后台</button></div><p class="tiny muted">不会退出、重设或切换前台账号。</p></section>`,
    bind(root) {
      root.querySelector('#back-account-logout').onclick = (event) =>
        submit(event.currentTarget, async () => {
          await post('/auth/logout', {});
          await refresh();
          location.hash = '/login';
          window.dispatchEvent(new Event('qishu:refresh'));
          toast('已退出后台。');
        });
    }
  };
}
