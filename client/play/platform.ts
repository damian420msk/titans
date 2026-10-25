import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Material } from '@babylonjs/core/Materials/material';
import { cellStyle, cellBoundary, tileState, tileAsset, platformCatalog,
  type PlatformCellStyle, type TileState, type GridCell } from '../../shared/platformStyle';
import type { Side, Point } from '../../shared/world';
import { assetUrl } from './assets';

type CellVisual = { side: Side; owner: string; root: TransformNode; style: PlatformCellStyle; slab: TransformNode | null;
  shown: TileState; boundaryCount: number; anchorNames: string[] };
type Piece = { mesh: AbstractMesh; base: Vector3; rotation: Quaternion; velocity: Vector3; spin: Vector3 };
type FractureEffect = { owner: string; root: TransformNode; pieces: Piece[]; elapsed: number };

/** Presentation only: owns no HP, collisions, movement rules or network state. */
export class PlatformRenderer {
  private scene: Scene;
  private templates = new Map<string, AssetContainer>();
  private islands: TransformNode[] = [];
  private cells: [Map<string, CellVisual>, Map<string, CellVisual>] = [new Map(), new Map()];
  private effects = new Map<string, FractureEffect>();
  private disposed = false;
  private maxFragments = 64;
  private tileTemplates: [Map<string,AssetContainer>,Map<string,AssetContainer>] = [new Map(),new Map()];
  private tileMaterials: Material[] = [];
  private localSeat: Side = 0;
  private grid!: readonly GridCell[];
  private centre!: (c: GridCell, side: Side) => Point;
  private cellSize = 2.8;

  private constructor(scene: Scene) { this.scene = scene; }

  static async create(scene: Scene, cells: readonly GridCell[], centre: (c: GridCell, side: Side) => Point, size: number) {
    if (size !== platformCatalog.cellSize) throw new Error('Platform art/grid size mismatch');
    const view = new PlatformRenderer(scene);
    view.grid=cells;view.centre=centre;view.cellSize=size;
    await view.load();
    view.build(cells, centre, size);
    scene.onDisposeObservable.add(() => view.dispose());
    return view;
  }

  private async load() {
    const names: string[] = [];
    for (const s of platformCatalog.surfaces) {
      names.push(`tile_${s}_intact`);
      for (const f of platformCatalog.fractures) names.push(`tile_${s}_${f}_cracked`, `tile_${s}_${f}_fragments`);
    }
    for (const r of platformCatalog.underrocks) names.push(`underrock_${r}`);
    for (const p of ['teal', 'coral']) names.push(`edge_${p}`, `corner_${p}`);
    const assets = await Promise.all(names.map(async name => [name,
      await LoadAssetContainerAsync(assetUrl(`${platformCatalog.assetRoot}${name}.glb`), this.scene, { pluginExtension: '.glb' })] as const));
    const sharedMaterials = new Map<string, Material>();
    for (const [name, asset] of assets) {
      for (const mesh of asset.meshes) {
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.receiveShadows = true;
        if (mesh.material) {
          const shared = sharedMaterials.get(mesh.material.name);
          if (shared) mesh.material = shared;
          else sharedMaterials.set(mesh.material.name, mesh.material);
        }
      }
      this.templates.set(name, asset);
    }
    const stone=sharedMaterials.get('PlatformStone_v05')!;
    for(const side of [0,1] as Side[]){
      const material=stone.clone(`platform-stone-${side}`)!;this.tileMaterials[side]=material;
      for(const [name,base] of this.templates){if(!name.startsWith('tile_'))continue;
        const entries=base.instantiateModelsToScene(n=>`source-${side}/${n}`,false,{doNotInstantiate:true});
        const nodes=entries.rootNodes.flatMap(n=>[n,...n.getDescendants(false)]);
        const container=new AssetContainer(this.scene);
        container.meshes=nodes.filter(n=>n instanceof AbstractMesh) as AbstractMesh[];
        container.transformNodes=nodes.filter(n=>n instanceof TransformNode&&!(n instanceof AbstractMesh)) as TransformNode[];
        container.rootNodes=entries.rootNodes;
        for(const m of container.meshes)if(m.getTotalVertices()>0)m.material=material;
        container.removeAllFromScene();this.tileTemplates[side].set(name,container);
      }
    }
  }

  private spawn(asset: string, parent: TransformNode, name: string, side: Side = 0) {
    const group = new TransformNode(name, this.scene);
    group.parent = parent;
    const entries = (this.tileTemplates[side].get(asset)??this.templates.get(asset))!.instantiateModelsToScene(n => `${name}/${n}`, false, { doNotInstantiate: false });
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
        const slab = this.spawn(tileAsset(style, 'intact'), root, `platform-slab:${owner}`,side);
        slab.rotation.y = style.rotation * Math.PI / 2 + islandYaw;
        const rock = this.spawn(`underrock_${style.underrockId}`, root, `platform-rock:${owner}`);
        rock.rotation.y = (style.seed >>> 16 & 3) * Math.PI / 2 + islandYaw;
        const boundary = cellBoundary(c, occupied), anchorNames: string[] = [];
        for (const edge of boundary.edges) {
          const segment = this.spawn(`edge_${style.paletteId}`, root, `platform-edge:${owner}:${edge.dx},${edge.dz}`);
          segment.rotation.y = edge.yaw + islandYaw;
          segment.metadata = { ownerCell: owner, boundaryDirection: [edge.dx, edge.dz] };
        }
        for (const corner of boundary.corners) {
          const cap = this.spawn(`corner_${style.paletteId}`, root, `platform-corner:${owner}:${corner.dx},${corner.dz}`);
          cap.position.set(sign * corner.dx * size / 2, 0, sign * corner.dz * size / 2);
          const anchor = new TransformNode(`platform-decoration-anchor:${owner}:${corner.dx},${corner.dz}`, this.scene);
          anchor.parent = root; anchor.position.copyFrom(cap.position); anchor.position.y = .015;
          anchor.metadata = { ownerCell: owner, role: 'future-corner-decoration', collision: false };
          anchorNames.push(anchor.name);
        }
        this.cells[side].set(key, { side,owner, root, style, slab, shown: 'intact', boundaryCount: boundary.edges.length, anchorNames });
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
      if (next === 'hole') {
        // Root owns slab, underrock, edge pieces and decoration sockets together.
        cell.root.setEnabled(false);
        this.fracture(cell, this.islands[side]);
      } else {
        cell.root.setEnabled(true);
        cell.slab = this.spawn(tileAsset(cell.style, next), cell.root, `platform-slab:${cell.owner}`,side);
        cell.slab.rotation.y = cell.style.rotation * Math.PI / 2 + side * Math.PI;
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

  private fracture(cell: CellVisual, island: TransformNode) {
    const count = this.templates.get(tileAsset(cell.style, 'fragments'))!.meshes.filter(m => m.getTotalVertices() > 0).length;
    while (this.effects.size && this.diagnosticsFragmentCount() + count > this.maxFragments) this.cancelEffect(this.effects.keys().next().value!);
    const root = this.spawn(tileAsset(cell.style, 'fragments'), island, `platform-debris:${cell.owner}`,cell.side);
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
  materials(side: Side) { return [this.tileMaterials[side]]; }
  configurePhysicalSeat(seat: Side) {
    if(seat===this.localSeat)return;
    this.clearEffects();for(const island of this.islands)island.dispose(false,false);
    this.islands.length=0;this.cells[0].clear();this.cells[1].clear();this.localSeat=seat;
    this.build(this.grid,this.centre,this.cellSize);
  }

  /** Read-only diagnostics used by the local regression and visual review. */
  diagnostics() {
    return { styleVersion: platformCatalog.version, activeEffects: this.effects.size,
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
    for (const asset of this.templates.values()) asset.dispose();
    for(const list of this.tileTemplates)for(const asset of list.values())asset.dispose();
    for(const material of this.tileMaterials)material.dispose();
    this.cells[0].clear(); this.cells[1].clear(); this.templates.clear();
  }
}
