// Core duel rules. Pure TypeScript, no Babylon/DOM: the same code can run on the client (training, raids vs bot) and later on a server.
import { rules, map, size, cellCentre, cellAt, move, type Cell, type Point, type Side } from './world.ts';

export type Kind = 'normal' | 'spin' | 'heavy';
export type Shot = { id: number; owner: Side; kind: Kind; cells: Cell[]; start: Point; elapsed: number };
export type Actor = {
  pos: Point; y: number; vy: number; falling: boolean;
  lives: number; stones: number; cooldown: number; stun: number; slide: { dx: number; dz: number; t: number } | null;
  /** jump: seconds left in the air (0 = on the ground) and the cooldown after landing; sprint: stamina in seconds of running left, 'winded' blocks sprint until it recovers */
  air: number; jumpCd: number; stamina: number; winded: boolean; sprintWait: number; running: boolean;
};
export type Charge = { t: number; target: Cell | null };
export type Repair = { cell: Cell; t: number; need: number };
export type GameEvent =
  | { type: 'throw'; side: Side; kind: Kind }
  | { type: 'jump'; side: Side }
  | { type: 'land'; side: Side }
  | { type: 'dodge'; side: Side }
  | { type: 'impact'; side: Side; cell: Cell; kind: Kind; hpBefore: number; hpAfter: number }
  | { type: 'hit'; side: Side; kind: Kind }
  | { type: 'fall'; side: Side }
  | { type: 'respawn'; side: Side }
  | { type: 'repaired'; side: Side; cell: Cell }
  | { type: 'refill'; side: Side }
  | { type: 'over'; winner: Side | null };

export const sideOther = (s: Side): Side => s === 0 ? 1 : 0;
export const cellKey = (c: Cell) => `${c.x},${c.z}`;
export const KINDS = rules.shot.types;
export const MATCH_SECONDS = 180;
export const LIVES = 3;
export const RESPAWN_CELL: Cell = { x: 4, z: 0 };
const START_CELL: Cell = { x: rules.arena.spawn_cell[0], z: rules.arena.spawn_cell[1] };
const SPRINT = rules.character.sprint, JUMP = rules.character.jump;
const GRAVITY = 18, FALL_DEPTH = -12, SLIDE_S = .25;
const valid = (c: Cell | null): c is Cell => !!c && Number.isInteger(c.x) && Number.isInteger(c.z) && c.x >= 0 && c.x < rules.arena.width_cells && c.z >= 0 && c.z < rules.arena.depth_cells;

const KIND_RANK: Record<Kind, number> = { normal: 0, spin: 1, heavy: 2 };
export const HOLD_SLACK_S = .25;
/** Which throw a hold of `t` seconds produces. */
export function kindForHold(t: number): Kind {
  return t >= KINDS.heavy.hold_from_s ? 'heavy' : t >= KINDS.spin.hold_from_s ? 'spin' : 'normal';
}
/** Cells hit by a throw: the target plus its x+1 neighbour (x-1 at the right edge) for spin and heavy. */
export function cellsFor(kind: Kind, target: Cell): Cell[] {
  if (kind === 'normal') return [{ ...target }];
  const x2 = target.x + 1 < rules.arena.width_cells ? target.x + 1 : target.x - 1;
  return [{ ...target }, { x: x2, z: target.z }];
}

/** Per-player tuning that upgrades change. Everything else comes from rules_v01.json. */
export type Mods = { capacity: number; cooldown: number; refill: number; walk: number; tileHp: number; repair: number; stam: number; thrift: number };
export const DEFAULT_MODS: Mods = { capacity: rules.inventory.capacity, cooldown: rules.shot.min_release_interval_s, refill: rules.interaction.refill_per_stone_s, walk: 1, tileHp: rules.arena.start_normal_cell_hp, repair: 1, stam: 1, thrift: 1 };
export const makeMods = (m?: Partial<Mods>): Mods => ({ ...DEFAULT_MODS, ...m });

export class Battle {
  mods: [Mods, Mods] = [makeMods(), makeMods()];
  actors: [Actor, Actor] = [this.newActor(0), this.newActor(1)];
  floors: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];
  input: [Point, Point] = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  /** sprint intent (held button); whether the titan really runs is decided in `step` */
  sprint: [boolean, boolean] = [false, false];
  charges: [Charge | null, Charge | null] = [null, null];
  repairs: [Repair | null, Repair | null] = [null, null];
  refills: [number, number] = [0, 0];
  shots: Shot[] = [];
  events: GameEvent[] = [];
  time = 0;
  phase: 'playing' | 'over' = 'playing';
  winner: Side | null = null;
  private shotId = 0;

  constructor(mods?: [Partial<Mods>?, Partial<Mods>?]) {
    if (mods) this.mods = [makeMods(mods[0]), makeMods(mods[1])];
    this.actors = [this.newActor(0), this.newActor(1)]; this.resetFloors();
  }

  private newActor(side: Side, at: Cell = START_CELL): Actor {
    return { pos: cellCentre(at, side), y: 0, vy: 0, falling: false, lives: LIVES, stones: this.mods[side].capacity, cooldown: 0, stun: 0, slide: null, air: 0, jumpCd: 0, stamina: SPRINT.stamina_s * this.mods[side].stam, winded: false, sprintWait: 0, running: false };
  }
  private resetFloors() {
    for (const side of [0, 1] as Side[]) {
      this.floors[side].clear();
      for (const c of map.cells) this.floors[side].set(cellKey(c), c.destructible ? this.mods[side].tileHp : Infinity);
    }
  }

  hp(c: Cell, side: Side) { return this.floors[side].get(cellKey(c)) ?? 0; }
  supported(p: Point, side: Side) { const c = cellAt(p, side); return c !== null && this.hp(c, side) > 0; }
  cellOf(side: Side) { return cellAt(this.actors[side].pos, side); }
  speed(side: Side) { return (this.charges[side] ? rules.character.charge_speed_mps : rules.character.walk_speed_mps) * this.mods[side].walk * (this.actors[side].running ? SPRINT.speed_mult : 1) * (this.actors[side].air > 0 ? JUMP.air_speed_mult : 1); }
  canAct(side: Side) { const a = this.actors[side]; return this.phase === 'playing' && !a.falling && a.stun <= 0; }

  nearArsenal(side: Side) {
    const p = this.actors[side].pos, c = cellCentre({ x: rules.arena.arsenal_cell[0], z: rules.arena.arsenal_cell[1] }, side);
    const d = Math.hypot(Math.max(0, Math.abs(p.x - c.x) - size / 2), Math.max(0, Math.abs(p.z - c.z) - size / 2));
    return d <= rules.interaction.arsenal_range_m;
  }

  /** Damaged orthogonal neighbours (or the own cell) that the titan could repair, nearest first. */
  repairCandidates(side: Side): Cell[] {
    const me = this.cellOf(side); if (!me) return [];
    const p = this.actors[side].pos, out: { c: Cell; d: number }[] = [];
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = { x: me.x + dx, z: me.z + dz };
      if (!valid(c)) continue;
      const hp = this.hp(c, side);
      if (!Number.isFinite(hp) || hp >= this.mods[side].tileHp) continue;
      const q = cellCentre(c, side); out.push({ c, d: Math.hypot(q.x - p.x, q.z - p.z) });
    }
    return out.sort((a, b) => a.d - b.d).map(o => o.c);
  }
  canRepair(side: Side) { return this.canAct(side) && this.actors[side].air <= 0 && this.actors[side].stones >= rules.inventory.repair_cost && this.repairCandidates(side).length > 0; }

  // ---- intents (client/bot call these) ----
  setMove(side: Side, x: number, z: number) { const l = Math.max(1, Math.hypot(x, z)); this.input[side] = { x: x / l, z: z / l }; }
  beginCharge(side: Side) {
    const a = this.actors[side];
    if (!this.canAct(side) || a.air > 0 || this.charges[side] || a.stones < rules.inventory.shot_cost || a.cooldown > 0) return false;
    this.repairs[side] = null; this.charges[side] = { t: 0, target: null }; return true;
  }
  setSprint(side: Side, on: boolean) { this.sprint[side] = on; }
  /** Stamina one hop costs (upgrades make it cheaper) and the size of the stamina pool, in seconds of running. */
  jumpCost(side: Side) { return JUMP.stamina_cost_s * this.mods[side].thrift; }
  staminaMax(side: Side) { return SPRINT.stamina_s * this.mods[side].stam; }
  /** Hop: a short airborne arc. Floor is ignored while in the air (cross a hole, land on the far side) and shots that land meanwhile miss. */
  jump(side: Side) {
    const a = this.actors[side];
    if (!this.canAct(side) || a.air > 0 || a.jumpCd > 0 || this.charges[side] || a.stamina < this.jumpCost(side)) return false;
    a.stamina -= this.jumpCost(side); a.sprintWait = SPRINT.regen_delay_s; // no timer: every hop costs stamina (shared with sprint), so hopping stays steady but cannot be endless
    this.repairs[side] = null; a.air = JUMP.duration_s; this.events.push({ type: 'jump', side }); return true;
  }
  setTarget(side: Side, c: Cell | null) { const ch = this.charges[side]; if (ch) ch.target = valid(c) ? { ...c } : null; }
  cancelCharge(side: Side) { this.charges[side] = null; }
  /** `claimed`: the throw the player saw in the preview. Online the server's hold timer lags a little behind, so a claim up to HOLD_SLACK_S ahead of it is honoured. */
  releaseCharge(side: Side, claimed?: Kind): Shot | null {
    const ch = this.charges[side]; this.charges[side] = null;
    const a = this.actors[side];
    if (!ch || !valid(ch.target) || !this.canAct(side) || a.stones < rules.inventory.shot_cost) return null;
    let kind = kindForHold(ch.t);
    if (claimed && KIND_RANK[claimed] > KIND_RANK[kind] && KIND_RANK[kindForHold(ch.t + HOLD_SLACK_S)] >= KIND_RANK[claimed]) kind = claimed;
    const shot: Shot = { id: ++this.shotId, owner: side, kind, cells: cellsFor(kind, ch.target), start: { ...a.pos }, elapsed: 0 };
    this.shots.push(shot); a.stones -= rules.inventory.shot_cost; a.cooldown = this.mods[side].cooldown;
    this.events.push({ type: 'throw', side, kind }); return shot;
  }
  beginRepair(side: Side) {
    if (!this.canRepair(side) || this.charges[side] || this.repairs[side]) return false;
    const cell = this.repairCandidates(side)[0];
    this.repairs[side] = { cell, t: 0, need: (this.hp(cell, side) === 0 ? rules.interaction.repair_hole_s : rules.interaction.repair_cracked_s) * this.mods[side].repair }; return true;
  }
  cancelRepair(side: Side) { this.repairs[side] = null; }

  // ---- simulation ----
  step(dt: number) {
    if (this.phase !== 'playing') return;
    this.time += dt;
    for (const side of [0, 1] as Side[]) this.stepActor(side, dt);
    this.stepShots(dt);
    if (this.phase === 'playing' && this.time >= MATCH_SECONDS) this.finish(this.byTime());
  }

  private stepActor(side: Side, dt: number) {
    const a = this.actors[side];
    if (a.falling) {
      a.running = false; a.air = 0; a.vy -= GRAVITY * dt; a.y += a.vy * dt;
      if (a.y < FALL_DEPTH) this.afterFall(side);
      return;
    }
    a.cooldown = Math.max(0, a.cooldown - dt); a.stun = Math.max(0, a.stun - dt); a.jumpCd = Math.max(0, a.jumpCd - dt);
    const ch = this.charges[side]; if (ch) ch.t += dt;
    if (a.air > 0) {
      a.air = Math.max(0, a.air - dt); const u = 1 - a.air / JUMP.duration_s; a.y = JUMP.height_m * 4 * u * (1 - u);
      if (a.air <= 0) { a.y = 0; a.jumpCd = JUMP.cooldown_s; this.events.push({ type: 'land', side }); }
    }
    // sprint: needs a moving, free titan with stamina; runs the stamina down, recovers shortly after it stops
    const m0 = this.input[side], moving = Math.hypot(m0.x, m0.z) > .1;
    if (a.winded && a.stamina >= SPRINT.min_to_start_s) a.winded = false;
    a.running = this.sprint[side] && moving && !this.charges[side] && !this.repairs[side] && a.stun <= 0 && !a.slide && !a.winded && a.stamina > 0;
    if (a.running && a.air <= 0) { a.stamina = Math.max(0, a.stamina - SPRINT.drain_per_s * this.mods[side].thrift * dt); a.sprintWait = SPRINT.regen_delay_s; if (a.stamina <= 0) a.winded = true; }
    else if (!a.running) { a.sprintWait = Math.max(0, a.sprintWait - dt); if (a.sprintWait <= 0) a.stamina = Math.min(this.staminaMax(side), a.stamina + SPRINT.regen_per_s * dt); }
    let dx = 0, dz = 0;
    if (a.slide) { const s = Math.min(dt, a.slide.t), k = s / SLIDE_S; dx += a.slide.dx * k; dz += a.slide.dz * k; a.slide.t -= s; if (a.slide.t <= 1e-9) a.slide = null; }
    else if (a.stun <= 0) { const v = this.speed(side), m = this.input[side]; dx = m.x * v * dt; dz = m.z * v * dt; }
    if (dx || dz) {
      if (this.repairs[side] && Math.hypot(dx, dz) > 0) this.repairs[side] = null;
      a.pos = move(a.pos, dx, dz, a.air > 0 ? () => true : p => this.supported(p, side), side);
    }
    const rp = this.repairs[side];
    if (rp) {
      if (a.stones < rules.inventory.repair_cost || !this.repairCandidates(side).some(c => cellKey(c) === cellKey(rp.cell))) this.repairs[side] = null;
      else if ((rp.t += dt) >= rp.need) {
        a.stones -= rules.inventory.repair_cost; this.floors[side].set(cellKey(rp.cell), this.mods[side].tileHp);
        this.events.push({ type: 'repaired', side, cell: rp.cell }); this.repairs[side] = null;
      }
    }
    if (this.nearArsenal(side) && a.stones < this.mods[side].capacity) {
      this.refills[side] += dt;
      while (this.refills[side] >= this.mods[side].refill && a.stones < this.mods[side].capacity) { this.refills[side] -= this.mods[side].refill; a.stones++; this.events.push({ type: 'refill', side }); }
    } else this.refills[side] = 0;
    this.checkSupport(side);
  }

  private checkSupport(side: Side) {
    const a = this.actors[side];
    if (a.falling || a.air > 0 || this.supported(a.pos, side)) return;
    a.falling = true; a.vy = 0; this.charges[side] = null; this.repairs[side] = null; a.slide = null;
    this.events.push({ type: 'fall', side });
  }

  private afterFall(side: Side) {
    const a = this.actors[side];
    a.lives--;
    if (a.lives <= 0) { a.y = FALL_DEPTH; this.finish(sideOther(side)); return; }
    this.actors[side] = { ...this.newActor(side, RESPAWN_CELL), lives: a.lives };
    this.input[side] = { x: 0, z: 0 }; this.events.push({ type: 'respawn', side });
  }

  private stepShots(dt: number) {
    const arrived: Shot[] = [];
    for (const s of this.shots) { s.elapsed += dt; if (s.elapsed >= rules.shot.flight_duration_s - 1e-9) arrived.push(s); }
    if (!arrived.length) return;
    this.shots = this.shots.filter(s => !arrived.includes(s));
    for (const s of arrived) this.land(s);
  }

  private land(s: Shot) {
    const side = sideOther(s.owner), t = KINDS[s.kind], hitCells = new Set<string>();
    for (const c of s.cells) {
      const before = this.hp(c, side); hitCells.add(cellKey(c));
      const after = Number.isFinite(before) ? Math.max(0, before - t.damage_per_cell) : before;
      if (Number.isFinite(before)) this.floors[side].set(cellKey(c), after);
      this.events.push({ type: 'impact', side, cell: c, kind: s.kind, hpBefore: before, hpAfter: after });
    }
    const v = this.actors[side], here = this.cellOf(side);
    if (!v.falling && v.air > 0 && here && hitCells.has(cellKey(here)) && this.phase === 'playing') this.events.push({ type: 'dodge', side });
    else if (!v.falling && here && hitCells.has(cellKey(here)) && this.phase === 'playing') {
      v.stun = rules.recovery.knockdown_and_stand_s; this.charges[side] = null; this.repairs[side] = null;
      const dist = t.knockback_cells * size, dir = side === 0 ? -1 : 1;
      v.slide = { dx: 0, dz: dir * dist, t: SLIDE_S };
      this.events.push({ type: 'hit', side, kind: s.kind });
    }
    for (const sd of [0, 1] as Side[]) this.checkSupport(sd);
  }

  private totalHp(side: Side) { let n = 0; for (const [, v] of this.floors[side]) if (Number.isFinite(v)) n += v; return n; }
  private byTime(): Side | null {
    const [a, b] = this.actors;
    if (a.lives !== b.lives) return a.lives > b.lives ? 0 : 1;
    const ha = this.totalHp(0), hb = this.totalHp(1);
    return ha === hb ? null : ha > hb ? 0 : 1;
  }
  private finish(winner: Side | null) { if (this.phase === 'over') return; this.phase = 'over'; this.winner = winner; this.charges = [null, null]; this.repairs = [null, null]; this.events.push({ type: 'over', winner }); }
}

/** Flight position of a shot for rendering and collision previews. */
export function shotPosition(s: Shot) {
  const t = Math.min(1, s.elapsed / rules.shot.flight_duration_s), aim = s.cells.length > 1 ? { x: (cellCentre(s.cells[0], sideOther(s.owner)).x + cellCentre(s.cells[1], sideOther(s.owner)).x) / 2, z: cellCentre(s.cells[0], sideOther(s.owner)).z } : cellCentre(s.cells[0], sideOther(s.owner));
  const y0 = rules.character.height_m * .65;
  return { x: s.start.x + (aim.x - s.start.x) * t, z: s.start.z + (aim.z - s.start.z) * t, y: y0 * (1 - t) + 4 * rules.shot.arc_height_above_chord_m * t * (1 - t) };
}
