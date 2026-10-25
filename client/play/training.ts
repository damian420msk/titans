// Training checklist: pure bookkeeping (no DOM, no Babylon), so it can be tested. The game loop feeds it the battle events of each frame.
// Tasks go top to bottom: only the current task counts. Progress is stored by the caller so the player can leave and come back.
import type { GameEvent } from '../../shared/battle.ts';

export type StepId = 'move' | 'throw' | 'hit' | 'heavy' | 'refill' | 'jump' | 'repair';
export type Step = { id: StepId; text: string; pc: string; touch: string };
export const STEPS: Step[] = [
  { id: 'move', text: 'Пройдись во все стороны', pc: 'Клавиши W A S D: вперёд, влево, назад, вправо. Нужно пройти пару шагов в каждую сторону', touch: 'Веди левым пальцем: джойстик появится под ним. Нужно пройти пару шагов в каждую сторону' },
  { id: 'throw', text: 'Брось камень во вражеский остров', pc: 'Зажми левую кнопку мыши на острове врага и отпусти', touch: 'Нажми правой половиной экрана, сдвинь прицел на остров врага и отпусти' },
  { id: 'hit', text: 'Разбей плиту врага', pc: 'Бей в одну плиту: сначала трещина, потом дыра', touch: 'Бей в одну плиту: сначала трещина, потом дыра' },
  { id: 'heavy', text: 'Сделай мощный бросок', pc: 'Держи кнопку дольше 2,5 секунды, пока полоска не станет фиолетовой', touch: 'Держи палец дольше 2,5 секунды, пока полоска не станет фиолетовой' },
  { id: 'refill', text: 'Возьми камни у кучи', pc: 'Подойди к куче камней в углу своего острова', touch: 'Подойди к куче камней в углу своего острова' },
  { id: 'jump', text: 'Прыгни', pc: 'Пробел. Бег: держи Shift', touch: 'Кнопка ⤒. Бег: тяни джойстик за край круга' },
  { id: 'repair', text: 'Почини треснувшую плиту', pc: 'Встань рядом с трещиной и держи E', touch: 'Встань рядом с трещиной и держи кнопку РЕМОНТ' },
];
export type Dir = 'up' | 'left' | 'down' | 'right';
export const DIRS: Dir[] = ['up', 'left', 'down', 'right'];
/** Metres to walk in each direction (W, A, S, D) before the walking task is done: about two steps. */
export const DIR_GOAL_M = 1.2;
/** Seconds without progress before the hint for the next task appears. */
export const NUDGE_S = 12;

const matches = (id: StepId, e: GameEvent): boolean => {
  switch (id) {
    case 'throw': return e.type === 'throw' && e.side === 0;
    case 'heavy': return e.type === 'throw' && e.side === 0 && e.kind === 'heavy';
    case 'hit': return e.type === 'impact' && e.side === 1 && e.hpAfter < e.hpBefore;
    case 'refill': return e.type === 'refill' && e.side === 0;
    case 'jump': return e.type === 'jump' && e.side === 0;
    case 'repair': return e.type === 'repaired' && e.side === 0;
    default: return false;
  }
};

export class Training {
  done = new Set<StepId>();
  /** Directions walked far enough so far (only counted while the walking task is the current one). */
  dirs = new Set<Dir>();
  private idle = 0; private last: { x: number; z: number } | null; private acc: Record<Dir, number> = { up: 0, left: 0, down: 0, right: 0 };
  constructor(done: Iterable<StepId>, start: { x: number; z: number }) {
    const saved = new Set(done); for (const s of STEPS) { if (!saved.has(s.id)) break; this.done.add(s.id); } // only a prefix counts: tasks go in order
    if (this.done.has('move')) DIRS.forEach(d => this.dirs.add(d));
    this.last = { x: start.x, z: start.z };
  }
  get complete() { return this.done.size === STEPS.length; }
  get current(): Step | undefined { return STEPS.find(s => !this.done.has(s.id)); }
  /** True when the player has been stuck for a while: the caller shows the hint of `current`. */
  get nudge() { return this.idle >= NUDGE_S && !this.complete; }
  /** Feed one frame. Returns the tasks completed by it, in order. */
  update(dt: number, events: readonly GameEvent[], me: { x: number; z: number }): StepId[] {
    const got: StepId[] = [], mark = (id: StepId) => { this.done.add(id); got.push(id); };
    const prev = this.last, dx = prev ? me.x - prev.x : 0, dz = prev ? me.z - prev.z : 0; this.last = { x: me.x, z: me.z };
    let before = this.dirs.size;
    if (this.current?.id === 'move' && Math.hypot(dx, dz) < 1) { // a jump of a metre in one frame is a knock-back or a respawn, not walking
      // side 0 looks along +z; +x is the right hand of the screen
      if (dz > 0) this.acc.up += dz; else this.acc.down -= dz; if (dx > 0) this.acc.right += dx; else this.acc.left -= dx;
      for (const d of DIRS) if (this.acc[d] >= DIR_GOAL_M) this.dirs.add(d);
      if (this.dirs.size === DIRS.length) mark('move');
    }
    for (const e of events) { const c = this.current; if (c && matches(c.id, e)) mark(c.id); }
    this.idle = got.length || this.dirs.size > before ? 0 : this.idle + dt;
    return got;
  }
}
