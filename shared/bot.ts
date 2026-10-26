// Island defender / training opponent. Uses only the public Battle intents, like a player would.
import { rules, cellCentre, cellAt, type Cell, type Side } from './world.ts';
import { Battle, cellKey, sideOther, RESPAWN_CELL, type Kind } from './battle.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';
/** think: seconds between decisions; aimError: cells of aim noise; onTarget: share of throws aimed at the foe; heavy/spin: throw mix; dodge: chance to walk out of a hit;
 *  repair; fireGap: seconds between throws; speed: share of full walk speed; sprint: chance to run to a far goal; hop: chance to jump a shot that is about to land on it;
 *  lead: how much of the foe's walk during the flight the aim adds; roam: chance to reposition when there is nothing else to do. */
type Profile = { think: number; aimError: number; onTarget: number; heavy: number; spin: number; dodge: number; repair: number; fireGap: number; speed: number; sprint: number; hop: number; lead: number; roam: number };
const PROFILES: Record<Difficulty, Profile> = {
  easy:   { think: 1.1, aimError: 3.4, onTarget: .18, heavy: 0,   spin: .03, dodge: .04, repair: .10, fireGap: 4.6, speed: .45, sprint: 0,   hop: 0,   lead: 0,   roam: .08 },
  normal: { think: .5,  aimError: 1.5, onTarget: .55, heavy: .08, spin: .20, dodge: .40, repair: .50, fireGap: 2.0, speed: .8,  sprint: .35, hop: .25, lead: .5,  roam: .25 },
  hard:   { think: .3,  aimError: .7,  onTarget: .80, heavy: .20, spin: .30, dodge: .75, repair: .80, fireGap: 1.2, speed: 1,   sprint: .7,  hop: .55, lead: .85, roam: .35 },
};
/** Skill 0..1 on the easy → normal → hard line (0.5 = normal). */
export const SKILL: Record<Difficulty, number> = { easy: 0, normal: .5, hard: 1 };
/** A profile anywhere on the easy → normal → hard line: lets the quick-match bot fit the player instead of jumping between three levels. */
export function profileFor(skill: number): Profile {
  const s = Math.max(0, Math.min(1, Number.isFinite(skill) ? skill : .5)), [a, b, k] = s < .5 ? [PROFILES.easy, PROFILES.normal, s / .5] : [PROFILES.normal, PROFILES.hard, (s - .5) / .5];
  const out = {} as Profile; for (const key of Object.keys(a) as (keyof Profile)[]) out[key] = a[key] + (b[key] - a[key]) * k; return out;
}
export const mulberry32 = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

export class Bot {
  private p: Profile;
  private timer = 0;
  private goal: Cell | null = null;
  private run = false;
  private sinceFire = 99;
  private plan: { target: Cell; hold: number } | null = null;
  /** shots already judged for a jump-dodge (one roll per shot) */
  private judged = new Set<number>();
  private battle: Battle; readonly side: Side; private rnd: () => number;
  constructor(battle: Battle, side: Side = 1, level: Difficulty | number = 'normal', rnd: () => number = mulberry32(7)) {
    this.battle = battle; this.side = side; this.rnd = rnd; this.p = typeof level === 'number' ? profileFor(level) : PROFILES[level];
  }

  update(dt: number) {
    const b = this.battle, me = b.actors[this.side];
    if (b.phase !== 'playing' || me.falling) { b.setMove(this.side, 0, 0); b.setSprint(this.side, false); this.plan = null; this.goal = null; return; }
    this.timer -= dt; this.sinceFire += dt;
    this.hop();
    if (this.plan && b.charges[this.side]) {
      const ch = b.charges[this.side]!;
      if (ch.t >= this.plan.hold) { b.setTarget(this.side, this.plan.target); b.releaseCharge(this.side); this.plan = null; }
    } else if (this.plan && !b.charges[this.side]) this.plan = null;
    if (this.timer <= 0) { this.timer = this.p.think * (.7 + this.rnd() * .6); this.think(); }
    this.walk();
  }

  /** Jump a shot that is about to land on the bot's cell: in the air the hit misses (one roll per shot, stamina permitting). */
  private hop() {
    const b = this.battle, s = this.side, here = b.cellOf(s); if (!here || this.p.hop <= 0 || b.charges[s]) return;
    for (const sh of b.shots) {
      if (sh.owner === s || this.judged.has(sh.id)) continue;
      const left = rules.shot.flight_duration_s - sh.elapsed;
      if (left > .42 || left < .1 || !sh.cells.some(c => cellKey(c) === cellKey(here))) continue;
      this.judged.add(sh.id);
      if (this.rnd() < this.p.hop) { b.cancelRepair(s); b.jump(s); }
    }
    if (this.judged.size > 64) this.judged.clear();
  }

  private think() {
    const b = this.battle, s = this.side, me = b.actors[s];
    if (!b.canAct(s)) return;
    // 1. dodge: leave a cell that an incoming shot is about to hit
    const danger = this.dangerCells();
    const here = b.cellOf(s);
    if (here && danger.has(cellKey(here)) && this.rnd() < this.p.dodge) { this.setGoal(this.safeCell(danger), true); this.cancelWork(); return; }
    if (this.goal && here && cellKey(this.goal) === cellKey(here)) this.goal = null;
    if (b.charges[s] || this.plan) return;
    // 2. out of stones: go to the arsenal
    if (me.stones === 0) { if (!b.nearArsenal(s)) this.setGoal({ ...RESPAWN_CELL }, false); return; }
    // 3. repair a damaged neighbour if safe
    if (me.stones >= 2 && b.canRepair(s) && this.rnd() < this.p.repair * .5 && !b.repairs[s]) { this.goal = null; b.setMove(s, 0, 0); b.beginRepair(s); return; }
    if (b.repairs[s]) return;
    // 4. attack
    if (me.cooldown > 0 || me.stones < 1 || this.sinceFire < this.p.fireGap) { if (!this.goal && this.rnd() < this.p.roam * this.p.think) this.setGoal(this.safeCell(danger), false); return; }
    const target = this.pickTarget();
    if (!target || !b.beginCharge(s)) return;
    const r = this.rnd(), kind: Kind = r < this.p.heavy ? 'heavy' : r < this.p.heavy + this.p.spin ? 'spin' : 'normal';
    const hold = kind === 'heavy' ? rules.shot.types.heavy.hold_from_s + .1 : kind === 'spin' ? rules.shot.types.spin.hold_from_s + .1 : .2;
    this.plan = { target, hold }; this.sinceFire = 0;
    b.setTarget(s, target);
    // a little repositioning while charging keeps the bot alive but unpredictable
    if (this.rnd() < .4) this.setGoal(this.safeCell(danger), false);
  }

  /** A goal far away (or an urgent one) may be run to: stronger bots sprint more. */
  private setGoal(c: Cell | null, urgent: boolean) {
    this.goal = c; const here = this.battle.cellOf(this.side);
    const far = !!c && !!here && Math.abs(c.x - here.x) + Math.abs(c.z - here.z) >= (urgent ? 1 : 3);
    this.run = far && this.rnd() < this.p.sprint;
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

  /** Where the foe will stand when a stone thrown now lands: its position plus `lead` of its walk during the flight. */
  private foeCell(): Cell | null {
    const b = this.battle, enemy = sideOther(this.side), foe = b.actors[enemy], m = b.input[enemy];
    if (this.p.lead <= 0 || foe.falling || foe.stun > 0) return cellAt(foe.pos, enemy);
    const k = b.speed(enemy) * rules.shot.flight_duration_s * this.p.lead;
    return cellAt({ x: foe.pos.x + m.x * k, z: foe.pos.z + m.z * k }, enemy) ?? cellAt(foe.pos, enemy);
  }

  private pickTarget(): Cell | null {
    const b = this.battle, enemy = sideOther(this.side);
    const fc = this.foeCell();
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
    if (!this.goal || !b.canAct(s) || b.repairs[s]) { b.setMove(s, 0, 0); b.setSprint(s, false); return; }
    const here = b.cellOf(s); if (!here) return;
    const next = this.nextStep(here, this.goal);
    if (!next) { this.goal = null; b.setMove(s, 0, 0); b.setSprint(s, false); return; }
    const t = cellCentre(next, s), p = b.actors[s].pos, dx = t.x - p.x, dz = t.z - p.z, l = Math.hypot(dx, dz);
    const v = l < .05 ? 0 : this.p.speed; b.setMove(s, v ? dx / l * v : 0, v ? dz / l * v : 0);
    b.setSprint(s, this.run && !b.charges[s]);
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
