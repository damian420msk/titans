import rules from '../docs/concept/titans_concept_v01/rules_v01.json' with { type: 'json' };
import map from '../docs/concept/titans_concept_v01/map_9x11.json' with { type: 'json' };
export { rules, map };
export type Side = 0 | 1;
export type Point = { x: number; z: number };
export type Cell = { x: number; z: number };
export const size = rules.arena.cell_size_m;
export const halfWidth = rules.arena.width_cells * size / 2;
export const depth = rules.arena.depth_cells * size;
export const front = rules.arena.gap_between_front_edges_m / 2;
// Own front edge is -3; opponent front is +3. Both local grids face inward.
export function cellCentre(c: Cell, side: Side): Point {
  const sign = side === 0 ? 1 : -1;
  return { x: sign * ((c.x + .5) * size - halfWidth), z: sign * (-front - depth + (c.z + .5) * size) };
}
export function cellAt(p: Point, side: Side): Cell | null {
  const sign = side === 0 ? 1 : -1;
  const x = Math.floor((p.x * sign + halfWidth) / size);
  const z = Math.floor((p.z * sign + front + depth) / size);
  return x >= 0 && x < rules.arena.width_cells && z >= 0 && z < rules.arena.depth_cells ? { x, z } : null;
}
export const spawn = cellCentre({ x: rules.arena.spawn_cell[0], z: rules.arena.spawn_cell[1] }, 0);
export function hitsArsenal(p: Point, side: Side = 0): boolean {
  const c = cellCentre({ x: rules.arena.arsenal_cell[0], z: rules.arena.arsenal_cell[1] }, side);
  const dx = Math.max(Math.abs(p.x - c.x) - size / 2, 0);
  const dz = Math.max(Math.abs(p.z - c.z) - size / 2, 0);
  return dx * dx + dz * dz < rules.character.collision_radius_m ** 2;
}
// Small substeps prevent tunnelling through the occupied square at low frame rates.
export function move(p: Point, dx: number, dz: number, supported?: (p: Point) => boolean, side: Side = 0): Point {
  supported ??= p => !!cellAt(p, side);
  const result = { ...p };
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .1));
  for (let i = 0; i < steps; i++) {
    const before = { ...result };
    if (!hitsArsenal({ x: result.x + dx / steps, z: result.z }, side)) result.x += dx / steps;
    if (!hitsArsenal({ x: result.x, z: result.z + dz / steps }, side)) result.z += dz / steps;
    const from = cellAt(before, side), to = cellAt(result, side);
    if (from && to && from.x !== to.x && from.z !== to.z &&
      !supported({ x: result.x, z: before.z }) && !supported({ x: before.x, z: result.z })) {
      return { x: result.x, z: before.z };
    }
    if (!supported(result)) break;
  }
  return result;
}
export function targetCell(p: Point, previous: Cell | null, side: Side = 1): Cell | null {
  const next = cellAt(p, side);
  if (!next) return null;
  if (previous) {
    const c = cellCentre(previous, side);
    if (Math.abs(p.x - c.x) < size / 2 + .08 && Math.abs(p.z - c.z) < size / 2 + .08) return previous;
  }
  return next;
}
