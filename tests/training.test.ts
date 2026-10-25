import test from 'node:test';
import assert from 'node:assert/strict';
import { Training, STEPS, NUDGE_S, DIR_GOAL_M, DIRS } from '../client/play/training.ts';
import type { GameEvent } from '../shared/battle.ts';

const imp = (side: 0 | 1, before: number, after: number): GameEvent => ({ type: 'impact', side, cell: { x: 1, z: 1 }, kind: 'normal', hpBefore: before, hpAfter: after });
/** Walk `m` metres along one axis in small steps, as the game loop would. */
const walk = (t: Training, p: { x: number; z: number }, ax: 'x' | 'z', m: number) => { const out = []; const n = Math.round(Math.abs(m) / .05); for (let i = 0; i < n; i++) { p[ax] += Math.sign(m) * .05; out.push(...t.update(1 / 60, [], p)); } return out; };

test('training: walking counts only after about two steps in each of W, A, S, D', () => {
  const p = { x: 0, z: 0 }, t = new Training([], p);
  assert.deepEqual(walk(t, p, 'z', 6), [], 'only forward is not enough'); assert.deepEqual([...t.dirs], ['up']);
  assert.deepEqual(walk(t, p, 'x', -DIR_GOAL_M - .1), []); assert.deepEqual(walk(t, p, 'z', -8), []); assert.equal(t.done.size, 0);
  assert.deepEqual(walk(t, p, 'x', 3), ['move']); assert.equal(t.dirs.size, DIRS.length); assert.equal(t.current!.id, 'throw');
});

test('training: a knock-back or respawn jump is not counted as walking', () => {
  const p = { x: 0, z: 0 }, t = new Training([], p);
  p.z += 20; t.update(1 / 60, [], p); p.x += 20; t.update(1 / 60, [], p); p.z -= 20; t.update(1 / 60, [], p); p.x -= 20; t.update(1 / 60, [], p);
  assert.equal(t.dirs.size, 0);
});

test('training: tasks go top to bottom, an action for a later task does not count early', () => {
  const p = { x: 0, z: 0 }, t = new Training(['move'], p);
  assert.deepEqual(t.update(.1, [{ type: 'jump', side: 0 }, { type: 'refill', side: 0 }, imp(1, 2, 1)], p), [], 'throw is the current task, the rest is ignored');
  assert.deepEqual(t.update(.1, [{ type: 'throw', side: 0, kind: 'normal' }], p), ['throw']);
  assert.deepEqual(t.update(.1, [imp(1, 2, 1)], p), ['hit']);
  assert.deepEqual(t.update(.1, [{ type: 'throw', side: 0, kind: 'heavy' }], p), ['heavy']);
  assert.deepEqual(t.update(.1, [{ type: 'refill', side: 0 }], p), ['refill']);
  assert.deepEqual(t.update(.1, [{ type: 'jump', side: 0 }], p), ['jump']);
  assert.equal(t.complete, false);
  assert.deepEqual(t.update(.1, [{ type: 'repaired', side: 0, cell: { x: 2, z: 6 } }], p), ['repair']); assert.equal(t.complete, true);
});

test('training: the enemy side and own-island hits do not count; a task is reported once', () => {
  const p = { x: 0, z: 0 }, t = new Training(['move', 'throw'], p);
  assert.deepEqual(t.update(.1, [imp(0, 2, 1), imp(1, 1, 1)], p), []);
  assert.deepEqual(t.update(.1, [imp(1, 2, 1)], p), ['hit']); assert.deepEqual(t.update(.1, [imp(1, 2, 1)], p), [], 'hit is done, heavy is next');
});

test('training: saved progress restores only an unbroken prefix; unknown ids are ignored', () => {
  const p = { x: 0, z: 0 };
  const t = new Training(['move', 'throw', 'bogus' as any, 'heavy'], p); assert.equal(t.done.size, 2); assert.equal(t.current!.id, 'hit'); assert.equal(t.dirs.size, DIRS.length);
  assert.equal(new Training(['throw', 'hit'], p).done.size, 0, 'a saved task without the first one is dropped');
  assert.equal(new Training(STEPS.map(s => s.id), p).complete, true);
});

test('training: the hint shows after a pause without progress and goes away on progress', () => {
  const p = { x: 0, z: 0 }, t = new Training(['move'], p);
  t.update(NUDGE_S - .5, [], p); assert.equal(t.nudge, false); t.update(.6, [], p); assert.equal(t.nudge, true);
  t.update(.1, [{ type: 'throw', side: 0, kind: 'normal' }], p); assert.equal(t.nudge, false);
});
