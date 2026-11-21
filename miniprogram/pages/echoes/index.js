/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const {page,app}=require('../../utils/runtime');
page({
 data:{story:require('../../vendor/story'),playing:false,kind:'renewal',muted:false,reduced:false,phase:'ready',bell:'',silhouette:''},
 init(params){this.setData({bell:app().client?.asset('bell-isolated.png') || '',silhouette:app().client?.asset('yu-nianan-silhouette.png') || '',kind:params.kind || 'renewal'});this.stopMedia=()=>{clearTimeout(this.finishTimer);if(this.audio){this.audio.stop();this.audio.destroy();this.audio=null;}this.setData({playing:false});};},
 play(e){this.stopMedia();const kind=e?.currentTarget?.dataset?.kind || this.data.kind;this.setData({kind,playing:true,phase:'playing'});if(!this.data.muted){this.audio=wx.createInnerAudioContext();this.audio.src='/assets/'+(kind==='dream'?'dream':'bell')+'.wav';this.audio.onError(()=>this.setData({notice:'当前设备无法播放音效，可以静音继续。'}));this.audio.play();}this.finishTimer=setTimeout(()=>{this.stopMedia();this.setData({phase:'complete'});if(this.params.auto)wx.navigateBack();},this.data.reduced?800:6000);},
 mute(e){this.setData({muted:e.detail.value});if(this.audio)this.audio.volume=e.detail.value?0:1;},
 reduced(e){this.setData({reduced:e.detail.value});},
 skip(){this.stopMedia();this.setData({phase:'complete'});if(this.params.auto)wx.navigateBack();}
});
