import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../shared/battle.ts';
import { Bot, mulberry32 } from '../shared/bot.ts';
import { snapshot, applySnap, mirrorSnap, mirrorEvents, type Snap } from '../shared/net.ts';

const playBots = (seconds: number, seed = 5) => {
  const b = new Battle(), bots = [new Bot(b, 0, 'hard', mulberry32(seed)), new Bot(b, 1, 'normal', mulberry32(seed + 1))];
  for (let i = 0; i < seconds * 60; i++) { bots.forEach(x => x.update(1 / 60)); b.step(1 / 60); }
  return b;
};
const close = (a: unknown, b: unknown, path = ''): void => {
  if (typeof a === 'number' && typeof b === 'number') { assert.ok(Math.abs(a - b) < 1e-6, `${path}: ${a} vs ${b}`); return; }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a as object).sort(), Object.keys(b as object).sort(), path);
    for (const k of Object.keys(a as object)) close((a as any)[k], (b as any)[k], `${path}.${k}`);
    return;
  }
  assert.equal(a, b, path);
};

test('snapshot survives JSON and restores the same state', () => {
  const b = playBots(40), s = snapshot(b), copy = new Battle();
  applySnap(copy, JSON.parse(JSON.stringify(s)) as Snap);
  assert.deepEqual(snapshot(copy), s);
});

test('mirror is its own inverse', () => {
  const s = snapshot(playBots(25));
  assert.deepEqual(mirrorSnap(mirrorSnap(s)), s);
});

test('the rules are symmetric: a mirrored battle evolves as the mirror image', () => {
  for (const seed of [1, 2, 3]) {
    const s = snapshot(playBots(18 + seed * 4, seed)), A = new Battle(), B = new Battle();
    applySnap(A, s); applySnap(B, mirrorSnap(s));
    const script = (b: Battle, swap: boolean) => {
      const sd = (i: 0 | 1) => (swap ? 1 - i : i) as 0 | 1, sg = swap ? -1 : 1;
      return (step: number) => {
        if (step === 0) { b.setMove(sd(0), .6 * sg, .8 * sg); b.setMove(sd(1), -1 * sg, 0); b.cancelCharge(sd(0)); b.beginCharge(sd(1)); b.setTarget(sd(1), { x: 4, z: 6 }); }
        if (step === 30) { b.beginCharge(sd(0)); b.setTarget(sd(0), { x: 3, z: 5 }); }
        if (step === 90) b.releaseCharge(sd(1));
        if (step === 150) { b.releaseCharge(sd(0)); b.setMove(sd(0), 0, -1 * sg); }
      };
    };
    const ra = script(A, false), rb = script(B, true), evA: any[] = [], evB: any[] = [];
    for (let i = 0; i < 400; i++) { ra(i); rb(i); A.step(1 / 60); B.step(1 / 60); evA.push(...A.events); evB.push(...B.events); A.events.length = 0; B.events.length = 0; }
    assert.ok(evA.some(e => e.type === 'throw'), 'script produced throws');
    close(snapshot(B), mirrorSnap(snapshot(A)), `seed ${seed}`);
    assert.deepEqual(evB.map(e => e.type), mirrorEvents(evA).map(e => e.type));
  }
});
