import { rules, map, size, cellCentre, cellAt, spawn, move, type Cell, type Point, type Side } from './world.ts';
export type Actor = { pos: Point; y: number; vy: number; falling: boolean };
export type Shot = { id: number; owner: Side; target: Cell; start: Point; elapsed: number };
export type PrimaryContext = 'shot' | 'refill' | null;
export const cellKey = (c: Cell) => `${c.x},${c.z}`;
export const otherSide = (side: Side): Side => side === 0 ? 1 : 0;
const spawnCell = { x: rules.arena.spawn_cell[0], z: rules.arena.spawn_cell[1] };
export const validCell = (c: Cell | null): c is Cell => !!c && Number.isInteger(c.x) && Number.isInteger(c.z) && c.x >= 0 && c.x < rules.arena.width_cells && c.z >= 0 && c.z < rules.arena.depth_cells;

/** Same deterministic rules for local training and the authoritative two-player room. */
export class Simulation {
  actors: [Actor, Actor] = [this.actor(0), this.actor(1)];
  floors: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];
  inventories = [rules.inventory.round_start, rules.inventory.round_start];
  cooldowns = [0, 0];
  primaries: [PrimaryContext, PrimaryContext] = [null, null];
  refills = [0, 0];
  shots: Shot[] = [];
  round = 1;
  phase: 'playing' | 'falling' = 'playing';
  released = 0;
  lastImpact: { target: Cell; hp: number; side: Side } | null = null;
  message = 'Тестовый раунд · цель неподвижна';
  // Local-stage API retained; network callers supply an explicit side.
  get ammo() { return this.inventories[0]; } set ammo(v: number) { this.inventories[0] = v; }
  get enemyAmmo() { return this.inventories[1]; } set enemyAmmo(v: number) { this.inventories[1] = v; }
  get cooldown() { return this.cooldowns[0]; } set cooldown(v: number) { this.cooldowns[0] = v; }
  get primary() { return this.primaries[0]; }
  get refillElapsed() { return this.refills[0]; }
  constructor() { this.restoreFloor(); }
  private actor(side: Side): Actor { return { pos: side === 0 ? { ...spawn } : cellCentre(spawnCell, 1), y: 0, vy: 0, falling: false }; }
  private restoreFloor() {
    for (const side of [0, 1] as Side[]) {
      this.floors[side].clear();
      for (const c of map.cells) this.floors[side].set(cellKey(c), c.destructible ? rules.arena.start_normal_cell_hp : Infinity);
    }
  }
  hp(c: Cell, side: Side) { return this.floors[side].get(cellKey(c)) ?? 0; }
  supported(p: Point, side: Side) { const c = cellAt(p, side); return c !== null && this.hp(c, side) > 0; }
  arsenalAvailable(lookingAtPile: boolean, side: Side = 0) {
    const p = this.actors[side].pos, centre = cellCentre({ x: rules.arena.arsenal_cell[0], z: rules.arena.arsenal_cell[1] }, side);
    const distance = Math.hypot(Math.max(0, Math.abs(p.x - centre.x) - size / 2), Math.max(0, Math.abs(p.z - centre.z) - size / 2));
    const c = cellAt(p, side), onProtected = !!c && rules.arena.protected_cells.some(([x,z]) => c.x === x && c.z === z);
    return this.phase === 'playing' && distance <= rules.interaction.arsenal_range_m && (lookingAtPile || onProtected);
  }
  /** Server checks a horizontal view ray against the occupied R square, never a client's claimed position/range. */
  looksAtArsenal(yaw: number, side: Side) {
    const p = this.actors[side].pos, c = cellCentre({ x: rules.arena.arsenal_cell[0], z: rules.arena.arsenal_cell[1] }, side);
    let near = 0, far = Infinity;
    for (const [origin, direction, centre] of [[p.x, Math.sin(yaw), c.x], [p.z, Math.cos(yaw), c.z]]) {
      if (Math.abs(direction) < 1e-9) { if (Math.abs(origin - centre) > size / 2) return false; }
      else { const a = (centre - size / 2 - origin) / direction, b = (centre + size / 2 - origin) / direction; near = Math.max(near, Math.min(a,b)); far = Math.min(far, Math.max(a,b)); }
    }
    return far >= near;
  }
  context(target: Cell | null, arsenal: boolean, side: Side = 0): PrimaryContext {
    if (this.phase !== 'playing') return null;
    if (arsenal) return this.inventories[side] < rules.inventory.capacity ? 'refill' : null;
    return validCell(target) && this.inventories[side] >= rules.inventory.shot_cost && this.cooldowns[side] <= 0 ? 'shot' : null;
  }
  begin(kind: PrimaryContext, side: Side = 0) {
    if (this.primaries[side] || this.phase !== 'playing') return;
    if (kind === 'shot' && (this.inventories[side] < rules.inventory.shot_cost || this.cooldowns[side] > 0)) return;
    this.primaries[side] = kind; this.refills[side] = 0;
  }
  press(target: Cell | null, arsenal: boolean, side: Side = 0) { this.begin(this.context(target, arsenal, side), side); }
  release(target: Cell | null, side: Side = 0) {
    const action = this.primaries[side]; this.cancel(side);
    if (action !== 'shot' || !validCell(target) || !this.context(target, false, side)) return;
    this.shots.push({ id: ++this.released, owner: side, target: { ...target }, start: { ...this.actors[side].pos }, elapsed: 0 });
    this.inventories[side] -= rules.inventory.shot_cost; this.cooldowns[side] = rules.shot.min_release_interval_s;
    this.message = `Обычный бросок → ${target.x}, ${target.z}`;
  }
  cancel(side: Side = 0) { this.primaries[side] = null; this.refills[side] = 0; }
  cancelAll() { this.cancel(0); this.cancel(1); }
  movePlayer(dx: number, dz: number, side: Side = 0, deferSupport = false) {
    if (this.phase !== 'playing') return;
    if (Math.hypot(dx, dz) > 0 && this.primaries[side] === 'refill') this.cancel(side);
    this.actors[side].pos = move(this.actors[side].pos, dx, dz, p => this.supported(p, side), side);
    if (!deferSupport) this.checkSupport();
  }
  private checkSupport() {
    if (this.phase !== 'playing') return;
    const fallen = ([0,1] as Side[]).filter(side => !this.supported(this.actors[side].pos, side));
    if (!fallen.length) return;
    for (const side of fallen) this.actors[side].falling = true;
    this.phase = 'falling'; this.cancelAll(); this.shots = [];
    this.message = fallen.length === 2 ? 'Одновременное падение · раунд завершён' : `${fallen[0] === 0 ? 'Вы' : 'Соперник'}: падение · раунд завершён`;
  }
  step(dt: number, arsenal: boolean | [boolean, boolean]) {
    if (this.phase === 'falling') {
      for (const a of this.actors) if (a.falling) { a.vy -= 18 * dt; a.y += a.vy * dt; }
      if (this.actors.some(a => a.falling && a.y < -12)) this.reset();
      return;
    }
    const supplies = typeof arsenal === 'boolean' ? [arsenal, false] : arsenal;
    for (const side of [0,1] as Side[]) {
      this.cooldowns[side] = Math.max(0, this.cooldowns[side] - dt);
      if (this.primaries[side] !== 'refill') continue;
      if (!supplies[side]) this.cancel(side);
      else {
        this.refills[side] += dt;
        while (this.refills[side] + 1e-9 >= rules.interaction.refill_per_stone_s && this.inventories[side] < rules.inventory.capacity) {
          this.refills[side] -= rules.interaction.refill_per_stone_s; this.inventories[side]++; this.message = 'Камень получен из арсенала';
        }
        if (this.inventories[side] === rules.inventory.capacity) this.cancel(side);
      }
    }
    const arrived: Shot[] = [];
    for (const shot of this.shots) { shot.elapsed += dt; if (shot.elapsed + 1e-9 >= rules.shot.flight_duration_s) arrived.push(shot); }
    this.shots = this.shots.filter(s => !arrived.includes(s));
    for (const shot of arrived) {
      const side = otherSide(shot.owner), hp = this.hp(shot.target, side);
      if (Number.isFinite(hp)) this.floors[side].set(cellKey(shot.target), Math.max(0, hp - rules.shot.types.normal.damage_per_cell));
      this.lastImpact = { target: { ...shot.target }, hp: this.hp(shot.target, side), side };
      this.message = hp === Infinity ? 'Защищённый пол сохранён' : hp === 2 ? 'Клетка треснула' : hp === 1 ? 'Клетка разрушена' : 'Камень ушёл в отверстие';
    }
    // Resolve a whole fixed-step batch before deciding deaths; both sides see one outcome.
    this.checkSupport();
  }
  reset() {
    this.round++; this.actors = [this.actor(0), this.actor(1)]; this.restoreFloor();
    this.inventories = [rules.inventory.round_start, rules.inventory.round_start]; this.cooldowns = [0,0];
    this.shots = []; this.lastImpact = null; this.cancelAll(); this.phase = 'playing'; this.message = `Тестовый раунд ${this.round} · поле восстановлено`;
  }
}
export function shotPosition(shot: Shot) {
  const t = Math.min(1, shot.elapsed / rules.shot.flight_duration_s), end = cellCentre(shot.target, otherSide(shot.owner));
  const startY = rules.character.height_m * .65;
  return { x: shot.start.x + (end.x - shot.start.x) * t, z: shot.start.z + (end.z - shot.start.z) * t, y: startY * (1 - t) + 4 * rules.shot.arc_height_above_chord_m * t * (1 - t) };
}
