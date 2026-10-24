import { rules } from '../shared/world.ts';
/** True when (x, z) is an integer cell inside the arena. */
export const cellsValid = (x: unknown, z: unknown): boolean =>
  Number.isInteger(x) && Number.isInteger(z) && (x as number) >= 0 && (x as number) < rules.arena.width_cells && (z as number) >= 0 && (z as number) < rules.arena.depth_cells;
