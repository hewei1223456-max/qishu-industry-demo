const ui = require('../../services/ui');
function finished(job) {
  return (
    job &&
    ['completed', 'succeeded', 'failed', 'cancelled', 'unconfigured', 'unsupported'].includes(job.status)
  );
}
Page({
  data: {
    fontPx: 16,
    mode: 'diagnosis',
    outputTask: 'chat',
    outputType: '',
    outputUrl: '',
    taskOptions: [
      { task: 'chat', title: '文字回答' },
      { task: 'image', title: '生成图片' },
      { task: 'video', title: '生成视频' },
      { task: 'tts', title: '朗读文字' }
    ],
    form: { city: '', area: '', years: '', style: '', priceBand: '', question: '' },
    message: '',
    messages: [],
    job: null,
    jobResult: '',
    busy: false,
    error: '',
    media: null,
    recording: false,
    buyers: [],
    quota: null,
    query: '',
    city: '',
    style: '',
    loading: false,
    contactMessage: '',
    contactChannels: []
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    this._alive = true;
    this._visible = true;
    ui.sync(this, 2);
    ui.platform.title(this.data.supplier ? '找客户' : '店铺诊断');
    if (this.data.supplier) this.loadBuyers();
    else if (this.data.job && !finished(this.data.job)) this.poll(this.data.job.id);
  },
  onHide() {
    this.cleanup();
  },
  onUnload() {
    this._alive = false;
    this.cleanup();
  },
  cleanup() {
    this._visible = false;
    clearTimeout(this._pollHandle);
    ui.platform.stopAudio();
    if (this.data.recording) {
      ui.platform.stopRecord();
      this.setData({ recording: false });
    }
  },
  async loadBuyers() {
    this.setData({ loading: true, error: '', buyers: [], quota: null, contactChannels: [] });
    try {
      await getApp().refresh();
      ui.sync(this, 2);
      if (!ui.flag('buyers')) throw new Error('找客户正在维护，其他入口仍可使用');
      const query =
        '?query=' +
        encodeURIComponent(this.data.query) +
        '&city=' +
        encodeURIComponent(this.data.city) +
        '&style=' +
        encodeURIComponent(this.data.style);
      const responses = await Promise.all([ui.api.get('/buyers' + query), ui.api.get('/quota')]);
      this.setData({ buyers: ui.list(responses[0]), quota: responses[1].quota || responses[1] });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },
  formInput(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value });
  },
  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, error: '' });
  },
  chooseOutput(e) {
    this.setData({ outputTask: e.currentTarget.dataset.task });
  },
  async playAudio() {
    try {
      await ui.platform.playAudio(this.data.outputUrl);
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  openBuyer(e) {
    ui.platform.open('/pages/detail/index?kind=buyer&id=' + encodeURIComponent(e.currentTarget.dataset.id));
  },
  async contactBuyer(e) {
    if (this._contacting) return;
    this._contacting = true;
    this.setData({ contactMessage: '', contactChannels: [] });
    try {
      const r = await ui.api.post('/leads', { buyerId: e.currentTarget.dataset.id });
      this.setData({
        quota: r.quota || this.data.quota,
        contactChannels: ui.contactChannels(r.contact),
        contactMessage:
          (r.contact && r.contact.message) || '主动联系已记录，实际加好友及需求结果请在回访中确认。'
      });
    } catch (error) {
      this.setData({ contactMessage: error.message });
    } finally {
      this._contacting = false;
    }
  },
  async useContact(e) {
    const channel = this.data.contactChannels[Number(e.currentTarget.dataset.index)];
    try {
      await ui.openContact(channel);
      if (channel.type !== 'qrcode') ui.platform.toast('已复制，请自行确认联系结果');
    } catch (error) {
      ui.platform.toast(error.message);
    }
  },
  profile() {
    ui.platform.tab('/pages/me/index');
  },
  async submitDiagnosis() {
    if (this.data.busy) return;
    if (!this.data.form.question.trim()) {
      this.setData({ error: '请先填写希望解决的经营问题' });
      return;
    }
    try {
      if (!ui.flag('diagnosis')) throw new Error('诊断服务正在维护');
      this.setData({ busy: true, error: '', jobResult: '' });
      const r = await ui.api.post('/jobs', {
        task: 'diagnosis',
        message: this.data.form.question,
        profile: this.data.form,
        fileId: this.data.media && this.data.media.id
      });
      const job = r.job || r;
      this.setData({ job });
      this.poll(job.id);
    } catch (e) {
      this.setData({ error: e.message, busy: false });
    }
  },
  async sendMessage() {
    const message = this.data.message.trim();
    if (!message || this.data.busy) return;
    try {
      this.setData({
        busy: true,
        error: '',
        message: '',
        outputType: '',
        outputUrl: '',
        messages: this.data.messages.concat([{ role: 'user', text: message }])
      });
      const r = await ui.api.post('/jobs', {
        task: this.data.outputTask,
        message,
        fileId: this.data.media && this.data.media.id
      });
      const job = r.job || r;
      this._chatJob = job.id;
      this.setData({ job });
      this.poll(job.id);
    } catch (e) {
      this.setData({ error: e.message, busy: false });
    }
  },
  async poll(id) {
    clearTimeout(this._pollHandle);
    if (!this._alive || !this._visible || !id) return;
    try {
      const r = await ui.api.get('/jobs/' + encodeURIComponent(id));
      const job = r.job || r,
        result = ui.jobText(job);
      if (!this._alive || !this._visible) return;
      this.setData(Object.assign({ job, jobResult: result }, ui.jobOutput(job)));
      if (finished(job)) {
        this.setData({ busy: false });
        if (this._chatJob === id) {
          this.setData({
            messages: this.data.messages.concat([
              { role: 'assistant', text: result || '任务已结束，请查看状态。' }
            ])
          });
          this._chatJob = null;
        }
      } else this._pollHandle = setTimeout(() => this.poll(id), 2000);
    } catch (e) {
      this.setData({ busy: false, error: e.message });
    }
  },
  async chooseMedia(e) {
    try {
      const file = await ui.platform.choose(e.currentTarget.dataset.kind);
      this.setData({ busy: true, error: '' });
      const media = await ui.api.upload(file, true);
      this.setData({ media: Object.assign({ name: file.name }, media) });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async record() {
    if (this.data.recording) {
      ui.platform.stopRecord();
      this.setData({ recording: false });
      return;
    }
    this.setData({ recording: true, error: '' });
    try {
      const file = await ui.platform.record();
      if (!this._alive || !this._visible) return;
      this.setData({ recording: false, busy: true });
      const media = await ui.api.upload(file, true);
      this.setData({ media: Object.assign({ name: file.name }, media) });
    } catch (e) {
      if (this._alive) this.setData({ error: e.message });
    } finally {
      if (this._alive) this.setData({ recording: false, busy: false });
    }
  },
  async mediaTask(e) {
    if (!this.data.media) {
      this.setData({ error: '请先选择并上传本次素材' });
      return;
    }
    try {
      this.setData({ busy: true, error: '', jobResult: '' });
      const r = await ui.api.post('/jobs', {
        task: e.currentTarget.dataset.task,
        fileId: this.data.media.id
      });
      this.setData({ job: r.job || r });
      this.poll((r.job || r).id);
    } catch (error) {
      this.setData({ busy: false, error: error.message });
    }
  },
  knowledge() {
    ui.platform.open('/pages/knowledge/index');
  }
});
