// 平台API只在适配层集中调用，业务页使用明确能力，不直接混用浏览器API。
function call(method, options) {
  return new Promise((resolve, reject) => {
    if (typeof wx[method] !== 'function') return reject(new Error('当前微信版本不支持这项操作'));
    wx[method](
      Object.assign({}, options, {
        success: resolve,
        fail: (e) => reject(new Error(e.errMsg || '操作未完成'))
      })
    );
  });
}
let recorder, audioPlayer;
const privateDownloads = new Set();
function chooseMedia(kind, count, sourceType = ['album', 'camera']) {
  return call('chooseMedia', { count, mediaType: [kind], sourceType, camera: 'back', maxDuration: 60 }).then(
    (r) =>
      r.tempFiles.map((f, index) => ({
        path: f.tempFilePath,
        name: kind + '-' + Date.now() + '-' + index + (kind === 'video' ? '.mp4' : '.jpg'),
        type: kind,
        duration: Number(f.duration) || null,
        size: Number(f.size) || 0
      }))
  );
}
module.exports = {
  request: (options) => call('request', options),
  upload: (options) => call('uploadFile', options),
  download: async (options) => {
    const result = await call('downloadFile', options);
    if (result.statusCode >= 200 && result.statusCode < 300 && result.tempFilePath)
      privateDownloads.add(result.tempFilePath);
    return result;
  },
  clearDownloads: async () => {
    const paths = [...privateDownloads];
    privateDownloads.clear();
    if (typeof wx.getFileSystemManager !== 'function') return;
    const files = wx.getFileSystemManager();
    await Promise.all(
      paths.map((filePath) => new Promise((resolve) => files.unlink({ filePath, complete: resolve })))
    );
  },
  read: (key) => {
    try {
      return wx.getStorageSync(key);
    } catch (_) {
      return '';
    }
  },
  write: (key, value) => wx.setStorageSync(key, value),
  remove: (key) => wx.removeStorageSync(key),
  font: () => {
    try {
      const info = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
      const platform = wx.getSystemInfoSync().platform;
      const base = platform === 'ios' ? 17 : 16;
      return Math.max(
        1,
        Math.min(1.8, Number(info.fontSizeScaleFactor) || Number(info.fontSizeSetting) / base || 1)
      );
    } catch (_) {
      return 1;
    }
  },
  open: (url) => call('navigateTo', { url }),
  tab: (url) => call('switchTab', { url }),
  back: (fallback) => {
    if (getCurrentPages().length > 1) return call('navigateBack', { delta: 1 });
    return call('switchTab', { url: fallback || '/pages/info/index' });
  },
  title: (title) => wx.setNavigationBarTitle({ title }),
  toast: (title) => wx.showToast({ title: String(title).slice(0, 25), icon: 'none' }),
  copy: (data) => call('setClipboardData', { data: String(data) }),
  preview: (current, urls) => call('previewImage', { current, urls }),
  confirm: (title, content) => call('showModal', { title, content }),
  login: () => call('login', {}),
  choose: (kind) => {
    if (kind === 'image' || kind === 'video') {
      return chooseMedia(kind, 1).then((files) => files[0]);
    }
    return call('chooseMessageFile', { count: 1, type: 'file' }).then((r) => ({
      path: r.tempFiles[0].path,
      name: r.tempFiles[0].name,
      type: kind
    }));
  },
  chooseMany: (kind, count) => chooseMedia(kind, Math.max(1, Math.min(9, Number(count) || 1))),
  captureVideo: () => chooseMedia('video', 1, ['camera']).then((files) => files[0]),
  record: () =>
    new Promise((resolve, reject) => {
      if (typeof wx.getRecorderManager !== 'function') return reject(new Error('当前环境不支持录音'));
      recorder = wx.getRecorderManager();
      const cleanup = () => {
        if (typeof recorder.offStop === 'function') recorder.offStop(onStop);
        if (typeof recorder.offError === 'function') recorder.offError(onError);
      };
      const onStop = (r) => {
        cleanup();
        resolve({ path: r.tempFilePath, name: '经营问题-' + Date.now() + '.mp3', type: 'audio' });
      };
      const onError = (e) => {
        cleanup();
        reject(new Error(e.errMsg || '录音未完成'));
      };
      recorder.onStop(onStop);
      recorder.onError(onError);
      recorder.start({ duration: 60000, format: 'mp3' });
    }),
  stopRecord: () => {
    if (recorder) recorder.stop();
  },
  playAudio: (url) =>
    new Promise((resolve, reject) => {
      if (typeof wx.createInnerAudioContext !== 'function')
        return reject(new Error('当前微信版本不支持语音播放'));
      if (audioPlayer) audioPlayer.destroy();
      audioPlayer = wx.createInnerAudioContext();
      audioPlayer.src = url;
      audioPlayer.onError((e) => reject(new Error(e.errMsg || '语音播放未完成')));
      audioPlayer.onPlay(resolve);
      audioPlayer.play();
    }),
  stopAudio: () => {
    if (audioPlayer) {
      audioPlayer.stop();
      audioPlayer.destroy();
      audioPlayer = null;
    }
  },
  scrollTop: () => wx.pageScrollTo({ scrollTop: 0, duration: 0 })
};
