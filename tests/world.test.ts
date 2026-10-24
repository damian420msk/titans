import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules,map,size,cellCentre,cellAt,move,hitsArsenal,spawn,targetCell } from '../shared/world.ts';
import { Simulation, shotPosition, cellKey } from '../shared/simulation.ts';
import { tileAppearance, APPEARANCE_VERSION } from '../shared/tile-appearance.ts';

test('visual appearance is canonical, stable across traversal and has all three variants/four rotations',()=>{
  assert.equal(APPEARANCE_VERSION,1);
  assert.deepEqual([tileAppearance(123456,0,{x:0,z:0}),tileAppearance(123456,1,{x:0,z:0}),tileAppearance(123456,1,{x:8,z:10})],[{variant:'C',rotation:3},{variant:'B',rotation:1},{variant:'A',rotation:1}]);
  const first=new Map<string,unknown>(),second=new Map<string,unknown>(),counts={A:0,B:0,C:0},rotations=new Set<number>();
  for(const side of [0,1] as const)for(const cell of map.cells)first.set(`${side}/${cell.z}/${cell.x}`,tileAppearance(123456,side,cell));
  for(const side of [1,0] as const)for(const cell of [...map.cells].reverse())second.set(`${side}/${cell.z}/${cell.x}`,tileAppearance(123456,side,cell));
  for(const[key,value]of first)assert.deepEqual(second.get(key),value);
  assert.notDeepEqual([...first.values()].slice(0,99),[...first.values()].slice(99));
  for(let seed=1;seed<=12000;seed++){const v=tileAppearance(seed,1,{x:4,z:6});counts[v.variant]++;rotations.add(v.rotation);}
  for(const count of Object.values(counts))assert.ok(count>3700&&count<4300);assert.equal(rotations.size,4);
});
test('source map agrees with rules; symmetric coordinates roundtrip',()=>{
  assert.equal(map.cells.length,99);assert.equal(size,map.cell_size_m);
  assert.deepEqual(map.cells.filter(c=>c.role==='protected').map(c=>[c.x,c.z]),rules.arena.protected_cells);
  assert.deepEqual(map.cells.filter(c=>c.role==='arsenal').map(c=>[c.x,c.z]),[rules.arena.arsenal_cell]);
  assert.deepEqual(map.cells.filter(c=>c.spawn).map(c=>[c.x,c.z]),[rules.arena.spawn_cell]);
  for(const c of map.cells)for(const side of [0,1] as const)assert.deepEqual(cellAt(cellCentre(c,side),side),{x:c.x,z:c.z});
  const a=cellCentre({x:4,z:10},0),b=cellCentre({x:4,z:10},1);assert.ok(Math.abs(b.z-a.z-size-rules.arena.gap_between_front_edges_m)<1e-8);
});

const target = { x: 3, z: 5 };
const advance = (s: Simulation, seconds: number, arsenal = false) => { for (let i = 0; i < Math.ceil(seconds / .01); i++) s.step(.01, arsenal); };
const fire = (s: Simulation, c = target) => { s.press(c, false); s.release(c); };

test('release copies target, spends once, follows configured arc and only damages the selected cell', () => {
  const s = new Simulation(), c = { ...target };
  s.press(c, false); assert.equal(s.ammo, 3);
  s.release(c); s.release(c); c.x = 8;
  assert.equal(s.ammo, 2); assert.equal(s.released, 1); assert.deepEqual(s.shots[0].target, target);
  advance(s, rules.shot.flight_duration_s / 2);
  assert.ok(shotPosition(s.shots[0]).y >= rules.shot.arc_height_above_chord_m);
  assert.equal(s.hp(target, 1), 2);
  advance(s, rules.shot.flight_duration_s / 2 + .02);
  assert.equal(s.hp(target, 1), 1); assert.equal(s.hp({ x: 4, z: 5 }, 1), 2);
  fire(s); advance(s, 1.42); assert.equal(s.hp(target, 1), 0);
});

test('invalid target, cancellation, empty inventory and presses during cooldown never queue shots', () => {
  const s = new Simulation(); s.press(null, false); s.release(null); assert.equal(s.released, 0);
  s.press(target, false); s.cancel(); s.release(target); assert.equal(s.ammo, 3);
  s.press(target, false); s.release(null); assert.equal(s.ammo, 3);
  fire(s); s.press(target, false); advance(s, 1.2); s.release(target); assert.equal(s.released, 1);
  fire(s); advance(s, 1.42); fire(s); advance(s, 1.42); fire(s); assert.equal(s.ammo, 0); assert.equal(s.released, 3);
});

test('R and P resist shots; refill measures distance to square, obeys timing/capacity and cannot become a shot on release', () => {
  const s = new Simulation();
  for (const c of [{ x: 4, z: 1 }, { x: 3, z: 0 }]) { fire(s, c); advance(s, 1.42); assert.equal(s.hp(c, 1), Infinity); }
  assert.equal(s.arsenalAvailable(true), false);
  s.actors[0].pos = cellCentre({ x: 3, z: 0 }, 0);
  assert.equal(s.arsenalAvailable(false), true);
  s.press(target, true); advance(s, .69, true); assert.equal(s.ammo, 1);
  advance(s, .02, true); assert.equal(s.ammo, 2);
  advance(s, 3, true); assert.equal(s.ammo, 3); s.release(target); assert.equal(s.released, 2);
  const r = cellCentre({ x: 4, z: 1 }, 0);
  for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    s.actors[0].pos = { x: r.x + dx * (size / 2 + 3.39), z: r.z + dz * (size / 2 + 3.39) };
    assert.equal(s.arsenalAvailable(true), true);
    s.actors[0].pos = { x: r.x + dx * (size / 2 + 3.41), z: r.z + dz * (size / 2 + 3.41) };
    assert.equal(s.arsenalAvailable(true), false);
  }
});

test('moving or cancelling interrupts refill; missing support ends round, clears shots and restores both sides', () => {
  const s = new Simulation(); fire(s); advance(s, 1.42);
  s.actors[0].pos = cellCentre({ x: 3, z: 0 }, 0); s.press(null, true); advance(s, .4, true); s.movePlayer(.01, 0); advance(s, 1, true); assert.equal(s.ammo, 2);
  s.press(null, true); advance(s, .4, true); s.cancel(); advance(s, 1, true); assert.equal(s.ammo, 2);
  const enemyCell = { x: 4, z: 6 }; fire(s, enemyCell); advance(s, 1.42); fire(s, enemyCell); advance(s, 1.42);
  assert.equal(s.phase, 'falling'); assert.equal(s.actors[1].falling, true); assert.equal(s.shots.length, 0);
  advance(s, 1.3); assert.equal(s.round, 2); assert.equal(s.ammo, 3); assert.equal(s.hp(enemyCell, 1), 2); assert.deepEqual(s.actors[0].pos, spawn);
  s.actors[0].pos.x = 12.5; s.movePlayer(.3, 0); assert.equal(s.phase, 'falling'); advance(s, 1.3); assert.equal(s.round, 3);
});

test('diagonal corner between two holes loses support instead of bridging', () => {
  const s = new Simulation(); const from = cellCentre({ x: 3, z: 5 }, 0);
  s.actors[0].pos = from;
  s.floors[0].set(cellKey({ x: 4, z: 5 }), 0); s.floors[0].set(cellKey({ x: 3, z: 6 }), 0);
  s.movePlayer(size, size); assert.equal(s.phase, 'falling');
});
test('arsenal blocks a long step and permits walking round it',()=>{
  const r=cellCentre({x:4,z:1},0);const p=move(spawn,0,-30);assert.equal(hitsArsenal(p),false);assert.ok(p.z>r.z+size/2);
  const bypass=move({x:r.x+size,z:spawn.z},0,-14);assert.ok(bypass.z<r.z);
});
test('no invisible edge wall; off-grid aim is cleared; hysteresis remains discrete',()=>{
  assert.equal(cellAt(move(spawn,20,0),0),null);
  const c={x:4,z:5},p=cellCentre(c,1);assert.deepEqual(targetCell(p,null),c);
  assert.deepEqual(targetCell({x:p.x+size/2+.04,z:p.z},c),c);
  assert.deepEqual(targetCell({x:p.x+size/2+.2,z:p.z},c),{x:3,z:5});
  assert.equal(targetCell(spawn,c),null);
});
