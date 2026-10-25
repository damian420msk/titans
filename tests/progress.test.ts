import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, sanitizeProfile, modsFor, buyUpgrade, buyCosmetic, equip, upgradeCost, elo, applyOnline, claimDaily, dayIndex, rewardBot, botRatingDelta, recordQuest, QUESTS, freshQuest, league, UPGRADES, COSMETICS, DAILY_BONUS } from '../shared/progress.ts';
import { Battle } from '../shared/battle.ts';

test('new profile: 1000 rating, starter coins, free cosmetics equipped', () => {
  const p = newProfile('x'); assert.equal(p.rating, 1000); assert.equal(p.coins, 100);
  assert.deepEqual(p.eq, { skin: 'skin_classic', tiles: 'tiles_sand', stone: 'stone_grey' });
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
  assert.equal(buyCosmetic(p, 'skin_gold').ok, false); assert.equal(p.coins, 100);
  p.coins = 400; assert.equal(buyCosmetic(p, 'skin_gold').ok, true); assert.equal(p.eq.skin, 'skin_gold'); assert.equal(p.coins, 50);
  assert.equal(buyCosmetic(p, 'skin_gold').ok, false); assert.equal(equip(p, 'skin_classic').ok, true); assert.equal(equip(p, 'skin_frost').ok, false); assert.equal(equip(p, 'nope').ok, false);
});
test('Elo: equal players move by about half K, upsets pay more, the sum is zero for equal K', () => {
  assert.deepEqual(elo(1000, 1000, 1), [14, -14]); const [up] = elo(1000, 1400, 1), [fav] = elo(1400, 1000, 1); assert.ok(up > fav * 3);
  const a = newProfile('a'), b = newProfile('b'); a.games = b.games = 50;
  const [ra, rb] = applyOnline(a, b, 0); assert.equal(a.rating + b.rating, 2000); assert.ok(ra.rating > 0 && rb.rating < 0); assert.equal(a.wins, 1); assert.equal(b.losses, 1); assert.ok(ra.coins > rb.coins);
  const c = newProfile('c'), d = newProfile('d'); applyOnline(c, d, null); assert.equal(c.rating, 1000); assert.equal(c.games, 1);
});
test('daily bonus once per day, rewards by difficulty, leagues', () => {
  const p = newProfile('x'), day = dayIndex(Date.UTC(2026, 9, 25, 12)); assert.equal(claimDaily(p, day), DAILY_BONUS); assert.equal(claimDaily(p, day), 0); assert.equal(claimDaily(p, day + 1), DAILY_BONUS);
  const c0 = p.coins; assert.ok(rewardBot(p, 'hard', true) > rewardBot(p, 'easy', true)); assert.ok(p.coins > c0);
  assert.equal(league(900).name, 'Бронза'); assert.equal(league(1250).name, 'Золото'); assert.equal(league(3000).name, 'Алмаз');
});
test('sanitizeProfile repairs garbage and never grants unowned items', () => {
  const p = sanitizeProfile({ nick: 5, rating: 'x', coins: -50, up: { bag: 99, legs: 1.6 }, own: ['skin_gold', 'bogus', 7], eq: { skin: 'skin_frost', tiles: 'skin_gold', stone: 'stone_grey' } }, 'id1');
  assert.equal(p.id, 'id1'); assert.equal(p.nick, 'Игрок'); assert.equal(p.rating, 1000); assert.equal(p.coins, 0); assert.equal(p.up.bag, 2); assert.equal(p.up.legs, 2);
  assert.ok(p.own.includes('skin_gold') && !p.own.includes('bogus')); assert.equal(p.eq.skin, 'skin_classic'); assert.equal(p.eq.tiles, 'tiles_sand');
  assert.equal(COSMETICS.filter(c => c.cost === 0).length, 3);
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
  assert.equal(p.quest.online, 0); assert.equal(recordQuest(p, 5, { won: true, ranked: true }), QUESTS[2].reward);
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
  assert.equal(botRatingDelta({ rating: 2000, games: 50 }, 'easy', true), 1); assert.ok(botRatingDelta({ rating: 2000, games: 50 }, 'easy', false) <= -1);
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
