// Device adapters. Produce one set of intents; contain no combat rules.
import { liftOff } from '../../shared/aim';
export class Controls {
  move = { x: 0, z: 0 };
  /** Aim point in CSS px relative to the canvas (already offset above the finger on touch). */
  aim = { x: 0, y: 0, seen: false };
  held = false;          // throw button / finger / LMB is down
  pressed = false;       // edge, consumed by the game loop
  released = false;      // edge
  cancelled = false;     // current hold was cancelled (RMB, Esc, finger over ✕)
  overCancel = false;
  repairHeld = false;
  /** edge: jump was pressed (Space / button); consumed by the game loop */
  jumpPressed = false;
  /** sprint is held: Shift, or the stick pushed past its rim */
  sprintHeld = false;
  private keySprint = false; private stickFast = false;
  pauseRequested = false;
  touch = false;
  private keys = new Set<string>();
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private aimId: number | null = null;
  private repairId: number | null = null;
  private stickEl = document.getElementById('stick')!;
  private cancelEl = document.getElementById('cancel')!;
  private repairEl = document.getElementById('repair')!;
  /** Touch aiming is relative: finger movement since the press, in px. The game maps it onto the enemy island. */
  touchDelta = { x: 0, y: 0 };
  private touchStart = { x: 0, y: 0 };
  private touchHist: { t: number; x: number; y: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => this.down(e), opts);
    window.addEventListener('pointermove', e => this.moved(e), opts);
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e, true));
    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    // anything that takes the game away from the player (switching apps, a call, the notification shade, a lost window):
    // let go of every key, finger and hold, and tell the match so nothing keeps walking or charging on its own
    const interrupt = () => { this.reset(); this.onInterrupt(); };
    window.addEventListener('blur', interrupt);
    window.addEventListener('pagehide', interrupt);
    document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });
    const jumpEl = document.getElementById('jump')!;
    jumpEl.addEventListener('pointerdown', e => { e.preventDefault(); this.touch = e.pointerType !== 'mouse'; this.jumpPressed = true; jumpEl.classList.add('hold'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jumpEl.addEventListener(ev, () => jumpEl.classList.remove('hold'));
    this.repairEl.addEventListener('pointerdown', e => { e.preventDefault(); this.touch = e.pointerType !== 'mouse'; this.repairId = e.pointerId; this.repairHeld = true; this.repairEl.classList.add('hold'); this.repairEl.setPointerCapture(e.pointerId); });
  }

  /** Set by the game: stops the local actor and, online, sends the stop / cancel intents to the server. */
  onInterrupt: () => void = () => {};
  reset() {
    if (this.held) this.cancelHold();
    this.keys.clear(); this.keySprint = this.stickFast = this.sprintHeld = false; this.jumpPressed = false; this.stick = null; this.aimId = null; this.repairId = null; this.repairHeld = false; this.move = { x: 0, z: 0 };
    this.stickEl.classList.remove('on'); this.repairEl.classList.remove('hold');
  }
  private cancelHold() { this.cancelled = true; this.held = false; this.released = true; this.overCancel = false; }

  private rel(e: PointerEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; }

  private down(e: PointerEvent) {
    const p = this.rel(e);
    if (e.pointerType === 'mouse') {
      this.touch = false;
      if (e.button === 2) { if (this.held) this.cancelHold(); return; }
      if (e.button !== 0) return;
      this.aim = { x: p.x, y: p.y, seen: true }; this.begin();
      return;
    }
    this.touch = true; e.preventDefault();
    if (p.x < p.w / 2 && !this.stick) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.stickEl.style.left = e.clientX + 'px'; this.stickEl.style.top = e.clientY + 'px'; this.stickEl.classList.add('on');
      (this.stickEl.firstElementChild as HTMLElement).style.transform = '';
    } else if (p.x >= p.w / 2 && this.aimId === null) {
      this.aimId = e.pointerId; this.touchStart = { x: p.x, y: p.y }; this.touchDelta = { x: 0, y: 0 }; this.touchHist = []; this.begin();
    }
  }
  private begin() { this.held = true; this.pressed = true; this.cancelled = false; this.overCancel = false; }

  private moved(e: PointerEvent) {
    const p = this.rel(e);
    if (e.pointerType === 'mouse') { this.aim = { x: p.x, y: p.y, seen: true }; return; }
    if (this.stick && e.pointerId === this.stick.id) {
      const max = 55; let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy; const l = Math.hypot(dx, dy);
      if (l > max) { dx *= max / l; dy *= max / l; }
      // pushing the knob well past the rim = run (hysteresis so it does not flicker at the edge)
      this.stickFast = l > max * (this.stickFast ? 1.0 : 1.22); this.sprintHeld = this.keySprint || this.stickFast; this.stickEl.classList.toggle('fast', this.stickFast);
      this.stick.x = dx / max; this.stick.y = dy / max;
      (this.stickEl.firstElementChild as HTMLElement).style.transform = `translate(${dx}px,${dy}px)`;
      this.updateMove();
    }
    if (e.pointerId === this.aimId) {
      e.preventDefault();
      this.touchDelta = { x: p.x - this.touchStart.x, y: p.y - this.touchStart.y };
      const now = performance.now(); this.touchHist.push({ t: now, ...this.touchDelta }); while (this.touchHist.length > 1 && now - this.touchHist[0].t > 400) this.touchHist.shift();
      const r = this.cancelEl.getBoundingClientRect(), pad = 14;
      this.overCancel = !this.cancelEl.hidden && e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad;
      this.cancelEl.classList.toggle('over', this.overCancel);
    }
  }

  private up(e: PointerEvent, cancelled = false) {
    if (e.pointerType === 'mouse') { if (e.button === 0 && this.held) { this.held = false; this.released = true; } return; }
    if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.stickEl.classList.remove('on', 'fast'); this.stickFast = false; this.sprintHeld = this.keySprint; this.updateMove(); }
    if (e.pointerId === this.aimId) {
      this.aimId = null;
      // the fingertip rolls and slips as it lifts: aim where it was a moment before, not where the last jittery sample says
      if (!cancelled) this.touchDelta = liftOff(this.touchHist, this.touchDelta, performance.now());
      if (this.held) { this.held = false; this.released = true; if (cancelled || this.overCancel) this.cancelled = true; }
      this.cancelEl.classList.remove('over');
    }
    if (e.pointerId === this.repairId) { this.repairId = null; this.repairHeld = false; this.repairEl.classList.remove('hold'); }
  }

  private key(e: KeyboardEvent, down: boolean) {
    const code = e.code;
    if ((e.target as HTMLElement | null)?.closest?.('input,textarea')) return;
    if (e.repeat && (code === 'Escape' || code === 'KeyQ')) return;
    if (code === 'Space') { e.preventDefault(); if (down && !e.repeat) this.jumpPressed = true; this.touch = false; return; }
    if (code === 'ShiftLeft' || code === 'ShiftRight') { this.keySprint = down; this.sprintHeld = this.keySprint || this.stickFast; this.touch = false; return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE'].includes(code)) { e.preventDefault(); if (down) this.keys.add(code); else this.keys.delete(code); this.touch = false; this.updateMove(); }
    if (code === 'KeyE') this.repairHeld = down;
    if (down && (code === 'Escape' || code === 'KeyQ')) { if (this.held) this.cancelHold(); else if (code === 'Escape') this.pauseRequested = true; }
  }

  private updateMove() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.stick && !x && !z) {
      const l = Math.hypot(this.stick.x, this.stick.y);
      if (l > .18) { const s = Math.min(1, (l - .18) / .5); x = this.stick.x / l * s; z = -this.stick.y / l * s; }
    }
    const l = Math.max(1, Math.hypot(x, z)); this.move = { x: x / l, z: z / l };
  }
}
