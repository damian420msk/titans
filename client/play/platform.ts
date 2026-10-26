import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Material } from '@babylonjs/core/Materials/material';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { cellStyle, cellBoundary, tileState, tileAsset, platformCatalog,
  type PlatformCellStyle, type TileState, type GridCell } from '../../shared/platformStyle';
import { DEFAULT_KIT, kitInfo, kitAssetNames, type KitId } from '../../shared/platformKits';
import type { Side, Point } from '../../shared/world';
import { assetUrl } from './assets';

type CellVisual = { side: Side; kit: KitId; owner: string; root: TransformNode; style: PlatformCellStyle; slab: TransformNode | null;
  shown: TileState; boundaryCount: number; anchorNames: string[]; glow: AbstractMesh | null };
type Piece = { mesh: AbstractMesh; base: Vector3; rotation: Quaternion; velocity: Vector3; spin: Vector3 };
type FractureEffect = { owner: string; root: TransformNode; pieces: Piece[]; elapsed: number };

/** Presentation only: owns no HP, collisions, movement rules or network state. */
export class PlatformRenderer {
  private scene: Scene;
  /** Loaded kits (templates by asset name). A kit is a look only; the two islands may use different kits. */
  private kits = new Map<KitId, Map<string, AssetContainer>>();
  private loading = new Map<KitId, Promise<void>>();
  private sideKit: [KitId, KitId] = [DEFAULT_KIT, DEFAULT_KIT];
  private kitJob = 0;
  private keep = new Set<KitId>();
  private islands: TransformNode[] = [];
  private cells: [Map<string, CellVisual>, Map<string, CellVisual>] = [new Map(), new Map()];
  private effects = new Map<string, FractureEffect>();
  private disposed = false;
  private maxFragments = 64;
  private materialsOf = new Map<KitId, Material[]>();
  private localSeat: Side = 0;
  private grid!: readonly GridCell[];
  private centre!: (c: GridCell, side: Side) => Point;
  private cellSize = 2.8;
  /** Gold light inside a cracked slab: the cracks are real cuts through it, so a glowing sheet inside shows only through them (STYLE_BRIEF «Повреждения»). */
  private crackGlow: Mesh | null = null;

  private constructor(scene: Scene) { this.scene = scene; }

  static async create(scene: Scene, cells: readonly GridCell[], centre: (c: GridCell, side: Side) => Point, size: number) {
    if (size !== platformCatalog.cellSize) throw new Error('Platform art/grid size mismatch');
    const view = new PlatformRenderer(scene);
    view.grid=cells;view.centre=centre;view.cellSize=size;
    await view.loadKit(DEFAULT_KIT);
    view.build(cells, centre, size);
    scene.onDisposeObservable.add(() => view.dispose());
    return view;
  }

  private loadKit(kit: KitId): Promise<void> {
    if (this.kits.has(kit)) return Promise.resolve();
    let job = this.loading.get(kit);
    if (!job) {
      job = (async () => {
        const root = kitInfo(kit).dir;
        const names = kitAssetNames(platformCatalog.surfaces, platformCatalog.fractures, platformCatalog.underrocks, ['teal', 'coral']);
        const assets = await Promise.all(names.map(async name => [name,
          await LoadAssetContainerAsync(assetUrl(`${root}${name}.glb`), this.scene, { pluginExtension: '.glb' })] as const));
        if (this.disposed) { for (const [, asset] of assets) asset.dispose(); return; }
        // the same material appears in many files: share one instance per kit (3 plate materials for both palettes)
        const shared = new Map<string, Material>(), templates = new Map<string, AssetContainer>();
        for (const [name, asset] of assets) {
          for (const mesh of asset.meshes) {
            mesh.isPickable = false; mesh.checkCollisions = false; mesh.receiveShadows = true;
            if (mesh.material) { const own = shared.get(mesh.material.name); if (own) mesh.material = own; else shared.set(mesh.material.name, mesh.material); }
          }
          templates.set(name, asset);
        }
        this.materialsOf.set(kit, [...shared.values()]);
        this.kits.set(kit, templates);
      })().finally(() => this.loading.delete(kit));
      this.loading.set(kit, job);
    }
    return job;
  }

  /** Load a kit ahead of time and keep it until a different one is preloaded (menu idle: the bot island and the player's own kit). */
  preloadKit(kit: KitId, keep?: KitId) { const all = [kit, ...(keep ? [keep] : [])]; this.keep = new Set(all); return Promise.all(all.map(k => this.loadKit(k))).then(() => undefined, () => undefined); }

  private disposeKit(kit: KitId) {
    const templates = this.kits.get(kit); if (!templates) return;
    for (const asset of templates.values()) asset.dispose();
    for (const material of this.materialsOf.get(kit) ?? []) material.dispose();
    this.kits.delete(kit); this.materialsOf.delete(kit);
  }

  /** Choose the plate kit of each island (own side 0, opponent side 1). Loads what is missing, rebuilds changed islands, frees kits nobody uses. Call between matches. */
  async setKits(kit0: KitId, kit1: KitId) {
    const job = ++this.kitJob; // a newer call wins even if an older download finishes later
    try { await Promise.all([this.loadKit(kit0), this.loadKit(kit1)]); } catch (e) { console.warn('plate kit failed to load, keeping the current look', e); return; }
    if (this.disposed || job !== this.kitJob) return;
    const want: [KitId, KitId] = [kit0, kit1];
    if (want[0] === this.sideKit[0] && want[1] === this.sideKit[1]) return;
    this.clearEffects();
    this.sideKit = want; this.rebuild();
    for (const kit of [...this.kits.keys()]) if (kit !== want[0] && kit !== want[1] && kit !== DEFAULT_KIT && !this.keep.has(kit)) this.disposeKit(kit);
  }

  private spawn(asset: string, parent: TransformNode, name: string, kit: KitId) {
    const group = new TransformNode(name, this.scene);
    group.parent = parent;
    const entries = this.kits.get(kit)!.get(asset)!.instantiateModelsToScene(n => `${name}/${n}`, false, { doNotInstantiate: false });
    for (const node of entries.rootNodes) node.parent = group;
    for (const mesh of group.getChildMeshes()) {
      mesh.isPickable = false; mesh.checkCollisions = false;
    }
    group.metadata = { platformAsset: asset };
    return group;
  }

  private build(cells: readonly GridCell[], centre: (c: GridCell, side: Side) => Point, size: number) {
    const occupied = new Set(cells.map(c => `${c.x},${c.z}`));
    for (const side of [0, 1] as Side[]) {
      const island = new TransformNode(`platform-island-${side}`, this.scene);
      this.islands.push(island);
      const physical=(side^this.localSeat) as Side;
      const islandId = `arena-island-${physical}`, islandYaw = side * Math.PI, sign = side === 0 ? 1 : -1;
      for (const c of cells) {
        const key = `${c.x},${c.z}`, owner = `${islandId}/${key}`, p = centre(c, side);
        const style = cellStyle(islandId, c, physical === 0 ? 'teal' : 'coral');
        const root = new TransformNode(`platform-cell:${owner}`, this.scene);
        root.parent = island; root.position.set(p.x, 0, p.z); root.metadata = { ownerCell: owner, style };
        root.freezeWorldMatrix();
        const kit = this.sideKit[side], slab = this.spawn(tileAsset(style, 'intact'), root, `platform-slab:${owner}`, kit);
        slab.rotation.y = style.rotation * Math.PI / 2 + islandYaw;
        const rock = this.spawn(`underrock_${style.underrockId}`, root, `platform-rock:${owner}`, kit);
        rock.rotation.y = (style.seed >>> 16 & 3) * Math.PI / 2 + islandYaw;
        const boundary = cellBoundary(c, occupied), anchorNames: string[] = [];
        for (const edge of boundary.edges) {
          const segment = this.spawn(`edge_${style.paletteId}`, root, `platform-edge:${owner}:${edge.dx},${edge.dz}`, kit);
          segment.rotation.y = edge.yaw + islandYaw;
          segment.metadata = { ownerCell: owner, boundaryDirection: [edge.dx, edge.dz] };
        }
        for (const corner of boundary.corners) {
          // rect90 cap: origin on the boundary corner, canonical +X,+Z; yaw turns it to the real corner (kit handoff, section 7)
          const cap = this.spawn(`corner_rect90_${style.paletteId}`, root, `platform-corner:${owner}:${corner.dx},${corner.dz}`, kit);
          cap.position.set(sign * corner.dx * size / 2, 0, sign * corner.dz * size / 2);
          cap.rotation.y = Math.atan2(corner.dx, corner.dz) - Math.PI / 4 + islandYaw;
          const anchor = new TransformNode(`platform-decoration-anchor:${owner}:${corner.dx},${corner.dz}`, this.scene);
          anchor.parent = root; anchor.position.copyFrom(cap.position); anchor.position.y = .015;
          anchor.metadata = { ownerCell: owner, role: 'future-corner-decoration', collision: false };
          anchorNames.push(anchor.name);
        }
        this.cells[side].set(key, { side, kit, owner, root, style, slab, shown: 'intact', boundaryCount: boundary.edges.length, anchorNames, glow: null });
        for(const node of root.getDescendants(false))if(node instanceof TransformNode)node.freezeWorldMatrix();
      }
    }
  }

  update(floors: [ReadonlyMap<string, number>, ReadonlyMap<string, number>], dt: number) {
    for (const side of [0, 1] as Side[]) for (const [key, cell] of this.cells[side]) {
      const next = tileState(floors[side].get(key) ?? 0);
      if (next === cell.shown) continue;
      this.cancelEffect(cell.owner);
      cell.slab?.dispose(false, false); cell.slab = null;
      cell.glow?.dispose(); cell.glow = null;
      if (next === 'hole') {
        // Root owns slab, underrock, edge pieces and decoration sockets together.
        cell.root.setEnabled(false);
        this.fracture(cell, this.islands[side]);
      } else {
        cell.root.setEnabled(true);
        cell.slab = this.spawn(tileAsset(cell.style, next), cell.root, `platform-slab:${cell.owner}`, cell.kit);
        cell.slab.rotation.y = cell.style.rotation * Math.PI / 2 + side * Math.PI;
        if (next === 'cracked') { const g = this.glowTemplate().createInstance(`platform-crack-glow:${cell.owner}`); g.parent = cell.root; g.position.y = -.03; g.isPickable = false; cell.glow = g; }
        for(const node of [cell.slab,...cell.slab.getDescendants(false)])if(node instanceof TransformNode)node.freezeWorldMatrix();
      }
      cell.shown = next;
    }
    for (const [owner, effect] of this.effects) {
      effect.elapsed += dt;
      const t = effect.elapsed;
      if (t >= .85) { this.cancelEffect(owner); continue; }
      for (const piece of effect.pieces) {
        piece.mesh.position.copyFrom(piece.base).addInPlace(piece.velocity.scale(t));
        piece.mesh.position.y -= 5.6 * t * t;
        piece.mesh.rotationQuaternion = piece.rotation.multiply(Quaternion.RotationYawPitchRoll(piece.spin.y*t, piece.spin.x*t, piece.spin.z*t));
        piece.mesh.scaling.setAll(t < .55 ? 1 : Math.max(0, (.85-t)/.3));
      }
    }
  }

  private glowTemplate() {
    if (!this.crackGlow) {
      // a sheet 3 cm under the top (deeper, the crack walls hide it), a little smaller than the slab so it never shows past the chamfered rim
      const m = MeshBuilder.CreateGround('platform-crack-glow', { width: this.cellSize - .14, height: this.cellSize - .14 }, this.scene);
      const mat = new StandardMaterial('crackGlow', this.scene); mat.disableLighting = true; mat.emissiveColor = Color3.FromHexString('#FFB938'); mat.diffuseColor = Color3.Black();
      m.material = mat; m.isPickable = false; m.isVisible = false; this.crackGlow = m; // the template itself is never drawn, only its instances
    }
    return this.crackGlow;
  }

  private fracture(cell: CellVisual, island: TransformNode) {
    const count = this.kits.get(cell.kit)!.get(tileAsset(cell.style, 'fragments'))!.meshes.filter(m => m.getTotalVertices() > 0).length;
    while (this.effects.size && this.diagnosticsFragmentCount() + count > this.maxFragments) this.cancelEffect(this.effects.keys().next().value!);
    const root = this.spawn(tileAsset(cell.style, 'fragments'), island, `platform-debris:${cell.owner}`, cell.kit);
    root.position.copyFrom(cell.root.position);
    root.rotation.y = cell.style.rotation * Math.PI / 2 + cell.side * Math.PI;
    const pieces = root.getChildMeshes().filter(m => m.getTotalVertices() > 0).map((mesh, i): Piece => {
      const n = (cell.style.seed ^ Math.imul(i+1, 0x45d9f3b)) >>> 0;
      const c = mesh.position;
      return { mesh, base: c.clone(), rotation: mesh.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(mesh.rotation),
        velocity: new Vector3(c.x*.27 + ((n&31)/31-.5)*.3, -.15 - (n>>>5&15)*.018, c.z*.27),
        spin: new Vector3(.35 + (n>>>9&15)*.04, ((n>>>13&31)/31-.5)*.9, -.65 + (n>>>18&31)*.04) };
    });
    root.metadata = { ownerCell: cell.owner, effect: 'individual-fragments', lifetimeSeconds: .85 };
    this.effects.set(cell.owner, { owner: cell.owner, root, pieces, elapsed: 0 });
  }

  private cancelEffect(owner: string) {
    const effect = this.effects.get(owner);
    if (effect) { effect.root.dispose(false, false); this.effects.delete(owner); }
  }
  clearEffects() { for (const owner of [...this.effects.keys()]) this.cancelEffect(owner); }
  private diagnosticsFragmentCount() { let n=0; for (const e of this.effects.values()) n+=e.pieces.length; return n; }
  setFragmentBudget(max: number) {
    this.maxFragments = Math.max(4, max);
    while (this.effects.size && this.diagnosticsFragmentCount() > this.maxFragments) this.cancelEffect(this.effects.keys().next().value!);
  }
  configurePhysicalSeat(seat: Side) {
    if(seat===this.localSeat)return;
    this.localSeat=seat;this.rebuild();
  }
  private rebuild() {
    this.clearEffects();for(const island of this.islands)island.dispose(false,false);
    this.islands.length=0;this.cells[0].clear();this.cells[1].clear();
    this.build(this.grid,this.centre,this.cellSize);
  }

  /** Read-only diagnostics used by the local regression and visual review. */
  diagnostics() {
    return { styleVersion: platformCatalog.version, kits: [...this.sideKit], loadedKits: [...this.kits.keys()], activeEffects: this.effects.size,
      fragmentMeshes: [...this.effects.values()].reduce((n,e) => n+e.pieces.length,0),
      cells: this.cells.flatMap((map,side) => [...map].map(([key,c]) => ({ side,key,owner:c.owner,style:c.style,state:c.shown,
        enabled:c.root.isEnabled(),slab:c.slab?.metadata?.platformAsset ?? null,
        boundaryCount:c.boundaryCount,anchorNames:c.anchorNames,
        visibleMeshes:c.root.getChildMeshes().filter(m => m.isEnabled() && m.isVisible && m.getTotalVertices()>0).length }))) };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clearEffects();
    for (const island of this.islands) island.dispose(false, false);
    for (const kit of [...this.kits.keys()]) this.disposeKit(kit);
    this.cells[0].clear(); this.cells[1].clear();
  }
}
