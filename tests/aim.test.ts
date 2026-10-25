import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liftOff, touchAim, LIFT_MS } from '../shared/aim.ts';
import { Battle, HOLD_SLACK_S, cellsFor } from '../shared/battle.ts';
import { rules } from '../shared/world.ts';

const W = rules.arena.width_cells, H = rules.arena.depth_cells;

test('touchAim: every enemy cell is reachable and the result stays on the island', () => {
  const seen = new Set<string>();
  for (let ax = 0; ax < W; ax++) for (let az = 0; az < H; az++) {
    assert.deepEqual(touchAim({ x: ax, z: az }, { x: 0, y: 0 }, 24, 15, W, H), { x: ax, z: az });
    for (let dx = -400; dx <= 400; dx += 8) for (const dy of [-300, 0, 300]) {
      const c = touchAim({ x: ax, z: az }, { x: dx, y: dy }, 24, 15, W, H);
      assert.ok(c.x >= 0 && c.x < W && c.z >= 0 && c.z < H);
      seen.add(`${c.x},${c.z}`);
    }
  }
  assert.equal(seen.size, W * H);
});

test('touchAim: finger right moves the aim to lower x (the foe island is turned 180°), finger down raises z', () => {
  const a = touchAim({ x: 4, z: 5 }, { x: 24, y: 0 }, 24, 15, W, H), b = touchAim({ x: 4, z: 5 }, { x: 0, y: 15 }, 24, 15, W, H);
  assert.deepEqual(a, { x: 3, z: 5 }); assert.deepEqual(b, { x: 4, z: 6 });
});

test('liftOff ignores the last jittery samples of a lifting finger', () => {
  const hist = [{ t: 0, x: 0, y: 0 }, { t: 100, x: 30, y: 10 }, { t: 400, x: 48, y: 20 }, { t: 470, x: 70, y: 45 }, { t: 490, x: 85, y: 60 }];
  assert.deepEqual(liftOff(hist, { x: 85, y: 60 }, 500), { x: 48, y: 20 });
  // a finger that stopped long ago is unaffected
  assert.deepEqual(liftOff(hist, { x: 85, y: 60 }, 490 + LIFT_MS + 50), { x: 85, y: 60 });
  // no samples: the plain offset
  assert.deepEqual(liftOff([], { x: 3, y: 4 }, 10), { x: 3, y: 4 });
  // a very short touch falls back to the first sample
  assert.deepEqual(liftOff([{ t: 95, x: 7, y: 1 }, { t: 100, x: 40, y: 9 }], { x: 40, y: 9 }, 110), { x: 7, y: 1 });
});

test('release with a claimed kind: honoured within the latency slack, never beyond', () => {
  const run = (hold: number, claimed?: 'normal' | 'spin' | 'heavy') => {
    const b = new Battle(); b.beginCharge(0); b.charges[0]!.t = hold; b.setTarget(0, { x: 4, z: 5 });
    return b.releaseCharge(0, claimed);
  };
  const spinFrom = rules.shot.types.spin.hold_from_s;
  assert.equal(run(spinFrom - 0.1, 'spin')!.kind, 'spin');                 // server timer a bit behind the client
  assert.equal(run(spinFrom - HOLD_SLACK_S - 0.05, 'spin')!.kind, 'normal'); // too far behind: no free upgrade
  assert.equal(run(spinFrom + 0.1)!.kind, 'spin');
  assert.equal(run(spinFrom + 0.1, 'normal')!.kind, 'spin');               // a claim never lowers the throw
  assert.equal(run(0.1, 'heavy')!.kind, 'normal');                         // nor jumps two tiers
  assert.deepEqual(run(spinFrom - 0.1, 'spin')!.cells, cellsFor('spin', { x: 4, z: 5 }));
});

import { mouseAim } from '../shared/aim.ts';

test('mouseAim: camera motion under a still pointer does not move the aim; mouse travel catches the aim up with the cursor', () => {
  const start = { x: 2, z: 30 };
  let t = mouseAim(null, start, start, 0);
  assert.deepEqual(t, start);
  // camera pulls out: the point under the still pointer jumps by (+6, -9) but the target stays
  const shifted = { x: 8, z: 21 };
  t = mouseAim(t, shifted, shifted, 0);
  assert.deepEqual(t, start);
  // pointer moves: the target follows by the same world delta (offset fades with travel)
  const moved = { x: 10, z: 21 }, big = mouseAim(t, shifted, moved, 5);
  assert.ok(Math.abs(big.x - (2 + 2)) < 0.2 && Math.abs(big.z - 30) < 0.5);
  // long travel: offset disappears, aim sits under the pointer
  const far = mouseAim(t, shifted, moved, 6000);
  assert.ok(Math.hypot(far.x - moved.x, far.z - moved.z) < 1e-3);
});
