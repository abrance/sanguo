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

  /** 单音：{ type, from, to, dur, gain, noise, at, bp, bpTo } */
  _blip(spec) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (spec.at || 0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    // attack 显式给 4ms：默认 10ms 的爬升会把“撞击”听成“布嗡”
    g.gain.exponentialRampToValueAtTime(spec.gain == null ? 0.1 : spec.gain, t0 + (spec.attack || 0.01));
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
      lp.type = spec.bp ? 'bandpass' : 'lowpass';
      lp.frequency.setValueAtTime(spec.bp || spec.noise, t0);
      if (spec.bpTo) lp.frequency.exponentialRampToValueAtTime(spec.bpTo, t0 + spec.dur);
      lp.Q.value = spec.bp ? 0.9 : 0.7;
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
    if (spec.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = spec.lp;
      osc.connect(f); f.connect(g);
    } else {
      osc.connect(g);
    }
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
      case 'siege':  // 旧名保留：破城（中立视角）
      case 'capture':  // 破城：撞击 → 瓦砾扬尘（战报里别人的城破了也响，但轻一档）
        this._blip({ type: 'sine', from: 95, to: 42, dur: 0.35, gain: 0.12, attack: 0.004 });
        this._blip({ noise: 320, dur: 0.12, gain: 0.09, attack: 0.003 });
        this._blip({ noise: 500, bp: 900, bpTo: 300, dur: 0.9, gain: 0.07, at: 0.08 });
        break;
      case 'captureWin':  // 我破的城：撞击 + 瓦砾 + 三音号角（A4-C5-E5）
        this._blip({ type: 'sine', from: 95, to: 42, dur: 0.35, gain: 0.15, attack: 0.004 });
        this._blip({ noise: 320, dur: 0.12, gain: 0.1, attack: 0.003 });
        this._blip({ noise: 500, bp: 900, bpTo: 300, dur: 0.9, gain: 0.075, at: 0.08 });
        [440, 523.25, 659.25].forEach((f, i) => {
          this._blip({ type: 'triangle', from: f, to: f, dur: i === 2 ? 0.42 : 0.14, gain: 0.1, lp: 2400, at: 0.34 + i * 0.14 });
        });
        break;
      case 'captureLose':  // 我的城破了：下行小二度 + 更闷的低频（听感是“沉下去”）
        this._blip({ type: 'sine', from: 80, to: 38, dur: 0.5, gain: 0.14, attack: 0.005 });
        this._blip({ noise: 220, dur: 0.3, gain: 0.09, attack: 0.004 });
        this._blip({ type: 'triangle', from: 392, to: 349.23, dur: 0.5, gain: 0.07, lp: 900, at: 0.2 });
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
