// 3D presentation of a Battle. Reads simulation state, never changes it.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
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
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/loaders/glTF/2.0';
import { createEnvironment } from '../environment';
import { rules, map, size, cellCentre, type Cell, type Point, type Side } from '../../shared/world';
import { Battle, cellKey, cellsFor, kindForHold, shotPosition, sideOther, type GameEvent, type Kind } from '../../shared/battle';

const KIND_COLOR: Record<Kind, string> = { normal: '#FFF3B0', spin: '#FFB050', heavy: '#C08CFF' };
const TEAM = ['#2BB8AA', '#E8634E'];
type CellView = { root: TransformNode[]; intact: TransformNode; cracked: TransformNode; foundation: Mesh; shown: 'intact' | 'cracked' | 'hole'; fall: number; base: Vector3[] };
type TitanView = { holder: TransformNode; body: TransformNode; walk: AnimationGroup | null; stone: Mesh; yaw: number; lean: number; lie: number; moving: boolean };
type Particle = { mesh: Mesh; v: Vector3; life: number; max: number; gravity: number };

export class World {
  engine: Engine; scene: Scene; camera: FreeCamera;
  private shadows!: ShadowGenerator;
  private casters: Mesh[] = [];
  private cells: [Map<string, CellView>, Map<string, CellView>] = [new Map(), new Map()];
  private titans: [TitanView, TitanView] = [] as unknown as [TitanView, TitanView];
  private shotMeshes = new Map<number, Mesh>();
  private warns = new Map<string, Mesh>();
  private particles: Particle[] = [];
  private aimPool: { fill: Mesh; edges: Mesh[] }[] = [];
  private dots: Mesh[] = [];
  private mats: Record<string, StandardMaterial> = {};
  private stoneTemplate!: Mesh;
  private trailTemplate!: Mesh;
  private time = 0;
  /** 0 = walking camera, 1 = aiming camera (both titan and enemy island in view). */
  aimBlend = 0;
  private aimHold = 0;

  private constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, false);
    this.engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(.72, .71, .84, 1);
    this.camera = new FreeCamera('cam', new Vector3(0, 6, -40), this.scene);
    this.camera.minZ = .1; this.camera.maxZ = 600; this.camera.inputs.clear();
  }

  static async create(canvas: HTMLCanvasElement) {
    const w = new World(canvas);
    w.buildLightsAndSky();
    w.buildMaterials();
    await w.buildIslands();
    await w.buildTitans();
    w.buildPools();
    return w;
  }

  // ---------- setup ----------
  private mat(name: string, hex: string, emissive = 0, spec = 0) {
    const m = new StandardMaterial(name, this.scene); m.diffuseColor = Color3.FromHexString(hex).toLinearSpace();
    m.specularColor = new Color3(spec, spec, spec); m.emissiveColor = Color3.FromHexString(hex).scale(emissive); return m;
  }
  private buildMaterials() {
    const m = this.mats;
    m.stoneDark = this.mat('stoneDark', '#8E7F6C', .03); m.rock = this.mat('rock', '#B89775', .07);
    m.trim0 = this.mat('trim0', TEAM[0], .6); m.trim1 = this.mat('trim1', TEAM[1], .6);
    m.sky = this.mat('skystone', '#BDF3FF', .55, .4); m.skyCore = this.mat('skycore', '#5FD6F5', 1.1);
    for (const k of Object.keys(KIND_COLOR) as Kind[]) {
      m['aim_' + k] = this.mat('aim_' + k, KIND_COLOR[k], .8);
      m['fill_' + k] = this.mat('fill_' + k, KIND_COLOR[k], .9); m['fill_' + k].alpha = .28;
      m['stone_' + k] = this.mat('stone_' + k, KIND_COLOR[k], .85, .3);
    }
    m.warnEnemy = this.mat('warnE', '#FF7A45', .9); m.warnEnemy.alpha = .42;
    m.warnMine = this.mat('warnM', '#BDF3FF', .8); m.warnMine.alpha = .25;
    m.dust = this.mat('dust', '#E7DCCB', .2);
    m.trail = this.mat('trailm', '#E6FBFF', 1); m.trail.alpha = .6;
  }
  private buildLightsAndSky() {
    const s = this.scene;
    const fill = new HemisphericLight('sky', new Vector3(.2, 1, .3), s); fill.intensity = .7; fill.diffuse = new Color3(.8, .86, 1); fill.groundColor = new Color3(.4, .38, .46);
    const sun = new DirectionalLight('sun', new Vector3(-.45, -1, .35), s); sun.position.set(30, 60, -30); sun.diffuse = new Color3(1, .9, .76); sun.intensity = 1.7;
    sun.autoUpdateExtends = false; sun.orthoLeft = -50; sun.orthoRight = 50; sun.orthoTop = 50; sun.orthoBottom = -50; sun.shadowMinZ = 1; sun.shadowMaxZ = 140;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.shadows = new ShadowGenerator(touch ? 1024 : 2048, sun); this.shadows.usePercentageCloserFiltering = true; this.shadows.bias = .0004; this.shadows.normalBias = .03; this.shadows.setDarkness(.3);
    this.glow = new GlowLayer('glow', s, { blurKernelSize: touch ? 24 : 40 }); this.glow.intensity = .85;
    createEnvironment(s, new TransformNode('env', s));
    const sky = s.getMeshByName('gradient sky')!, v = sky.getVerticesData('position')!, col: number[] = [];
    const top = Color3.FromHexString('#6D6FD8'), mid = Color3.FromHexString('#B49BE6'), hor = Color3.FromHexString('#FFC9C4');
    for (let i = 0; i < v.length; i += 3) { const t = (v[i + 1] + 245) / 490; const c = t > .55 ? Color3.Lerp(mid, top, (t - .55) / .45) : Color3.Lerp(hor, mid, Math.max(0, (t - .4) / .15)); col.push(c.r, c.g, c.b, 1); }
    sky.setVerticesData('color', col);
    const cloud = s.getMaterialByName('soft cloud banks') as StandardMaterial; cloud.alpha = .9;
    for (let i = 0; i < 70; i++) { const a = i * 2.39996, r = 8 + (i % 10) * 9 + (i * 7 % 13); const m = MeshBuilder.CreatePlane('cloudsea', { width: 26 + (i % 4) * 8, height: 13 + (i % 3) * 4 }, s); m.position.set(Math.sin(a) * r, -9 - (i % 5) * 3.2, Math.cos(a) * r); m.billboardMode = Mesh.BILLBOARDMODE_ALL; m.material = cloud; m.isPickable = false; }
    for (const m of s.meshes) if (m.name.startsWith('far rock')) m.position.y -= 20;
  }
  private glow!: GlowLayer;
  private cast<T extends Mesh>(m: T) { this.casters.push(m); m.receiveShadows = true; return m; }

  private async buildIslands() {
    const tiles = new Map<string, AssetContainer>();
    for (const v of ['a', 'b', 'c']) for (const k of ['intact', 'cracked']) tiles.set(`${v}/${k}`, await LoadAssetContainerAsync(`/art/blocks-abc-v03/tile_${v}_${k}.glb`, this.scene, { pluginExtension: '.glb' }));
    const S = size;
    const collar = MeshBuilder.CreateBox('collar', { width: S, height: .25, depth: S }, this.scene); collar.position.y = -.525;
    const rock = MeshBuilder.CreateCylinder('hang', { diameterTop: S, diameterBottom: 1.9, height: 1.0, tessellation: 8, subdivisions: 2 }, this.scene); rock.position.y = -1.15;
    collar.material = rock.material = this.mats.rock;
    const foundation = Mesh.MergeMeshes([collar, rock], true, true)!; foundation.convertToFlatShadedMesh(); foundation.isVisible = false;
    for (const side of [0, 1] as Side[]) {
      const root = new TransformNode('island' + side, this.scene);
      for (const c of map.cells) {
        const key = cellKey(c), p = cellCentre(c, side), v = 'abc'[(c.x * 7 + c.z * 3 + side) % 3], rot = ((c.x + c.z * 3) % 4) * Math.PI / 2;
        const make = (kind: string) => {
          const inst = tiles.get(`${v}/${kind}`)!.instantiateModelsToScene(n => `${side}/${key}/${kind}/${n}`, false);
          const group = new TransformNode(`tile${side}/${key}/${kind}`, this.scene); group.position.set(p.x, 0, p.z); group.rotation.y = rot; group.parent = root;
          for (const n of inst.rootNodes) { const t = n as TransformNode; t.parent = group; for (const m of t.getChildMeshes()) { m.receiveShadows = true; } }
          return group;
        };
        const intact = make('intact'), cracked = make('cracked');
        const f = foundation.createInstance(`f${side}/${key}`); f.position.set(p.x, 0, p.z); f.rotation.y = ((c.x * 3 + c.z) % 4) * Math.PI / 2; f.parent = root;
        cracked.setEnabled(false);
        this.cells[side].set(key, { root: [], intact, cracked, foundation: f as unknown as Mesh, shown: 'intact', fall: 0, base: [] });
      }
      // team trim along the front edge
      for (let x = 0; x < rules.arena.width_cells; x++) {
        const p = cellCentre({ x, z: rules.arena.depth_cells - 1 }, side), dir = side === 0 ? 1 : -1;
        const strip = MeshBuilder.CreateBox('trim', { width: S * .82, height: .14, depth: .22 }, this.scene); strip.material = this.mats['trim' + side]; strip.position.set(p.x, -.08, p.z + dir * (S / 2 - .05)); strip.parent = root;
      }
      // arsenal: pile of sky stones
      const a = cellCentre({ x: rules.arena.arsenal_cell[0], z: rules.arena.arsenal_cell[1] }, side);
      const base = this.cast(MeshBuilder.CreateCylinder('arsenal base', { diameterTop: 2.2, diameterBottom: 2.6, height: .5, tessellation: 8 }, this.scene)); base.material = this.mats.stoneDark; base.position.set(a.x, .25, a.z);
      const ring = MeshBuilder.CreateTorus('arsenal ring', { diameter: 2.3, thickness: .08, tessellation: 32 }, this.scene); ring.material = this.mats['trim' + side]; ring.position.set(a.x, .52, a.z);
      for (const [x, y, z, r] of [[0, .85, 0, .55], [.55, .7, .3, .42], [-.5, .7, .25, .45], [.1, .7, -.55, .44], [-.25, 1.3, -.1, .4], [.3, 1.25, .05, .36], [0, 1.75, 0, .32]]) this.skyStone(new Vector3(a.x + x, y, a.z + z), r);
    }
  }

  private skyStone(p: Vector3, r: number, material = this.mats.sky) {
    const s = this.cast(MeshBuilder.CreateIcoSphere('skystone', { radius: r, subdivisions: 1, flat: true }, this.scene)); s.material = material; s.position.copyFrom(p); s.rotation.set(p.x * 3, p.z * 2, p.y);
    const c = MeshBuilder.CreateIcoSphere('core', { radius: r * .55, subdivisions: 1 }, this.scene); c.material = this.mats.skyCore; c.parent = s;
    return s;
  }

  private async buildTitans() {
    for (const side of [0, 1] as Side[]) {
      const c = await LoadAssetContainerAsync(`/art/titans-v03/titan_${side === 0 ? 'teal' : 'coral'}_v03.glb`, this.scene, { pluginExtension: '.glb' });
      for (const l of c.lights) l.setEnabled(false);
      c.addAllToScene();
      const holder = new TransformNode('titan' + side, this.scene), body = new TransformNode('body' + side, this.scene); body.parent = holder;
      const root = c.meshes[0]; root.parent = body; root.scaling.scaleInPlace(3.2 / 1.7);
      for (const m of c.meshes) if (m.getTotalVertices()) this.cast(m as Mesh);
      for (const g of c.animationGroups) g.stop();
      const walk = c.animationGroups.find(g => /walking/i.test(g.name)) ?? c.animationGroups[0] ?? null;
      const stone = MeshBuilder.CreateIcoSphere('held', { radius: .4, subdivisions: 1, flat: true }, this.scene); stone.parent = holder; stone.position.set(.8, 4.1, 0); stone.setEnabled(false); stone.material = this.mats.stone_normal;
      const core = MeshBuilder.CreateIcoSphere('heldcore', { radius: .22, subdivisions: 1 }, this.scene); core.material = this.mats.skyCore; core.parent = stone;
      this.titans[side] = { holder, body, walk, stone, yaw: side === 0 ? 0 : Math.PI, lean: 0, lie: 0, moving: false };
    }
  }

  private buildPools() {
    this.stoneTemplate = MeshBuilder.CreateIcoSphere('stoneT', { radius: .38, subdivisions: 1, flat: true }, this.scene); this.stoneTemplate.setEnabled(false);
    this.trailTemplate = MeshBuilder.CreateSphere('trailT', { diameter: .5, segments: 6 }, this.scene); this.trailTemplate.material = this.mats.trail; this.trailTemplate.isVisible = false;
    this.glow.addIncludedOnlyMesh(this.trailTemplate);
    const S = size;
    for (let i = 0; i < 2; i++) {
      const fill = MeshBuilder.CreateGround('aimfill', { width: S * .92, height: S * .92 }, this.scene); fill.isPickable = false; fill.setEnabled(false);
      const edges: Mesh[] = [];
      for (const [w, d, dx, dz] of [[S, .12, 0, S / 2], [S, .12, 0, -S / 2], [.12, S, S / 2, 0], [.12, S, -S / 2, 0]] as const) { const e = MeshBuilder.CreateBox('aimedge', { width: w, height: .06, depth: d }, this.scene); e.parent = fill; e.position.set(dx, .01, dz); edges.push(e); }
      this.aimPool.push({ fill, edges });
    }
    for (let i = 0; i < 26; i++) { const d = MeshBuilder.CreateSphere('aimdot', { diameter: .18, segments: 5 }, this.scene); d.material = this.mats.aim_normal; d.setEnabled(false); this.dots.push(d); }
    // glow only on light-emitting materials
    this.glow.customEmissiveColorSelector = (mesh, _sub, material, result) => {
      const emits = material === this.mats.sky || material === this.mats.skyCore || material === this.mats.trim0 || material === this.mats.trim1 || (material && (material.name.startsWith('stone_') || material.name.startsWith('aim_') || material.name === 'trailm' || material.name === 'warnE'));
      if (emits && material instanceof StandardMaterial) result.set(material.emissiveColor.r, material.emissiveColor.g, material.emissiveColor.b, 1); else result.set(0, 0, 0, 0);
      void mesh;
    };
    this.shadows.getShadowMap()!.renderList = this.casters;
  }

  // ---------- per-frame ----------
  /** Pointer position (CSS px relative to the canvas) -> enemy island cell, or null. */
  pick(x: number, y: number): Cell | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    if (ray.direction.y > -1e-4) return null;
    const t = -ray.origin.y / ray.direction.y, px = ray.origin.x + ray.direction.x * t, pz = ray.origin.z + ray.direction.z * t;
    let best: Cell | null = null, bd = Infinity;
    for (const c of map.cells) { const q = cellCentre(c, 1), d = Math.hypot(q.x - px, q.z - pz); if (d < bd) { bd = d; best = c; } }
    return best && bd < size * 1.6 ? { x: best.x, z: best.z } : null;
  }

  update(b: Battle, dt: number, input: { aiming: boolean; kind: Kind | null; aimCell: Cell | null; cancel: boolean }) {
    this.time += dt;
    this.updateCamera(b, dt, input.aiming);
    this.updateCells(b, dt);
    this.updateTitans(b, dt);
    this.updateShots(b, dt);
    this.updateAim(b, input);
    this.updateParticles(dt);
    this.shadows.getShadowMap()!.renderList = this.casters;
  }

  private updateCamera(b: Battle, dt: number, aiming: boolean) {
    // pull out while holding a throw, return smoothly after a short delay
    if (aiming) { this.aimHold = .3; this.aimBlend = Math.min(1, this.aimBlend + dt / .25); }
    else if ((this.aimHold -= dt) <= 0) this.aimBlend = Math.max(0, this.aimBlend - dt / .4);
    const e = this.aimBlend * this.aimBlend * (3 - 2 * this.aimBlend), me = b.actors[0].pos;
    const px = me.x, pz = Math.max(me.z, -33), lerp = (a: number, c: number) => a + (c - a) * e;
    const portrait = this.engine.getRenderWidth() < this.engine.getRenderHeight();
    this.camera.fov = (portrait ? 70 : 55) * Math.PI / 180;
    const pos = new Vector3(lerp(px * .75, px * .4), lerp(9.5, 19), lerp(pz - 14, pz - 21));
    const target = new Vector3(lerp(px * .5, 0), lerp(.5, 0), lerp(pz + 14, 14));
    this.camera.position.copyFrom(Vector3.Lerp(this.camera.position, pos, Math.min(1, dt * 10)));
    this.camera.setTarget(Vector3.Lerp(this.camera.getTarget(), target, Math.min(1, dt * 10)));
  }

  private updateCells(b: Battle, dt: number) {
    for (const side of [0, 1] as Side[]) for (const [key, v] of this.cells[side]) {
      const hp = b.floors[side].get(key) ?? 0, want = hp >= 2 ? 'intact' : hp === 1 ? 'cracked' : 'hole';
      if (want !== v.shown) {
        if (want === 'hole') { v.fall = 1.1; v.cracked.setEnabled(true); v.intact.setEnabled(false); v.foundation.setEnabled(false); }
        else { v.fall = 0; v.intact.position.y = v.cracked.position.y = 0; v.intact.setEnabled(want === 'intact'); v.cracked.setEnabled(want === 'cracked'); v.foundation.setEnabled(true); }
        v.shown = want;
      }
      if (v.fall > 0) {
        v.fall -= dt; const t = 1.1 - v.fall;
        v.cracked.position.y = -t * t * 9; v.cracked.rotation.z = t * .6; v.cracked.rotation.x = t * .4;
        if (v.fall <= 0) { v.cracked.setEnabled(false); v.cracked.position.y = 0; v.cracked.rotation.x = v.cracked.rotation.z = 0; }
      }
    }
  }

  private updateTitans(b: Battle, dt: number) {
    for (const side of [0, 1] as Side[]) {
      const a = b.actors[side], t = this.titans[side], m = b.input[side];
      t.holder.position.set(a.pos.x, a.y, a.pos.z);
      const charging = !!b.charges[side], moving = !a.falling && a.stun <= 0 && Math.hypot(m.x, m.z) > .1 && !a.slide;
      const facing = side === 0 ? 0 : Math.PI;
      const yaw = moving && !charging ? Math.atan2(m.x, m.z) : facing;
      let d = yaw - t.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); t.yaw += d * Math.min(1, dt * 12);
      if (a.falling) t.yaw += dt * 5;
      t.holder.rotation.y = t.yaw;
      // posture: lean back while charging, flat when knocked down, spin and sink while falling
      const targetLean = a.stun > 0 ? -1.35 : charging ? -.16 : 0, targetLie = a.stun > 0 ? 1 : 0;
      t.lean += (targetLean - t.lean) * Math.min(1, dt * (a.stun > 0 ? 14 : 8));
      t.lie += (targetLie - t.lie) * Math.min(1, dt * 10);
      t.body.rotation.x = side === 0 ? t.lean : -t.lean;
      t.body.position.y = t.lie * .5 + (a.falling ? 0 : Math.abs(Math.sin(this.time * 14)) * (moving ? .08 : 0));
      if (t.walk) {
        if (moving && !t.moving) t.walk.start(true, charging ? .6 : 1);
        else if (!moving && t.moving) { t.walk.stop(); }
        t.walk.speedRatio = charging ? .6 : 1; t.moving = moving;
      }
      const ch = b.charges[side];
      t.stone.setEnabled(!!ch && !a.falling);
      if (ch) {
        const k = kindForHold(ch.t);
        t.stone.material = this.mats['stone_' + k];
        const grow = .8 + Math.min(1, ch.t / 2.6) * .8 + (k !== 'normal' ? Math.sin(this.time * 18) * .06 : 0);
        t.stone.scaling.setAll(grow); t.stone.rotation.y += dt * 3;
        t.stone.position.y = 4.0 + grow * .3;
      }
    }
  }

  private updateShots(b: Battle, dt: number) {
    for (const [id, m] of this.shotMeshes) if (!b.shots.some(s => s.id === id)) { m.dispose(); this.shotMeshes.delete(id); }
    for (const [k, w] of this.warns) { const id = Number(k.split('/')[0]); if (!b.shots.some(s => s.id === id)) { w.dispose(); this.warns.delete(k); } }
    for (const s of b.shots) {
      let m = this.shotMeshes.get(s.id);
      if (!m) { m = this.stoneTemplate.clone('shot' + s.id); m.setEnabled(true); m.material = this.mats['stone_' + s.kind]; m.scaling.setAll(s.kind === 'heavy' ? 1.5 : s.kind === 'spin' ? 1.2 : 1); this.shotMeshes.set(s.id, m); }
      const p = shotPosition(s); m.position.set(p.x, p.y, p.z); m.rotation.x += dt * 8; m.rotation.z += dt * 5;
      this.particle(new Vector3(p.x, p.y, p.z), Vector3.Zero(), .3, 0, this.trailTemplate, .25 + (s.kind === 'heavy' ? .15 : 0));
      s.cells.forEach((c, i) => {
        const key = `${s.id}/${i}`, victim = sideOther(s.owner);
        let w = this.warns.get(key);
        if (!w) { w = MeshBuilder.CreateGround('warn', { width: size * .9, height: size * .9 }, this.scene); w.isPickable = false; w.material = s.owner === 1 ? this.mats.warnEnemy : this.mats.warnMine; const q = cellCentre(c, victim); w.position.set(q.x, .07, q.z); this.warns.set(key, w); }
        const pulse = s.owner === 1 ? .75 + .25 * Math.sin(this.time * 14) : 1; w.scaling.setAll(pulse * (.7 + .3 * s.elapsed / rules.shot.flight_duration_s));
      });
    }
  }

  private updateAim(b: Battle, input: { aiming: boolean; kind: Kind | null; aimCell: Cell | null; cancel: boolean }) {
    const show = input.aimCell && input.kind && !input.cancel;
    const kind = input.kind ?? 'normal', cells = show ? cellsFor(kind, input.aimCell!) : [];
    this.aimPool.forEach((p, i) => {
      const c = cells[i]; p.fill.setEnabled(!!c); if (!c) return;
      const q = cellCentre(c, 1), hp = b.hp(c, 1);
      p.fill.position.set(q.x, .07, q.z); p.fill.material = this.mats['fill_' + kind];
      for (const e of p.edges) e.material = hp === Infinity ? this.mats.stoneDark : this.mats['aim_' + kind];
    });
    const me = b.actors[0];
    this.dots.forEach((d, i) => {
      if (!show || !input.aiming) { d.setEnabled(false); return; }
      const t = (i + 2) / (this.dots.length + 3), fake = { id: 0, owner: 0 as Side, kind, cells, start: { ...me.pos }, elapsed: t * rules.shot.flight_duration_s };
      const p = shotPosition(fake); d.position.set(p.x, p.y + 1.5 * (1 - t), p.z); d.material = this.mats['aim_' + kind]; d.setEnabled(true);
    });
  }

  handle(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'impact') {
        const c = cellCentre(e.cell, e.side), n = e.kind === 'heavy' ? 14 : 8, destroyed = e.hpAfter === 0 && e.hpBefore > 0;
        if (e.hpBefore === Infinity) { for (let i = 0; i < 5; i++) this.burst(c, .3, this.mats.stoneDark); continue; }
        for (let i = 0; i < n + (destroyed ? 8 : 0); i++) this.burst(c, destroyed ? 1 : .6, this.mats.rock);
        for (let i = 0; i < 4; i++) this.burst(c, .5, this.mats.dust);
      }
      if (e.type === 'hit') { const t = this.titans[e.side].holder.position; for (let i = 0; i < 10; i++) this.burst({ x: t.x, z: t.z }, .9, this.mats.dust, 1.5); }
      if (e.type === 'repaired') { const c = cellCentre(e.cell, e.side); for (let i = 0; i < 10; i++) this.burst(c, .6, this.mats.sky, 2.2); }
      if (e.type === 'throw') { this.titans[e.side].lean = .5; }
    }
  }
  private burst(c: Point, power: number, material: StandardMaterial, y = .2) {
    const m = MeshBuilder.CreateIcoSphere('chip', { radius: .12 + Math.random() * .16, subdivisions: 0, flat: true }, this.scene); m.material = material; m.isPickable = false;
    const a = Math.random() * Math.PI * 2, s = (1 + Math.random() * 3) * power;
    m.position.set(c.x + Math.cos(a) * .6, y, c.z + Math.sin(a) * .6);
    this.particles.push({ mesh: m, v: new Vector3(Math.cos(a) * s, 3 + Math.random() * 4 * power, Math.sin(a) * s), life: .9, max: .9, gravity: 14 });
  }
  private particle(pos: Vector3, v: Vector3, life: number, gravity: number, template: Mesh, scale = 1) {
    const m = template.createInstance('p'); m.position.copyFrom(pos); m.scaling.setAll(scale); m.isPickable = false;
    this.particles.push({ mesh: m as unknown as Mesh, v, life, max: life, gravity });
  }
  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      if (p.life <= 0) { p.mesh.dispose(); this.particles.splice(i, 1); continue; }
      p.v.y -= p.gravity * dt; p.mesh.position.addInPlace(p.v.scale(dt)); p.mesh.scaling.scaleInPlace(Math.max(.9, 1 - dt * 2.5));
    }
  }
  /** Used by tests / diagnostics. */
  meshCount() { return this.scene.meshes.length; }
  isReady() { return this.scene.isReady(); }
}
