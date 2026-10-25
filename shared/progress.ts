// Player profile, upgrades, cosmetics, coin rewards and rating. Pure data and functions: used by the server (authoritative) and the client (display).
import { makeMods, type Mods } from './battle.ts';
import type { Difficulty } from './bot.ts';

export type UpgradeId = 'bag' | 'hands' | 'legs' | 'quarry' | 'mender' | 'lungs' | 'thrift';
export type CosmeticKind = 'titan' | 'tiles' | 'stone';
export type Upgrade = { id: UpgradeId; name: string; desc: string; costs: number[]; icon: string };
export type Cosmetic = { id: string; kind: CosmeticKind; name: string; cost: number; color: string | null };

export const UPGRADES: Upgrade[] = [
  { id: 'bag', name: 'Вместительный мешок', desc: '+1 камень в запасе за уровень', costs: [150, 400], icon: 'bag' },
  { id: 'hands', name: 'Быстрые руки', desc: 'откат между бросками короче на 7% за уровень', costs: [150, 350, 700], icon: 'bolt' },
  { id: 'legs', name: 'Резвые ноги', desc: 'ходьба быстрее на 4% за уровень', costs: [120, 300, 600], icon: 'boot' },
  { id: 'quarry', name: 'Добытчик', desc: 'камни у кучи набираются на 12% быстрее за уровень', costs: [100, 250, 550], icon: 'pick' },
  { id: 'lungs', name: 'Глубокое дыхание', desc: 'запас выносливости больше на 15% за уровень', costs: [120, 300, 600], icon: 'wind' },
  { id: 'thrift', name: 'Лёгкая поступь', desc: 'бег и прыжки тратят выносливость на 10% меньше за уровень', costs: [150, 350, 700], icon: 'feather' },
  { id: 'mender', name: 'Мастер ремонта', desc: 'ремонт плит быстрее на 15% за уровень', costs: [200, 450, 800], icon: 'tools' },
];

export const COSMETICS: Cosmetic[] = [
  // which titan model you play (free); the colour is only the shop swatch, the tint kinds below recolour the model
  { id: 'titan_blue', kind: 'titan', name: 'Бирюзовый', cost: 0, color: '#2BB8AA' },
  { id: 'titan_red', kind: 'titan', name: 'Красный', cost: 0, color: '#E8634E' },
  { id: 'tiles_sand', kind: 'tiles', name: 'Песчаник', cost: 0, color: null },
  { id: 'tiles_granite', kind: 'tiles', name: 'Гранит', cost: 250, color: '#b9bfd0' },
  { id: 'tiles_moss', kind: 'tiles', name: 'Мох', cost: 250, color: '#b9dca0' },
  { id: 'tiles_dusk', kind: 'tiles', name: 'Закат', cost: 300, color: '#e0b0c8' },
  { id: 'stone_grey', kind: 'stone', name: 'Серый', cost: 0, color: null },
  { id: 'stone_ice', kind: 'stone', name: 'Лёд', cost: 150, color: '#9fe6ff' },
  { id: 'stone_lava', kind: 'stone', name: 'Лава', cost: 200, color: '#ff8a4a' },
  { id: 'stone_gold', kind: 'stone', name: 'Золотой', cost: 300, color: '#ffd24a' },
];
/** Titan tints were removed from the shop (the red titan replaced them): what players paid for them is returned once, when the profile is loaded. */
export const RETIRED_COSMETICS: Record<string, number> = { skin_ember: 200, skin_gold: 350, skin_violet: 300, skin_jade: 300, skin_frost: 400 };
export const DEFAULT_EQUIP: Record<CosmeticKind, string> = { titan: 'titan_blue', tiles: 'tiles_sand', stone: 'stone_grey' };

export type Profile = {
  id: string; nick: string; rating: number; wins: number; losses: number; games: number; coins: number;
  up: Record<UpgradeId, number>; own: string[]; eq: Record<CosmeticKind, string>; daily: number; streak: number; quest: Quest; recent: Recent[];
  /** The training checklist was finished and its one-time reward paid. */
  trained: boolean;
};
/** One line of the fight history shown on the rating screen (newest first, 8 kept). */
export type Recent = { nick: string; won: boolean | null; delta: number; online: boolean };
export const RECENT_KEEP = 8;
export function pushRecent(p: Profile, r: Recent) { p.recent = [r, ...(p.recent ?? [])].slice(0, RECENT_KEEP); }

/** Daily tasks: the same three every day, progress resets at midnight (Moscow). Coins are paid the moment a task completes. */
export type Quest = { day: number; played: number; won: number; online: number; paid: [boolean, boolean, boolean] };
export const QUESTS = [
  { text: 'Сыграй 3 боя', goal: 3, reward: 40, key: 'played' },
  { text: 'Выиграй 2 боя', goal: 2, reward: 60, key: 'won' },
  { text: 'Победи живого игрока в рейтинговом бою', goal: 1, reward: 80, key: 'online' },
] as const;
export const freshQuest = (day: number): Quest => ({ day, played: 0, won: 0, online: 0, paid: [false, false, false] });
export function recordQuest(p: Profile, day: number, r: { won: boolean; ranked: boolean }): number {
  if (p.quest.day !== day) p.quest = freshQuest(day);
  const q = p.quest; q.played++; if (r.won) q.won++; if (r.won && r.ranked) q.online++;
  let coins = 0; QUESTS.forEach((d, i) => { if (!q.paid[i] && q[d.key] >= d.goal) { q.paid[i] = true; coins += d.reward; } });
  p.coins += coins; return coins;
}

export const START_RATING = 1000;
export const newProfile = (id: string, nick = 'Игрок'): Profile => ({
  id, nick, rating: START_RATING, wins: 0, losses: 0, games: 0, coins: 100,
  up: { bag: 0, hands: 0, legs: 0, quarry: 0, mender: 0, lungs: 0, thrift: 0 }, own: COSMETICS.filter(c => c.cost === 0).map(c => c.id), eq: { ...DEFAULT_EQUIP }, daily: -1, streak: 0, quest: freshQuest(-1), recent: [], trained: false,
});

const num = (v: unknown, d: number, lo = 0, hi = 1e9) => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
/** Rebuild a profile from untrusted or older stored data. */
export function sanitizeProfile(raw: any, id: string): Profile {
  const p = newProfile(id), r = raw && typeof raw === 'object' ? raw : {};
  p.nick = typeof r.nick === 'string' ? r.nick.slice(0, 14) || p.nick : p.nick;
  p.rating = num(r.rating, p.rating, 0, 9999); p.wins = num(r.wins, 0); p.losses = num(r.losses, 0); p.games = num(r.games, 0); p.coins = num(r.coins, p.coins); p.daily = num(r.daily, -1, -1); p.streak = num(r.streak, 0, 0, 7);
  for (const u of UPGRADES) p.up[u.id] = num(r.up?.[u.id], 0, 0, u.costs.length);
  if (num(r.up?.plates, 0) > 0) p.coins += 800; // the old 'plates' upgrade was removed (too strong): refund it
  if (Array.isArray(r.own)) for (const id of new Set(r.own)) if (typeof id === 'string' && RETIRED_COSMETICS[id]) p.coins += RETIRED_COSMETICS[id]!;
  const known = new Set(COSMETICS.map(c => c.id));
  p.own = [...new Set([...p.own, ...(Array.isArray(r.own) ? r.own.filter((x: unknown) => typeof x === 'string' && known.has(x)) : [])])];
  for (const k of ['titan', 'tiles', 'stone'] as CosmeticKind[]) { const e = r.eq?.[k]; p.eq[k] = typeof e === 'string' && p.own.includes(e) && COSMETICS.find(c => c.id === e)?.kind === k ? e : DEFAULT_EQUIP[k]; }
  const q = r.quest; if (q && typeof q === 'object') p.quest = { day: num(q.day, -1, -1), played: num(q.played, 0, 0, 99), won: num(q.won, 0, 0, 99), online: num(q.online, 0, 0, 99), paid: [0, 1, 2].map(i => q.paid?.[i] === true) as Quest['paid'] };
  p.trained = r.trained === true;
  if (Array.isArray(r.recent)) p.recent = r.recent.slice(0, RECENT_KEEP).filter((x: any) => x && typeof x.nick === 'string').map((x: any): Recent => ({ nick: x.nick.slice(0, 14), won: x.won === true ? true : x.won === false ? false : null, delta: num(x.delta, 0, -999, 999), online: x.online === true }));
  return p;
}

/** Battle tuning that a profile's upgrades give. */
export function modsFor(p: Pick<Profile, 'up'>): Mods {
  const m = makeMods(), up = (k: UpgradeId) => { const v = p.up?.[k]; return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(v, UPGRADES.find(u => u.id === k)!.costs.length)) : 0; };
  m.capacity += up('bag'); m.cooldown *= 1 - .07 * up('hands'); m.walk *= 1 + .04 * up('legs'); m.refill *= 1 - .12 * up('quarry'); m.repair *= 1 - .15 * up('mender'); m.stam *= 1 + .15 * up('lungs'); m.thrift *= 1 - .1 * up('thrift');
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
/** Seven-day gift calendar: miss a day and the run starts again from day 1; after day 7 it starts again too. */
export const DAILY_REWARDS = [50, 50, 75, 75, 100, 100, 200] as const;
export const DAILY_BONUS = DAILY_REWARDS[0];
/** One-time coins for finishing the training checklist. No rating and no bot-fight rewards come from training. */
export const TRAIN_REWARD = 100;
export function claimTrained(p: Profile): number { if (p.trained) return 0; p.trained = true; p.coins += TRAIN_REWARD; return TRAIN_REWARD; }
/** Day number since the epoch in Moscow time; one daily bonus per day. */
export const dayIndex = (ms: number) => Math.floor((ms + 3 * 3600e3) / 86400e3);

/** Days of the current run already collected (0..7) as seen on `day`. */
export function dailyStreak(p: Profile, day: number): number { return p.daily >= day - 1 && !(p.daily < day && p.streak >= 7) ? p.streak : 0; }
export function claimDaily(p: Profile, day: number): number {
  if (p.daily >= day) return 0;
  const s = dailyStreak(p, day) + 1, g = DAILY_REWARDS[s - 1];
  p.streak = s; p.daily = day; p.coins += g; return g;
}
/** Rating for a bot fight: Elo against a fixed bot rating, then halved (a bot is worth half a live player). A win always gives at least +1, a loss costs at least 1. */
export const BOT_RATING: Record<Difficulty, number> = { easy: 850, normal: 1050, hard: 1250 };
export function botRatingDelta(p: Pick<Profile, 'rating' | 'games'>, level: Difficulty, won: boolean): number {
  const [d] = elo(p.rating, BOT_RATING[level], won ? 1 : 0, p.games, 99), half = Math.round(d / 2);
  const delta = won ? Math.max(1, half) : Math.min(-1, half);
  return Math.max(delta, -p.rating) || 0;
}
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
