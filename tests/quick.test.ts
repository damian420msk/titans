import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBot, BOT_NICKS, QUICK_SEARCH_S, BOT_OFFER_S } from '../shared/quick.ts';
import { checkNick } from '../shared/names.ts';
import { mulberry32 } from '../shared/bot.ts';

test('quick search: 15 s quiet, then the offer for 30 s more', () => { assert.equal(QUICK_SEARCH_S, 15); assert.equal(BOT_OFFER_S, 30); });
test('every bot nick passes the nick filter', () => { for (const n of BOT_NICKS) assert.equal(checkNick(n).ok, true, n); });
test('the quick-match bot fits the player: stronger with rating, softer after losses, never below 0.3', () => {
  const r = mulberry32(5);
  assert.equal(pickBot(1000, r).level, 'normal'); assert.equal(pickBot(1400, r).level, 'hard');
  assert.ok(pickBot(1200, r).skill > pickBot(1000, r).skill);
  assert.ok(pickBot(1000, r, [false, false, false]).skill < pickBot(1000, r).skill, 'losing streak');
  assert.ok(pickBot(1000, r, [true, true, true]).skill > pickBot(1000, r).skill, 'winning streak');
  assert.equal(pickBot(0, r, [false, false, false]).skill, .3);
});
