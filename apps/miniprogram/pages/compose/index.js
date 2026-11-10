const ui = require('../../services/ui');
Page({
  data: {
    fontPx: 16,
    kind: 'content',
    form: {
      title: '',
      body: '',
      category: '经营经验',
      style: '',
      origin: '',
      price: '',
      moq: '',
      status: '现货',
      date: '',
      location: ''
    },
    files: [],
    busy: false,
    error: '',
    notice: '',
    job: null,
    jobResult: ''
  },
  async onLoad(q) {
    this._alive = true;
    try {
      await getApp().refresh();
      ui.sync(this, -1);
      this.setData({ kind: q.kind || 'content' });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onShow() {
    this._visible = true;
    ui.sync(this, -1);
    if (this.data.job && this.data.busy) this.poll(this.data.job.id);
  },
  onHide() {
    this._visible = false;
    clearTimeout(this._timer);
  },
  onUnload() {
    this._alive = false;
    this._visible = false;
    clearTimeout(this._timer);
  },
  back() {
    ui.platform.back('/pages/me/index');
  },
  input(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value });
  },
  changeKind(e) {
    const kind = e.currentTarget.dataset.kind;
    if (kind !== 'content' && !this.data.supplier) {
      this.setData({ error: '只有已授权厂家可以发布货源和订货会' });
      return;
    }
    this.setData({ kind, error: '' });
  },
  async choose(e) {
    if (this.data.busy) return;
    try {
      const file = await ui.platform.choose(e.currentTarget.dataset.kind);
      this.setData({ busy: true, error: '' });
      const media = await ui.api.upload(file, true, 'content');
      this.setData({
        files: this.data.files.concat([
          Object.assign({}, media, { name: file.name, localPath: file.path, kind: file.type })
        ])
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  removeFile(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({ files: this.data.files.filter((_, index) => index !== i) });
  },
  async save(e) {
    if (this.data.busy) return;
    const status = e.currentTarget.dataset.status || 'pending',
      form = this.data.form;
    if (!form.title.trim()) {
      this.setData({ error: '请填写标题' });
      return;
    }
    if (status !== 'draft' && !form.body.trim()) {
      this.setData({ error: '请填写说明或正文，AI不会凭空补全经营信息' });
      return;
    }
    if (this.data.kind === 'product' && status !== 'draft' && (!form.price || !form.moq || !form.origin)) {
      this.setData({ error: '货源提交审核前请补充拿货价、起批量和产地' });
      return;
    }
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const body = Object.assign({}, form, {
        kind: this.data.kind,
        status,
        price: form.price ? Number(form.price) : undefined,
        moq: form.moq ? Number(form.moq) : undefined,
        files: this.data.files.map((f) => f.id),
        image:
          this.data.files.find((f) => f.kind === 'image') &&
          this.data.files.find((f) => f.kind === 'image').url
      });
      await ui.api.post('/creator', body);
      this.setData({ notice: status === 'draft' ? '草稿已保存到服务端' : '已提交审核，通过后才会公开展示' });
      ui.platform.toast(status === 'draft' ? '草稿已保存' : '已提交审核');
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async organize() {
    if (!this.data.form.body.trim()) {
      this.setData({ error: '请先提供要整理的真实资料' });
      return;
    }
    try {
      this.setData({ busy: true, error: '', notice: '' });
      const r = await ui.api.post('/jobs', {
        task: 'chat',
        message:
          '请根据以下资料整理可供审核的发布草稿；缺少的经营字段标注待补充，不编造价格或产地。\n' +
          this.data.form.body,
        fileId: this.data.files[0] && this.data.files[0].id
      });
      this.setData({ job: r.job || r });
      this.poll((r.job || r).id);
    } catch (error) {
      this.setData({ busy: false, error: error.message });
    }
  },
  async poll(id) {
    clearTimeout(this._timer);
    if (!this._alive || !this._visible) return;
    try {
      const r = await ui.api.get('/jobs/' + id),
        job = r.job || r,
        result = ui.jobText(job);
      if (!this._alive || !this._visible) return;
      this.setData({ job, jobResult: result });
      if (
        ['completed', 'succeeded', 'failed', 'unconfigured', 'unsupported', 'cancelled'].includes(job.status)
      ) {
        this.setData({ busy: false });
        if (['completed', 'succeeded'].includes(job.status) && result)
          this.setData({ 'form.body': result, notice: 'AI草稿已回填，请核对事实后再提交审核' });
      } else this._timer = setTimeout(() => this.poll(id), 2000);
    } catch (error) {
      this.setData({ busy: false, error: error.message });
    }
  }
});
