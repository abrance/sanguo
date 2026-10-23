// 音效：全部用 WebAudio 现场合成，零素材（docs/VISUAL.md §11.5）
//
// 用法：Audio.play('turn')；首次用户手势后自动解锁 AudioContext（浏览器策略）。
// 静音状态存 localStorage，不进存档 —— 换一局也记得上次的选择。
const Audio = {
  ctx: null,
  muted: false,
  _last: 0,
  _lastName: '',

  init() {
    try { this.muted = localStorage.getItem('sanguo.muted') === '1'; } catch (e) { /* 隐私模式 */ }
    const unlock = () => {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    };
    // 任一手势都解锁一次（挂 document 上，不用各处再写）
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
  },

  setMuted(on) {
    this.muted = !!on;
    try { localStorage.setItem('sanguo.muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
  },

  /** 单音：{ type, from, to, dur, gain, noise } */
  _blip(spec) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(spec.gain == null ? 0.1 : spec.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
    g.connect(ctx.destination);

    if (spec.noise) {
      const len = Math.floor(ctx.sampleRate * spec.dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = spec.noise;
      src.connect(lp); lp.connect(g);
      src.start(t0);
      return;
    }

    const osc = ctx.createOscillator();
    osc.type = spec.type || 'sine';
    osc.frequency.setValueAtTime(spec.from || 440, t0);
    if (spec.to && spec.to !== spec.from) {
      osc.frequency.exponentialRampToValueAtTime(spec.to, t0 + spec.dur);
    }
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + spec.dur + 0.02);
  },

  /** 五个音：翻月 / 开工 / 出征 / 破城 / 警报 */
  play(name) {
    if (this.muted || !this.ctx) return;
    // 同一种音 250ms 内只响一次，免得一回合里几十场战斗把耳朵炸了
    const now = Date.now();
    if (name === this._lastName && now - this._last < 250) return;
    this._last = now; this._lastName = name;

    switch (name) {
      case 'turn':   // 木质双击：880 → 440
        this._blip({ type: 'square', from: 880, to: 440, dur: 0.09, gain: 0.06 });
        break;
      case 'build':  // 石块敲击：低频噪声
        this._blip({ noise: 220, dur: 0.12, gain: 0.08 });
        break;
      case 'march':  // 号角：220 → 330 上滑
        this._blip({ type: 'sawtooth', from: 220, to: 330, dur: 0.26, gain: 0.07 });
        break;
      case 'siege':  // 破城：低频撞击 + 噪声
        this._blip({ type: 'triangle', from: 120, to: 60, dur: 0.4, gain: 0.1 });
        this._blip({ noise: 400, dur: 0.4, gain: 0.09 });
        break;
      case 'alarm':  // 警报：两短音
        this._blip({ type: 'triangle', from: 660, to: 660, dur: 0.09, gain: 0.07 });
        setTimeout(() => this._blip({ type: 'triangle', from: 660, to: 660, dur: 0.09, gain: 0.07 }), 130);
        break;
      default:
        break;
    }
  },
};
