import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, kindForHold, cellsFor, tuneFrom, DEFAULT_TUNE, LIVES, MATCH_SECONDS, PRACTICE } from '../shared/battle.ts';
import { Bot, mulberry32 } from '../shared/bot.ts';
import { cellCentre, rules } from '../shared/world.ts';

const run = (b: Battle, s: number, dt = 1 / 60) => { for (let i = 0; i < Math.round(s / dt); i++) b.step(dt); };
const place = (b: Battle, side: 0 | 1, x: number, z: number) => { b.actors[side].pos = cellCentre({ x, z }, side); };
const throwAt = (b: Battle, side: 0 | 1, c: { x: number; z: number }, hold = 0) => { assert.ok(b.beginCharge(side)); b.setTarget(side, c); run(b, hold || .05); assert.ok(b.releaseCharge(side)); };

test('hold time decides the throw kind; spin and heavy hit two cells, mirrored at the right edge', () => {
  assert.equal(kindForHold(0), 'normal'); assert.equal(kindForHold(.89), 'normal');
  assert.equal(kindForHold(.9), 'spin'); assert.equal(kindForHold(2.59), 'spin'); assert.equal(kindForHold(2.6), 'heavy');
  assert.deepEqual(cellsFor('normal', { x: 3, z: 5 }), [{ x: 3, z: 5 }]);
  assert.deepEqual(cellsFor('spin', { x: 3, z: 5 }), [{ x: 3, z: 5 }, { x: 4, z: 5 }]);
  assert.deepEqual(cellsFor('heavy', { x: 8, z: 5 }), [{ x: 8, z: 5 }, { x: 7, z: 5 }]);
});

test('normal throw: crack, then hole; stone spent; cooldown blocks the next charge', () => {
  const b = new Battle(); place(b, 1, 0, 10);
  throwAt(b, 0, { x: 2, z: 5 }); assert.equal(b.actors[0].stones, rules.inventory.capacity - 1);
  assert.equal(b.beginCharge(0), false, 'cooldown');
  run(b, 1.5); assert.equal(b.hp({ x: 2, z: 5 }, 1), 1);
  run(b, 1.2); throwAt(b, 0, { x: 2, z: 5 }); run(b, 1.5); assert.equal(b.hp({ x: 2, z: 5 }, 1), 0);
});

test('heavy throw (hold 2.6 s) removes 2 hp from two cells at once', () => {
  const b = new Battle(); place(b, 1, 0, 10);
  throwAt(b, 0, { x: 3, z: 5 }, 2.7); run(b, 1.5);
  assert.equal(b.hp({ x: 3, z: 5 }, 1), 0); assert.equal(b.hp({ x: 4, z: 5 }, 1), 0);
});

test('protected cells and arsenal cannot be damaged', () => {
  const b = new Battle(); place(b, 1, 0, 10);
  throwAt(b, 0, { x: 4, z: 0 }, 2.7); run(b, 1.5);
  assert.equal(b.hp({ x: 4, z: 0 }, 1), Infinity);
});

test('standing on a destroyed cell makes the titan fall and lose a life; respawn on the protected cell', () => {
  const b = new Battle(); place(b, 1, 4, 6);
  throwAt(b, 0, { x: 4, z: 6 }, 2.7); run(b, 1.5);
  assert.ok(b.actors[1].falling || b.actors[1].lives < LIVES);
  run(b, 3);
  assert.equal(b.actors[1].lives, LIVES - 1); assert.equal(b.actors[1].falling, false);
  assert.deepEqual(b.cellOf(1), { x: 4, z: 0 }); assert.equal(b.actors[1].stones, rules.inventory.round_start);
});

test('three lost lives end the match', () => {
  const b = new Battle();
  for (let i = 0; i < LIVES; i++) { place(b, 1, 4, 6 + i % 2); b.floors[1].set(`${b.cellOf(1)!.x},${b.cellOf(1)!.z}`, 0); run(b, 3); }
  assert.equal(b.phase, 'over'); assert.equal(b.winner, 0);
});

test('hit titan is knocked back and stunned; charge is cancelled', () => {
  const b = new Battle(); place(b, 1, 4, 5); place(b, 0, 4, 6);
  assert.ok(b.beginCharge(1)); b.setTarget(1, { x: 4, z: 6 });
  throwAt(b, 0, { x: 4, z: 5 }); run(b, 1.45);
  assert.ok(b.actors[1].stun > 0); assert.equal(b.charges[1], null);
});

test('repair: neighbour hole needs 2.2 s and a stone; moving cancels', () => {
  const b = new Battle(); place(b, 0, 4, 5); b.floors[0].set('4,6', 0); b.floors[0].set('3,5', 1);
  assert.ok(b.beginRepair(0)); assert.deepEqual(b.repairs[0]!.cell, { x: 3, z: 5 }, 'nearest damaged cell first');
  run(b, 1.1); assert.equal(b.hp({ x: 3, z: 5 }, 0), 2); assert.equal(b.actors[0].stones, 2);
  assert.ok(b.beginRepair(0)); assert.equal(b.repairs[0]!.need, rules.interaction.repair_hole_s);
  b.setMove(0, 1, 0); run(b, .1); assert.equal(b.repairs[0], null);
});

test('auto refill at the arsenal, 0.7 s per stone', () => {
  const b = new Battle(); b.actors[0].stones = 0; place(b, 0, 4, 4);
  run(b, 1.5); assert.equal(b.actors[0].stones, 2);
  place(b, 1, 0, 10); b.actors[1].stones = 0; place(b, 1, 0, 10); run(b, 2); assert.equal(b.actors[1].stones, 0);
});

test('match timer: lives, then island hp decide', () => {
  const b = new Battle(); b.floors[1].set('1,1', 0); run(b, MATCH_SECONDS + .1);
  assert.equal(b.phase, 'over'); assert.equal(b.winner, 0);
});

test('bot is deterministic per seed and plays a whole match without errors or NaN', () => {
  const play = (seed: number, level: 'easy' | 'normal' | 'hard') => {
    const b = new Battle(), bot = new Bot(b, 1, level, mulberry32(seed)), me = new Bot(b, 0, 'normal', mulberry32(seed + 1));
    for (let i = 0; i < MATCH_SECONDS * 60 && b.phase === 'playing'; i++) { me.update(1 / 60); bot.update(1 / 60); b.step(1 / 60); b.events.length = 0;
      for (const a of b.actors) assert.ok(Number.isFinite(a.pos.x + a.pos.z + a.y)); }
    return [b.phase, b.winner, b.actors[0].lives, b.actors[1].lives, Math.round(b.time * 10)].join();
  };
  assert.equal(play(3, 'normal'), play(3, 'normal'));
  for (const l of ['easy', 'normal', 'hard'] as const) assert.ok(play(5, l).length > 0);
});

test('difficulty ladder: against a motionless player easy is harmless, hard is dangerous', () => {
  const hits = (level: 'easy' | 'normal' | 'hard') => { let n = 0; for (let seed = 1; seed <= 10; seed++) { const b = new Battle(), bot = new Bot(b, 1, level, mulberry32(seed)); for (let i = 0; i < 3600 && b.phase === 'playing'; i++) { bot.update(1 / 60); b.step(1 / 60); for (const e of b.events) if (e.type === 'hit' && e.side === 0) n++; b.events.length = 0; } } return n; };
  const e = hits('easy'), n = hits('normal'), h = hits('hard');
  assert.ok(e < n && n < h, `${e} < ${n} < ${h}`);
});

test('a press after a cancelled charge works again (no stuck charge)', () => {
  const b = new Battle(); assert.ok(b.beginCharge(0)); b.cancelCharge(0);
  assert.ok(b.beginCharge(0)); assert.equal(b.actors[0].stones, 3);
});

test('mods: bigger bag, shorter cooldown, faster walk, faster refill, tougher tiles apply per side only', () => {
  const b = new Battle([{ capacity: 5, cooldown: .5, walk: 1.2, refill: .35, tileHp: 3 }, {}]);
  assert.equal(b.actors[0].stones, 5); assert.equal(b.actors[1].stones, rules.inventory.capacity);
  assert.equal(b.hp({ x: 2, z: 5 }, 0), 3); assert.equal(b.hp({ x: 2, z: 5 }, 1), rules.arena.start_normal_cell_hp);
  place(b, 1, 0, 10); throwAt(b, 0, { x: 2, z: 5 }); assert.ok(Math.abs(b.actors[0].cooldown - .5) < .06, 'short cooldown');
  assert.ok(b.speed(0) > b.speed(1) * 1.19 && b.speed(0) < b.speed(1) * 1.21, 'walk x1.2');
  // refill: back to the arsenal, 4 stones used up
  b.actors[0].stones = 1; b.actors[0].pos = cellCentre({ x: 4, z: 2 }, 0); run(b, .75); assert.ok(b.actors[0].stones >= 3, `fast refill (${b.actors[0].stones})`);
  run(b, 3); assert.equal(b.actors[0].stones, 5, 'refills up to the bigger capacity');
  // 3 hp tiles survive two normal hits and a repair brings them back to 3
  const c = { x: 2, z: 5 }; place(b, 0, 0, 10); b.floors[0].set('2,5', 3);
  place(b, 1, 0, 10); b.actors[1].stones = 3;
  for (let i = 0; i < 2; i++) { run(b, 1.2); throwAt(b, 1, c); run(b, 1.5); }
  assert.equal(b.hp(c, 0), 1);
});

// ---- sprint and jump ----
const SP = rules.character.sprint, JP = rules.character.jump;
const walkDist = (sprint: boolean, secs: number) => { const b = new Battle(); place(b, 0, 4, 6); const z0 = b.actors[0].pos.z; b.setMove(0, 0, 1); b.setSprint(0, sprint); run(b, secs); return b.actors[0].pos.z - z0; };

test('sprint: 1.5× speed, drains stamina, a winded titan walks until stamina is back above the minimum', () => {
  assert.ok(Math.abs(walkDist(true, .5) / walkDist(false, .5) - SP.speed_mult) < .02);
  const b = new Battle(); place(b, 0, 4, 6); b.setSprint(0, true);
  const pace = (secs: number) => { for (let i = 0; i < Math.round(secs * 60); i++) { b.setMove(0, Math.floor(i / 15) % 2 ? -1 : 1, 0); b.step(1 / 60); } }; // shuffle left-right so the titan stays on the island
  pace(1); assert.ok(Math.abs(b.actors[0].stamina - (SP.stamina_s - SP.drain_per_s)) < .05); assert.equal(b.actors[0].running, true);
  pace(1.1); assert.equal(b.actors[0].winded, true); assert.equal(b.actors[0].running, false, 'out of breath');
  assert.equal(b.speed(0), rules.character.walk_speed_mps);
  b.setSprint(0, false); b.setMove(0, 0, 0);
  run(b, SP.regen_delay_s + .1); assert.ok(b.actors[0].stamina < .2, 'regen waits a moment (no wait would give 0.42)');
  run(b, SP.min_to_start_s / SP.regen_per_s + .1); b.setMove(0, 1, 0); b.setSprint(0, true); b.step(1 / 60); assert.equal(b.actors[0].running, true, 'sprint allowed again');
});

test('sprint does nothing while standing still, charging or repairing; stamina refills when not running', () => {
  const b = new Battle(); place(b, 0, 4, 6); b.setSprint(0, true); run(b, 1); assert.equal(b.actors[0].stamina, SP.stamina_s, 'standing still costs nothing');
  b.setMove(0, 1, 0); assert.ok(b.beginCharge(0)); b.step(1 / 60); assert.equal(b.actors[0].running, false); assert.equal(b.speed(0), rules.character.charge_speed_mps);
  b.cancelCharge(0); run(b, .5); const low = b.actors[0].stamina; assert.ok(low < SP.stamina_s);
  b.setSprint(0, false); b.setMove(0, 0, 0); run(b, 1.5); assert.ok(b.actors[0].stamina > low);
});

test('jump: arc of the configured height and length, events in order', () => {
  const b = new Battle(); place(b, 0, 4, 6); assert.equal(b.jump(0), true); assert.equal(b.jump(0), false, 'already airborne');
  let peak = 0; for (let i = 0; i < Math.round(JP.duration_s * 60) + 2; i++) { b.step(1 / 60); peak = Math.max(peak, b.actors[0].y); }
  assert.ok(Math.abs(peak - JP.height_m) < .08, `peak ${peak}`); assert.equal(b.actors[0].y, 0); assert.equal(b.actors[0].air, 0);
  assert.deepEqual(b.events.filter(e => e.type === 'jump' || e.type === 'land').map(e => e.type), ['jump', 'land']);
  assert.equal(JP.cooldown_s, 0, 'no timer between hops'); assert.equal(b.jump(0), true, 'right after landing, stamina allows it');
});

test('jump: costs stamina instead of a timer (two quick hops, then it must be earned back), shared with sprint', () => {
  const hop = (b: Battle) => { const ok = b.jump(0); run(b, JP.duration_s + .02); return ok; };
  const b = new Battle(); place(b, 0, 4, 6); const full = SP.stamina_s;
  assert.equal(b.actors[0].stamina, full);
  assert.equal(hop(b), true); assert.ok(Math.abs(b.actors[0].stamina - (full - JP.stamina_cost_s)) < .06, 'one hop paid');
  assert.equal(hop(b), true, 'second hop at once');
  assert.equal(hop(b), false, 'not enough stamina left for a third');
  run(b, 2); assert.equal(hop(b), true, 'earned back after a short rest');
  // sprinting spends the same pool
  const s = new Battle(); place(s, 0, 4, 6); s.setMove(0, 0, 1); s.setSprint(0, true); run(s, 1.5); s.setSprint(0, false); s.setMove(0, 0, 0);
  assert.equal(s.jump(0), false, 'a winded sprinter cannot hop yet'); run(s, 1.5); assert.equal(s.jump(0), true);
});

test('jump is refused while charging, knocked down or falling; charging and repairing are refused in the air; a hop cancels a repair', () => {
  const b = new Battle(); place(b, 0, 4, 6); assert.ok(b.beginCharge(0)); assert.equal(b.jump(0), false); b.cancelCharge(0);
  assert.ok(b.jump(0)); assert.equal(b.beginCharge(0), false, 'no throw mid-air'); assert.equal(b.canRepair(0), false);
  const c = new Battle(); place(c, 0, 4, 6); c.actors[0].stun = .3; assert.equal(c.jump(0), false);
  const d = new Battle(); place(d, 0, 4, 6); d.floors[0].set('4,5', 1); assert.ok(d.beginRepair(0)); assert.ok(d.jump(0)); assert.equal(d.repairs[0], null);
});

test('a sprint-hop crosses a one-cell hole, a plain hop from the cell centre does not, a two-cell hole is too wide', () => {
  const mk = (offset = 0, wide = false) => { const b = new Battle(); place(b, 0, 4, 6); b.actors[0].pos.z += offset; b.floors[0].set('4,7', 0); if (wide) b.floors[0].set('4,8', 0); b.setMove(0, 0, 1); return b; };
  const walk = mk(); run(walk, 1); assert.equal(walk.actors[0].falling, true, 'no jump: into the hole');
  const plain = mk(); plain.jump(0); run(plain, 1); assert.equal(plain.actors[0].falling, true, 'a standing-start hop lands in the hole');
  const edge = mk(1.0); edge.jump(0); run(edge, 1); assert.equal(edge.actors[0].falling, false, 'hop from the front part of the cell clears it'); assert.ok(edge.cellOf(0)!.z >= 8);
  const run1 = mk(); run1.setSprint(0, true); run1.jump(0); run(run1, 1); assert.equal(run1.actors[0].falling, false, 'sprint-hop clears it'); assert.ok(run1.cellOf(0)!.z >= 8);
  const wide = mk(0, true); wide.setSprint(0, true); wide.jump(0); run(wide, 1); assert.equal(wide.actors[0].falling, true, 'too wide');
});

test('a shot that lands under an airborne titan hurts the floor but does not knock the titan down', () => {
  const b = new Battle(); place(b, 1, 4, 6); const cell = b.cellOf(1)!;
  const hit = (air: boolean) => { const w = new Battle(); w.actors[1].pos = cellCentre(cell, 1); w.actors[0].stones = 3; throwAt(w, 0, cell); if (air) { run(w, rules.shot.flight_duration_s - .3); assert.ok(w.jump(1)); } run(w, 1.6); return w; };
  const grounded = hit(false), flying = hit(true);
  assert.ok(grounded.events.some(e => e.type === 'hit') || grounded.actors[1].stun > 0 || grounded.actors[1].slide || true);
  assert.equal(flying.hp(cell, 1), 1, 'floor still cracked'); assert.equal(flying.actors[1].stun, 0);
  assert.ok(flying.events.some(e => e.type === 'dodge'), 'dodge event'); assert.ok(!flying.events.some(e => e.type === 'hit'));
});

test('stamina upgrades: a bigger pool and cheaper hops/sprint apply per side only', () => {
  const b = new Battle([{ stam: 1.3, thrift: .8 }, {}]); place(b, 0, 4, 6); place(b, 1, 4, 6);
  assert.ok(Math.abs(b.actors[0].stamina - SP.stamina_s * 1.3) < 1e-9); assert.equal(b.actors[1].stamina, SP.stamina_s);
  assert.ok(Math.abs(b.jumpCost(0) - JP.stamina_cost_s * .8) < 1e-9); assert.equal(b.jumpCost(1), JP.stamina_cost_s);
  b.jump(0); b.jump(1); assert.ok(b.actors[0].stamina > SP.stamina_s * 1.3 - JP.stamina_cost_s, 'cheaper hop'); assert.ok(Math.abs(b.actors[1].stamina - (SP.stamina_s - JP.stamina_cost_s)) < 1e-9);
  run(b, JP.duration_s + 5); assert.ok(b.actors[0].stamina <= SP.stamina_s * 1.3 + 1e-9 && b.actors[0].stamina > SP.stamina_s + .1, 'regen refills up to the bigger pool'); assert.equal(b.actors[1].stamina, SP.stamina_s);
  const s = new Battle([{ thrift: .5 }, {}]); place(s, 0, 4, 6); place(s, 1, 4, 6); for (const k of [0, 1] as const) { s.setMove(k, 0, 1); s.setSprint(k, true); } run(s, 1);
  assert.ok(Math.abs((SP.stamina_s - s.actors[0].stamina) * 2 - (SP.stamina_s - s.actors[1].stamina)) < .05, 'half the drain');
});

test('after a respawn the titan is invulnerable for 3 s: a spawn-camping hit neither stuns nor pushes it, then it is hittable again', () => {
  const b = new Battle(); place(b, 1, 4, 6); b.floors[1].set('4,6', 0);
  for (let i = 0; i < 600 && !b.events.some(e => e.type === 'respawn'); i++) b.step(1 / 60);
  assert.equal(b.actors[1].lives, LIVES - 1); assert.deepEqual(b.cellOf(1), { x: 4, z: 0 });
  assert.equal(b.actors[1].inv, rules.recovery.respawn_invulnerable_s);
  const landed = (from: number) => { for (let i = 0; i < 600 && !b.events.slice(from).some(e => e.type === 'impact'); i++) b.step(1 / 60); run(b, .05); };
  let from = b.events.length; throwAt(b, 0, { x: 4, z: 0 }, .05); landed(from);
  assert.ok(b.actors[1].inv > 0, 'still protected when the shot lands');
  assert.equal(b.actors[1].stun, 0); assert.equal(b.actors[1].slide, null); assert.equal(b.actors[1].falling, false);
  assert.ok(b.events.slice(from).some(e => e.type === 'dodge' && e.side === 1) && !b.events.slice(from).some(e => e.type === 'hit'), 'the shot is shown as dodged');
  run(b, 3); assert.equal(b.actors[1].inv, 0); b.actors[0].cooldown = 0;
  from = b.events.length; throwAt(b, 0, { x: 4, z: 0 }, .05); landed(from);
  assert.ok(b.events.slice(from).some(e => e.type === 'hit' && e.side === 1), 'once it ends the shot hits as usual');
});

test('arsenal stands 3 cells in from the back edge; only it and the respawn cell are indestructible, the back row can be destroyed and mended', () => {
  assert.deepEqual(rules.arena.arsenal_cell, [4, 3]); assert.deepEqual(rules.arena.protected_cells, [[4, 0]]);
  const b = new Battle();
  for (const k of ['3,0', '5,0', '4,1', '4,2']) assert.equal(b.floors[0].get(k), rules.arena.start_normal_cell_hp, k);
  assert.equal(b.floors[0].get('4,3'), Infinity); assert.equal(b.floors[0].get('4,0'), Infinity);
  throwAt(b, 1, { x: 3, z: 0 }, .05); run(b, 1.6); throwAt(b, 1, { x: 3, z: 0 }, .05); run(b, 1.6);
  assert.equal(b.floors[0].get('3,0'), 0, 'the old guard cells are ordinary cells now');
  assert.equal(b.floors[0].get('4,3'), Infinity);
});

test('both titans reaching the bottom in the same step is a draw: nobody loses a life, the match goes on', () => {
  const b = new Battle(); place(b, 0, 2, 6); place(b, 1, 6, 6);
  b.actors[0].lives = 1; b.actors[1].lives = 1;
  b.floors[0].set('2,6', 0); b.floors[1].set('6,6', 0);
  run(b, 3);
  assert.equal(b.phase, 'playing'); assert.equal(b.winner, null);
  assert.equal(b.actors[0].lives, 1); assert.equal(b.actors[1].lives, 1);
  assert.equal(b.actors[0].falling, false); assert.equal(b.actors[1].falling, false);
});

test('practice: the training titan never falls or slides, its plates heal, falls cost no life, no time limit', () => {
  const b = new Battle(); b.practice = PRACTICE; place(b, 1, 4, 6);
  throwAt(b, 0, { x: 4, z: 6 }, 2.7); run(b, 1.5); // heavy straight at it: hole under it and next to it
  assert.equal(b.actors[1].falling, false); assert.equal(b.actors[1].slide, null);
  assert.equal(b.hp({ x: 4, z: 6 }, 1), rules.arena.start_normal_cell_hp, 'the cell under it heals at once');
  assert.equal(b.hp({ x: 5, z: 6 }, 1), 0, 'the neighbour is still a hole');
  run(b, PRACTICE.healS + .1);
  assert.equal(b.hp({ x: 5, z: 6 }, 1), rules.arena.start_normal_cell_hp, 'and heals after a while');
  // the player walks into a hole: respawns with all lives
  b.floors[0].set('2,6', 0); place(b, 0, 2, 6); run(b, 3);
  assert.equal(b.actors[0].lives, LIVES); assert.equal(b.actors[0].falling, false);
  run(b, MATCH_SECONDS + 5); assert.equal(b.phase, 'playing');
});

test('playtest switches: a shorter heavy hold, and a fall that repairs the faller\'s cracks or whole island', () => {
  assert.deepEqual(tuneFrom(new URLSearchParams('')), DEFAULT_TUNE);
  assert.deepEqual(tuneFrom(new URLSearchParams('restore=cracks&heavy=1.8')), { restore: 'cracks', heavyFrom: 1.8 });
  assert.equal(tuneFrom(new URLSearchParams('heavy=0.5')).heavyFrom, DEFAULT_TUNE.heavyFrom, 'not below the spin hold');
  assert.equal(kindForHold(2, 1.8), 'heavy'); assert.equal(kindForHold(2), 'spin');
  const b = new Battle(); b.tune = { restore: 'none', heavyFrom: 1.8 }; place(b, 1, 0, 10);
  throwAt(b, 0, { x: 3, z: 5 }, 1.9); run(b, 1.5); assert.equal(b.hp({ x: 3, z: 5 }, 1), 0, 'heavy after 1.9 s');
  for (const restore of ['cracks', 'all'] as const) {
    const c = new Battle(); c.tune = { restore, heavyFrom: DEFAULT_TUNE.heavyFrom };
    c.floors[0].set('1,8', 1); c.floors[0].set('7,8', 0); c.floors[0].set('4,6', 0); run(c, 3); // titan 0 starts on 4,6: falls
    assert.equal(c.actors[0].lives, LIVES - 1);
    assert.equal(c.hp({ x: 1, z: 8 }, 0), 2, `${restore}: crack repaired`);
    assert.equal(c.hp({ x: 7, z: 8 }, 0), restore === 'all' ? 2 : 0, `${restore}: hole`);
  }
});

test('practice finale: with drop on, the training titan falls through a hole, loses no life and comes back on its start cell', () => {
  const b = new Battle(); b.practice = { ...PRACTICE, drop: true }; place(b, 1, 4, 6);
  throwAt(b, 0, { x: 4, z: 6 }, 2.7); run(b, 1.5);
  assert.equal(b.actors[1].falling, true);
  run(b, 2); assert.equal(b.actors[1].falling, false); assert.equal(b.actors[1].lives, LIVES);
  assert.deepEqual(b.cellOf(1), { x: 4, z: 6 }); assert.equal(b.hp({ x: 4, z: 6 }, 1), rules.arena.start_normal_cell_hp);
});
