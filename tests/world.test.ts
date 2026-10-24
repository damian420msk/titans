import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, map, size, cellCentre, cellAt } from '../shared/world.ts';

test('source map agrees with rules; symmetric coordinates roundtrip', () => {
  assert.equal(map.cells.length, 99); assert.equal(size, map.cell_size_m);
  assert.deepEqual(map.cells.filter(c => c.role === 'protected').map(c => [c.x, c.z]), rules.arena.protected_cells);
  assert.deepEqual(map.cells.filter(c => c.role === 'arsenal').map(c => [c.x, c.z]), [rules.arena.arsenal_cell]);
  for (const c of map.cells) for (const side of [0, 1] as const) assert.deepEqual(cellAt(cellCentre(c, side), side), { x: c.x, z: c.z });
  const a = cellCentre({ x: 4, z: 10 }, 0), b = cellCentre({ x: 4, z: 10 }, 1);
  assert.ok(Math.abs(b.z - a.z - size - rules.arena.gap_between_front_edges_m) < 1e-8);
});
