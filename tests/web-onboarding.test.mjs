import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../apps/web/core/state.js';
import { identityLanding } from '../apps/web/core/onboarding.js';
import {
  isSupplierCertificate,
  certificateReviewPath,
  certificateReviewSelection,
  filterCertificateReviews
} from '../apps/web/core/certificate-navigation.js';
import { login, registration } from '../apps/web/pages/auth.js';
import { certification } from '../apps/web/pages/certification.js';
import { resourcePage, overview } from '../apps/web/pages/admin.js';
import { toast } from '../apps/web/components/ui.js';

function environment(t, scope = 'front') {
  const original = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    window: globalThis.window,
    document: globalThis.document,
    state: { ...state }
  };
  let hash = '#/login';
  const notice = { textContent: '', classList: { add() {}, remove() {} } };
  globalThis.location = {
    search: '?workspace=' + scope,
    get hash() {
      return hash;
    },
    set hash(value) {
      hash = value.startsWith('#') ? value : '#' + value;
    }
  };
  globalThis.window = { dispatchEvent() {} };
  globalThis.document = { querySelector: () => notice };
  state.mode = 'development-demo';
  t.after(() => {
    clearTimeout(toast.timer);
    for (const key of ['fetch', 'location', 'window', 'document']) {
      if (original[key] === undefined) delete globalThis[key];
      else globalThis[key] = original[key];
    }
    Object.assign(state, original.state);
  });
  return notice;
}

function button(dataset) {
  return {
    dataset,
    innerHTML: '继续',
    textContent: '继续',
    disabled: false,
    isConnected: true,
    setAttribute() {},
    removeAttribute() {}
  };
}

function authResponses() {
  const requests = [];
  let user;
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, body: options.body ? JSON.parse(options.body) : undefined });
    let value = {};
    if (path === '/api/auth/demo') {
      const body = JSON.parse(options.body);
      user = { id: body.userId || body.role + '-01', role: body.role, verified: false, tags: [], demo: true };
      value = { user };
    } else if (path === '/api/bootstrap') {
      value = { user, mode: 'development-demo', config: { features: {} }, dictionaries: {}, providers: [] };
    } else if (path === '/api/certifications') value = { items: [] };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  return requests;
}

test('unverified business login and registration land on the real certification route in either workspace', (t) => {
  environment(t);
  for (const scope of ['front', 'back']) {
    location.search = '?workspace=' + scope;
    assert.equal(identityLanding({ role: 'supplier', verified: false }), '/auth');
    assert.equal(identityLanding({ role: 'owner', verified: false }), '/auth');
    assert.equal(identityLanding({ role: 'supplier', verified: true }, { registering: true }), '/auth');
  }
  location.search = '?workspace=front';
  assert.equal(identityLanding({ role: 'supplier', verified: true }), '/info');
  location.search = '?workspace=back';
  assert.equal(identityLanding({ role: 'supplier', verified: true }), '/manufacturer');
  assert.equal(identityLanding({ role: 'admin' }), '/admin');
  assert.throws(() => identityLanding(null));
});

test('actual supplier login binding navigates to certification; the rendered form has all required uploads', async (t) => {
  environment(t);
  const requests = authResponses();
  const page = await login(),
    supplierButton = button({ loginRole: 'supplier' });
  page.bind({ querySelectorAll: () => [supplierButton] });
  await supplierButton.onclick();
  assert.equal(location.hash, '#/auth');
  assert.equal(requests[0].body.role, 'supplier');
  assert.equal(requests[0].body.scope, 'front');
  const form = await certification();
  for (const id of ['license-file', 'venue-video-file', 'venue-photo-files']) {
    const input = form.html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))?.[0];
    assert(input?.includes('required'), id + ' must be a required field in the actual page output');
  }
  assert(form.html.includes('提交人工审核'));
  assert(form.html.includes('5张不同的场所照片'));
  assert(form.html.includes('暂不提交，继续浏览有限公开信息'));
});

test('owner and supplier registration buttons invoke the real form route, not a registration success screen', async (t) => {
  environment(t);
  const requests = authResponses();
  for (const role of ['owner', 'supplier']) {
    let click;
    const submitButton = button({ role });
    const page = await registration({ query: new URLSearchParams({ role }) });
    page.bind({
      querySelector: () => ({
        addEventListener: (_event, handler) => {
          click = handler;
        }
      })
    });
    await click({ currentTarget: submitButton });
    assert.equal(location.hash, '#/auth');
    assert.equal(
      requests.filter((request) => request.path === '/api/auth/demo').at(-1).body.userId,
      role === 'supplier' ? 'supplier-guest' : 'owner-guest'
    );
  }
});

test('desktop formal login does not send a fake WeChat authorization request', async (t) => {
  const notice = environment(t);
  const requests = authResponses();
  state.mode = 'production';
  const page = await login(),
    supplierButton = button({ loginRole: 'supplier' });
  page.bind({ querySelectorAll: () => [supplierButton] });
  await supplierButton.onclick();
  assert.equal(requests.length, 0);
  assert.equal(location.hash, '#/login');
  assert(notice.textContent.includes('尚未接入正式微信扫码登录'));
});

const applications = [
  {
    id: 'factory-current',
    applicantRole: 'supplier',
    company: '厂家甲',
    scope: '服装批发',
    status: 'pending'
  },
  {
    id: 'factory-legacy',
    company: '旧厂家乙',
    scope: '服装零售',
    status: 'rejected',
    missingFields: ['至少30秒场所视频']
  },
  { id: 'shop-current', applicantRole: 'owner', company: '店主丙', scope: '服装零售', status: 'pending' }
];

test('certification classification, filtering and deep links keep factory and owner reviews separate', () => {
  assert.equal(isSupplierCertificate(applications[1]), true);
  const selected = certificateReviewSelection();
  assert.equal(selected.role, 'supplier');
  assert.deepEqual(
    filterCertificateReviews(applications, selected).map((item) => item.id),
    ['factory-current', 'factory-legacy']
  );
  assert.deepEqual(
    filterCertificateReviews(applications, { role: 'supplier', status: 'pending', query: '厂家甲' }).map(
      (item) => item.id
    ),
    ['factory-current']
  );
  assert.equal(certificateReviewPath(applications[0]), '/admin/users?tab=supplier-certifications');
  assert.equal(certificateReviewPath(applications[2]), '/admin/users?tab=owner-certifications');
  assert.equal(certificateReviewSelection(new URLSearchParams('tab=owner-certifications')).role, 'owner');
});

test('actual admin resource page defaults to factory reviews, supports owner/status filtering and explains empty submissions', async (t) => {
  environment(t, 'back');
  state.user = { id: 'admin-01', role: 'admin', permissions: ['*'] };
  globalThis.fetch = async (path) =>
    new Response(
      JSON.stringify(path === '/api/admin/certifications' ? { items: applications } : { items: [] }),
      { headers: { 'content-type': 'application/json' } }
    );
  const ctx = (query) => ({ args: ['admin', 'users'], query: new URLSearchParams(query) });
  const ids = (html) => [...html.matchAll(/data-review-application="([^"]+)"/g)].map((match) => match[1]);
  const factoryPage = await resourcePage('certifications', ctx(''));
  assert.deepEqual(ids(factoryPage.html), ['factory-current', 'factory-legacy']);
  assert(factoryPage.html.includes('厂家资质审核（2）'));
  assert(factoryPage.html.includes('店主资质审核（1）'));
  const ownerPage = await resourcePage('certifications', ctx('tab=owner-certifications'));
  assert.deepEqual(ids(ownerPage.html), ['shop-current']);
  const emptyPage = await resourcePage('certifications', ctx('tab=supplier-certifications&status=approved'));
  assert.deepEqual(ids(emptyPage.html), []);
  assert(emptyPage.html.includes('/?workspace=front#/register?role=supplier'));
  assert(emptyPage.html.includes('只登录或选择身份不会生成申请'));
  const buyersPage = await resourcePage('buyers', ctx('tab=buyers'));
  assert(buyersPage.html.includes('tab=supplier-certifications'));
  assert(buyersPage.html.includes('tab=owner-certifications'));
  const dashboard = await overview();
  assert(dashboard.html.includes('href="#/admin/users?tab=supplier-certifications"'));
  assert(dashboard.html.includes('href="#/admin/users?tab=owner-certifications"'));
});
