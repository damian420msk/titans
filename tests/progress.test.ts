import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, sanitizeProfile, modsFor, buyUpgrade, buyCosmetic, equip, upgradeCost, elo, applyOnline, claimDaily, dayIndex, rewardBot, league, UPGRADES, COSMETICS, DAILY_BONUS } from '../shared/progress.ts';
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
