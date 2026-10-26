// Which titan models exist and who stands against whom. Presentation only: the battle rules never read this.
// Roster v1 (docs/art/titan-rift-v1/ROSTER.md): all titans share one 24-joint skeleton and one set of clips, so any of them plays any match.
export type TitanId = 'novice' | 'atlas' | 'oceanus' | 'hyperion' | 'prometheus' | 'kronos';
export const TITAN_IDS: TitanId[] = ['novice', 'atlas', 'oceanus', 'hyperion', 'prometheus', 'kronos'];
export const TITANS: Record<TitanId, { name: string; file: string }> = {
  novice: { name: 'Новичок', file: 'art/titans-rift-v1/novice.glb' },
  atlas: { name: 'Атлас', file: 'art/titans-rift-v1/atlas.glb' },
  oceanus: { name: 'Океан', file: 'art/titans-rift-v1/oceanus.glb' },
  hyperion: { name: 'Гиперион', file: 'art/titans-rift-v1/hyperion.glb' },
  prometheus: { name: 'Прометей', file: 'art/titans-rift-v1/prometheus.glb' },
  kronos: { name: 'Кронос', file: 'art/titans-rift-v1/kronos.glb' },
};
/** Shop item id → model ('titan_atlas' → 'atlas'); anything unknown (also the retired titan_blue / titan_red) falls back to the starter. */
export const titanOf = (cosmeticId: string | undefined): TitanId => TITAN_IDS.find(id => `titan_${id}` === cosmeticId) ?? TITAN_IDS[0]!;
/** The first model that differs from `mine` (two titans on one arena never look alike). */
export const otherTitan = (mine: TitanId): TitanId => TITAN_IDS.find(id => id !== mine) ?? mine;
/** The opponent's model for a bot match: a random titan from the whole roster except the player's own,
 *  so the player sees the paid ones in battle before buying them. */
export function botTitan(mine: TitanId, rnd: () => number): TitanId {
  const rest = TITAN_IDS.filter(id => id !== mine); return rest.length ? rest[Math.floor(rnd() * rest.length) % rest.length]! : mine;
}
/** The model shown for a human opponent: their own choice, unless it equals ours — then another one, so the sides stay distinguishable. */
export const foeTitan = (mine: TitanId, theirs: TitanId): TitanId => theirs === mine ? otherTitan(mine) : theirs;
