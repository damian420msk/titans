// Plate kits sold in the shop: a kit is only a look (stone, cracks, fragments, under-rocks, trim). Rules and HP never depend on it.
export type KitId = 'starter' | 'terracotta' | 'jade' | 'basalt';
export type PlatformKit = Readonly<{ id: KitId; cosmetic: string; name: string; dir: string }>;
/** Order = price order in the shop (the first one is free). */
export const PLATFORM_KITS: readonly PlatformKit[] = [
  { id: 'starter', cosmetic: 'tiles_starter', name: 'Стартовая арена', dir: 'art/platform-skins-v01/starter/' },
  { id: 'terracotta', cosmetic: 'tiles_terracotta', name: 'Терракотовый бастион', dir: 'art/platform-skins-v01/terracotta/' },
  { id: 'jade', cosmetic: 'tiles_jade', name: 'Нефритовая арена', dir: 'art/platform-skins-v01/jade/' },
  { id: 'basalt', cosmetic: 'tiles_basalt', name: 'Базальтовая крепость', dir: 'art/platform-skins-v01/basalt/' },
];
export const DEFAULT_KIT: KitId = 'starter';
/** Kit for a cosmetic id from a profile or from the network (anything unknown falls back to the free kit). */
export const kitOfTiles = (cosmeticId: string | undefined): KitId => PLATFORM_KITS.find(k => k.cosmetic === cosmeticId)?.id ?? DEFAULT_KIT;
export const kitInfo = (id: KitId): PlatformKit => PLATFORM_KITS.find(k => k.id === id)!;
/** Every file of one kit; the same names in every kit folder. */
export function kitAssetNames(surfaces: readonly string[], fractures: readonly string[], underrocks: readonly number[], palettes: readonly string[]): string[] {
  const names: string[] = [];
  for (const s of surfaces) { names.push(`tile_${s}_intact`); for (const f of fractures) names.push(`tile_${s}_${f}_cracked`, `tile_${s}_${f}_fragments`); }
  for (const r of underrocks) names.push(`underrock_${r}`);
  for (const p of palettes) names.push(`edge_${p}`, `corner_rect90_${p}`);
  return names;
}
