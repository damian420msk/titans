// Training checklist: pure bookkeeping (no DOM, no Babylon), so it can be tested. The game loop feeds it the battle events of each frame.
// Tasks can be done in any order; progress is stored by the caller so the player can leave and come back.
import type { GameEvent } from '../../shared/battle.ts';

export type StepId = 'move' | 'throw' | 'hit' | 'heavy' | 'refill' | 'jump' | 'repair';
export type Step = { id: StepId; text: string; pc: string; touch: string };
export const STEPS: Step[] = [
  { id: 'move', text: 'Пройдись по острову', pc: 'Клавиши W A S D или стрелки', touch: 'Веди левым пальцем: джойстик появится под ним' },
  { id: 'throw', text: 'Брось камень во вражеский остров', pc: 'Зажми левую кнопку мыши на острове врага и отпусти', touch: 'Нажми правой половиной экрана, сдвинь прицел на остров врага и отпусти' },
  { id: 'hit', text: 'Разбей плиту врага', pc: 'Бей в одну плиту: сначала трещина, потом дыра', touch: 'Бей в одну плиту: сначала трещина, потом дыра' },
  { id: 'heavy', text: 'Сделай мощный бросок', pc: 'Держи кнопку дольше 2,5 секунды, пока полоска не станет фиолетовой', touch: 'Держи палец дольше 2,5 секунды, пока полоска не станет фиолетовой' },
  { id: 'refill', text: 'Возьми камни у кучи', pc: 'Подойди к куче камней в углу своего острова', touch: 'Подойди к куче камней в углу своего острова' },
  { id: 'jump', text: 'Прыгни', pc: 'Пробел. Бег: держи Shift', touch: 'Кнопка ⤒. Бег: тяни джойстик за край круга' },
  { id: 'repair', text: 'Почини треснувшую плиту', pc: 'Встань рядом с трещиной и держи E', touch: 'Встань рядом с трещиной и держи кнопку РЕМОНТ' },
];
export const MOVE_GOAL_M = 2.5;
/** Seconds without progress before the hint for the next task appears. */
export const NUDGE_S = 12;

export class Training {
  done = new Set<StepId>();
  private idle = 0; private x0: number; private z0: number;
  constructor(done: Iterable<StepId>, start: { x: number; z: number }) { for (const d of done) if (STEPS.some(s => s.id === d)) this.done.add(d); this.x0 = start.x; this.z0 = start.z; }
  get complete() { return this.done.size === STEPS.length; }
  get current(): Step | undefined { return STEPS.find(s => !this.done.has(s.id)); }
  /** True when the player has been stuck for a while: the caller shows the hint of `current`. */
  get nudge() { return this.idle >= NUDGE_S && !this.complete; }
  /** Feed one frame. Returns the tasks completed by it. */
  update(dt: number, events: readonly GameEvent[], me: { x: number; z: number }): StepId[] {
    const got: StepId[] = [], mark = (id: StepId) => { if (!this.done.has(id)) { this.done.add(id); got.push(id); } };
    if (Math.hypot(me.x - this.x0, me.z - this.z0) >= MOVE_GOAL_M) mark('move');
    for (const e of events) {
      if (e.type === 'throw' && e.side === 0) { mark('throw'); if (e.kind === 'heavy') mark('heavy'); }
      else if (e.type === 'impact' && e.side === 1 && e.hpAfter < e.hpBefore) mark('hit');
      else if (e.type === 'refill' && e.side === 0) mark('refill');
      else if (e.type === 'jump' && e.side === 0) mark('jump');
      else if (e.type === 'repaired' && e.side === 0) mark('repair');
    }
    this.idle = got.length ? 0 : this.idle + dt;
    return got;
  }
}
