// 3D presentation of a Battle. Reads simulation state, never changes it.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
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
import type { Material } from '@babylonjs/core/Materials/material';
import { COSMETICS, type CosmeticKind } from '../../shared/progress';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/loaders/glTF/2.0';
import { createEnvironment } from '../environment';
import { TitanRig, readClips, CLIP } from './rig';
import { rules, map, size, cellCentre, type Cell, type Point, type Side } from '../../shared/world';
import { Battle, cellKey, cellsFor, kindForHold, shotPosition, sideOther, type GameEvent, type Kind } from '../../shared/battle';

const KIND_COLOR: Record<Kind, string> = { normal: '#FFF3B0', spin: '#FFB050', heavy: '#C08CFF' };
const TEAM = ['#2BB8AA', '#E8634E'];
/** Size of the game stone in the titan's hand relative to the 0.7 m cube (the model's hand is small). */
const STONE_HAND = .5;
const STONE_COLOR: Record<Kind, string> = { normal: '#C9C3B6', spin: '#E3A862', heavy: '#8E80C4' };
type CellView = { root: TransformNode[]; intact: TransformNode; cracked: TransformNode; foundation: Mesh; shown: 'intact' | 'cracked' | 'hole'; fall: number; base: Vector3[] };
type TitanView = { mats: Material[]; holder: TransformNode; body: TransformNode; rig: TitanRig; stone: Mesh; ring: Mesh; yaw: number; lean: number; lie: number; moving: boolean;
  cheer: number; flail: number; cheerTarget: boolean; squash: number };
/** Local rotation offset from Euler angles in degrees (x, y, z). */
const rot = (x: number, y: number, z: number) => Quaternion.RotationYawPitchRoll(y * Math.PI / 180, x * Math.PI / 180, z * Math.PI / 180);
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
  private tileMats: [Material[], Material[]] = [[], []];
  private baseAlbedo = new Map<Material, Color3>();
  private trailTemplate!: Mesh;
  private time = 0;
  /** Online: ease the foe's drawn position between snapshots. */
  smoothFoe = false; foeVis = { x: 0, z: 0, ok: false };
  /** Camera follow point (smoothed titan position): a knock-back slide or a snapshot correction must not yank the view. */
  private follow = { x: 0, z: -15.6, tau: .15 };
  /** While a throw is held the camera stands still: the cell under a still pointer never changes. */
  private aimFrozen = false;
  freezeCamera = false;
  /** Hard reset of everything a finished match can leave behind: plates mid-fall, camera pose, leftover titan posture. */
  resetMatch() {
    for (const side of [0, 1] as Side[]) for (const v of this.cells[side].values()) {
      v.fall = 0; v.shown = 'intact';
      for (const n of [v.intact, v.cracked]) { n.position.y = 0; n.rotation.x = n.rotation.z = 0; }
      v.intact.setEnabled(true); v.cracked.setEnabled(false); v.foundation.setEnabled(true);
    }
    for (const m of this.shotMeshes.values()) m.dispose(); this.shotMeshes.clear();
    for (const p of this.particles) p.mesh.dispose(); this.particles.length = 0;
    this.aimFrozen = false; this.snapCamera = true;
    for (const t of this.titans) { t.lean = 0; t.lie = 0; t.body.rotation.x = 0; t.body.position.y = 0; }
    this.resetPoses();
  }
  private snapCamera = false;
  resetPoses() { this.foeVis.ok = false; for (const t of this.titans) { t.cheerTarget = false; t.cheer = t.flail = t.squash = 0; t.rig.reset(); } }

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
    w.scene.onAfterAnimationsObservable.add(() => w.applyBones());
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
      m['stone_' + k] = this.mat('rock_' + k, STONE_COLOR[k], .12);
    }
    for (const sd of [0, 1]) m['stone_normal' + sd] = this.mat('rock_normal' + sd, STONE_COLOR.normal, .12);
    m.warnEnemy = this.mat('warnE', '#FF7A45', .9); m.warnEnemy.alpha = .42;
    m.warnMine = this.mat('warnM', '#BDF3FF', .8); m.warnMine.alpha = .25;
    m.dust = this.mat('dust', '#E7DCCB', .2);
    m.trail = this.mat('trailm', '#F4EEE2', .35); m.trail.alpha = .5;
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
    for (const m of s.meshes) if (m.name.startsWith('far rock') || m.name.startsWith('mountain template')) m.setEnabled(false);
  }
  private glow!: GlowLayer;
  private cast<T extends Mesh>(m: T) { this.casters.push(m); m.receiveShadows = true; return m; }

  private async buildIslands() {
    // one set of tile containers per island: tinting a material then only changes that side's plates
    const tilesBySide: [Map<string, AssetContainer>, Map<string, AssetContainer>] = [new Map(), new Map()];
    for (const sd of [0, 1] as Side[]) for (const v of ['a', 'b', 'c']) for (const k of ['intact', 'cracked']) { const ct = await LoadAssetContainerAsync(`${import.meta.env.BASE_URL}art/blocks-abc-v03/tile_${v}_${k}.glb`, this.scene, { pluginExtension: '.glb' }); tilesBySide[sd].set(`${v}/${k}`, ct); this.tileMats[sd].push(...ct.materials); }
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
          const inst = tilesBySide[side].get(`${v}/${kind}`)!.instantiateModelsToScene(n => `${side}/${key}/${kind}/${n}`, false);
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
      this.stonePile(a, side);
    }
  }

  /** A chunky bevelled stone cube: three slightly shorter boxes intersected give chamfered edges. */
  private stoneCube(size: number, material: StandardMaterial, name = 'stone') {
    const k = .84, parts = [[1, k, k], [k, 1, k], [k, k, 1]].map(([w, h, d], i) => { const b = MeshBuilder.CreateBox(`${name}${i}`, { width: w * size, height: h * size, depth: d * size }, this.scene); return b; });
    const m = Mesh.MergeMeshes(parts, true, true)!; m.name = name; m.convertToFlatShadedMesh(); m.material = material; return m;
  }
  private stonePile(a: Point, side: Side) {
    const cube = (x: number, y: number, z: number, yaw: number) => { const c = this.cast(this.stoneCube(.72, this.mats['stone_normal' + side], 'pile')); c.position.set(a.x + x, y, a.z + z); c.rotation.y = yaw; };
    for (const [x, z, r] of [[-.4, -.4, .1], [.4, -.4, -.08], [-.4, .4, -.12], [.4, .4, .07]]) cube(x, .86, z, r);
    for (const [x, r] of [[-.36, .06], [.36, -.1]]) cube(x, 1.58, 0, r);
    cube(0, 2.3, 0, .2);
  }

  private async buildTitans() {
    for (const side of [0, 1] as Side[]) {
      const c = await LoadAssetContainerAsync(`${import.meta.env.BASE_URL}art/titans-v04/titan_turquoise_v04_web.glb`, this.scene, { pluginExtension: '.glb' });
      for (const l of c.lights) l.setEnabled(false);
      c.addAllToScene();
      const holder = new TransformNode('titan' + side, this.scene), body = new TransformNode('body' + side, this.scene); body.parent = holder;
      // the file is in metres (about 3.2 m tall): no extra scale
      const root = c.meshes[0]; root.parent = body;
      // the props that ship inside the file (a test rock in the hand) are dropped: the game owns the stone in the hand
      for (const m of [...c.meshes]) if (m.name.startsWith('HandStone')) { m.dispose(); }
      for (const m of c.meshes) if (m.getTotalVertices() && !m.isDisposed()) { this.cast(m as Mesh); m.alwaysSelectAsActiveMesh = true; }
      const clips = readClips(c.animationGroups);
      for (const g of c.animationGroups) { g.stop(); g.dispose(); }
      for (const n of Object.values(CLIP)) if (!clips.has(n)) console.warn('titan clip missing:', n);
      const nodes = new Map<string, TransformNode>(); for (const n of c.transformNodes) nodes.set(n.name, n);
      const rig = new TitanRig(nodes, clips);
      const hand = nodes.get('RightHand'), socket = new TransformNode('stoneSocket' + side, this.scene);
      if (hand) { socket.parent = hand; socket.position.set(-.028, .13, .112); } else socket.parent = holder;
      const stone = this.stoneCube(.7, this.mats['stone_normal' + side], 'held'); stone.parent = socket; stone.setEnabled(false);
      // both sides use the same model: a ring in the team colour under the feet tells them apart (the cosmetics tint does not touch it)
      const ring = MeshBuilder.CreateTorus('ring' + side, { diameter: 2.9, thickness: .17, tessellation: 40 }, this.scene), rm = new StandardMaterial('ringMat' + side, this.scene);
      rm.disableLighting = true; rm.emissiveColor = Color3.FromHexString(TEAM[side]!); rm.alpha = .9; ring.material = rm; ring.parent = holder; ring.position.y = .07; ring.scaling.y = .35; ring.isPickable = false;
      this.titans[side] = { mats: c.materials.filter(m => !m.name.startsWith('HandStone')), holder, body, rig, stone, ring, yaw: side === 0 ? 0 : Math.PI, lean: 0, lie: 0, moving: false, cheer: 0, flail: 0, cheerTarget: false, squash: 0 };
    }
  }

  private stoneMat(kind: Kind, side: Side) { return kind === 'normal' ? this.mats['stone_normal' + side] : this.mats['stone_' + kind]; }

  /** Cosmetics: tint the titan, the island plates and the plain stones of one side. A null colour restores the original look. */
  setLook(side: Side, look: Record<CosmeticKind, string>) {
    const color = (kind: CosmeticKind) => COSMETICS.find(c => c.id === look[kind])?.color ?? null;
    // a tint multiplies the colour the model came with (plate edges and cracks are not white); no tint restores exactly that colour
    const tint = (list: Material[], hex: string | null) => {
      for (const m of list) {
        const pbr = m as Material & { albedoColor?: Color3 }; if (!pbr.albedoColor) continue;
        const base = this.baseAlbedo.get(m) ?? (this.baseAlbedo.set(m, pbr.albedoColor.clone()), pbr.albedoColor.clone());
        pbr.albedoColor = hex ? base.multiply(Color3.FromHexString(hex).toLinearSpace()) : base.clone();
      }
    };
    tint(this.titans[side].mats, color('skin')); tint(this.tileMats[side], color('tiles'));
    const sm = this.mats['stone_normal' + side], hex = color('stone') ?? STONE_COLOR.normal;
    sm.diffuseColor = Color3.FromHexString(hex).toLinearSpace(); sm.emissiveColor = Color3.FromHexString(hex).scale(.12);
  }

  private buildPools() {
    this.stoneTemplate = this.stoneCube(.7, this.mats.stone_normal0, 'stoneT'); this.stoneTemplate.setEnabled(false);
    this.trailTemplate = MeshBuilder.CreateSphere('trailT', { diameter: .5, segments: 6 }, this.scene); this.trailTemplate.material = this.mats.trail; this.trailTemplate.isVisible = false;
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
      const emits = material === this.mats.sky || material === this.mats.skyCore || material === this.mats.trim0 || material === this.mats.trim1 || (material && (material.name.startsWith('aim_') || material.name === 'warnE'));
      if (emits && material instanceof StandardMaterial) result.set(material.emissiveColor.r, material.emissiveColor.g, material.emissiveColor.b, 1); else result.set(0, 0, 0, 0);
      void mesh;
    };
    this.shadows.getShadowMap()!.renderList = this.casters;
  }

  // ---------- per-frame ----------
  /** Pointer position (CSS px relative to the canvas) -> enemy island cell, or null. */
  pick(x: number, y: number): Cell | null { const p = this.pickPoint(x, y); return p && this.cellNear(p, false); }

  /** Pointer (CSS px) -> point on the enemy island plane, in world coordinates. Babylon divides by the hardware scaling level itself,
   *  so CSS px go in unchanged (checked for dpr 1/2/2.5 and the quality steps). */
  pickPoint(x: number, y: number): { x: number; z: number } | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    if (ray.direction.y > -1e-4) return null;
    const t = -ray.origin.y / ray.direction.y;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  /** Nearest enemy cell to a world point; with `clamp` off, null when the point is further than 1.6 cells from any centre. */
  cellNear(p: { x: number; z: number }, clamp: boolean): Cell | null {
    let best: Cell | null = null, bd = Infinity;
    for (const c of map.cells) { const q = cellCentre(c, 1), d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = c; } }
    return best && (clamp || bd < size * 1.6) ? { x: best.x, z: best.z } : null;
  }

  /** Enemy-island cell centre -> screen position in CSS px relative to the canvas. */
  project(c: Cell): { x: number; y: number } {
    this.scene.updateTransformMatrix(true);
    const q = cellCentre(c, 1), rw = this.engine.getRenderWidth(), rh = this.engine.getRenderHeight();
    const v = Vector3.Project(new Vector3(q.x, 0, q.z), Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(rw, rh));
    const el = this.engine.getRenderingCanvas()!, k = el.clientWidth / rw;
    return { x: v.x * k, y: v.y * k };
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

  /** The rig writes every bone from the clips (plus the cheer/flail fallback offsets). Runs after animations, before skinning. */
  private applyBones() { for (const t of this.titans) t?.rig.apply(); }

  private slowTime = 0; private fastTime = 0; private qStep = 0; private baseScale = 1;
  /** One-way quality governor for weak phones: if frames stay slow, draw fewer pixels (up to 3 steps). */
  adaptQuality(frame: number) {
    if (this.qStep === 0 && this.baseScale === 1) this.baseScale = this.engine.getHardwareScalingLevel();
    if (frame > 1 / 38) this.slowTime += frame; else this.slowTime = Math.max(0, this.slowTime - frame);
    if (this.slowTime > 2.5 && this.qStep < 3) {
      this.qStep++; this.slowTime = 0;
      this.engine.setHardwareScalingLevel(this.baseScale * (1 + .3 * this.qStep)); this.engine.resize();
      if (this.qStep === 3) this.shadows.getShadowMap()!.refreshRate = 2;
    }
  }
  get qualityStep() { return this.qStep; }

  /** One steady frame: the camera keeps the same offset, height, tilt and zoom behind the titan and only slides with it
   *  (no zoom, no tilt, no look-ahead). The own island, the titan and the enemy island are always in view. While a throw is held the
   *  camera stands still, so the cell under the pointer is exactly the aimed cell. */
  private updateCamera(b: Battle, dt: number, aiming: boolean) {
    if (this.freezeCamera) return;
    const a0 = b.actors[0], f0 = this.follow, hit = a0.stun > 0 || !!a0.slide;
    this.aimFrozen = aiming && !hit;
    if (!this.aimFrozen) {
      // lazy while knocked about (the hit moves the titan, not the view), snappy otherwise
      f0.tau += ((hit ? .6 : .15) - f0.tau) * Math.min(1, dt * 10);
      if (this.snapCamera || Math.hypot(a0.pos.x - f0.x, a0.pos.z - f0.z) > 9 || a0.falling) { f0.x = a0.pos.x; f0.z = a0.pos.z; }
      else { const kf = 1 - Math.exp(-dt / f0.tau); f0.x += (a0.pos.x - f0.x) * kf; f0.z += (a0.pos.z - f0.z) * kf; }
    }
    const portrait = this.engine.getRenderWidth() < this.engine.getRenderHeight();
    this.camera.fov = (40 + (portrait ? 14 : 0)) * Math.PI / 180;
    const px = f0.x * .9, pz = f0.z;
    const pos = new Vector3(px, 16, pz - 20), target = new Vector3(px, 0, pz + 14);
    const k = this.snapCamera ? 1 : Math.min(1, dt * 12); this.snapCamera = false;
    this.camera.position.copyFrom(Vector3.Lerp(this.camera.position, pos, k));
    this.camera.setTarget(Vector3.Lerp(this.camera.getTarget(), target, k));
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
      if (side === 1 && this.smoothFoe) {
        // online the foe jumps a little with every snapshot: draw it slightly behind its real position and glide
        const v = this.foeVis, dx = a.pos.x - v.x, dz = a.pos.z - v.z;
        if (!v.ok || Math.hypot(dx, dz) > 4 || a.falling) { v.x = a.pos.x; v.z = a.pos.z; v.ok = true; }
        else { const k = Math.min(1, dt * 16); v.x += dx * k; v.z += dz * k; }
        t.holder.position.set(v.x, a.y, v.z);
      } else t.holder.position.set(a.pos.x, a.y, a.pos.z);
      const charging = !!b.charges[side], moving = !a.falling && a.stun <= 0 && Math.hypot(m.x, m.z) > .1 && !a.slide;
      const facing = side === 0 ? 0 : Math.PI;
      const yaw = moving && !charging ? Math.atan2(m.x, m.z) : facing;
      let d = yaw - t.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); t.yaw += d * Math.min(1, dt * 12);
      if (a.falling) t.yaw += dt * 5;
      t.holder.rotation.y = t.yaw;
      // posture: lean back while charging, flat when knocked down, spin and sink while falling
      const targetLean = a.stun > 0 ? -1.35 : a.running && !a.falling ? .2 : 0, targetLie = a.stun > 0 ? 1 : 0;
      t.lean += (targetLean - t.lean) * Math.min(1, dt * (a.stun > 0 ? 14 : 8));
      t.lie += (targetLie - t.lie) * Math.min(1, dt * 10);
      t.body.rotation.x = side === 0 ? t.lean : -t.lean;
      t.body.position.y = t.lie * .5; // the walk clip carries its own body bounce
      // stretch while rising, squash right after landing
      t.squash = Math.max(0, t.squash - dt / .18); const sy = a.air > 0 ? 1.07 : 1 - .12 * t.squash;
      t.body.scaling.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      const rate = charging ? .6 : a.running ? 1.5 : 1, free = !a.falling && a.stun <= 0 && a.air <= 0;
      t.rig.update(dt, moving, rate, charging, free); t.moving = moving;
      this.poseTitan(t, side, a, dt); t.ring.setEnabled(!a.falling);
      const ch = b.charges[side];
      t.stone.setEnabled(!!ch && !a.falling && t.rig.layer > .35);
      if (ch) {
        const k = kindForHold(ch.t);
        t.stone.material = this.stoneMat(k, side);
        const grow = .8 + Math.min(1, ch.t / 2.6) * .8 + (k !== 'normal' ? Math.sin(this.time * 18) * .06 : 0);
        t.stone.scaling.setAll(grow * STONE_HAND); t.stone.rotation.y += dt * 3;
      }
    }
  }

  /** Fallback reactions the clips do not have (cheering, flailing while falling), added on top of the clip pose. The clips own the throw. */
  private poseTitan(t: TitanView, side: Side, a: { falling: boolean; stun: number }, dt: number) {
    const k = (rate: number) => Math.min(1, dt * rate);
    t.cheer += ((t.cheerTarget ? 1 : 0) - t.cheer) * k(6);
    t.flail += ((a.falling ? 1 : 0) - t.flail) * k(10);
    const f = t.flail, c = t.cheer;
    const bob = Math.sin(this.time * 9 + side), flailS = Math.sin(this.time * 17 + side * 2), off = t.rig.off;
    off.set('RightArm', rot(0, 0, -150 * c - (100 + 45 * flailS) * f));
    off.set('RightForeArm', rot(25 * f * flailS, 0, 0));
    off.set('LeftArm', rot(0, 0, 150 * c + (100 - 45 * flailS) * f));
    off.set('Head', rot(c * -12 + f * 18, 0, c * bob * 4));
  }

  /** Visual only: a stone seen right after the throw starts in the thrower's hand and settles onto its flight line within 0.3 s. */
  private shotOffset = new Map<number, Vector3>();
  private updateShots(b: Battle, dt: number) {
    for (const [id, m] of this.shotMeshes) if (!b.shots.some(s => s.id === id)) { m.dispose(); this.shotMeshes.delete(id); this.shotOffset.delete(id); }
    for (const [k, w] of this.warns) { const id = Number(k.split('/')[0]); if (!b.shots.some(s => s.id === id)) { w.dispose(); this.warns.delete(k); } }
    for (const s of b.shots) {
      let m = this.shotMeshes.get(s.id);
      if (!m) { m = this.stoneTemplate.clone('shot' + s.id); m.setEnabled(true); m.material = this.stoneMat(s.kind, s.owner); m.scaling.setAll(s.kind === 'heavy' ? 1.5 : s.kind === 'spin' ? 1.2 : 1); this.shotMeshes.set(s.id, m); }
      const p = shotPosition(s);
      if (!this.shotOffset.has(s.id)) {
        const sock = this.titans[s.owner]?.stone.parent as TransformNode | undefined; let off = Vector3.Zero();
        if (sock && s.elapsed < .15) { sock.computeWorldMatrix(true); off = sock.getAbsolutePosition().subtract(new Vector3(p.x, p.y, p.z)); if (off.length() > 4) off = Vector3.Zero(); }
        this.shotOffset.set(s.id, off);
      }
      const o = this.shotOffset.get(s.id)!, fade = Math.max(0, 1 - s.elapsed / .3); p.x += o.x * fade; p.y += o.y * fade; p.z += o.z * fade;
      m.position.set(p.x, p.y, p.z); m.rotation.x += dt * (s.kind === 'spin' ? 16 : 7); m.rotation.z += dt * 4; m.rotation.y += dt * (s.kind === 'spin' ? 14 : 3);
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
      if (e.type === 'jump') { const t = this.titans[e.side].holder.position; for (let i = 0; i < 4; i++) this.burst({ x: t.x, z: t.z }, .35, this.mats.dust, .15); }
      if (e.type === 'land') { const t = this.titans[e.side]; t.squash = 1; for (let i = 0; i < 7; i++) this.burst({ x: t.holder.position.x, z: t.holder.position.z }, .5, this.mats.dust, .15); }
      if (e.type === 'dodge') { const t = this.titans[e.side].holder.position; for (let i = 0; i < 6; i++) this.burst({ x: t.x, z: t.z }, .6, this.mats.sky, 1.2); }
      if (e.type === 'throw') { this.titans[e.side].lean = .5; this.titans[e.side].rig.release(); }
      if (e.type === 'over') { this.titans[0].cheerTarget = e.winner === 0; this.titans[1].cheerTarget = e.winner === 1; }
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
