// Presentation policy only: no device names, no combat rules. Adapted from the Codex mobile pass (v06).
// Phones render at most 1 pixel per CSS pixel (a DPR 2-3 phone used to draw 4-9x that), with a pixel budget on top;
// desktops keep the sharp DPR-based picture. Slow frames step the picture down for good (never back up, no flicker).
export type QualitySettings = {
  scale: number;        // render pixels per CSS pixel on phones (desktop: multiplier on top of the device pixel ratio)
  maxDpr: number;       // device pixel ratio actually used: phones 1, desktops up to 2
  maxPixels: number; maxEdge: number;
  clouds: number; particles: number; fragments: number; trailEvery: number;
  shadows: boolean; shadowEvery: 1 | 2; glow: boolean;
};

export function settings(mobile: boolean, degradation = 0): QualitySettings {
  const d = Math.min(degradation, 3);
  return {
    scale: Math.pow(.85, d),
    maxDpr: mobile ? 1 : 2, maxPixels: mobile ? 921600 : 3686400, maxEdge: mobile ? 1280 : 3000,
    clouds: mobile ? (d >= 2 ? 16 : 30) : 70, particles: mobile ? 56 : 128, fragments: mobile ? 24 : 64, trailEvery: mobile ? .05 : 0,
    shadows: !mobile || d < 2, shadowEvery: mobile ? 2 : 1, glow: !mobile || d < 1,
  };
}

/** Render pixels per CSS pixel: the device ratio (capped by `maxDpr`) times the quality step, within the pixel and long-edge budget. */
export function renderScale(cssWidth: number, cssHeight: number, q: QualitySettings, dpr = 1): number {
  const px = Math.min(Math.max(dpr, 1), q.maxDpr) * q.scale;
  return Math.max(.35, Math.min(px, q.maxEdge / Math.max(cssWidth, cssHeight), Math.sqrt(q.maxPixels / (cssWidth * cssHeight))));
}

/** Only steps down, only after sustained slowness. Isolated spikes and hidden-tab gaps do not count. */
export class QualityPolicy {
  mobile: boolean;
  degradation = 0;
  private warmup = 4;
  private badSeconds = 0;
  private cooldown = 0;
  private averageMs = 16.67;
  constructor(mobile: boolean) { this.mobile = mobile; }
  get current() { return settings(this.mobile, this.degradation); }
  resetTiming() { this.warmup = 4; this.badSeconds = 0; this.cooldown = 0; this.averageMs = 16.67; }
  /** Returns true when the quality just stepped down. */
  sample(frameMs: number): boolean {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 200) return false;
    const dt = frameMs / 1000;
    this.averageMs += (frameMs - this.averageMs) * Math.min(1, dt / .8);
    if (this.warmup > 0) { this.warmup -= dt; return false; }
    if (this.degradation >= 3) return false;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown) return false;
    this.badSeconds = this.averageMs > (this.degradation < 2 ? 26 : 32) ? this.badSeconds + dt : Math.max(0, this.badSeconds - dt * 2);
    if (this.badSeconds < 3) return false;
    this.degradation++; this.badSeconds = 0; this.cooldown = 10;
    return true;
  }
}
