import test from 'node:test';
import assert from 'node:assert/strict';
import { Training, STEPS, NUDGE_S, MOVE_GOAL_M } from '../client/play/training.ts';
import type { GameEvent } from '../shared/battle.ts';

const at = { x: 0, z: 0 };
const imp = (side: 0 | 1, before: number, after: number): GameEvent => ({ type: 'impact', side, cell: { x: 1, z: 1 }, kind: 'normal', hpBefore: before, hpAfter: after });

test('training: every task is ticked by its own event, in any order', () => {
  const t = new Training([], at);
  assert.deepEqual(t.update(.1, [{ type: 'jump', side: 0 }], at), ['jump']);
  assert.deepEqual(t.update(.1, [], { x: MOVE_GOAL_M - .1, z: 0 }), [], 'not far enough yet');
  assert.deepEqual(t.update(.1, [], { x: MOVE_GOAL_M, z: 0 }), ['move']);
  assert.deepEqual(t.update(.1, [{ type: 'throw', side: 0, kind: 'normal' }], at), ['throw']);
  assert.deepEqual(t.update(.1, [{ type: 'throw', side: 0, kind: 'heavy' }], at), ['heavy']);
  assert.deepEqual(t.update(.1, [imp(1, 2, 1)], at), ['hit']);
  assert.deepEqual(t.update(.1, [{ type: 'refill', side: 0 }], at), ['refill']);
  assert.equal(t.complete, false); assert.equal(t.current!.id, 'repair');
  assert.deepEqual(t.update(.1, [{ type: 'repaired', side: 0, cell: { x: 2, z: 6 } }], at), ['repair']);
  assert.equal(t.complete, true); assert.equal(t.current, undefined);
});

test('training: the enemy side and own-island hits do not count; a task is reported once', () => {
  const t = new Training([], at);
  assert.deepEqual(t.update(.1, [{ type: 'throw', side: 1, kind: 'heavy' }, { type: 'jump', side: 1 }, { type: 'refill', side: 1 }, imp(0, 2, 1), imp(1, 1, 1)], at), []);
  assert.deepEqual(t.update(.1, [{ type: 'jump', side: 0 }], at), ['jump']); assert.deepEqual(t.update(.1, [{ type: 'jump', side: 0 }], at), []);
});

test('training: saved progress is restored and unknown ids are ignored', () => {
  const t = new Training(['move', 'throw', 'bogus' as any], at); assert.equal(t.done.size, 2); assert.equal(t.current!.id, 'hit');
  assert.equal(new Training(STEPS.map(s => s.id), at).complete, true);
});

test('training: the hint shows after a pause without progress and goes away on progress', () => {
  const t = new Training([], at);
  t.update(NUDGE_S - .5, [], at); assert.equal(t.nudge, false); t.update(.6, [], at); assert.equal(t.nudge, true);
  t.update(.1, [{ type: 'jump', side: 0 }], at); assert.equal(t.nudge, false);
});
