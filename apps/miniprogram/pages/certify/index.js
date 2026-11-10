const ui = require('../../services/ui');
Page({
  data: {
    fontPx: 16,
    company: '',
    scope: '',
    license: null,
    loading: false,
    savingProfile: false,
    savingContact: false,
    error: '',
    notice: '',
    items: [],
    profile: {},
    operationNeedsText: '',
    publicContact: { wechat: '', phone: '', qrUrl: '', consent: false }
  },
  onShow() {
    ui.sync(this, -1);
    this.load();
    this.loadContact();
  },
  back() {
    ui.platform.back('/pages/me/index');
  },
  async load() {
    try {
      const r = await ui.api.get('/certifications');
      const labels = {
        'not-configured': '识别渠道待配置',
        queued: 'AI识别已排队',
        running: 'AI识别中',
        completed: '识别完成，待人工复核',
        failed: '识别未完成，仍待人工'
      };
      this.setData({
        items: ui
          .list(r)
          .map((item) =>
            Object.assign({}, item, {
              ocrStatusText: labels[item.precheck && item.precheck.ocrStatus] || '待人工审核',
              consistencyText: Object.values((item.precheck && item.precheck.consistency) || {}).join('；')
            })
          )
      });
      const p = await ui.api.get('/profile');
      this.setData({
        profile: p.profile || {},
        operationNeedsText: ((p.profile && p.profile.operationNeeds) || []).join('、')
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  profileInput(e) {
    this.setData({ ['profile.' + e.currentTarget.dataset.field]: e.detail.value });
  },
  contactInput(e) {
    this.setData({ ['publicContact.' + e.currentTarget.dataset.field]: e.detail.value });
  },
  contactConsent(e) {
    this.setData({ 'publicContact.consent': e.detail.value === true });
  },
  async loadContact() {
    try {
      const r = await ui.api.get('/profile/contact');
      this.setData({
        publicContact: Object.assign({ wechat: '', phone: '', qrUrl: '', consent: false }, r.contact || {})
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async saveContact() {
    if (this.data.savingContact) return;
    this.setData({ savingContact: true, error: '', notice: '' });
    try {
      const c = this.data.publicContact;
      const fields = {
        wechat: String(c.wechat || '').trim(),
        phone: String(c.phone || '').trim(),
        qrUrl: String(c.qrUrl || '').trim(),
        consent: c.consent === true
      };
      const r = await ui.api.patch('/profile/contact', fields);
      this.setData({
        publicContact: r.contact || fields,
        notice: fields.consent ? '公开联络设置已保存，将按平台权限向联系方展示。' : '已关闭公开联络展示。'
      });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ savingContact: false });
    }
  },
  async saveProfile() {
    this.setData({ savingProfile: true, error: '', notice: '' });
    try {
      const p = this.data.profile;
      const fields = {};
      for (const key of ['name', 'shop', 'city', 'style', 'customerAge', 'retailPriceBand'])
        fields[key] = String(p[key] || '');
      for (const key of ['area', 'businessYears'])
        fields[key] = p[key] === '' || p[key] == null ? null : Number(p[key]);
      fields.operationNeeds = this.data.operationNeedsText
        .split(/[、,，\n]/)
        .map((x) => x.trim())
        .filter(Boolean);
      const saved = await ui.api.patch('/profile', fields);
      getApp().globalData.user = saved.user;
      this.setData({ profile: saved.profile, notice: '经营资料已保存，资质审核状态不会因此自动改变。' });
      ui.sync(this, -1);
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ savingProfile: false });
    }
  },
  async chooseLicense() {
    this.setData({ loading: true, error: '' });
    try {
      const file = await ui.platform.choose('image');
      const media = await ui.api.upload(Object.assign({}, file, { type: 'license' }), true);
      this.setData({ license: Object.assign({}, media, { localPath: file.path }) });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  async submit() {
    if (!this.data.company.trim() || !this.data.scope.trim() || !this.data.license) {
      this.setData({ error: '请填写主体名称、经营范围并上传执照图片' });
      return;
    }
    this.setData({ loading: true, error: '', notice: '' });
    try {
      await ui.api.post('/certifications', {
        company: this.data.company,
        scope: this.data.scope,
        licenseFileId: this.data.license.id
      });
      this.setData({ notice: '资料已提交。AI辅助识别与人工终审分开，不会因上传图片自动通过认证。' });
      this.load();
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  phone(e) {
    const code = e.detail.code;
    if (!code) {
      this.setData({ error: '未取得手机号授权，未进行验证' });
      return;
    }
    ui.api
      .post('/auth/phone', { code })
      .then(async () => {
        await getApp().refresh();
        ui.sync(this, -1);
        this.setData({ notice: '手机号验证已完成' });
      })
      .catch((err) => this.setData({ error: err.message }));
  }
});
