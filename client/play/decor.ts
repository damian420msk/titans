// Island decor (STYLE_BRIEF «Остров», items 4–5): marble props on ledges around each arena, outside the cells.
// Presentation only: never pickable, never collides, never touches the rules. Art: public/art/decor-v01 (tools/decor_blender.py).
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Side } from '../../shared/world';
import { assetUrl } from './assets';

const PROPS = ['column', 'column_broken', 'brazier', 'vase', 'banner', 'bush', 'rubble', 'plinth'] as const;
type Prop = typeof PROPS[number];
/** One island's layout in its own frame: x across (− left, + right, seen from behind the owner), z from the front edge (0) to the back (1).
 *  `out` = how far past the arena edge the ledge stands, metres. Mirrored for side 1 so both islands read the same way. */
const LAYOUT: { prop: Prop; x: number; z: number; out: number; yaw: number }[] = [
  { prop: 'column', x: -1, z: 1, out: 1.5, yaw: 0 }, { prop: 'column', x: 1, z: 1, out: 1.5, yaw: 0 },
  { prop: 'banner', x: -1, z: 0, out: 1.5, yaw: 0 }, { prop: 'banner', x: 1, z: 0, out: 1.5, yaw: 0 },
  { prop: 'brazier', x: -1, z: .45, out: 1.5, yaw: 0 }, { prop: 'brazier', x: 1, z: .45, out: 1.5, yaw: 0 },
  { prop: 'vase', x: -1, z: .2, out: 1.5, yaw: .6 }, { prop: 'bush', x: 1, z: .22, out: 1.5, yaw: 1.3 },
  { prop: 'column_broken', x: 1, z: .72, out: 1.5, yaw: 2.1 }, { prop: 'bush', x: -1, z: .7, out: 1.5, yaw: .4 },
  { prop: 'rubble', x: -1, z: .88, out: 1.5, yaw: 1.7 }, { prop: 'vase', x: 1, z: .9, out: 1.5, yaw: 2.6 },
];

export class IslandDecor {
  private flames: { mesh: AbstractMesh; phase: number }[] = [];

  /** halfWidth, front, depth: the arena rectangle of side 0 (x ∈ ±halfWidth, z from −front to −front−depth); side 1 is its mirror. */
  static async create(scene: Scene, halfWidth: number, front: number, depth: number, team: readonly string[]) {
    const d = new IslandDecor();
    const lib = new Map<Prop, AssetContainer>();
    await Promise.all(PROPS.map(async p => lib.set(p, await LoadAssetContainerAsync(assetUrl(`art/decor-v01/${p}.glb`), scene, { pluginExtension: '.glb' }))));
    // one cloth material per side (the team colour); everything else shares the file materials
    const cloth = [0, 1].map(side => { const m = (lib.get('banner')!.materials.find(x => x.name === 'TeamCloth') as PBRMaterial).clone(`TeamCloth${side}`); m.albedoColor = Color3.FromHexString(team[side]!).toLinearSpace(); return m; });
    for (const side of [0, 1] as Side[]) {
      const sign = side === 0 ? 1 : -1, root = new TransformNode(`decor-island-${side}`, scene);
      const still = new Map<string, { material: Material; list: Mesh[] }>(); // static parts, merged per material below: about 7 draw calls per island instead of ~80
      for (const it of LAYOUT) {
        // the ledge sits just past the side edge (x) at a point along the island's length (z)
        const x = sign * it.x * (halfWidth + it.out), z = sign * -(front + it.z * depth);
        for (const prop of ['plinth', it.prop] as Prop[]) {
          const inst = lib.get(prop)!.instantiateModelsToScene(n => `decor:${side}:${prop}:${n}`, false, { doNotInstantiate: true });
          const node = inst.rootNodes[0] as TransformNode; node.parent = root;
          node.position.set(x, 0, z); node.rotationQuaternion = null; node.rotation.y = it.yaw + (side ? Math.PI : 0);
          // the banners face the other island, in the side's own team colour
          if (prop === 'banner') node.rotation.y = side ? Math.PI : 0;
          node.computeWorldMatrix(true);
          for (const m of node.getChildMeshes(false)) {
            if (!(m instanceof Mesh) || !m.material) continue;
            m.isPickable = false; m.checkCollisions = false; m.receiveShadows = true; m.computeWorldMatrix(true);
            if (m.material.name === 'TeamCloth') m.material = cloth[side]!;
            if (m.material.name === 'Flame' || m.material.name === 'FlameCore') {
              // fire ignores the sun, feeds the glow layer and flickers (so it stays a mesh of its own)
              const f = m.material as PBRMaterial; f.unlit = true; f.emissiveColor = f.albedoColor.clone();
              d.flames.push({ mesh: m, phase: d.flames.length * 1.7 }); continue;
            }
            // merge only meshes with the same material and the same vertex attributes
            const key = `${m.material.uniqueId}|${m.getVerticesDataKinds().sort().join(',')}`;
            const g = still.get(key) ?? { material: m.material, list: [] }; g.list.push(m); still.set(key, g);
          }
        }
      }
      for (const { material, list } of still.values()) {
        const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
        if (merged) { merged.name = `decor:${side}:${material.name}`; merged.parent = root; merged.isPickable = false; merged.receiveShadows = true; merged.freezeWorldMatrix(); }
      }
    }
    for (const c of lib.values()) c.removeAllFromScene();
    return d;
  }

  /** Fire in the braziers: a cheap scale flicker, no particles. */
  update(time: number) {
    for (const f of this.flames) { const k = 1 + Math.sin(time * 9 + f.phase) * .08 + Math.sin(time * 23 + f.phase * 2) * .05; f.mesh.scaling.set(1 / k, k, 1 / k); }
  }
}
