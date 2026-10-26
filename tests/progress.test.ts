import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_RATING_CAP, BOT_DAILY_COINS, BOT_REWARD, newProfile, sanitizeProfile, modsFor, buyUpgrade, buyCosmetic, equip, upgradeCost, elo, applyOnline, claimDaily, dailyStreak, DAILY_REWARDS, dayIndex, rewardBot, botRatingDelta, recordQuest, QUESTS, freshQuest, league, UPGRADES, COSMETICS, DAILY_BONUS } from '../shared/progress.ts';
import { Battle } from '../shared/battle.ts';

test('new profile: 1000 rating, starter coins, free cosmetics equipped', () => {
  const p = newProfile('x'); assert.equal(p.rating, 1000); assert.equal(p.coins, 100);
  assert.deepEqual(p.eq, { titan: 'titan_blue', tiles: 'tiles_starter', stone: 'stone_grey' });
});
test('upgrades cost coins, stack to their cap and change the battle mods', () => {
  const p = newProfile('x'); p.coins = 9000;
  for (const u of UPGRADES) for (let i = 0; i < u.costs.length; i++) assert.deepEqual(buyUpgrade(p, u.id), { ok: true });
  assert.equal(buyUpgrade(p, 'bag').ok, false); assert.equal(upgradeCost(p, 'legs'), null);
  const m = modsFor(p); assert.equal(m.capacity, 5); assert.ok(m.cooldown < 1.1 * .8); assert.ok(m.walk > 1.1); assert.ok(m.refill < .7 * .7); assert.ok(m.repair < .6); assert.equal(m.tileHp, 2);
  const b = new Battle([m, {}]); assert.equal(b.actors[0].stones, 5);
  assert.equal(p.coins, 9000 - UPGRADES.flatMap(u => u.costs).reduce((a, c) => a + c, 0));
});
test('cannot overspend, buying a cosmetic equips it, equip needs ownership', () => {
  const p = newProfile('x'); p.coins = 100;
  assert.equal(buyCosmetic(p, 'tiles_terracotta').ok, false); assert.equal(p.coins, 100);
  p.coins = 400; assert.equal(buyCosmetic(p, 'tiles_terracotta').ok, true); assert.equal(p.eq.tiles, 'tiles_terracotta'); assert.equal(p.coins, 150);
  assert.equal(buyCosmetic(p, 'tiles_terracotta').ok, false); assert.equal(equip(p, 'tiles_starter').ok, true); assert.equal(equip(p, 'tiles_basalt').ok, false); assert.equal(equip(p, 'nope').ok, false);
});
test('Elo: equal players move by about half K, upsets pay more, the sum is zero for equal K', () => {
  assert.deepEqual(elo(1000, 1000, 1), [14, -14]); const [up] = elo(1000, 1400, 1), [fav] = elo(1400, 1000, 1); assert.ok(up > fav * 3);
  const a = newProfile('a'), b = newProfile('b'); a.games = b.games = 50;
  const [ra, rb] = applyOnline(a, b, 0); assert.equal(a.rating + b.rating, 2000); assert.ok(ra.rating > 0 && rb.rating < 0); assert.equal(a.wins, 1); assert.equal(b.losses, 1); assert.ok(ra.coins > rb.coins);
  const c = newProfile('c'), d = newProfile('d'); applyOnline(c, d, null); assert.equal(c.rating, 1000); assert.equal(c.games, 1);
});
test('daily bonus once per day, rewards by difficulty, leagues', () => {
  const p = newProfile('x'), day = dayIndex(Date.UTC(2026, 9, 25, 12)); assert.equal(claimDaily(p, day), DAILY_BONUS); assert.equal(claimDaily(p, day), 0); assert.equal(claimDaily(p, day + 1), DAILY_BONUS);
  const c0 = p.coins; assert.ok(rewardBot(p, 'hard', true, 1) > rewardBot(p, 'easy', true, 1)); assert.ok(p.coins > c0);
  assert.equal(league(900).name, 'Бронза'); assert.equal(league(1250).name, 'Золото'); assert.equal(league(3000).name, 'Алмаз');
});
test('sanitizeProfile repairs garbage and never grants unowned items', () => {
  const p = sanitizeProfile({ nick: 5, rating: 'x', coins: -50, up: { bag: 99, legs: 1.6 }, own: ['tiles_moss', 'bogus', 7], eq: { tiles: 'stone_ice', stone: 'stone_grey' } }, 'id1');
  assert.equal(p.id, 'id1'); assert.equal(p.nick, 'Игрок'); assert.equal(p.rating, 1000); assert.equal(p.coins, 250, 'moss was retired: 250 back'); assert.equal(p.up.bag, 2); assert.equal(p.up.legs, 2);
  assert.ok(!p.own.includes('tiles_moss') && !p.own.includes('bogus')); assert.equal(p.eq.tiles, 'tiles_starter');
  assert.equal(COSMETICS.filter(c => c.cost === 0).length, 4); assert.equal(p.eq.titan, 'titan_blue');
});

test('mender shortens repairs for its owner only', () => {
  const b = new Battle([{ repair: .5 }, {}]);
  for (const side of [0, 1] as const) {
    const c = b.cellOf(side)!; b.floors[side].set(`${c.x},${c.z}`, 1); b.actors[side].stones = 3;
    assert.ok(b.beginRepair(side), 'repair starts');
  }
  assert.ok(Math.abs(b.repairs[0]!.need * 2 - b.repairs[1]!.need) < 1e-9);
});
test('old plates upgrade is refunded once and then gone', () => {
  const p = sanitizeProfile({ coins: 10, up: { plates: 1, bag: 1 } }, 'x'); assert.equal(p.coins, 810); assert.equal(p.up.bag, 1);
  const again = sanitizeProfile(JSON.parse(JSON.stringify(p)), 'x'); assert.equal(again.coins, 810);
});

test('daily quests pay once when done, count only ranked wins as online wins, and reset on a new day', () => {
  const p = newProfile('x'), c0 = p.coins;
  assert.equal(recordQuest(p, 5, { won: true, ranked: false }), 0); assert.equal(recordQuest(p, 5, { won: true, ranked: false }), QUESTS[1].reward, '2 wins');
  assert.equal(recordQuest(p, 5, { won: false, ranked: false }), QUESTS[0].reward, '3 played'); assert.equal(recordQuest(p, 5, { won: true, ranked: false }), 0, 'paid once');
  assert.equal(p.quest.strong, 0); assert.equal(recordQuest(p, 5, { won: true, ranked: true }), QUESTS[2].reward);
  assert.equal(p.coins, c0 + 60 + 40 + 80);
  assert.equal(recordQuest(p, 6, { won: false, ranked: false }), 0); assert.equal(p.quest.day, 6); assert.equal(p.quest.played, 1); assert.deepEqual(p.quest.paid, [false, false, false]);
  const back = sanitizeProfile(JSON.parse(JSON.stringify(p)), 'x'); assert.deepEqual(back.quest, p.quest);
  assert.deepEqual(sanitizeProfile({ quest: 'junk' }, 'x').quest, freshQuest(-1));
});
test('mods stay finite for an old or damaged profile (missing or junk upgrade levels)', () => {
  for (const up of [{ bag: 1, plates: 1 }, { bag: NaN, hands: 'x', legs: 99, quarry: -3 }, {}, null]) {
    const m = modsFor({ up } as any); for (const v of Object.values(m)) assert.ok(Number.isFinite(v), JSON.stringify(up));
  }
  assert.equal(modsFor({ up: { legs: 99 } } as any).walk, 1 + .04 * 3, 'levels are capped');
});

test('bot fights move rating, half as much as a live player; a win always gives at least +1, a loss costs at least 1', () => {
  const p = { rating: 1000, games: 50 };
  const live = elo(1000, 1050, 1)[0], vs = botRatingDelta(p, 'normal', true);
  assert.ok(vs > 0 && vs <= Math.ceil(live / 2), `bot win ${vs} vs live win ${live}`);
  assert.ok(botRatingDelta(p, 'normal', false) < 0);
  assert.ok(botRatingDelta(p, 'hard', true) > botRatingDelta(p, 'easy', true), 'a harder bot pays more');
  assert.ok(botRatingDelta(p, 'easy', false) < botRatingDelta(p, 'hard', false), 'losing to an easy bot costs more');
  assert.ok(botRatingDelta({ rating: 1240, games: 50 }, 'easy', true) >= 1); assert.equal(botRatingDelta({ rating: 2000, games: 50 }, 'easy', true), 0, 'bots do not lift above the cap'); assert.ok(botRatingDelta({ rating: 2000, games: 50 }, 'easy', false) <= -1);
  assert.equal(botRatingDelta({ rating: 0, games: 50 }, 'hard', false), 0, 'never below zero');
});

import { pushRecent, RECENT_KEEP, newProfile as np } from '../shared/progress.ts';
test('recent fights: junk is dropped, long lists are cut, pushRecent keeps newest first', () => {
  const p = sanitizeProfile({ recent: [{ nick: 'x'.repeat(40), won: 'yes', delta: 1e9, online: 1 }, 5, null, { nick: 3 }, ...Array(20).fill({ nick: 'ok', won: true, delta: 3, online: true })] }, 'id');
  assert.equal(p.recent.length, RECENT_KEEP - 3, 'junk entries are dropped from the first 8');
  assert.equal(p.recent[0].nick.length, 14); assert.equal(p.recent[0].won, null); assert.equal(p.recent[0].delta, 999); assert.equal(p.recent[0].online, false);
  const q = np('q'); for (let i = 0; i < 12; i++) pushRecent(q, { nick: String(i), won: true, delta: i, online: true });
  assert.equal(q.recent.length, RECENT_KEEP); assert.equal(q.recent[0].nick, '11');
  assert.deepEqual(sanitizeProfile(undefined, 'z').recent, []);
});

test('lungs and thrift upgrades change the stamina mods', () => {
  const p = newProfile('x'); p.coins = 5000;
  assert.equal(modsFor(p).stam, 1); assert.equal(modsFor(p).thrift, 1);
  buyUpgrade(p, 'lungs'); buyUpgrade(p, 'thrift'); buyUpgrade(p, 'thrift');
  const m = modsFor(p); assert.ok(Math.abs(m.stam - 1.15) < 1e-9); assert.ok(Math.abs(m.thrift - .8) < 1e-9);
});

test('gift calendar: seven days, a missed day or a finished week restarts the run', () => {
  const p = newProfile('x'), d0 = 20000; const got: number[] = [];
  for (let i = 0; i < 7; i++) { assert.equal(dailyStreak(p, d0 + i), i); got.push(claimDaily(p, d0 + i)); assert.equal(claimDaily(p, d0 + i), 0, 'once a day'); }
  assert.deepEqual(got, [...DAILY_REWARDS]); assert.equal(dailyStreak(p, d0 + 6), 7);
  assert.equal(dailyStreak(p, d0 + 7), 0, 'week finished: new run'); assert.equal(claimDaily(p, d0 + 7), DAILY_REWARDS[0]);
  assert.equal(claimDaily(p, d0 + 8), DAILY_REWARDS[1]); assert.equal(claimDaily(p, d0 + 9), DAILY_REWARDS[2]);
  assert.equal(dailyStreak(p, d0 + 11), 0, 'a skipped day resets'); assert.equal(claimDaily(p, d0 + 11), DAILY_REWARDS[0]);
  assert.equal(sanitizeProfile({ streak: 99 }, 'x').streak, 7);
});

test('titan choice is free, validated and old profiles get the default', async () => {
  const t = await import('../shared/titans.ts');
  const p = newProfile('t'); assert.ok(p.own.includes('titan_red') && p.own.includes('titan_blue')); assert.equal(equip(p, 'titan_red').ok, true); assert.equal(p.eq.titan, 'titan_red');
  const old = sanitizeProfile({ eq: { tiles: 'tiles_starter', stone: 'stone_grey' } }, 'o'); assert.equal(old.eq.titan, 'titan_blue');
  assert.equal(sanitizeProfile({ eq: { titan: 'titan_red' } }, 'x').eq.titan, 'titan_red');
  assert.equal(sanitizeProfile({ eq: { titan: 'tiles_moss' }, own: ['tiles_moss'] }, 'x').eq.titan, 'titan_blue');
  assert.equal(t.titanOf('titan_red'), 'red'); assert.equal(t.titanOf(undefined), 'blue'); assert.equal(t.titanOf('junk'), 'blue');
  // opponents never look alike: a bot gets the other model, a human with the same pick is shown as the other one
  assert.equal(t.botTitan('blue', Math.random), 'red'); assert.equal(t.botTitan('red', Math.random), 'blue');
  assert.equal(t.foeTitan('blue', 'blue'), 'red'); assert.equal(t.foeTitan('red', 'red'), 'blue'); assert.equal(t.foeTitan('blue', 'red'), 'red');
});

test('retired titan and plate tints are refunded once when an old profile is loaded and are gone afterwards', () => {
  const old = sanitizeProfile({ coins: 10, own: ['skin_classic', 'skin_gold', 'skin_frost', 'tiles_moss'], eq: { skin: 'skin_gold', tiles: 'tiles_moss' } }, 'r');
  assert.equal(old.coins, 10 + 350 + 400 + 250); assert.ok(!old.own.some(x => x.startsWith('skin_') || x === 'tiles_moss')); assert.equal(old.eq.tiles, 'tiles_starter');
  assert.equal(sanitizeProfile(JSON.parse(JSON.stringify(old)), 'r').coins, old.coins, 'a saved profile is not refunded again');
});

test('plate kits: free starter, then terracotta < jade < basalt; an old plate tint owner gets the money back and the starter kit', () => {
  const kits = COSMETICS.filter(c => c.kind === 'tiles'); assert.deepEqual(kits.map(c => c.id), ['tiles_starter', 'tiles_terracotta', 'tiles_jade', 'tiles_basalt']);
  assert.equal(kits[0]!.cost, 0); assert.ok(kits[1]!.cost > 0 && kits[1]!.cost < kits[2]!.cost && kits[2]!.cost < kits[3]!.cost);
  const p = newProfile('k'); p.coins = 5000; for (const k of kits.slice(1)) assert.equal(buyCosmetic(p, k.id).ok, true);
  assert.equal(p.eq.tiles, 'tiles_basalt'); assert.equal(p.coins, 5000 - 250 - 450 - 700); assert.equal(equip(p, 'tiles_jade').ok, true); assert.equal(p.eq.tiles, 'tiles_jade');
  const old = sanitizeProfile({ coins: 0, own: ['tiles_sand', 'tiles_granite', 'tiles_dusk'], eq: { tiles: 'tiles_dusk' } }, 'o');
  assert.equal(old.coins, 250 + 300); assert.equal(old.eq.tiles, 'tiles_starter'); assert.deepEqual(old.own.filter(x => x.startsWith('tiles_')), ['tiles_starter']);
});

test('bot fights: rating never climbs above the cap, coins stop at the daily limit and start again the next day', () => {
  const p = newProfile('cap'); p.rating = BOT_RATING_CAP - 3; p.games = 50;
  assert.equal(botRatingDelta(p, 'hard', true), 3); p.rating = BOT_RATING_CAP; assert.equal(botRatingDelta(p, 'hard', true), 0); assert.ok(botRatingDelta(p, 'hard', false) < 0, 'losses still count');
  let got = 0; for (let i = 0; i < 30; i++) got += rewardBot(p, 'hard', true, 7);
  assert.equal(got, BOT_DAILY_COINS); assert.equal(rewardBot(p, 'hard', true, 7), 0);
  assert.equal(rewardBot(p, 'hard', true, 8), BOT_REWARD.hard.win, 'a new day');
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(p)), 'cap').bot, p.bot);
});

test('the third daily task is done by beating the hard bot or a live player; old profiles keep their progress', () => {
  const p = newProfile('q3'); assert.equal(recordQuest(p, 3, { won: true, ranked: false, hard: false }), 0);
  assert.equal(recordQuest(p, 3, { won: false, ranked: false, hard: true }), 0, 'a loss does not count');
  assert.ok(recordQuest(p, 3, { won: true, ranked: false, hard: true }) >= QUESTS[2].reward);
  assert.equal(sanitizeProfile({ quest: { day: 3, played: 1, won: 1, online: 1, paid: [false, false, true] } }, 'x').quest.strong, 1);
});
