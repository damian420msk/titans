export type InputMode = 'desktop' | 'touch';
export type InputPreference = 'auto' | InputMode;
export type TouchLayout = 'zones' | 'joysticks';
export type GameAction =
  | { type: 'move'; x: number; z: number }
  | { type: 'look'; dx: number; dy: number }
  | { type: 'primary'; pressed: boolean }
  | { type: 'cancel' };
type Role = 'stick' | 'aimStick' | 'look' | 'primary' | 'cancel' | 'entry';
type Finger = { role: Role; x: number; y: number; ox: number; oy: number; capture?: HTMLElement; cancelled?: boolean };
const gameKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const readPreference = (): InputPreference => {
  try { const v = localStorage.getItem('titans.input'); return v === 'desktop' || v === 'touch' ? v : 'auto'; } catch { return 'auto'; }
};
const guessMode = (): InputMode => {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const noHover = matchMedia('(hover: none)').matches;
  return coarse && noHover || noHover && matchMedia('(any-pointer: coarse)').matches && navigator.maxTouchPoints > 0 ? 'touch' : 'desktop';
};

/** Device adapters emit the same actions. This class contains no combat rules. */
export class InputController {
  preference = readPreference();
  effective: InputMode = this.preference === 'auto' ? guessMode() : this.preference;
  pending: InputMode | null = null;
  fallback = false;
  blocked = false;
  sensitivity = 1;
  handoffs = 0;
  touchLayout: TouchLayout = (() => { try { return localStorage.getItem('titans.touch-layout') === 'joysticks' ? 'joysticks' : 'zones'; } catch { return 'zones'; } })();
  private handoffTimer: number | undefined;
  private aimX = 0;
  private aimY = 0;
  private keys = new Set<string>();
  private pointers = new Map<number, Finger>();
  private stickX = 0;
  private stickZ = 0;
  private lastTouch = -Infinity;
  private primaryOwner: number | null = null;
  private wasLocked = false;
  private select = document.querySelector<HTMLSelectElement>('#input-mode')!;
  private capture = document.querySelector<HTMLButtonElement>('#capture')!;
  private fallbackButton = document.querySelector<HTMLButtonElement>('#fallback')!;
  private stick = document.querySelector<HTMLElement>('#stick')!;
  private knob = document.querySelector<HTMLElement>('#knob')!;
  private lookStick = document.querySelector<HTMLElement>('#look-stick')!;
  private lookKnob = document.querySelector<HTMLElement>('#look-knob')!;
  private hint = document.querySelector<HTMLElement>('#input-hint')!;

  constructor(private canvas: HTMLCanvasElement, private emit: (action: GameAction) => void) {
    this.select.value = this.preference;
    const layout = document.querySelector<HTMLSelectElement>('#touch-layout')!;
    layout.value = this.touchLayout;
    layout.addEventListener('change', () => {
      this.clear(); // A changed adapter never releases an old prepared action.
      this.touchLayout = layout.value === 'joysticks' ? 'joysticks' : 'zones';
      try { localStorage.setItem('titans.touch-layout', this.touchLayout); } catch { /* Storage optional. */ }
      this.refreshUI();
    });
    const sensitivity = document.querySelector<HTMLInputElement>('#sensitivity')!;
    try { this.sensitivity = Math.min(1.8, Math.max(.6, Number(localStorage.getItem('titans.sensitivity')) || 1)); } catch { /* Storage optional. */ }
    sensitivity.value = String(this.sensitivity);
    const setSensitivity = () => { this.sensitivity = Number(sensitivity.value); document.getElementById('sensitivity-value')!.textContent = this.sensitivity.toFixed(1); try { localStorage.setItem('titans.sensitivity', String(this.sensitivity)); } catch { /* Storage optional. */ } };
    sensitivity.addEventListener('input', setSensitivity); setSensitivity();
    this.select.addEventListener('change', () => {
      const value = this.select.value as InputPreference;
      this.preference = value;
      try { localStorage.setItem('titans.input', value); } catch { /* Private storage can be unavailable. */ }
      this.cancelPrimary();
      this.requestMode(value === 'auto' ? guessMode() : value);
    });
    this.capture.addEventListener('click', () => {
      if (this.effective !== 'desktop' || this.pending) return;
      this.enter();
    });
    this.fallbackButton.addEventListener('click', () => {
      if (this.effective !== 'desktop') return;
      this.clear();
      if (this.locked) document.exitPointerLock();
      this.fallback = true;
      this.refreshUI();
      this.canvas.focus();
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.locked && this.effective !== 'desktop') { document.exitPointerLock(); return; }
      if (this.wasLocked && !this.locked) this.clear();
      this.wasLocked = this.locked;
      if (this.locked) this.canvas.focus();
      this.refreshUI();
    });
    document.addEventListener('pointerlockerror', () => this.enableFallback());
    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    document.addEventListener('mousemove', e => {
      if (this.locked && this.effective === 'desktop') this.emit({ type: 'look', dx: e.movementX, dy: e.movementY });
    });
    for (const id of ['game', 'look-stick', 'stick', 'primary']) {
      document.getElementById(id)!.addEventListener('pointerdown', e => this.down(e));
    }
    window.addEventListener('pointermove', e => this.pointerMove(e));
    window.addEventListener('pointerup', e => this.up(e, false));
    window.addEventListener('pointercancel', () => this.clear());
    document.addEventListener('lostpointercapture', e => { if (this.pointers.has((e as PointerEvent).pointerId)) this.up(e as PointerEvent, true); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    window.addEventListener('orientationchange', () => this.clear());
    document.getElementById('settings')!.addEventListener('toggle', () => { if ((document.getElementById('settings') as HTMLDetailsElement).open) this.clear(); });
    for (const query of ['(pointer: coarse)', '(hover: none)', '(any-pointer: coarse)']) {
      matchMedia(query).addEventListener('change', () => { if (this.preference === 'auto') this.requestMode(guessMode()); });
    }
    this.refreshUI();
  }

  get locked() { return document.pointerLockElement === this.canvas; }
  get active() { return !this.blocked && (this.effective === 'touch' || this.locked || this.fallback); }
  get busy() { return this.keys.size > 0 || this.pointers.size > 0; }
  get gestures() { return [...this.pointers.entries()].map(([id,p]) => ({id,role:p.role,cancelled:!!p.cancelled,neutral:{x:p.ox,y:p.oy}})); }
  setBlocked(blocked: boolean) { if (blocked !== this.blocked) { this.blocked = blocked; this.clear(); } }

  private requestMode(mode: InputMode) {
    this.pending = mode === this.effective ? null : mode;
    if (!this.busy) this.applyPending();
    this.refreshUI();
  }

  private applyPending() {
    if (!this.pending || this.busy) return;
    this.emit({ type: 'cancel' });
    this.effective = this.pending;
    this.pending = null;
    this.stickX = this.stickZ = 0;
    if (this.effective === 'touch') {
      this.fallback = false;
      if (this.locked) document.exitPointerLock();
    }
    this.refreshUI();
  }

  private intentional(mode: InputMode) {
    if (this.preference === 'auto' && mode !== this.effective) {
      this.cancelPrimary();
      this.requestMode(mode);
    }
  }

  private enter() {
    if (this.effective !== 'desktop' || this.locked) return;
    this.fallback = false;
    try { this.canvas.requestPointerLock()?.catch(() => this.enableFallback()); }
    catch { this.enableFallback(); }
  }

  private enableFallback() {
    if (this.effective !== 'desktop' || this.locked) return;
    this.fallback = true;
    this.refreshUI();
    this.canvas.focus();
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (e.code === 'Escape' && down) {
      this.clear();
      if (this.locked) document.exitPointerLock();
      this.fallback = false;
      this.refreshUI();
      return;
    }
    if (!gameKeys.has(e.code)) return;
    if (!this.locked && e.target instanceof HTMLElement && e.target.closest('select, input, button')) {
      if (!down) { this.keys.delete(e.code); this.applyPending(); }
      return;
    }
    if (down) this.intentional('desktop');
    if (this.effective !== 'desktop' || !this.active || this.pending) {
      if (!down) { this.keys.delete(e.code); this.applyPending(); }
      return;
    }
    e.preventDefault();
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    this.applyPending();
  }

  private down(e: PointerEvent) {
    // Only the canvas and dedicated controls own game pointers. HUD bubbling cannot start a gesture.
    if (e.target instanceof Element && e.target.closest('button,select,input,textarea,a,summary,dialog,#settings,#diagnostics,[data-input-ui]') && !(e.currentTarget as Element).matches('#primary')) return;
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touch) this.lastTouch = performance.now();
    else if (performance.now() - this.lastTouch < 800 || (e as PointerEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents) return;
    this.intentional(touch ? 'touch' : 'desktop');
    if (this.pending || this.effective !== (touch ? 'touch' : 'desktop')) return;
    const area = document.getElementById('game-root')!.getBoundingClientRect();
    if (this.blocked || this.effective === 'touch' && area.height >= area.width) return;
    const id = (e.currentTarget as HTMLElement).id;
    let role: Role;
    if (!touch) {
      if (!this.active) { this.pointers.set(e.pointerId, { role: 'entry', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY }); this.enter(); return; }
      role = e.button === 2 ? 'cancel' : this.fallback && (e.altKey || e.button === 1) ? 'look' : e.button === 0 ? 'primary' : 'entry';
    } else role = id === 'primary' ? 'primary' : this.touchLayout === 'zones'
      ? e.clientX < area.left + area.width / 2 ? 'stick' : 'look'
      : id === 'stick' ? 'stick' : id === 'look-stick' ? 'aimStick' : 'entry';
    if (role === 'stick' && [...this.pointers.values()].some(p => p.role === 'stick')) return;
    if (role === 'look' && [...this.pointers.values()].some(p => p.role === 'look')) return;
    if (role === 'aimStick' && [...this.pointers.values()].some(p => p.role === 'aimStick')) return;
    // Mouse buttons share a pointerId; a right-button chord cancels without replacing its owner.
    if (this.pointers.has(e.pointerId)) { if (role === 'cancel') this.cancelPrimary(); return; }
    const rect = this.lookStick.getBoundingClientRect();
    this.pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY, ox: role === 'aimStick' ? rect.left + rect.width / 2 : e.clientX, oy: role === 'aimStick' ? rect.top + rect.height / 2 : e.clientY, capture: e.currentTarget as HTMLElement });
    if (!this.locked) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (role === 'stick') {
      if (this.touchLayout === 'zones') this.placeFloatingStick(e);
      this.updateStick(e, this.pointers.get(e.pointerId)!);
    }
    if (role === 'aimStick') this.updateAimStick(e, this.pointers.get(e.pointerId)!);
    if (role === 'cancel') this.cancelPrimary();
    if (role === 'primary' && this.primaryOwner === null && ![...this.pointers.values()].some(p => p.role === 'cancel')) {
      clearTimeout(this.handoffTimer);document.body.classList.remove('handoff');
      this.primaryOwner = e.pointerId;
      this.emit({ type: 'primary', pressed: true });
    }
    if (touch) e.preventDefault();
  }

  private updateAimStick(e: PointerEvent, p: Finger) {
    const max = this.lookStick.getBoundingClientRect().width * .32;
    let x = e.clientX - p.ox, y = e.clientY - p.oy;
    const length = Math.max(max, Math.hypot(x, y));
    x *= max / length; y *= max / length;
    this.aimX = x / max; this.aimY = y / max;
    this.lookKnob.style.transform = `translate(${x}px,${y}px)`;
  }

  private handoff(e: PointerEvent, p: Finger) {
    this.cancelPrimary();
    for (const other of this.pointers.values()) if (other.role === 'aimStick' || other.role === 'look') other.role = 'entry';
    p.role = this.touchLayout === 'zones' ? 'look' : 'aimStick'; p.ox = e.clientX; p.oy = e.clientY;
    this.aimX = this.aimY = 0;
    this.lookKnob.style.transform = '';
    this.handoffs++;
    document.body.classList.add('handoff');
    clearTimeout(this.handoffTimer);
    this.handoffTimer=window.setTimeout(() => document.body.classList.remove('handoff'), 1100);
  }

  private placeFloatingStick(e: PointerEvent) {
    const bounds = document.getElementById('touch-bounds')!.getBoundingClientRect();
    const half = parseFloat(getComputedStyle(this.stick).width) / 2;
    const root = document.getElementById('game-root')!.getBoundingClientRect();
    const x = Math.max(bounds.left + half, Math.min(root.left + root.width / 2 - half, e.clientX));
    const y = Math.max(bounds.top + half, Math.min(bounds.bottom - half, e.clientY));
    this.stick.style.left = `${x - root.left - half}px`;
    this.stick.style.top = `${y - root.top - half}px`;
    document.body.classList.add('moving-stick');
  }

  private updateStick(e: PointerEvent, p: Finger) {
    const r = this.stick.getBoundingClientRect();
    let x = e.clientX - (this.touchLayout === 'zones' ? p.ox : r.left + r.width / 2), z = e.clientY - (this.touchLayout === 'zones' ? p.oy : r.top + r.height / 2);
    const max = r.width * .32, length = Math.max(max, Math.hypot(x, z));
    x *= max / length; z *= max / length;
    this.stickX = x / max; this.stickZ = -z / max;
    this.knob.style.transform = `translate(${x}px,${z}px)`;
  }

  private pointerMove(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (p.role === 'stick') this.updateStick(e, p);
    if (p.role === 'aimStick') this.updateAimStick(e, p);
    if (p.role === 'look' && !this.locked) this.emit({ type: 'look', dx: (e.clientX - p.x) * (e.pointerType === 'mouse' ? 1 : this.sensitivity), dy: (e.clientY - p.y) * (e.pointerType === 'mouse' ? 1 : this.sensitivity) });
    if (p.role === 'primary' && e.pointerType !== 'mouse') {
      const r = (this.touchLayout === 'zones' ? document.getElementById('cancel-zone')! : this.lookStick).getBoundingClientRect();
      const pad = this.touchLayout === 'zones' ? 0 : 16;
      if (e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - 2 && e.clientY <= r.bottom + pad) this.handoff(e, p);
      else this.emit({ type: 'look', dx: (e.clientX - p.x) * this.sensitivity, dy: (e.clientY - p.y) * this.sensitivity });
    }
    // A mouse button chord can emit pointermove instead of another pointerdown.
    if (e.pointerType === 'mouse' && (e.buttons & 2)) this.cancelPrimary();
    p.x = e.clientX; p.y = e.clientY;
  }

  private up(e: PointerEvent, cancelled: boolean) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (p.role === 'primary' && this.primaryOwner === e.pointerId) {
      if (cancelled || p.cancelled || this.pending) this.emit({ type: 'cancel' });
      else this.emit({ type: 'primary', pressed: false });
      this.primaryOwner = null;
    }
    if (p.role === 'stick') { this.stickX = this.stickZ = 0; this.knob.style.transform = ''; document.body.classList.remove('moving-stick'); }
    if (p.role === 'aimStick') { this.aimX = this.aimY = 0; this.lookKnob.style.transform = ''; }
    this.pointers.delete(e.pointerId);
    this.applyPending();
  }

  private cancelPrimary() {
    this.emit({ type: 'cancel' });
    for (const p of this.pointers.values()) if (p.role === 'primary') p.cancelled = true;
    this.primaryOwner = null;
  }

  clear() {
    this.cancelPrimary();
    const captured = [...this.pointers.entries()];
    this.keys.clear(); this.pointers.clear(); this.stickX = this.stickZ = this.aimX = this.aimY = 0;
    for (const [id,p] of captured) if (p.capture?.hasPointerCapture(id)) p.capture.releasePointerCapture(id);
    this.knob.style.transform = this.lookKnob.style.transform = '';
    document.body.classList.remove('moving-stick');
    this.emit({ type: 'move', x: 0, z: 0 });
    this.applyPending();
  }

  update(dt = 0) {
    let x = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) + this.stickX;
    let z = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) + this.stickZ;
    if (!this.active) x = z = 0;
    const length = Math.max(1, Math.hypot(x, z));
    this.emit({ type: 'move', x: x / length, z: z / length });
    const magnitude = Math.hypot(this.aimX, this.aimY);
    if (this.active && magnitude > .12) {
      const t = Math.min(1, (magnitude - .12) / .88);
      const rate = t * t * (3 - 2 * t) * this.sensitivity;
      this.emit({ type: 'look', dx: this.aimX / magnitude * rate * 630 * dt, dy: this.aimY / magnitude * rate * 470 * dt });
    }
  }

  private refreshUI() {
    document.body.classList.toggle('touch', this.effective === 'touch');
    document.body.classList.toggle('touch-zones', this.touchLayout === 'zones');
    if (this.touchLayout === 'joysticks') { this.stick.style.left = ''; this.stick.style.top = ''; }
    if (this.effective === 'touch' && this.touchLayout === 'zones') {
      let seen = false; try { seen = localStorage.getItem('titans.zones-tip') === 'seen'; } catch { /* Storage optional. */ }
      const tip = document.getElementById('zones-tip')!;
      if (!seen && !tip.dataset.shown) {
        tip.dataset.shown = 'true'; tip.hidden = false;
        try { localStorage.setItem('titans.zones-tip', 'seen'); } catch { /* Storage optional. */ }
        window.setTimeout(() => { tip.hidden = true; }, 4500);
      }
    } else document.getElementById('zones-tip')!.hidden = true;
    document.body.classList.toggle('fallback', this.effective === 'desktop' && this.fallback && !this.locked);
    this.capture.hidden = this.effective === 'touch' || this.locked;
    this.fallbackButton.hidden = this.effective === 'touch' || this.locked || this.fallback;
    this.capture.textContent = this.fallback ? 'Включить захват мыши' : 'Нажми, чтобы играть. WASD — движение, мышь — обзор, Esc — курсор';
    this.hint.textContent = this.pending ? 'Смена ввода после отпускания управления' : this.effective === 'touch'
      ? 'Левый — ход · правый — обзор · кнопка — бросок'
      : this.locked ? 'WASD · мышь — обзор · ЛКМ — действие · ПКМ — отмена · Esc — курсор'
      : this.fallback ? 'WASD · Alt + перетаскивание — обзор · ЛКМ — действие · ПКМ — отмена'
      : 'Нажмите вход для управления мышью';
    document.getElementById('mode-status')!.textContent = `${this.preference === 'auto' ? 'Авто: ' : ''}${this.effective === 'touch' ? 'касания' : 'мышь и клавиатура'}`;
  }
}
