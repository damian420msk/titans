import type { Side } from '../shared/world';

/** Local presentation settings only. ART-005 approved v02; global side fixes the appearance.
 * GLB: metres, feet at origin, forward +Z; model never defines gameplay geometry.
 */
export type VisualAsset = { url: string; scale?: number; yaw?: number; visualHeight?: number; nativeHeight?: number };
export type VisualAssets = { characters: [VisualAsset | null, VisualAsset | null]; environment: VisualAsset | null };
export const visualAssets: VisualAssets = { characters: ['teal','coral'].map(color=>({url:`/art/titans-v02/titan_${color}_v02.glb`,visualHeight:3.2,nativeHeight:3.2})) as [VisualAsset,VisualAsset], environment: null };
export const characterAsset = (assets: VisualAssets, side: Side) => assets.characters[side];
