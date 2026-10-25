// Island defender / training opponent. Uses only the public Battle intents, like a player would.
import { rules, cellCentre, cellAt, type Cell, type Side } from './world.ts';
import { Battle, cellKey, sideOther, RESPAWN_CELL, type Kind } from './battle.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';
type Profile = { think: number; aimError: number; onTarget: number; heavy: number; spin: number; dodge: number; repair: number; fireGap: number; speed: number };
const PROFILES: Record<Difficulty, Profile> = {
  easy:   { think: 1.1, aimError: 3.4, onTarget: .18, heavy: 0,   spin: .03, dodge: .04, repair: .10, fireGap: 4.6, speed: .45 },
  normal: { think: .5,  aimError: 1.5, onTarget: .55, heavy: .08, spin: .20, dodge: .40, repair: .50, fireGap: 2.0, speed: .8 },
  hard:   { think: .3,  aimError: .7,  onTarget: .80, heavy: .20, spin: .30, dodge: .75, repair: .80, fireGap: 1.2, speed: 1 },
};
export const mulberry32 = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

export class Bot {
  private p: Profile;
  private timer = 0;
  private goal: Cell | null = null;
  private sinceFire = 99;
  private holdFor = 0;
  private plan: { target: Cell; hold: number } | null = null;
  private battle: Battle; readonly side: Side; private rnd: () => number;
  constructor(battle: Battle, side: Side = 1, level: Difficulty = 'normal', rnd: () => number = mulberry32(7)) { this.battle = battle; this.side = side; this.rnd = rnd; this.p = PROFILES[level]; }

  update(dt: number) {
    const b = this.battle, me = b.actors[this.side];
    if (b.phase !== 'playing' || me.falling) { b.setMove(this.side, 0, 0); this.plan = null; this.goal = null; return; }
    this.timer -= dt; this.sinceFire += dt;
    if (this.plan && b.charges[this.side]) {
      const ch = b.charges[this.side]!;
      if (ch.t >= this.plan.hold) { b.setTarget(this.side, this.plan.target); b.releaseCharge(this.side); this.plan = null; }
    } else if (this.plan && !b.charges[this.side]) this.plan = null;
    if (this.timer <= 0) { this.timer = this.p.think * (.7 + this.rnd() * .6); this.think(); }
    this.walk();
  }

  private think() {
    const b = this.battle, s = this.side, me = b.actors[s];
    if (!b.canAct(s)) return;
    // 1. dodge: leave a cell that an incoming shot is about to hit
    const danger = this.dangerCells();
    const here = b.cellOf(s);
    if (here && danger.has(cellKey(here)) && this.rnd() < this.p.dodge) { this.goal = this.safeCell(danger); this.cancelWork(); return; }
    if (this.goal && here && cellKey(this.goal) === cellKey(here)) this.goal = null;
    if (b.charges[s] || this.plan) return;
    // 2. out of stones: go to the arsenal
    if (me.stones === 0) { if (!b.nearArsenal(s)) this.goal = { ...RESPAWN_CELL }; return; }
    // 3. repair a damaged neighbour if safe
    if (me.stones >= 2 && b.canRepair(s) && this.rnd() < this.p.repair * .5 && !b.repairs[s]) { this.goal = null; b.setMove(s, 0, 0); b.beginRepair(s); return; }
    if (b.repairs[s]) return;
    // 4. attack
    if (me.cooldown > 0 || me.stones < 1 || this.sinceFire < this.p.fireGap) return;
    const target = this.pickTarget();
    if (!target || !b.beginCharge(s)) return;
    const r = this.rnd(), kind: Kind = r < this.p.heavy ? 'heavy' : r < this.p.heavy + this.p.spin ? 'spin' : 'normal';
    const hold = kind === 'heavy' ? rules.shot.types.heavy.hold_from_s + .1 : kind === 'spin' ? rules.shot.types.spin.hold_from_s + .1 : .2;
    this.plan = { target, hold }; this.sinceFire = 0;
    b.setTarget(s, target);
    // a little repositioning while charging keeps the bot alive but unpredictable
    if (this.rnd() < .4) this.goal = this.safeCell(danger);
  }

  private cancelWork() { this.plan = null; this.battle.cancelCharge(this.side); this.battle.cancelRepair(this.side); }

  private dangerCells() {
    const set = new Set<string>(), enemy = sideOther(this.side);
    for (const sh of this.battle.shots) if (sh.owner === enemy) for (const c of sh.cells) set.add(cellKey(c));
    return set;
  }

  private safeCell(danger: Set<string>): Cell | null {
    const b = this.battle, here = b.cellOf(this.side); if (!here) return null;
    const options: Cell[] = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const c = { x: here.x + dx, z: here.z + dz };
      if (c.x < 0 || c.z < 0 || c.x >= rules.arena.width_cells || c.z >= rules.arena.depth_cells) continue;
      if (b.hp(c, this.side) < 1 || danger.has(cellKey(c)) || (c.x === rules.arena.arsenal_cell[0] && c.z === rules.arena.arsenal_cell[1])) continue;
      if (b.hp(c, this.side) === 1 && this.rnd() < .7) continue;
      options.push(c);
    }
    return options.length ? options[Math.floor(this.rnd() * options.length)] : null;
  }

  private pickTarget(): Cell | null {
    const b = this.battle, enemy = sideOther(this.side), foe = b.actors[enemy];
    const fc = cellAt(foe.pos, enemy);
    const jitter = () => Math.round((this.rnd() - .5) * 2 * this.p.aimError * (this.rnd() < .5 ? 1 : .5));
    let c: Cell;
    if (fc && this.rnd() < this.p.onTarget) c = { x: fc.x + jitter(), z: fc.z + jitter() };
    else c = { x: Math.floor(this.rnd() * rules.arena.width_cells), z: 4 + Math.floor(this.rnd() * (rules.arena.depth_cells - 4)) };
    c.x = Math.max(0, Math.min(rules.arena.width_cells - 1, c.x)); c.z = Math.max(0, Math.min(rules.arena.depth_cells - 1, c.z));
    if (b.hp(c, enemy) === 0) {
      // do not waste stones on holes: pick a standing cell next to the foe instead
      const alt: Cell[] = [];
      for (const q of b.floors[enemy].keys()) { const [x, z] = q.split(',').map(Number); if (b.hp({ x, z }, enemy) > 0 && Number.isFinite(b.hp({ x, z }, enemy))) alt.push({ x, z }); }
      return alt.length ? alt[Math.floor(this.rnd() * alt.length)] : null;
    }
    return Number.isFinite(b.hp(c, enemy)) ? c : fc;
  }

  /** Greedy walk to the goal over cells that still hold. */
  private walk() {
    const b = this.battle, s = this.side;
    if (!this.goal || !b.canAct(s) || b.repairs[s]) { b.setMove(s, 0, 0); return; }
    const here = b.cellOf(s); if (!here) return;
    const next = this.nextStep(here, this.goal);
    if (!next) { this.goal = null; b.setMove(s, 0, 0); return; }
    const t = cellCentre(next, s), p = b.actors[s].pos, dx = t.x - p.x, dz = t.z - p.z, l = Math.hypot(dx, dz);
    const v = l < .05 ? 0 : this.p.speed; b.setMove(s, v ? dx / l * v : 0, v ? dz / l * v : 0);
  }

  private nextStep(from: Cell, goal: Cell): Cell | null {
    const b = this.battle, s = this.side, key = cellKey, prev = new Map<string, Cell | null>([[key(from), null]]), q: Cell[] = [from];
    const ok = (c: Cell) => c.x >= 0 && c.z >= 0 && c.x < rules.arena.width_cells && c.z < rules.arena.depth_cells && b.hp(c, s) > 0 && !(c.x === rules.arena.arsenal_cell[0] && c.z === rules.arena.arsenal_cell[1]);
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (key(c) === key(goal)) { let cur = c, parent = prev.get(key(cur)); while (parent && key(parent) !== key(from)) { cur = parent; parent = prev.get(key(cur)); } return key(c) === key(from) ? null : cur; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = { x: c.x + dx, z: c.z + dz }; if (ok(n) && !prev.has(key(n)) && !(b.hp(n, s) === 1 && key(n) !== key(goal))) { prev.set(key(n), c); q.push(n); } }
    }
    return null;
  }
}
