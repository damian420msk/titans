// Client-side prediction for online duels: the server owns the truth, the client keeps its own copy running and gently corrects it.
// DOM-free so it can be tested against the real server code with simulated latency.
import { Battle } from './battle.ts';
import { applySnap, type Snap } from './net.ts';

export class Predictor {
  /** Smoothed round trip in seconds; the owner updates it. */
  rtt = .12;
  /** Time (seconds) when the player last released or cancelled a charge; stops stale server charges from coming back. */
  lastEnd = -9;
  private hist: { t: number; x: number; z: number }[] = [];

  reset() { this.hist.length = 0; this.lastEnd = -9; }
  /** Call once per frame, before reading input, with the own actor position. */
  record(now: number, x: number, z: number) { this.hist.push({ t: now, x, z }); while (this.hist.length && this.hist[0].t < now - 2) this.hist.shift(); }

  private posAt(t: number) {
    const h = this.hist;
    for (let i = 0; i < h.length; i++) {
      if (h[i].t >= t) { const p = h[i - 1]; if (!p) return h[i]; const k = (t - p.t) / Math.max(1e-6, h[i].t - p.t); return { x: p.x + (h[i].x - p.x) * k, z: p.z + (h[i].z - p.z) * k }; }
    }
    return h.length ? h[h.length - 1] : null;
  }

  /**
   * Take the server state (received at `at`, applied at `now`) and move it forward by the time it spent in transit.
   * Own charge and stick input stay local; own position is corrected only when it really diverged from what the server saw.
   */
  reconcile(b: Battle, s: Snap, at: number, now: number) {
    const me = b.actors[0], oldPos = { x: me.pos.x, z: me.pos.z }, busy = me.falling || me.stun > 0 || !!me.slide, oldCharge = b.charges[0], myInput = { ...b.input[0] }, oldTime = b.time;
    applySnap(b, s);
    b.input[0] = myInput;
    const srvPos = { ...b.actors[0].pos }, sa = b.actors[0], srvBusy = sa.falling || sa.stun > 0 || !!sa.slide, srvCharge = b.charges[0];
    const age = Math.min(.3, this.rtt / 2 + Math.max(0, now - at));
    for (let t = 0; t < age - 1e-9 && b.phase === 'playing'; t += 1 / 60) b.step(Math.min(1 / 60, age - t));
    b.events.length = 0; b.time = Math.max(oldTime, b.time);
    const grace = Math.max(.35, this.rtt * 1.5 + .15);
    if (oldCharge) b.charges[0] = srvCharge || oldCharge.t <= grace ? oldCharge : null;
    else if (srvCharge && now - this.lastEnd < .6 + this.rtt) b.charges[0] = null;
    const a = b.actors[0];
    if (!busy && !srvBusy && !a.falling && a.stun <= 0 && !a.slide) {
      const then = this.posAt(at - this.rtt);
      if (!then) a.pos = oldPos;
      else {
        const ex = srvPos.x - then.x, ez = srvPos.z - then.z, err = Math.hypot(ex, ez);
        if (err > 1.5) a.pos = { x: srvPos.x + oldPos.x - then.x, z: srvPos.z + oldPos.z - then.z };
        else if (err > .4) a.pos = { x: oldPos.x + ex * .3, z: oldPos.z + ez * .3 };
        else a.pos = oldPos;
        // the past moves with the correction, otherwise the same old error would be corrected again on the next snapshot
        const cx = a.pos.x - oldPos.x, cz = a.pos.z - oldPos.z;
        if (cx || cz) for (const h of this.hist) { h.x += cx; h.z += cz; }
      }
    }
  }
}
