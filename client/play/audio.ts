// Procedural sound: no audio files, everything is synthesised with Web Audio (Nordic folk mood: drone, plucked lute, frame drum, horn).
import type { Kind } from '../../shared/battle';

const D_DORIAN = [293.66, 329.63, 349.23, 392, 440, 493.88, 523.25]; // D E F G A B C

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;       // sends to the echo (effects)
  private fxMus!: GainNode;    // the same for music
  private busSfx!: GainNode; private busMus!: GainNode;
  private cur: 'sfx' | 'mus' = 'sfx';
  volume = { sfx: 1, music: 1 };
  private noiseBuf!: AudioBuffer;
  private chargeNode: { osc: OscillatorNode; gain: GainNode; tier: number } | null = null;
  private repairNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private musicTimer = 0;
  private beat = 0;
  private drone: OscillatorNode[] = [];
  muted = false;
  musicOn = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('titans.muted') === '1';
      for (const k of ['sfx', 'music'] as const) { const v = Number(localStorage.getItem('titans.vol.' + k)); if (localStorage.getItem('titans.vol.' + k) !== null && Number.isFinite(v)) this.volume[k] = Math.max(0, Math.min(1, v)); }
    } catch { /* optional */ }
  }
  /** Effects and music have their own level (0..1). */
  setVolume(kind: 'sfx' | 'music', v: number) {
    v = Math.max(0, Math.min(1, v)); this.volume[kind] = v; try { localStorage.setItem('titans.vol.' + kind, String(v)); } catch { /* optional */ }
    if (this.ctx) (kind === 'sfx' ? this.busSfx : this.busMus).gain.setTargetAtTime(v, this.ctx.currentTime, .03);
  }

  /** Must be called from a user gesture (button click / first touch). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : .8; this.master.connect(c.destination);
      this.busSfx = c.createGain(); this.busSfx.gain.value = this.volume.sfx; this.busSfx.connect(this.master);
      this.busMus = c.createGain(); this.busMus.gain.value = this.volume.music; this.busMus.connect(this.master);
      const echoFor = (bus: GainNode) => { const echo = c.createDelay(1), fb = c.createGain(), wet = c.createGain(), send = c.createGain(); echo.delayTime.value = .34; fb.gain.value = .32; wet.gain.value = .35; send.gain.value = 1; send.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(bus); return send; };
      this.fx = echoFor(this.busSfx); this.fxMus = echoFor(this.busMus);
      this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }
  private held = false;
  /** Silence everything while an ad is on screen (Yandex requires it). */
  hold(on: boolean) { this.held = on; if (this.ctx) this.master.gain.setTargetAtTime(on || this.muted ? 0 : .8, this.ctx.currentTime, .03); }
  setMuted(m: boolean) { this.muted = m; try { localStorage.setItem('titans.muted', m ? '1' : '0'); } catch { /* optional */ } if (this.ctx) this.master.gain.setTargetAtTime(m || this.held ? 0 : .8, this.ctx.currentTime, .03); }

  // ---------- building blocks ----------
  private get t() { return this.ctx!.currentTime; }
  private get out() { return this.cur === 'mus' ? this.busMus : this.busSfx; }
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, o: { to?: number; delay?: number; lp?: number; echo?: number; attack?: number } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = this.t + (o.delay ?? 0), osc = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    f.type = 'lowpass'; f.frequency.value = o.lp ?? 6000;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + (o.attack ?? .008)); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    osc.connect(f); f.connect(g); g.connect(this.out); if (o.echo) { const s = c.createGain(); s.gain.value = o.echo; g.connect(s); s.connect(this.cur === 'mus' ? this.fxMus : this.fx); }
    osc.start(t0); osc.stop(t0 + dur + .05);
  }
  private noise(dur: number, vol: number, o: { type?: BiquadFilterType; f0?: number; f1?: number; q?: number; delay?: number; attack?: number } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = this.t + (o.delay ?? 0), src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf; src.loop = true; f.type = o.type ?? 'lowpass'; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0 ?? 1000, t0); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + (o.attack ?? .005)); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.out); src.start(t0, Math.random()); src.stop(t0 + dur + .05);
  }

  // ---------- effects ----------
  click() { this.tone(520, .07, 'triangle', .25, { to: 780 }); }
  throwSfx(kind: Kind, mine = true) {
    const k = mine ? 1 : .55, big = kind === 'heavy' ? 1.4 : kind === 'spin' ? 1.1 : 1;
    this.noise(.38 * big, .32 * k, { type: 'bandpass', f0: 350, f1: 2200, q: 1.4, attack: .04 });
    this.tone(kind === 'heavy' ? 85 : 120, .22 * big, 'sawtooth', .22 * k, { to: 60, lp: 500 });
    if (kind === 'spin') for (let i = 0; i < 4; i++) this.tone(900 + i * 90, .05, 'square', .04 * k, { delay: i * .07, lp: 2500 });
  }
  /** Rising hum while a throw is charged. Call every frame with `on` and the hold time. */
  charge(on: boolean, t: number) {
    if (!this.ctx) return;
    if (!on) { if (this.chargeNode) { const n = this.chargeNode; n.gain.gain.setTargetAtTime(0, this.t, .05); n.osc.stop(this.t + .3); this.chargeNode = null; } return; }
    if (!this.chargeNode) {
      const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), f = this.ctx.createBiquadFilter(); osc.type = 'triangle'; f.type = 'lowpass'; f.frequency.value = 900;
      gain.gain.value = 0; gain.gain.setTargetAtTime(.09, this.t, .08); osc.connect(f); f.connect(gain); gain.connect(this.busSfx); osc.start(); this.chargeNode = { osc, gain, tier: 0 };
    }
    const n = this.chargeNode, tier = t >= 2.6 ? 2 : t >= .9 ? 1 : 0;
    n.osc.frequency.setTargetAtTime(110 * Math.pow(2, Math.min(t, 3) / 1.6), this.t, .05);
    if (tier > n.tier) { n.tier = tier; this.tone(tier === 2 ? 261.63 : 196, .35, 'sawtooth', .16, { lp: 1400, echo: .4, attack: .03 }); this.tone(tier === 2 ? 392 : 293.66, .35, 'sawtooth', .1, { lp: 1400, attack: .03 }); }
  }
  jump(mine = true) { const k = mine ? 1 : .5; this.tone(220, .16, 'triangle', .16 * k, { to: 440 }); this.noise(.12, .08 * k, { type: 'highpass', f0: 1800, f1: 3500 }); }
  land(mine = true) { const k = mine ? 1 : .5; this.tone(110, .12, 'sine', .22 * k, { to: 60 }); this.noise(.1, .12 * k, { type: 'lowpass', f0: 900 }); }
  dodge(mine = true) { this.tone(660, .1, 'triangle', .12, { to: 990, echo: .3 }); this.tone(990, .14, 'triangle', .08, { delay: .06, echo: .3 }); void mine; }
  impact(kind: Kind, hpBefore: number, hpAfter: number, near = 1) {
    const v = near * (kind === 'heavy' ? 1 : kind === 'spin' ? .8 : .65);
    if (hpBefore === Infinity) { this.noise(.1, .3 * v, { type: 'highpass', f0: 2500 }); this.tone(900, .06, 'square', .06 * v, { lp: 3000 }); return; }
    this.tone(150, .4, 'sine', .7 * v, { to: 38 }); this.noise(.28, .45 * v, { f0: 900, f1: 200 });
    if (hpAfter === 1) for (let i = 0; i < 3; i++) this.noise(.06, .3 * v, { type: 'highpass', f0: 2200, delay: i * .045 });
    if (hpAfter === 0) { this.noise(.9, .5 * v, { f0: 380, f1: 80, attack: .02 }); for (let i = 0; i < 5; i++) this.tone(400 + Math.random() * 500, .05, 'square', .05 * v, { delay: .1 + i * .09 + Math.random() * .05, lp: 2000 }); }
  }
  hit(mine = true) { const k = mine ? 1 : .6; this.tone(95, .45, 'sine', .8 * k, { to: 38 }); this.noise(.12, .4 * k, { f0: 1800, f1: 400 }); this.tone(170, .22, 'sawtooth', .22 * k, { to: 85, lp: 700, delay: .02 }); }
  fall(mine = true) { this.tone(780, 1.1, 'triangle', .22 * (mine ? 1 : .6), { to: 90, echo: .4 }); this.noise(1, .1, { type: 'bandpass', f0: 1500, f1: 200, q: 2 }); }
  respawn() { this.tone(392, .5, 'triangle', .2, { echo: .5 }); this.tone(587, .6, 'triangle', .16, { delay: .12, echo: .5 }); }
  refill() { this.tone(300, .05, 'square', .09, { lp: 1500 }); this.tone(220, .07, 'square', .08, { delay: .06, lp: 1200 }); }
  repair(on: boolean) {
    if (!this.ctx) return;
    if (!on) { if (this.repairNode) { this.repairNode.gain.gain.setTargetAtTime(0, this.t, .04); this.repairNode.src.stop(this.t + .2); this.repairNode = null; } return; }
    if (this.repairNode) return;
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    src.buffer = this.noiseBuf; src.loop = true; f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 3; g.gain.value = 0; g.gain.setTargetAtTime(.16, this.t, .05);
    lfo.frequency.value = 7; lg.gain.value = .12; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(f); f.connect(g); g.connect(this.busSfx); src.start(); this.repairNode = { src, gain: g };
  }
  repaired() { this.tone(330, .4, 'triangle', .22, { echo: .5 }); this.tone(494, .45, 'triangle', .18, { delay: .09, echo: .5 }); this.tone(659, .6, 'triangle', .14, { delay: .18, echo: .5 }); }
  win() { [[146.83, 0], [220, .3], [293.66, .6], [349.23, .9], [440, 1.2]].forEach(([f, d], i) => { this.tone(f, i === 4 ? 1.4 : .5, 'sawtooth', .17, { delay: d, lp: 1500, echo: .5, attack: .05 }); this.tone(f * 1.5, i === 4 ? 1.4 : .5, 'sawtooth', .07, { delay: d, lp: 1200, attack: .05 }); }); this.drum(.0, 1); this.drum(.6, .8); this.drum(1.2, 1); }
  lose() { [[293.66, 0], [261.63, .45], [220, .9], [146.83, 1.35]].forEach(([f, d], i) => this.tone(f, i === 3 ? 1.6 : .55, 'sawtooth', .15, { delay: d, lp: 900, echo: .4, attack: .06 })); }
  private drum(delay = 0, v = 1) { this.tone(130, .3, 'sine', .45 * v, { to: 48, delay }); this.noise(.06, .12 * v, { f0: 2500, delay }); }

  // ---------- music ----------
  startMusic() {
    if (!this.ctx || this.musicOn) return; this.musicOn = true;
    const c = this.ctx;
    for (const [f, v] of [[73.42, .05], [110, .035], [146.83, .02]] as const) { const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = Math.random() * 8 - 4; lp.type = 'lowpass'; lp.frequency.value = 500; g.gain.value = 0; g.gain.setTargetAtTime(v, this.t, 1.5); o.connect(lp); lp.connect(g); g.connect(this.busMus); o.start(); this.drone.push(o); }
    this.beat = 0;
    const tick = () => {
      if (!this.musicOn || !this.ctx) return;
      const b = this.beat++ % 16; this.cur = 'mus';
      if (b % 4 === 0) this.drum(0, .35);
      else if (b % 4 === 2 && Math.random() < .5) this.tone(180, .08, 'sine', .08, { to: 90 });
      if (Math.random() < (b % 2 === 0 ? .55 : .25)) { const n = D_DORIAN[Math.floor(Math.random() * D_DORIAN.length)] * (Math.random() < .3 ? 2 : 1); this.tone(n, .9, 'triangle', .085, { echo: .6, lp: 2400, attack: .004 }); this.tone(n * 2, .25, 'sine', .02, { lp: 3000 }); }
      if (b === 0 && Math.random() < .5) this.tone(D_DORIAN[4] / 2, 2.2, 'triangle', .035, { echo: .3, attack: .4, lp: 900 });
      this.cur = 'sfx';
    };
    this.musicTimer = window.setInterval(tick, 330);
  }
  stopMusic() { this.musicOn = false; window.clearInterval(this.musicTimer); for (const o of this.drone) { try { o.stop(this.t + .5); } catch { /* already stopped */ } } this.drone = []; }
}
