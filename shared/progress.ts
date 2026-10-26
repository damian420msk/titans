// Player profile, upgrades, cosmetics, coin rewards and rating. Pure data and functions: used by the server (authoritative) and the client (display).
import { makeMods, type Mods, type GameEvent } from './battle.ts';
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
  // plate kits (look only); order = price order, see shared/platformKits.ts
  { id: 'tiles_starter', kind: 'tiles', name: 'Стартовая арена', cost: 0, color: null },
  { id: 'tiles_terracotta', kind: 'tiles', name: 'Терракотовый бастион', cost: 250, color: '#d9826a' },
  { id: 'tiles_jade', kind: 'tiles', name: 'Нефритовая арена', cost: 450, color: '#9fb8a0' },
  { id: 'tiles_basalt', kind: 'tiles', name: 'Базальтовая крепость', cost: 700, color: '#4a4d55' },
  { id: 'stone_grey', kind: 'stone', name: 'Небесный', cost: 0, color: null }, // id kept for old profiles; the default sky crystal
  { id: 'stone_ice', kind: 'stone', name: 'Лёд', cost: 150, color: '#9fe6ff' },
  { id: 'stone_lava', kind: 'stone', name: 'Лава', cost: 200, color: '#ff8a4a' },
  { id: 'stone_gold', kind: 'stone', name: 'Золотой', cost: 300, color: '#ffd24a' },
];
/** Retired cosmetics (titan tints, plate tints): what players paid is returned once, when the profile is loaded. */
export const RETIRED_COSMETICS: Record<string, number> = { skin_ember: 200, skin_gold: 350, skin_violet: 300, skin_jade: 300, skin_frost: 400, tiles_granite: 250, tiles_moss: 250, tiles_dusk: 300 };
export const DEFAULT_EQUIP: Record<CosmeticKind, string> = { titan: 'titan_blue', tiles: 'tiles_starter', stone: 'stone_grey' };

export type Profile = {
  id: string; nick: string; rating: number; wins: number; losses: number; games: number; coins: number;
  up: Record<UpgradeId, number>; own: string[]; eq: Record<CosmeticKind, string>; daily: number; streak: number; quest: Quest; recent: Recent[];
  /** Coins earned from bot fights on `day` (Moscow day index): capped by BOT_DAILY_COINS. */
  bot: { day: number; coins: number };
  /** The training checklist was finished and its one-time reward paid. */
  trained: boolean;
};
/** One line of the fight history shown on the rating screen (newest first, 8 kept). */
export type Recent = { nick: string; won: boolean | null; delta: number; online: boolean };
export const RECENT_KEEP = 8;
export function pushRecent(p: Profile, r: Recent) { p.recent = [r, ...(p.recent ?? [])].slice(0, RECENT_KEEP); }

/** What one fight counts for the daily tasks. Bot fights: the client reports it (like the result itself); online: the server counts it from the battle events. */
export type FightStats = { won: boolean; ranked: boolean; hard: boolean; lost: number; heavy: number; spin: number; jumps: number; knock: number; repair: number; holes: number; dodge: number; falls: number };
export const noStats = (won: boolean, ranked = false, hard = false): FightStats => ({ won, ranked, hard, lost: 0, heavy: 0, spin: 0, jumps: 0, knock: 0, repair: 0, holes: 0, dodge: 0, falls: 0 });
/** Counts one side's deeds in a stream of battle events (same code on the client for bot fights and on the server for online ones). */
export function countEvents(st: FightStats, events: readonly GameEvent[], me: 0 | 1) {
  for (const e of events) {
    if (e.type === 'throw' && e.side === me) { if (e.kind === 'heavy') st.heavy++; else if (e.kind === 'spin') st.spin++; }
    else if (e.type === 'jump' && e.side === me) st.jumps++;
    else if (e.type === 'hit' && e.side !== me) st.knock++;
    else if (e.type === 'repaired' && e.side === me) st.repair++;
    else if (e.type === 'impact' && e.side !== me && e.hpBefore > 0 && e.hpAfter === 0) st.holes++;
    else if (e.type === 'dodge' && e.side === me) st.dodge++;
    else if (e.type === 'fall') { if (e.side === me) st.lost++; else st.falls++; }
  }
}
/** Untrusted stats from a client: integers, capped to what one 3-minute fight can hold. */
export function cleanStats(raw: unknown, won: boolean, hard: boolean): FightStats {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}, n = (k: string, hi: number) => num(r[k], 0, 0, hi);
  return { won, ranked: false, hard, lost: n('lost', 3), heavy: n('heavy', 40), spin: n('spin', 60), jumps: n('jumps', 200), knock: n('knock', 40), repair: n('repair', 40), holes: n('holes', 99), dodge: n('dodge', 40), falls: n('falls', 3) };
}

/** Daily tasks: five a day (two easy, two on skill, one hard) from a pool of 15. Every player has his own shuffled cyclic order of each tier and
 *  moves QUESTS_PER_TIER steps along it per day: two days in a row never share a task (each tier holds at least twice its daily count),
 *  and every task of a tier comes round before any of them repeats. Progress resets at midnight (Moscow); coins are paid the moment a task completes. */
export type QuestId = 'play3' | 'play6' | 'win2' | 'repair4' | 'jump10' | 'heavy5' | 'spin6' | 'knock6' | 'holes10' | 'dodge3' | 'falls4' | 'strong1' | 'perfect1' | 'win4' | 'holes25';
type QuestDef = { id: QuestId; text: string; goal: number; reward: number; icon: string; count: (s: FightStats) => number };
export const QUEST_POOL: QuestDef[][] = [
  [
    { id: 'play3', text: 'Сыграй 3 боя', goal: 3, reward: 30, icon: 'target', count: () => 1 },
    { id: 'play6', text: 'Сыграй 6 боёв', goal: 6, reward: 40, icon: 'target', count: () => 1 },
    { id: 'win2', text: 'Выиграй 2 боя', goal: 2, reward: 35, icon: 'trophy', count: s => +s.won },
    { id: 'repair4', text: 'Почини 4 плиты', goal: 4, reward: 30, icon: 'tools', count: s => s.repair },
    { id: 'jump10', text: 'Прыгни 10 раз', goal: 10, reward: 25, icon: 'feather', count: s => s.jumps },
  ],
  [
    { id: 'heavy5', text: 'Сделай 5 мощных бросков', goal: 5, reward: 40, icon: 'bolt', count: s => s.heavy },
    { id: 'spin6', text: 'Сделай 6 кручёных бросков', goal: 6, reward: 40, icon: 'bolt', count: s => s.spin },
    { id: 'knock6', text: 'Сбей соперника с ног 6 раз', goal: 6, reward: 40, icon: 'boot', count: s => s.knock },
    { id: 'holes10', text: 'Пробей 10 дыр в острове соперника', goal: 10, reward: 40, icon: 'pick', count: s => s.holes },
    { id: 'dodge3', text: 'Увернись в прыжке 3 раза', goal: 3, reward: 45, icon: 'feather', count: s => s.dodge },
    { id: 'falls4', text: 'Сбрось соперника в облака 4 раза', goal: 4, reward: 45, icon: 'wind', count: s => s.falls },
  ],
  [
    // a live opponent is rare while few play, so a hard bot counts too
    { id: 'strong1', text: 'Победи сложного бота или живого игрока', goal: 1, reward: 70, icon: 'robot', count: s => +(s.won && (s.ranked || s.hard)) },
    { id: 'perfect1', text: 'Победи, не потеряв ни одной жизни', goal: 1, reward: 80, icon: 'heart', count: s => +(s.won && s.lost === 0 && s.falls >= 3) }, // a real win: the foe went down three times (a win by the foe leaving does not count)
    { id: 'win4', text: 'Выиграй 4 боя', goal: 4, reward: 70, icon: 'trophy', count: s => +s.won },
    { id: 'holes25', text: 'Пробей 25 дыр за день', goal: 25, reward: 70, icon: 'pick', count: s => s.holes },
  ],
];
/** How many tasks of each tier a day brings (easy, skill, hard). */
export const QUESTS_PER_TIER = [2, 2, 1] as const;
export const QUESTS_A_DAY = QUESTS_PER_TIER.reduce((a: number, b: number) => a + b, 0);
const QUEST_DEFS = new Map(QUEST_POOL.flat().map(d => [d.id, d]));
export const questDef = (id: string) => QUEST_DEFS.get(id as QuestId);
export type Quest = { day: number; ids: QuestId[]; prog: number[]; paid: boolean[] };
const mix = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
/** The player's own order of a tier: a shuffle seeded by the player id. */
function tierOrder(tier: QuestDef[], id: string, t: number): QuestId[] {
  const order = tier.map(d => d.id);
  for (let i = order.length - 1; i > 0; i--) { const j = mix(`${id}|${t}|${i}`) % (i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  return order;
}
/** Today's tasks for this player: easy, easy, skill, skill, hard. */
export function pickQuests(day: number, id: string): QuestId[] {
  const d = Math.max(0, day), out: QuestId[] = [];
  QUEST_POOL.forEach((tier, t) => { const order = tierOrder(tier, id, t), k = QUESTS_PER_TIER[t]!; for (let j = 0; j < k; j++) out.push(order[(d * k + j) % order.length]!); });
  return out;
}
export const freshQuest = (day: number, id = ''): Quest => ({ day, ids: pickQuests(day, id), prog: Array(QUESTS_A_DAY).fill(0), paid: Array(QUESTS_A_DAY).fill(false) });
export function recordQuest(p: Profile, day: number, st: FightStats): number {
  if (p.quest.day !== day) p.quest = freshQuest(day, p.id);
  const q = p.quest; let coins = 0;
  q.ids.forEach((id, i) => { const d = questDef(id); if (!d || q.paid[i]) return; q.prog[i] = Math.min(d.goal, q.prog[i] + d.count(st)); if (q.prog[i] >= d.goal) { q.paid[i] = true; coins += d.reward; } });
  p.coins += coins; return coins;
}

export const START_RATING = 1000;
export const newProfile = (id: string, nick = 'Игрок'): Profile => ({
  id, nick, rating: START_RATING, wins: 0, losses: 0, games: 0, coins: 100,
  up: { bag: 0, hands: 0, legs: 0, quarry: 0, mender: 0, lungs: 0, thrift: 0 }, own: COSMETICS.filter(c => c.cost === 0).map(c => c.id), eq: { ...DEFAULT_EQUIP }, daily: -1, streak: 0, quest: freshQuest(-1, id), recent: [], trained: false, bot: { day: -1, coins: 0 },
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
  // today's tasks survive a reload; an old-format record (3 tasks a day, before 2026-10-27) starts the day afresh
  const q = r.quest; if (q && typeof q === 'object' && Array.isArray(q.ids) && q.ids.length === QUESTS_A_DAY && q.ids.every((x: unknown) => typeof x === 'string' && questDef(x))) p.quest = { day: num(q.day, -1, -1), ids: [...q.ids] as QuestId[], prog: q.ids.map((_: unknown, i: number) => num(q.prog?.[i], 0, 0, 99)), paid: q.ids.map((_: unknown, i: number) => q.paid?.[i] === true) };
  p.trained = r.trained === true;
  if (r.bot && typeof r.bot === 'object') p.bot = { day: num(r.bot.day, -1, -1), coins: num(r.bot.coins, 0) };
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
/** Bot wins never lift the rating above this (Gold): the higher leagues are earned against live players. */
export const BOT_RATING_CAP = 1250;
export function botRatingDelta(p: Pick<Profile, 'rating' | 'games'>, level: Difficulty, won: boolean): number {
  const [d] = elo(p.rating, BOT_RATING[level], won ? 1 : 0, p.games, 99), half = Math.round(d / 2);
  const delta = won ? Math.min(Math.max(1, half), Math.max(0, BOT_RATING_CAP - p.rating)) : Math.min(-1, half);
  return Math.max(delta, -p.rating) || 0;
}
/** Most coins a player can earn from bot fights in one day; quests and the daily gift are separate. */
export const BOT_DAILY_COINS = 600;
export function rewardBot(p: Profile, level: Difficulty, won: boolean, day: number): number {
  if (p.bot.day !== day) p.bot = { day, coins: 0 };
  const r = Math.min(BOT_REWARD[level][won ? 'win' : 'loss'], Math.max(0, BOT_DAILY_COINS - p.bot.coins));
  p.bot.coins += r; p.coins += r; p.games++; if (won) p.wins++; else p.losses++; return r;
}

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

/** Sky leagues: the tournament climbs into the sky (GDD). Thresholds unchanged; the bot-win cap (1250) ends at the Storm league. */
export const LEAGUES = [{ min: 0, name: 'Каменная', color: '#c98a52' }, { min: 1100, name: 'Облачная', color: '#c9d2e0' }, { min: 1250, name: 'Грозовая', color: '#b49bff' }, { min: 1450, name: 'Звёздная', color: '#7ee8d8' }, { min: 1650, name: 'Солнечная', color: '#ffd25a' }];
export const league = (r: number) => [...LEAGUES].reverse().find(l => r >= l.min)!;
/** What the client may see of another player. */
export type PublicEntry = { nick: string; rating: number; wins: number; losses: number };
