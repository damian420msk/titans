// Which titan models exist and who stands against whom. Presentation only: the battle rules never read this.
export type TitanId = 'blue' | 'red';
export const TITAN_IDS: TitanId[] = ['blue', 'red'];
export const TITANS: Record<TitanId, { name: string; file: string }> = {
  blue: { name: 'Бирюзовый', file: 'art/titans-v04/titan_turquoise_v04_web.glb' },
  red: { name: 'Красный', file: 'art/titans-red-v01/titan_red_v01_web.glb' },
};
/** Shop item id → model ('titan_red' → 'red'); anything unknown falls back to the first model. */
export const titanOf = (cosmeticId: string | undefined): TitanId => TITAN_IDS.find(id => `titan_${id}` === cosmeticId) ?? TITAN_IDS[0]!;
/** The first model that differs from `mine` (two titans on one arena never look alike). */
export const otherTitan = (mine: TitanId): TitanId => TITAN_IDS.find(id => id !== mine) ?? mine;
/** The opponent's model for a bot match: a random one of the models the player did not pick (one for now, more later). */
export function botTitan(mine: TitanId, rnd: () => number): TitanId {
  const rest = TITAN_IDS.filter(id => id !== mine); return rest.length ? rest[Math.floor(rnd() * rest.length) % rest.length]! : mine;
}
/** The model shown for a human opponent: their own choice, unless it equals ours — then the other one, so the sides stay distinguishable. */
export const foeTitan = (mine: TitanId, theirs: TitanId): TitanId => theirs === mine ? otherTitan(mine) : theirs;
