// Player profile, upgrades, cosmetics, coin rewards and rating. Pure data and functions: used by the server (authoritative) and the client (display).
import { makeMods, type Mods } from './battle.ts';
import type { Difficulty } from './bot.ts';

export type UpgradeId = 'bag' | 'hands' | 'legs' | 'quarry' | 'plates';
export type CosmeticKind = 'skin' | 'tiles' | 'stone';
export type Upgrade = { id: UpgradeId; name: string; desc: string; costs: number[]; icon: string };
export type Cosmetic = { id: string; kind: CosmeticKind; name: string; cost: number; color: string | null };

export const UPGRADES: Upgrade[] = [
  { id: 'bag', name: 'Вместительный мешок', desc: '+1 камень в запасе за уровень', costs: [150, 400], icon: '🎒' },
  { id: 'hands', name: 'Быстрые руки', desc: 'откат между бросками короче на 7% за уровень', costs: [150, 350, 700], icon: '✋' },
  { id: 'legs', name: 'Резвые ноги', desc: 'ходьба быстрее на 4% за уровень', costs: [120, 300, 600], icon: '👟' },
  { id: 'quarry', name: 'Добытчик', desc: 'камни у кучи набираются на 12% быстрее за уровень', costs: [100, 250, 550], icon: '⛏' },
  { id: 'plates', name: 'Крепкие плиты', desc: 'каждая плита твоего острова выдерживает +1 удар', costs: [800], icon: '🧱' },
];

export const COSMETICS: Cosmetic[] = [
  { id: 'skin_classic', kind: 'skin', name: 'Классика', cost: 0, color: null },
  { id: 'skin_ember', kind: 'skin', name: 'Уголёк', cost: 200, color: '#ff9a7a' },
  { id: 'skin_gold', kind: 'skin', name: 'Золото', cost: 350, color: '#ffe08a' },
  { id: 'skin_violet', kind: 'skin', name: 'Фиалка', cost: 300, color: '#c9a8ff' },
  { id: 'skin_jade', kind: 'skin', name: 'Нефрит', cost: 300, color: '#8af0b8' },
  { id: 'skin_frost', kind: 'skin', name: 'Иней', cost: 400, color: '#a8dcff' },
  { id: 'tiles_sand', kind: 'tiles', name: 'Песчаник', cost: 0, color: null },
  { id: 'tiles_granite', kind: 'tiles', name: 'Гранит', cost: 250, color: '#b9bfd0' },
  { id: 'tiles_moss', kind: 'tiles', name: 'Мох', cost: 250, color: '#b9dca0' },
  { id: 'tiles_dusk', kind: 'tiles', name: 'Закат', cost: 300, color: '#e0b0c8' },
  { id: 'stone_grey', kind: 'stone', name: 'Серый', cost: 0, color: null },
  { id: 'stone_ice', kind: 'stone', name: 'Лёд', cost: 150, color: '#9fe6ff' },
  { id: 'stone_lava', kind: 'stone', name: 'Лава', cost: 200, color: '#ff8a4a' },
  { id: 'stone_gold', kind: 'stone', name: 'Золотой', cost: 300, color: '#ffd24a' },
];
export const DEFAULT_EQUIP: Record<CosmeticKind, string> = { skin: 'skin_classic', tiles: 'tiles_sand', stone: 'stone_grey' };

export type Profile = {
  id: string; nick: string; rating: number; wins: number; losses: number; games: number; coins: number;
  up: Record<UpgradeId, number>; own: string[]; eq: Record<CosmeticKind, string>; daily: number;
};

export const START_RATING = 1000;
export const newProfile = (id: string, nick = 'Игрок'): Profile => ({
  id, nick, rating: START_RATING, wins: 0, losses: 0, games: 0, coins: 100,
  up: { bag: 0, hands: 0, legs: 0, quarry: 0, plates: 0 }, own: COSMETICS.filter(c => c.cost === 0).map(c => c.id), eq: { ...DEFAULT_EQUIP }, daily: -1,
});

const num = (v: unknown, d: number, lo = 0, hi = 1e9) => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
/** Rebuild a profile from untrusted or older stored data. */
export function sanitizeProfile(raw: any, id: string): Profile {
  const p = newProfile(id), r = raw && typeof raw === 'object' ? raw : {};
  p.nick = typeof r.nick === 'string' ? r.nick.slice(0, 14) || p.nick : p.nick;
  p.rating = num(r.rating, p.rating, 0, 9999); p.wins = num(r.wins, 0); p.losses = num(r.losses, 0); p.games = num(r.games, 0); p.coins = num(r.coins, p.coins); p.daily = num(r.daily, -1, -1);
  for (const u of UPGRADES) p.up[u.id] = num(r.up?.[u.id], 0, 0, u.costs.length);
  const known = new Set(COSMETICS.map(c => c.id));
  p.own = [...new Set([...p.own, ...(Array.isArray(r.own) ? r.own.filter((x: unknown) => typeof x === 'string' && known.has(x)) : [])])];
  for (const k of ['skin', 'tiles', 'stone'] as CosmeticKind[]) { const e = r.eq?.[k]; p.eq[k] = typeof e === 'string' && p.own.includes(e) && COSMETICS.find(c => c.id === e)?.kind === k ? e : DEFAULT_EQUIP[k]; }
  return p;
}

/** Battle tuning that a profile's upgrades give. */
export function modsFor(p: Pick<Profile, 'up'>): Mods {
  const m = makeMods();
  m.capacity += p.up.bag; m.cooldown *= 1 - .07 * p.up.hands; m.walk *= 1 + .04 * p.up.legs; m.refill *= 1 - .12 * p.up.quarry; m.tileHp += p.up.plates;
  return m;
}

export type Result = { ok: true } | { ok: false; error: string };
export const upgradeCost = (p: Profile, id: UpgradeId): number | null => { const u = UPGRADES.find(x => x.id === id); return u && p.up[id] < u.costs.length ? u.costs[p.up[id]] : null; };
export function buyUpgrade(p: Profile, id: UpgradeId): Result {
  const cost = upgradeCost(p, id); if (cost === null) return { ok: false, error: 'Уже максимум' };
  if (p.coins < cost) return { ok: false, error: 'Не хватает монет' };
  p.coins -= cost; p.up[id]++; return { ok: true };
}
export function buyCosmetic(p: Profile, id: string): Result {
  const c = COSMETICS.find(x => x.id === id); if (!c) return { ok: false, error: 'Нет такого предмета' };
  if (p.own.includes(id)) return { ok: false, error: 'Уже куплено' };
  if (p.coins < c.cost) return { ok: false, error: 'Не хватает монет' };
  p.coins -= c.cost; p.own.push(id); p.eq[c.kind] = id; return { ok: true };
}
export function equip(p: Profile, id: string): Result {
  const c = COSMETICS.find(x => x.id === id); if (!c || !p.own.includes(id)) return { ok: false, error: 'Предмет не куплен' };
  p.eq[c.kind] = id; return { ok: true };
}

// ---- rewards and rating ----
export const BOT_REWARD: Record<Difficulty, { win: number; loss: number }> = { easy: { win: 20, loss: 5 }, normal: { win: 35, loss: 10 }, hard: { win: 60, loss: 15 } };
export const ONLINE_REWARD = { win: 60, loss: 20, draw: 30 };
export const DAILY_BONUS = 50;
/** Day number since the epoch in Moscow time; one daily bonus per day. */
export const dayIndex = (ms: number) => Math.floor((ms + 3 * 3600e3) / 86400e3);

export function claimDaily(p: Profile, day: number): number { if (p.daily >= day) return 0; p.daily = day; p.coins += DAILY_BONUS; return DAILY_BONUS; }
export function rewardBot(p: Profile, level: Difficulty, won: boolean): number { const r = BOT_REWARD[level][won ? 'win' : 'loss']; p.coins += r; p.games++; if (won) p.wins++; else p.losses++; return r; }

/** Elo with a larger step for the first games. Returns the two rating changes. */
export function elo(ra: number, rb: number, scoreA: number, gamesA = 99, gamesB = 99): [number, number] {
  const ea = 1 / (1 + 10 ** ((rb - ra) / 400)), ka = gamesA < 10 ? 40 : 28, kb = gamesB < 10 ? 40 : 28;
  return [Math.round(ka * (scoreA - ea)), Math.round(kb * ((1 - scoreA) - (1 - ea)))];
}
/** Apply an online result to both profiles (winner null = draw). Returns what each player got. */
export function applyOnline(a: Profile, b: Profile, winner: 0 | 1 | null) {
  const sa = winner === null ? .5 : winner === 0 ? 1 : 0, [da, db] = elo(a.rating, b.rating, sa, a.games, b.games);
  const give = (p: Profile, d: number, won: boolean | null) => {
    p.rating = Math.max(0, p.rating + d); p.games++; const coins = won === null ? ONLINE_REWARD.draw : won ? ONLINE_REWARD.win : ONLINE_REWARD.loss;
    if (won === true) p.wins++; else if (won === false) p.losses++; p.coins += coins; return { rating: d, coins };
  };
  return [give(a, da, winner === null ? null : winner === 0), give(b, db, winner === null ? null : winner === 1)] as const;
}

export const LEAGUES = [{ min: 0, name: 'Бронза', color: '#c98a52' }, { min: 1100, name: 'Серебро', color: '#c9d2e0' }, { min: 1250, name: 'Золото', color: '#ffd25a' }, { min: 1450, name: 'Платина', color: '#7ee8d8' }, { min: 1650, name: 'Алмаз', color: '#8fc8ff' }];
export const league = (r: number) => [...LEAGUES].reverse().find(l => r >= l.min)!;
/** What the client may see of another player. */
export type PublicEntry = { nick: string; rating: number; wins: number; losses: number };
