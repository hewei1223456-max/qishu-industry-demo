const ui = require('../../services/ui');
Page({
  data: {
    fontPx: 16,
    company: '',
    scope: '',
    license: null,
    venueVideo: null,
    venuePhotos: [],
    missingFields: [],
    loading: false,
    submittingCertificate: false,
    previewingId: '',
    savingProfile: false,
    savingContact: false,
    error: '',
    notice: '',
    items: [],
    applicationPending: false,
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
  browsePublic() {
    ui.platform.tab('/pages/info/index');
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
        applicationPending: !!(ui.list(r)[0] && ui.list(r)[0].status === 'pending'),
        items: ui.list(r).map((item) =>
          Object.assign({}, item, {
            ocrStatusText: labels[item.precheck && item.precheck.ocrStatus] || '待人工审核',
            isSupplierApplication:
              item.applicantRole === 'supplier' ||
              item.role === 'supplier' ||
              item.subjectRole === 'supplier' ||
              !!item.venueVideoFileId ||
              this.data.supplier,
            missingMaterialsText: (item.missingFields || []).join('、'),
            videoStatusText: item.videoVerification
              ? [
                  item.videoVerification.status,
                  item.videoVerification.durationSeconds != null
                    ? item.videoVerification.durationSeconds + '秒'
                    : item.videoVerification.duration != null
                      ? item.videoVerification.duration + '秒'
                      : '',
                  item.videoVerification.message || ''
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '待服务端核验',
            phoneReviewText: item.phoneReview
              ? [
                  { pending: '待回访', passed: '回访通过', failed: '回访未通过' }[item.phoneReview.status] ||
                    item.phoneReview.status ||
                    '待回访',
                  {
                    confirmed: '已核实',
                    unreachable: '未接通，继续待核实',
                    inconsistent: '信息不一致',
                    rejected: '回访拒绝'
                  }[item.phoneReview.result] || '',
                  item.phoneReview.note || ''
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '待电话回访',
            consistencyText: Object.values((item.precheck && item.precheck.consistency) || {}).join('；')
          })
        )
      });
      const latest = ui.list(r)[0];
      if (latest && !this.data.license) {
        const materials = latest.materials || {},
          saved = (f) => (f ? Object.assign({}, f, { previewUrl: f.url ? ui.api.media(f.url) : '' }) : null);
        this.setData({
          company: this.data.company || latest.company || '',
          scope: this.data.scope || latest.scope || '',
          license: saved(materials.license),
          venueVideo: this.data.venueVideo || saved(materials.venueVideo),
          venuePhotos: this.data.venuePhotos.length
            ? this.data.venuePhotos
            : (materials.venuePhotos || []).map(saved)
        });
      }
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
    if (this.data.loading || this.data.submittingCertificate) return;
    const missing = [];
    if (!this.data.company.trim()) missing.push('主体名称');
    if (!this.data.scope.trim()) missing.push('经营范围');
    if (!this.data.license) missing.push('营业执照');
    if (this.data.supplier && !this.data.venueVideo) missing.push('至少30秒的场所视频');
    if (this.data.supplier && this.data.venuePhotos.length !== 5)
      missing.push('5张不同场所照片（当前' + this.data.venuePhotos.length + '张）');
    this.setData({ missingFields: missing });
    if (missing.length) {
      this.setData({ error: '请补齐：' + missing.join('、') });
      return;
    }
    this.setData({
      loading: true,
      submittingCertificate: true,
      error: '',
      notice: '材料核验中，请等待服务端检查文件并保存审核申请。原件不会因此公开。'
    });
    try {
      await ui.api.post('/certifications', {
        company: this.data.company,
        scope: this.data.scope,
        licenseFileId: this.data.license.id,
        ...(this.data.supplier
          ? {
              venueVideoFileId: this.data.venueVideo.id,
              venuePhotoFileIds: this.data.venuePhotos.map((f) => f.id)
            }
          : {})
      });
      this.setData({
        notice: this.data.supplier
          ? '厂家资料已提交，服务端核验视频与照片后，还需人工审核和电话回访；提交不等于通过。'
          : '店主资料已提交，AI辅助识别与人工终审分开，不会因上传图片自动通过认证。'
      });
      this.load();
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false, submittingCertificate: false });
    }
  },
  async chooseVenueVideo() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const file = await ui.platform.captureVideo();
      if (file.size > 300 * 1024 * 1024) throw new Error('场所视频超过300MB，请压缩后上传');
      const durationHint = file.duration
        ? '设备报告约' + file.duration + '秒；最终以服务端ffprobe核验为准。'
        : '设备未提供时长，最终以服务端核验为准。';
      const media = await ui.api.upload(file, true, 'certification_video');
      this.setData({
        venueVideo: Object.assign({}, media, { localPath: file.path, clientDuration: file.duration }),
        notice: durationHint,
        missingFields: []
      });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  async chooseVenuePhotos() {
    if (this.data.loading) return;
    if (this.data.venuePhotos.length >= 5) {
      this.setData({ error: '认证材料只收5张不同场所照片，可移除后重新选择' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const files = await ui.platform.chooseMany('image', 5 - this.data.venuePhotos.length);
      if (files.length + this.data.venuePhotos.length > 5)
        throw new Error('认证材料只收5张不同场所照片，请重新选择');
      for (const file of files) {
        const media = await ui.api.upload(file, true, 'certification_photo');
        this.setData({
          venuePhotos: this.data.venuePhotos.concat([Object.assign({}, media, { localPath: file.path })])
        });
      }
      this.setData({ notice: '场所照片已私有上传，重复照片与实际文件内容由服务器核验。', missingFields: [] });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  removeVenuePhoto(e) {
    this.setData({
      venuePhotos: this.data.venuePhotos.filter((_, i) => i !== Number(e.currentTarget.dataset.index))
    });
  },
  async previewMaterial(e) {
    if (this.data.previewingId) return;
    const kind = e.currentTarget.dataset.kind,
      index = Number(e.currentTarget.dataset.index) || 0;
    const field =
      kind === 'photo' ? 'venuePhotos[' + index + ']' : kind === 'video' ? 'venueVideo' : 'license';
    const file = kind === 'photo' ? this.data.venuePhotos[index] : this.data[field];
    if (!file) return;
    this.setData({ previewingId: file.id, error: '' });
    try {
      const localPath = file.localPath || (await ui.api.privatePreview(file));
      this.setData({ [field + '.localPath']: localPath });
      if (kind !== 'video') await ui.platform.preview(localPath, [localPath]);
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ previewingId: '' });
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
