/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app } = require('./runtime');
function attach(page) {
 page.startRecording = function () {
  if (this.data.busy || this.data.recording) return;
  const epoch = app().epoch;
  this.recorder = wx.getRecorderManager(); this.cancelledRecording = false;
  if(this.recordStop) this.recorder.offStop(this.recordStop);
  if(this.recordError) this.recorder.offError(this.recordError);
  this.recordStop = result => {
   if(this.alive) this.setData({ recording: false });
   if (this.cancelledRecording || !this.visible || !this.alive || epoch !== app().epoch) return;
   this.run(async () => {
    const audioBase64 = await new Promise((resolve,reject) => wx.getFileSystemManager().readFile({ filePath: result.tempFilePath, encoding: 'base64', success: r => resolve(r.data), fail: reject }));
    const response = await this.api('voice/transcribe', 'POST', { audioBase64, fileName: 'recording.mp3', mimeType: 'audio/mpeg', language: 'zh' });
    this.setData({ draft: (this.data.draft || '') + (response.text || ''), notice: response.fallback ? '本次语音使用了降级结果，请核对。' : '' });
   });
  };
  this.recordError = () => { if(this.alive) this.setData({ recording: false, error: '无法录音，请在微信设置中允许麦克风权限后重试。' }); };
  this.recorder.onStop(this.recordStop);
  this.recorder.onError(this.recordError);
  this.recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 64000, format: 'mp3' });
  this.setData({ recording: true });
 };
 page.finishRecording = function () { if(this.recorder) this.recorder.stop(); };
 page.cancelRecording = function () { this.cancelledRecording = true; if(this.recorder) this.recorder.stop(); this.setData({ recording: false }); };
 page.stopMedia = function () {
  this.cancelledRecording = true;
  if(this.recorder && this.data.recording) this.recorder.stop();
  if(this.recorder && this.recordStop) this.recorder.offStop(this.recordStop);
  if(this.recorder && this.recordError) this.recorder.offError(this.recordError);
  if(this.audio) { this.audio.stop(); this.audio.destroy(); this.audio = null; }
  if(this.audioPath) { wx.getFileSystemManager().unlink({ filePath: this.audioPath, fail() {} }); this.audioPath = null; }
  if(this.alive) this.setData({ recording: false, playing: false });
 };
 page.speakText = function (text) {
  return this.run(async () => {
   this.stopMedia();
   const result = await this.api('voice/synthesize', 'POST', { text, format: 'mp3' });
   if(!result.audioBase64) throw new Error('没有收到可播放音频。');
   this.audioPath = wx.env.USER_DATA_PATH + '/reply-' + Date.now() + '.mp3';
   await new Promise((resolve,reject) => wx.getFileSystemManager().writeFile({ filePath: this.audioPath, data: result.audioBase64, encoding: 'base64', success: resolve, fail: reject }));
   if(!this.visible) { this.stopMedia(); return; }
   this.audio = wx.createInnerAudioContext(); this.audio.src = this.audioPath;
   this.audio.onEnded(() => this.stopMedia());
   this.audio.onError(() => { this.stopMedia(); this.setData({ error: '音频播放失败，请检查设备和音频格式。' }); });
   this.audio.play(); this.setData({ playing: true });
  });
 };
}
module.exports = { attach };
