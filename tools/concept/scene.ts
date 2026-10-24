// Visual concept renderer: builds static, staged scenes from real game assets.
// Not gameplay code. Open /tools/concept/concept.html?scene=start|mid|late|lobby&mobile=1
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import '@babylonjs/loaders/glTF/2.0';
import { createEnvironment } from '../../client/environment';

const q = new URLSearchParams(location.search);
const SCENE = (q.get('scene') ?? 'mid') as 'start' | 'mid' | 'late' | 'lobby';
const MOBILE = q.get('mobile') === '1';
const S = 2.8, FRONT = 3;
type Side = 0 | 1;
type Build = { kind: 'tower' | 'wall' | 'obelisk' | 'banner' | 'statue' | 'bush' | 'flag'; x: number; z: number; edge?: 'n' | 's' | 'e' | 'w' };
type Island = { w: number; d: number; holes: string[]; cracks: string[]; builds: Build[] };

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
engine.setHardwareScalingLevel(1 / Math.min(2, devicePixelRatio));
const scene = new Scene(engine);
scene.clearColor = new Color4(.72, .71, .84, 1);
const camera = new FreeCamera('cam', Vector3.Zero(), scene); camera.minZ = .1; camera.maxZ = 600; camera.fov = +(q.get('fov') ?? 42) * Math.PI / 180;
const fill = new HemisphericLight('sky', new Vector3(.2, 1, .3), scene); fill.intensity = .7; fill.diffuse = new Color3(.8, .86, 1); fill.groundColor = new Color3(.4, .38, .46);
const sun = new DirectionalLight('sun', new Vector3(-.45, -1, .35), scene); sun.position.set(30, 60, -30); sun.diffuse = new Color3(1, .9, .76); sun.intensity = 1.7;
const shadows = new ShadowGenerator(2048, sun); shadows.usePercentageCloserFiltering = true; shadows.bias = .0004; shadows.normalBias = .03; shadows.setDarkness(.3);
const glow = new GlowLayer('glow', scene, { blurKernelSize: 48 }); glow.intensity = .85;
createEnvironment(scene, new TransformNode('env', scene));
{
  const sky = scene.getMeshByName('gradient sky')!, v = sky.getVerticesData('position')!, col: number[] = [];
  const top = Color3.FromHexString('#6D6FD8'), mid = Color3.FromHexString('#B49BE6'), hor = Color3.FromHexString('#FFC9C4');
  for (let i = 0; i < v.length; i += 3) { const t = (v[i + 1] + 245) / 490; const c = t > .55 ? Color3.Lerp(mid, top, (t - .55) / .45) : Color3.Lerp(hor, mid, Math.max(0, (t - .4) / .15)); col.push(c.r, c.g, c.b, 1); }
  sky.setVerticesData('color', col);
  const cloud = scene.getMaterialByName('soft cloud banks') as StandardMaterial; cloud.alpha = .9;
  for (let i = 0; i < 70; i++) { const a = i * 2.39996, r = 8 + (i % 10) * 9 + (i * 7 % 13); const m = MeshBuilder.CreatePlane('cloudsea', { width: 26 + (i % 4) * 8, height: 13 + (i % 3) * 4 }, scene); m.position.set(Math.sin(a) * r, -9 - (i % 5) * 3.2, Math.cos(a) * r); m.billboardMode = Mesh.BILLBOARDMODE_ALL; m.material = cloud; m.isPickable = false; }
  for (const m of scene.meshes) if (m.name.startsWith('far rock')) { m.position.y -= 20; }
}

const mat = (name: string, hex: string, emissive = 0, spec = 0) => { const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(hex).toLinearSpace(); m.specularColor = new Color3(spec, spec, spec); m.emissiveColor = Color3.FromHexString(hex).scale(emissive); return m; };
const TEAM = ['#2BB8AA', '#E8634E'];
const M = {
  stone: mat('stone', '#B7A58C', .05), stoneDark: mat('stoneDark', '#8E7F6C', .03), rock: mat('rock', '#B89775', .07),
  wood: mat('wood', '#7A5235', .03), gold: mat('gold', '#E8B64A', .15, .3),
  team: TEAM.map((c, i) => mat('team' + i, c, .22)), trim: TEAM.map((c, i) => mat('trim' + i, c, .6)),
  sky: mat('skystone', '#BDF3FF', .55, .4), skyCore: mat('skycore', '#5FD6F5', 1.1),
  leaf: mat('leaf', '#6FAF5A', .06), leaf2: mat('leaf2', '#8CC26A', .06), aim: mat('aim', '#FFF6C8', .7), aimFill: mat('aimfill', '#FFF0A0', .9),
};
M.aimFill.alpha = .2;
const GLOWING = new Set<any>([M.sky, M.skyCore, ...M.trim, M.aim]);

const cellPos = (isl: Island, side: Side, x: number, z: number) => {
  const sx = (x + .5) * S - isl.w * S / 2, sz = -FRONT - isl.d * S + (z + .5) * S;
  return side === 0 ? new Vector3(sx, 0, sz) : new Vector3(-sx, 0, -sz);
};
const casters: Mesh[] = [];
const cast = <T extends Mesh>(m: T) => { casters.push(m); m.receiveShadows = true; return m; };

// ---------- tiles ----------
const tiles = new Map<string, AssetContainer>();
async function loadTiles() {
  for (const v of ['a', 'b', 'c']) for (const k of ['intact', 'cracked']) tiles.set(`${v}/${k}`, await LoadAssetContainerAsync(`/art/blocks-abc-v03/tile_${v}_${k}.glb`, scene, { pluginExtension: '.glb' }));
}
const foundation = (() => {
  const collar = MeshBuilder.CreateBox('collar', { width: S, height: .25, depth: S }, scene); collar.position.y = -.525;
  const r = MeshBuilder.CreateCylinder('hang', { diameterTop: S, diameterBottom: 1.9, height: 1.0, tessellation: 8, subdivisions: 2 }, scene); r.position.y = -1.15;
  collar.material = r.material = M.rock; const m = Mesh.MergeMeshes([collar, r], true, true)!; m.convertToFlatShadedMesh(); m.isVisible = false; return m;
})();
function buildIsland(isl: Island, side: Side) {
  const root = new TransformNode('island' + side, scene);
  for (let z = 0; z < isl.d; z++) for (let x = 0; x < isl.w; x++) {
    const key = `${x},${z}`; if (isl.holes.includes(key)) continue;
    const p = cellPos(isl, side, x, z), v = 'abc'[(x * 7 + z * 3 + side) % 3], kind = isl.cracks.includes(key) ? 'cracked' : 'intact';
    const inst = tiles.get(`${v}/${kind}`)!.instantiateModelsToScene(n => `${side}/${key}/${n}`, false);
    for (const n of inst.rootNodes) { const t = n as TransformNode; t.position.addInPlace(p); t.rotation = new Vector3(0, ((x + z * 3) % 4) * Math.PI / 2, 0); t.rotationQuaternion = null; t.parent = root; for (const m of t.getChildMeshes()) m.receiveShadows = true; }
    const f = foundation.createInstance(`f${side}${key}`); f.position.copyFrom(p); f.rotation.y = ((x * 3 + z) % 4) * Math.PI / 2; f.parent = root;
  }
  // team trim along the front edge, like the concept art
  for (let x = 0; x < isl.w; x++) {
    if (isl.holes.includes(`${x},${isl.d - 1}`)) continue;
    const p = cellPos(isl, side, x, isl.d - 1), dir = side === 0 ? 1 : -1;
    const strip = MeshBuilder.CreateBox('trim', { width: S * .82, height: .14, depth: .22 }, scene); strip.material = M.trim[side]; strip.position.set(p.x, -.08, p.z + dir * (S / 2 - .05));
  }
  // arsenal: pile of glowing sky stones at the rear centre
  const a = cellPos(isl, side, Math.floor(isl.w / 2), 1);
  const base = cast(MeshBuilder.CreateCylinder('arsenal base', { diameterTop: 2.2, diameterBottom: 2.6, height: .5, tessellation: 8 }, scene)); base.material = M.stoneDark; base.position.set(a.x, .25, a.z);
  const ring = MeshBuilder.CreateTorus('arsenal ring', { diameter: 2.3, thickness: .08, tessellation: 32 }, scene); ring.material = M.trim[side]; ring.position.set(a.x, .52, a.z);
  const pile = [[0, .85, 0, .55], [.55, .7, .3, .42], [-.5, .7, .25, .45], [.1, .7, -.55, .44], [-.25, 1.3, -.1, .4], [.3, 1.25, .05, .36], [0, 1.75, 0, .32]];
  for (const [x, y, z, r] of pile) skyStone(new Vector3(a.x + x, y, a.z + z), r);
  for (const b of isl.builds) building(b, isl, side);
  return root;
}
function skyStone(p: Vector3, r = .35, glowCore = true) {
  const s = cast(MeshBuilder.CreateIcoSphere('skystone', { radius: r, subdivisions: 1, flat: true }, scene)); s.material = M.sky; s.position.copyFrom(p); s.rotation.set(p.x * 3, p.z * 2, p.y);
  if (glowCore) { const c = MeshBuilder.CreateIcoSphere('core', { radius: r * .55, subdivisions: 1 }, scene); c.material = M.skyCore; c.parent = s; }
  return s;
}
function banner(p: Vector3, side: Side, h = 3.4) {
  const pole = cast(MeshBuilder.CreateCylinder('pole', { diameter: .14, height: h }, scene)); pole.material = M.wood; pole.position.set(p.x, h / 2, p.z);
  const cloth = cast(MeshBuilder.CreateBox('cloth', { width: .9, height: 1.5, depth: .05 }, scene)); cloth.material = M.team[side]; cloth.position.set(p.x + .5, h - .9, p.z);
  const emblem = MeshBuilder.CreateBox('emblem', { width: .34, height: .34, depth: .07 }, scene); emblem.material = M.gold; emblem.rotation.z = Math.PI / 4; emblem.position.set(p.x + .5, h - .9, p.z);
  const knob = MeshBuilder.CreateSphere('knob', { diameter: .24 }, scene); knob.material = M.gold; knob.position.set(p.x, h + .1, p.z);
}
function building(b: Build, isl: Island, side: Side) {
  const p = cellPos(isl, side, b.x, b.z), face = side === 0 ? 0 : Math.PI;
  if (b.kind === 'tower') {
    const body = cast(MeshBuilder.CreateCylinder('tower', { diameterTop: 1.5, diameterBottom: 1.9, height: 2.6, tessellation: 8 }, scene)); body.material = M.stone; body.position.set(p.x, 1.3, p.z); body.convertToFlatShadedMesh();
    const top = cast(MeshBuilder.CreateCylinder('tower top', { diameter: 2.1, height: .35, tessellation: 8 }, scene)); top.material = M.stoneDark; top.position.set(p.x, 2.75, p.z);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, mer = cast(MeshBuilder.CreateBox('merlon', { width: .45, height: .45, depth: .3 }, scene)); mer.material = M.stone; mer.position.set(p.x + Math.sin(a) * .88, 3.12, p.z + Math.cos(a) * .88); mer.rotation.y = a; }
    const band = MeshBuilder.CreateTorus('band', { diameter: 1.78, thickness: .12, tessellation: 8 }, scene); band.material = M.trim[side]; band.position.set(p.x, 1.9, p.z);
    // catapult arm with a sky stone ready
    const arm = cast(MeshBuilder.CreateBox('arm', { width: .18, height: .18, depth: 1.8 }, scene)); arm.material = M.wood; arm.position.set(p.x, 3.45, p.z); arm.rotation.set(-.5, face, 0);
    skyStone(new Vector3(p.x, 3.95, p.z + (side === 0 ? -.6 : .6)), .3);
  } else if (b.kind === 'wall') {
    const horizontal = b.edge === 'n' || b.edge === 's', sign = b.edge === 'n' || b.edge === 'e' ? 1 : -1, d = side === 0 ? 1 : -1;
    const w = cast(MeshBuilder.CreateBox('wall', { width: horizontal ? S : .55, height: 1.0, depth: horizontal ? .55 : S }, scene)); w.material = M.stone;
    const off = (S / 2 - .3) * sign * d; w.position.set(p.x + (horizontal ? 0 : off), .5, p.z + (horizontal ? off : 0));
    for (let i = 0; i < 4; i++) { const t = (i - 1.5) * .7, m = cast(MeshBuilder.CreateBox('crenel', { width: horizontal ? .4 : .6, height: .32, depth: horizontal ? .6 : .4 }, scene)); m.material = M.stone; m.position.set(w.position.x + (horizontal ? t : 0), 1.16, w.position.z + (horizontal ? 0 : t)); }
    const cap = MeshBuilder.CreateBox('wall trim', { width: horizontal ? S * .98 : .58, height: .08, depth: horizontal ? .58 : S * .98 }, scene); cap.material = M.trim[side]; cap.position.set(w.position.x, .78, w.position.z);
  } else if (b.kind === 'obelisk') {
    const o = cast(MeshBuilder.CreateCylinder('obelisk', { diameterTop: .25, diameterBottom: 1.0, height: 3.6, tessellation: 4 }, scene)); o.material = M.stoneDark; o.position.set(p.x, 1.8, p.z); o.rotation.y = Math.PI / 4; o.convertToFlatShadedMesh();
    const rune = MeshBuilder.CreateBox('rune', { width: .22, height: .9, depth: .05 }, scene); rune.material = M.skyCore; rune.position.set(p.x, 1.6, p.z + (side === 0 ? -.42 : .42));
    const halo = MeshBuilder.CreateTorus('halo', { diameter: 1.6, thickness: .05, tessellation: 32 }, scene); halo.material = M.skyCore; halo.position.set(p.x, .2, p.z);
  } else if (b.kind === 'banner') banner(p.add(new Vector3(-.6, 0, 0)), side);
  else if (b.kind === 'statue') {
    const ped = cast(MeshBuilder.CreateBox('ped', { width: 1.1, height: .7, depth: 1.1 }, scene)); ped.material = M.stoneDark; ped.position.set(p.x, .35, p.z);
    const body = cast(MeshBuilder.CreateCylinder('st body', { diameterTop: .6, diameterBottom: .9, height: 1.2, tessellation: 8 }, scene)); body.material = M.gold; body.position.set(p.x, 1.3, p.z);
    const head = cast(MeshBuilder.CreateSphere('st head', { diameter: .55, segments: 8 }, scene)); head.material = M.gold; head.position.set(p.x, 2.15, p.z);
  } else if (b.kind === 'bush') {
    for (const [dx, dz, r, m] of [[-.6, -.5, .7, M.leaf], [.5, -.3, .6, M.leaf2], [0, .55, .65, M.leaf], [.7, .6, .45, M.leaf2]] as const) { const s = cast(MeshBuilder.CreateIcoSphere('bush', { radius: r, subdivisions: 1, flat: true }, scene)); s.material = m; s.position.set(p.x + dx, r * .8, p.z + dz); }
  } else if (b.kind === 'flag') banner(p, side, 4.6);
}

// ---------- titans ----------
async function titan(color: 'teal' | 'coral', pos: Vector3, yaw: number, pose: 'idle' | 'aim' | 'throw') {
  const c = await LoadAssetContainerAsync(`/art/titans-v03/titan_${color}_v03.glb`, scene, { pluginExtension: '.glb' });
  for (const l of c.lights) l.setEnabled(false);
  c.addAllToScene(); const root = c.meshes[0];
  // normalise: Meshy models are ~1.7 m tall; the game titan is 3.2 m
  const holder = new TransformNode('titanHolder', scene); holder.position.copyFrom(pos); holder.rotation.y = yaw; root.parent = holder;
  root.scaling.scaleInPlace(3.2 / 1.7);
  for (const m of c.meshes) { if (m.getTotalVertices()) { casters.push(m as Mesh); m.receiveShadows = true; } }
  for (const g of c.animationGroups) g.stop();
  const clip = c.animationGroups.find(g => /walking/i.test(g.name)) ?? c.animationGroups[0];
  if (clip) { clip.start(false); clip.goToFrame(clip.from + (clip.to - clip.from) * (pose === 'aim' ? .35 : pose === 'throw' ? .6 : .1)); clip.pause(); }
}

// ---------- shots & aim ----------
function arc(from: Vector3, to: Vector3, t: number, h = 6) {
  const p = Vector3.Lerp(from, to, t); p.y = from.y * (1 - t) + to.y * t + 4 * h * t * (1 - t); return p;
}
function shot(from: Vector3, to: Vector3, t: number, kind: 'normal' | 'spin' | 'heavy' = 'normal') {
  const r = kind === 'heavy' ? .55 : .38, head = skyStone(arc(from, to, t), r);
  const trailM = mat('trail' + Math.random(), kind === 'spin' ? '#FFB050' : kind === 'heavy' ? '#C08CFF' : '#E6FBFF', 1.0); trailM.alpha = .55;
  for (let i = 1; i <= 9; i++) { const tt = t - i * .025; if (tt < 0) break; const s = MeshBuilder.CreateSphere('trail', { diameter: r * 1.6 * (1 - i / 11), segments: 6 }, scene); s.material = trailM; s.position.copyFrom(arc(from, to, tt)); }
  return head;
}
function aimCells(cells: Vector3[]) {
  for (const p of cells) {
    const fillPlane = MeshBuilder.CreateGround('aimfill', { width: S * .92, height: S * .92 }, scene); fillPlane.material = M.aimFill; fillPlane.position.set(p.x, .06, p.z);
    for (const [w, d, dx, dz] of [[S, .12, 0, S / 2], [S, .12, 0, -S / 2], [.12, S, S / 2, 0], [.12, S, -S / 2, 0]]) { const e = MeshBuilder.CreateBox('aimedge', { width: w, height: .06, depth: d }, scene); e.material = M.aim; e.position.set(p.x + dx, .07, p.z + dz); }
  }
}
function aimArc(from: Vector3, to: Vector3) {
  const dm = mat('dots', '#FFF8D8', .9);
  for (let i = 2; i < 30; i++) { const t = i / 30, d = MeshBuilder.CreateSphere('aimdot', { diameter: .16, segments: 6 }, scene); d.material = dm; d.position.copyFrom(arc(from, to, t)); }
}
function warnCell(p: Vector3) { const m = mat('warn' + Math.random(), '#F4B63C', .5); m.alpha = .35; const g = MeshBuilder.CreateGround('warn', { width: S * .9, height: S * .9 }, scene); g.material = m; g.position.set(p.x, .06, p.z); }

// ---------- scenarios ----------
const scenarios: Record<string, { own: Island; foe: Island }> = {
  start: {
    own: { w: 5, d: 7, holes: [], cracks: ['1,5'], builds: [] },
    foe: { w: 5, d: 7, holes: ['3,5'], cracks: ['2,4', '3,4'], builds: [] },
  },
  mid: {
    own: { w: 7, d: 9, holes: ['1,6'], cracks: ['2,6', '5,7'], builds: [{ kind: 'tower', x: 1, z: 2 }, { kind: 'wall', x: 5, z: 8, edge: 'e' }, { kind: 'wall', x: 6, z: 7, edge: 'e' }, { kind: 'flag', x: 0, z: 0 }, { kind: 'flag', x: 6, z: 0 }] },
    foe: { w: 7, d: 9, holes: ['3,6', '4,6'], cracks: ['2,6', '3,5', '5,4'], builds: [{ kind: 'tower', x: 5, z: 2 }, { kind: 'wall', x: 1, z: 8, edge: 'w' }, { kind: 'wall', x: 0, z: 7, edge: 'w' }, { kind: 'flag', x: 0, z: 0 }, { kind: 'flag', x: 6, z: 0 }] },
  },
  late: {
    own: { w: 9, d: 11, holes: ['2,8', '6,9'], cracks: ['3,8', '5,9'], builds: [
      { kind: 'tower', x: 1, z: 3 }, { kind: 'tower', x: 7, z: 3 }, { kind: 'obelisk', x: 4, z: 4 }, { kind: 'wall', x: 0, z: 10, edge: 'w' }, { kind: 'wall', x: 8, z: 10, edge: 'e' }, { kind: 'wall', x: 0, z: 9, edge: 'w' }, { kind: 'wall', x: 8, z: 9, edge: 'e' },
      { kind: 'statue', x: 0, z: 0 }, { kind: 'statue', x: 8, z: 0 }, { kind: 'bush', x: 1, z: 0 }, { kind: 'bush', x: 7, z: 0 }, { kind: 'flag', x: 2, z: 0 }, { kind: 'flag', x: 6, z: 0 }] },
    foe: { w: 9, d: 11, holes: ['3,7', '4,7', '4,8'], cracks: ['5,7', '2,6', '6,8'], builds: [
      { kind: 'tower', x: 1, z: 3 }, { kind: 'tower', x: 7, z: 3 }, { kind: 'tower', x: 4, z: 6 }, { kind: 'obelisk', x: 2, z: 5 }, { kind: 'wall', x: 0, z: 10, edge: 'w' }, { kind: 'wall', x: 8, z: 10, edge: 'e' },
      { kind: 'statue', x: 0, z: 0 }, { kind: 'statue', x: 8, z: 0 }, { kind: 'bush', x: 1, z: 0 }, { kind: 'bush', x: 7, z: 0 }, { kind: 'flag', x: 2, z: 0 }, { kind: 'flag', x: 6, z: 0 }] },
  },
};
scenarios.lobby = { own: scenarios.late.own, foe: scenarios.late.foe };

async function main() {
  await loadTiles();
  const sc = scenarios[SCENE], own = sc.own, foe = sc.foe;
  buildIsland(own, 0);
  if (SCENE !== 'lobby') buildIsland(foe, 1);
  const spawnZ = Math.floor(own.d * .62), me = cellPos(own, 0, Math.floor(own.w / 2), spawnZ).add(new Vector3(.4, 0, 0));
  const enemyAt = cellPos(foe, 1, Math.floor(foe.w / 2) + (SCENE === 'start' ? 0 : -1), Math.floor(foe.d * .62));
  if (SCENE === 'lobby') {
    await titan('teal', cellPos(own, 0, 4, 6), Math.PI * .85, 'idle');
    for (const p of [[3, 6], [5, 6], [4, 5]]) { /* clear around titan */ }
    const centre = cellPos(own, 0, 4, 5);
    camera.position.set(centre.x + 24, 19, centre.z + 22); camera.setTarget(centre.add(new Vector3(-2, -2, 0)));
  } else {
    await titan('teal', me, Math.PI, SCENE === 'start' ? 'aim' : 'throw');
    await titan('coral', enemyAt, 0, SCENE === 'late' ? 'aim' : 'idle');
    // camera: fixed behind the player, always facing the enemy island
    const back = +(q.get('back') ?? 14) + own.d * .2, height = +(q.get('h') ?? 11) + own.d * .45;
    camera.position.set(me.x * .5, height, me.z - back);
    camera.setTarget(new Vector3(0, 0, FRONT + foe.d * S * +(q.get('t') ?? .15)));
    const hand = me.add(new Vector3(.6, 2.6, .3));
    if (SCENE === 'start') {
      const t1 = cellPos(foe, 1, 1, 3); aimCells([t1]); aimArc(hand, t1);
    } else if (SCENE === 'mid') {
      const a = cellPos(foe, 1, 4, 4), b = cellPos(foe, 1, 3, 4); aimCells([a, b]); aimArc(hand, a);
      shot(hand.add(new Vector3(-1, 0, 0)), cellPos(foe, 1, 1, 6), .45, 'spin');
      const tw = cellPos(foe, 1, 5, 2).add(new Vector3(0, 3.9, 0)), tgt = cellPos(own, 0, 4, 7); shot(tw, tgt, .55); warnCell(tgt);
    } else {
      const a = cellPos(foe, 1, 5, 6); aimCells([a, cellPos(foe, 1, 4, 6)]);
      shot(hand, a, .35, 'heavy');
      for (const [bx, bz, tx, tz, t] of [[1, 3, 3, 8, .6], [7, 3, 5, 6, .3]] as const) shot(cellPos(foe, 1, bx, bz).add(new Vector3(0, 3.9, 0)), cellPos(own, 0, tx, tz), t);
      shot(enemyAt.add(new Vector3(0, 2.6, 0)), cellPos(own, 0, 4, 8), .7, 'spin');
    }
  }
  shadows.getShadowMap()!.renderList = casters;
  for (const m of scene.meshes) if (GLOWING.has(m.material) || m.name === 'trail') glow.addIncludedOnlyMesh(m as Mesh);
  hud();
  scene.executeWhenReady(() => { let n = 0; engine.runRenderLoop(() => { scene.render(); if (++n === 30) (window as any).__ready = true; }); });
}

function hud() {
  const h = document.getElementById('hud')!;
  if (SCENE === 'lobby') {
    h.innerHTML = `<div id="lobby"><div id="logo"><small>НЕБЕСНЫЙ ТУРНИР</small>ТИТАНЫ</div><div class="league">Лига: <b>Облачная II</b> · 🏆 1 240</div>
    <div class="res"><span>🪙 3 450</span><span>💎 12</span><span>Ур. 7</span></div>
    <div class="menu"><span>🔨 Строить</span><span>🧔 Титан</span><span>🛒 Магазин</span><span>🏆 Рейтинг</span></div>
    <div id="fight">В БОЙ<small>Набег · остров уровня 6–8</small></div></div>`;
    return;
  }
  const lives = SCENE === 'start' ? [3, 3] : SCENE === 'mid' ? [3, 2] : [2, 2];
  const hearts = (n: number) => '♥'.repeat(n) + `<i>${'♥'.repeat(3 - n)}</i>`;
  const ammo = SCENE === 'start' ? 2 : SCENE === 'mid' ? 2 : 1;
  h.innerHTML = `
  <div class="badge l"><div class="face teal">ВЫ</div><div><div class="who">ВЫ · <span class="lvl">ур. ${SCENE === 'start' ? 1 : SCENE === 'mid' ? 4 : 9}</span></div><div class="hearts">${hearts(lives[0])}</div></div></div>
  <div id="timer">${SCENE === 'late' ? '1:34' : SCENE === 'mid' ? '0:48' : '0:21'}</div>
  ${SCENE === 'late' ? '<div id="warn">⚠ Острова осыпаются с краёв</div>' : ''}
  <div class="badge r"><div class="face coral">БР</div><div style="text-align:right"><div class="who">БОРГАР · <span class="lvl">ИИ</span></div><div class="hearts">${hearts(lives[1])}</div></div></div>
  ${SCENE !== 'start' ? '<div id="tag">Набег на остров игрока Боргар</div>' : ''}
  <div class="slots">${[0, 1, 2].map(i => `<div class="slot ${i < ammo ? '' : 'e'}"><b></b></div>`).join('')}</div>
  ${MOBILE ? `<div id="stick"></div><div id="throw"><div class="ring"></div>${SCENE === 'mid' ? 'КРУЧЁНЫЙ' : SCENE === 'late' ? 'МОЩНЫЙ' : 'БРОСОК'}</div>${SCENE === 'mid' ? '<div id="repair">ЧИНИТЬ</div>' : ''}` : ''}`;
  if (!MOBILE) { (h.querySelector('.slots') as HTMLElement).style.bottom = '24px'; }
}
addEventListener('resize', () => engine.resize());
void main();
