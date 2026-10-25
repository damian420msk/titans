// Pose driver for the v04 titan: samples the exported clips by hand and writes the bone transforms itself.
// Why by hand: the clips key every bone, but the game needs layers (legs from Walk while the torso charges a throw),
// cross-fades and a release that follows the authoritative throw event. Babylon's animation groups cannot mask like that.
// Only client code: nothing here touches the battle rules.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';

type Track = { t: number[]; v: (Quaternion | Vector3)[]; step: boolean };
export type Clip = { name: string; len: number; tracks: Map<string, { q?: Track; p?: Track; s?: Track }> };
type Pose = { q: Quaternion[]; p: Vector3[]; s: Vector3[] };

/** Names the clips are looked up by. */
export const CLIP = { idle: 'Idle', walk: 'Walk', windup: 'ThrowWindup', hold: 'ChargeHold', release: 'ThrowRelease' } as const;
/** Joints that belong to the legs: while walking and charging at once they follow Walk, the rest follows the throw clips. */
const LOWER = /^(Hips|Left(UpLeg|Leg|Foot|ToeBase)|Right(UpLeg|Leg|Foot|ToeBase))$/;
/** Props that ship inside the file but are not joints (the game owns the stone in the hand). */
const SKIP = new Set(['HandStone', 'HandStone_Rock']);

/** The release point of ThrowRelease is at 0.333 s; the clip starts a little before it so the empty hand follows the already launched stone. */
export const RELEASE_FROM = 0.2;
const XFADE = 0.08;

export function readClips(groups: AnimationGroup[]): Map<string, Clip> {
  const out = new Map<string, Clip>();
  for (const g of groups) {
    const clip: Clip = { name: g.name, len: 0, tracks: new Map() };
    for (const ta of g.targetedAnimations) {
      const node = ta.target as TransformNode, an = ta.animation, keys = an.getKeys(), fps = an.framePerSecond || 60;
      if (!node?.name || SKIP.has(node.name) || !keys.length) continue;
      const tr: Track = { t: keys.map(k => (k.frame - keys[0]!.frame) / fps), v: keys.map(k => (k.value as Quaternion | Vector3).clone()), step: keys[0]!.interpolation === 1 };
      clip.len = Math.max(clip.len, tr.t[tr.t.length - 1]!);
      const slot = clip.tracks.get(node.name) ?? {}; clip.tracks.set(node.name, slot);
      if (an.targetProperty === 'rotationQuaternion') slot.q = tr; else if (an.targetProperty === 'position') slot.p = tr; else if (an.targetProperty === 'scaling') slot.s = tr;
    }
    out.set(g.name, clip);
  }
  return out;
}

function at(tr: Track, time: number): { i: number; f: number } {
  const t = tr.t, n = t.length;
  if (n === 1 || time <= t[0]!) return { i: 0, f: 0 };
  if (time >= t[n - 1]!) return { i: n - 1, f: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m]! <= time) lo = m; else hi = m; }
  return { i: lo, f: tr.step ? 0 : (time - t[lo]!) / (t[hi]! - t[lo]!) };
}

export class TitanRig {
  /** Extra rotations multiplied on top of the clip pose by name (cheer, flail): fallback for reactions the clips do not have. */
  off = new Map<string, Quaternion>();
  private names: string[]; private nodes: TransformNode[]; private lower: boolean[];
  private rest: Pose;
  private idle: Pose; private walkP: Pose; private loco: Pose; private thrA: Pose; private thrB: Pose; private thr: Pose; private fin: Pose;
  private walkW = 0; private idleT = 0; private walkT = 0;
  private mode: 'loco' | 'windup' | 'hold' | 'release' = 'loco';
  private clipT = 0; private throwW = 0;
  private from: { clip: Clip; t: number } | null = null; private xf = 1;
  /** How long the charge has been gone without a release event (the event can arrive a frame later than the charge ends). */
  private lost = 0;
  /** Seen by the game: 0..1 how far the throw layer is blended in. */
  get layer() { return this.throwW; }
  get state() { return this.mode; }

  private clips: Map<string, Clip>;
  constructor(nodes: Map<string, TransformNode>, clips: Map<string, Clip>) {
    this.clips = clips;
    this.names = [...(clips.get(CLIP.idle)?.tracks.keys() ?? [])].filter(n => nodes.has(n));
    this.nodes = this.names.map(n => nodes.get(n)!); this.lower = this.names.map(n => LOWER.test(n));
    const blank = (): Pose => ({ q: this.names.map(() => new Quaternion()), p: this.names.map(() => new Vector3()), s: this.names.map(() => new Vector3(1, 1, 1)) });
    this.rest = blank(); this.idle = blank(); this.walkP = blank(); this.loco = blank(); this.thrA = blank(); this.thrB = blank(); this.thr = blank(); this.fin = blank();
    this.nodes.forEach((n, i) => { n.rotationQuaternion ??= Quaternion.FromEulerVector(n.rotation); this.rest.q[i]!.copyFrom(n.rotationQuaternion); this.rest.p[i]!.copyFrom(n.position); this.rest.s[i]!.copyFrom(n.scaling); });
  }

  private sample(clip: Clip | undefined, time: number, out: Pose) {
    for (let i = 0; i < this.names.length; i++) {
      const tk = clip?.tracks.get(this.names[i]!);
      if (tk?.q) { const { i: k, f } = at(tk.q, time), a = tk.q.v[k] as Quaternion, b = tk.q.v[Math.min(k + 1, tk.q.v.length - 1)] as Quaternion; Quaternion.SlerpToRef(a, b, f, out.q[i]!); } else out.q[i]!.copyFrom(this.rest.q[i]!);
      if (tk?.p) { const { i: k, f } = at(tk.p, time), a = tk.p.v[k] as Vector3, b = tk.p.v[Math.min(k + 1, tk.p.v.length - 1)] as Vector3; Vector3.LerpToRef(a, b, f, out.p[i]!); } else out.p[i]!.copyFrom(this.rest.p[i]!);
      if (tk?.s) { const { i: k, f } = at(tk.s, time), a = tk.s.v[k] as Vector3, b = tk.s.v[Math.min(k + 1, tk.s.v.length - 1)] as Vector3; Vector3.LerpToRef(a, b, f, out.s[i]!); } else out.s[i]!.copyFrom(this.rest.s[i]!);
    }
  }

  private mix(a: Pose, b: Pose, w: number | ((i: number) => number), out: Pose) {
    for (let i = 0; i < this.names.length; i++) {
      const k = typeof w === 'number' ? w : w(i);
      Quaternion.SlerpToRef(a.q[i]!, b.q[i]!, k, out.q[i]!); Vector3.LerpToRef(a.p[i]!, b.p[i]!, k, out.p[i]!); Vector3.LerpToRef(a.s[i]!, b.s[i]!, k, out.s[i]!);
    }
  }

  private cur(): Clip | undefined {
    return this.clips.get(this.mode === 'windup' ? CLIP.windup : this.mode === 'hold' ? CLIP.hold : CLIP.release);
  }
  private switchTo(mode: 'windup' | 'hold' | 'release', t: number) {
    const c = this.cur(); if (this.mode !== 'loco' && c) { this.from = { clip: c, t: this.clipT }; this.xf = 0; } else this.xf = 1;
    this.mode = mode; this.clipT = t;
  }

  /** The authoritative throw happened: play the release now (the stone is already on its way). */
  release() { this.lost = 0; if (this.mode === 'release' && this.clipT < .4) return; if (this.mode !== 'loco' || this.throwW > .05) this.switchTo('release', RELEASE_FROM); else { this.mode = 'release'; this.clipT = RELEASE_FROM; this.xf = 1; this.from = null; } }
  reset() { this.mode = 'loco'; this.clipT = 0; this.throwW = 0; this.walkW = 0; this.from = null; this.xf = 1; this.off.clear(); }

  /** `move` 0/1 whether the legs walk, `rate` walk cycle speed, `charge` whether a throw is being held, `free` false while falling or knocked down. */
  update(dt: number, move: boolean, rate: number, charge: boolean, free: boolean) {
    this.idleT = (this.idleT + dt) % (this.clips.get(CLIP.idle)?.len || 4);
    this.walkW += ((move ? 1 : 0) - this.walkW) * (1 - Math.exp(-dt / .07));
    if (this.walkW > .01) { const len = this.clips.get(CLIP.walk)?.len || 1; this.walkT = (this.walkT + dt * rate) % len; }
    // throw layer state machine
    const on = charge && free;
    if (on && (this.mode === 'loco' || this.mode === 'release' && this.clipT > .6)) { this.switchTo('windup', 0); if (this.throwW < .05) { this.from = null; this.xf = 1; } }
    else if (!on && (this.mode === 'windup' || this.mode === 'hold')) { this.lost += dt; if (this.lost > .06) { this.mode = 'loco'; this.from = null; this.xf = 1; this.lost = 0; } }
    else this.lost = 0;
    if (!free && this.mode === 'release') { this.mode = 'loco'; this.from = null; }
    if (this.mode !== 'loco') {
      this.clipT += dt; const c = this.cur(), len = c?.len || 1;
      if (this.mode === 'windup' && this.clipT >= len) this.switchTo('hold', this.clipT - len);
      else if (this.mode === 'hold') this.clipT %= len;
      else if (this.mode === 'release' && this.clipT >= len) { this.mode = 'loco'; this.from = null; }
    }
    if (this.xf < 1) { this.xf = Math.min(1, this.xf + dt / XFADE); if (this.xf >= 1) this.from = null; }
    const want = this.mode === 'loco' || this.mode === 'release' && this.clipT > .72 ? 0 : 1;
    this.throwW += (want - this.throwW) * (1 - Math.exp(-dt / (want ? .06 : .1)));
    if (this.throwW < .002 && want === 0) this.throwW = 0;
  }

  /** Evaluate the clips, blend the layers, write the result (plus the fallback offsets) into the bones. */
  apply() {
    if (this.walkW < .999) this.sample(this.clips.get(CLIP.idle), this.idleT, this.idle);
    if (this.walkW > .001) this.sample(this.clips.get(CLIP.walk), this.walkT, this.walkP);
    const loco = this.walkW >= .999 ? this.walkP : this.walkW <= .001 ? this.idle : (this.mix(this.idle, this.walkP, this.walkW, this.loco), this.loco);
    let out = loco;
    if (this.throwW > 0) {
      const c = this.cur();
      let thr = this.thrA;
      this.sample(c, this.clipT, this.thrA);
      if (this.from && this.xf < 1) { this.sample(this.from.clip, this.from.t, this.thrB); this.mix(this.thrB, this.thrA, this.xf, this.thr); thr = this.thr; }
      const w = this.throwW, wm = this.walkW;
      this.mix(loco, thr, i => this.lower[i] ? w * (1 - wm) : w, this.fin); out = this.fin;
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]!, q = n.rotationQuaternion!;
      q.copyFrom(out.q[i]!); const o = this.off.get(this.names[i]!); if (o) q.multiplyToRef(o, q);
      n.position.copyFrom(out.p[i]!); n.scaling.copyFrom(out.s[i]!);
    }
  }
}
