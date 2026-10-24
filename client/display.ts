import type { Engine } from '@babylonjs/core/Engines/engine';

export type Quality = 'auto' | 'clear' | 'fast';
export const qualityProfiles = { auto: { ratio: 1.5, pixels: 1_800_000 }, clear: { ratio: 2, pixels: 3_000_000 }, fast: { ratio: 1, pixels: 800_000 } };

/** One owner of viewport, framebuffer and CSS-to-Babylon coordinate conversion. */
export class Display {
  quality: Quality = 'auto';
  revision = 0;
  private signature = '';
  constructor(readonly root: HTMLElement, readonly canvas: HTMLCanvasElement, readonly engine: Engine, private onResize: () => void) {
    try { const v = localStorage.getItem('titans.quality'); if (v === 'clear' || v === 'fast') this.quality = v; } catch { /* Storage optional. */ }
    const select = document.querySelector<HTMLSelectElement>('#quality')!;
    select.value = this.quality;
    select.addEventListener('change', () => {
      this.quality = select.value as Quality;
      try { localStorage.setItem('titans.quality', this.quality); } catch { /* Storage optional. */ }
      this.sync();
    });
    const refresh = () => { this.sync(); };
    window.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('scroll', refresh);
    new ResizeObserver(refresh).observe(canvas);
    this.sync();
  }

  sync() {
    const v = window.visualViewport;
    const width = v?.width ?? document.documentElement.clientWidth;
    const height = v?.height ?? document.documentElement.clientHeight;
    this.root.style.width = `${width}px`; this.root.style.height = `${height}px`;
    this.root.style.setProperty('--available-height', `${height}px`);
    this.root.style.left = `${v?.offsetLeft ?? 0}px`; this.root.style.top = `${v?.offsetTop ?? 0}px`;
    this.root.style.setProperty('--joy', `${Math.min(126, Math.max(92, height * .28))}px`);
    this.root.style.setProperty('--pad', `${Math.min(24, Math.max(10, height * .04))}px`);
    this.root.style.setProperty('--attack-gap', height < 340 ? '10px' : '18px');
    const r = this.canvas.getBoundingClientRect(), profile = qualityProfiles[this.quality];
    const ratio = Math.min(devicePixelRatio || 1, profile.ratio, Math.sqrt(profile.pixels / Math.max(1, r.width * r.height)));
    const signature = [width, height, r.left, r.top, r.width, r.height, devicePixelRatio, this.quality].join(':');
    if (signature === this.signature || r.width <= 0 || r.height <= 0) return false;
    this.signature = signature;
    this.engine.setHardwareScalingLevel(1 / ratio);
    this.engine.resize(true);
    this.revision++;
    this.onResize();
    return true;
  }

  get portrait() { const r = this.root.getBoundingClientRect(); return r.height >= r.width; }

  aimPoint() {
    const mark = document.getElementById('reticle')!.getBoundingClientRect();
    const rect = this.canvas.getBoundingClientRect();
    const client = { x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 };
    const render = { x: (client.x - rect.left) / rect.width * this.engine.getRenderWidth(), y: (client.y - rect.top) / rect.height * this.engine.getRenderHeight() };
    // Babylon createPickingRay divides its input by hardwareScalingLevel internally.
    // Input therefore equals framebuffer coordinates multiplied by that level, not DPR.
    const scaling = this.engine.getHardwareScalingLevel();
    return { client, render, api: { x: render.x * scaling, y: render.y * scaling } };
  }

  diagnostics() {
    const r = this.canvas.getBoundingClientRect(), v = window.visualViewport;
    return { viewport: { width: v?.width, height: v?.height, offsetLeft: v?.offsetLeft, offsetTop: v?.offsetTop, scale: v?.scale, innerWidth, innerHeight },
      canvas: { left: r.left, top: r.top, width: r.width, height: r.height }, render: { width: this.engine.getRenderWidth(), height: this.engine.getRenderHeight() },
      dpr: devicePixelRatio, scaling: this.engine.getHardwareScalingLevel(), effectiveRatio: 1 / this.engine.getHardwareScalingLevel(), quality: this.quality, revision: this.revision, reticle: this.aimPoint() };
  }
}
