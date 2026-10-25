// Cosmetic catalog only. Never derives appearance from HP or a viewer's side.
import catalog from '../public/art/platform-v05/style.json' with { type: 'json' };

export type SurfaceId = 'a' | 'b' | 'c';
export type FractureId = 'f0' | 'f1' | 'f2';
export type PaletteId = 'teal' | 'coral' | 'sand';
export type TileState = 'intact' | 'cracked' | 'hole';
export type GridCell = { x: number; z: number };
export type PlatformCellStyle = Readonly<{
  version: string; islandId: string; surfaceId: SurfaceId; fractureId: FractureId;
  paletteId: PaletteId; ornament: string; rotation: 0 | 1 | 2 | 3; seed: number; underrockId: number;
}>;
export const platformCatalog = catalog;

export function styleHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
}

export function cellStyle(islandId: string, c: GridCell, paletteId: PaletteId, seed = catalog.seed): PlatformCellStyle {
  const h = styleHash(`${catalog.version}|${seed}|${islandId}|${c.x},${c.z}`);
  const surfaceId: SurfaceId = h % 10 < 5 ? 'a' : h % 10 < 7 ? 'b' : 'c';
  return Object.freeze({ version: catalog.version, islandId, surfaceId,
    fractureId: catalog.fractures[(h >>> 4) % 3] as FractureId, paletteId,
    ornament: catalog.ornaments[surfaceId], rotation: (h >>> 8 & 3) as 0 | 1 | 2 | 3,
    seed: h, underrockId: 1 + (h >>> 12) % 3 });
}

export const tileState = (hp: number): TileState => hp >= 2 ? 'intact' : hp === 1 ? 'cracked' : 'hole';
export const tileAsset = (s: PlatformCellStyle, state: Exclude<TileState, 'hole'> | 'fragments') =>
  state === 'intact' ? `tile_${s.surfaceId}_intact` : `tile_${s.surfaceId}_${s.fractureId}_${state}`;

/** Static map perimeter, deliberately independent of holes and tile rotation. */
export function cellBoundary(c: GridCell, occupied: ReadonlySet<string>) {
  const has = (dx: number, dz: number) => occupied.has(`${c.x + dx},${c.z + dz}`);
  const edges = [{ dx: 0, dz: 1, yaw: 0 }, { dx: 1, dz: 0, yaw: Math.PI / 2 },
    { dx: 0, dz: -1, yaw: Math.PI }, { dx: -1, dz: 0, yaw: -Math.PI / 2 }].filter(e => !has(e.dx, e.dz));
  const corners = ([-1, 1] as const).flatMap(dx => ([-1, 1] as const).filter(dz => !has(dx, 0) && !has(0, dz)).map(dz => ({ dx, dz })));
  return { edges, corners };
}
