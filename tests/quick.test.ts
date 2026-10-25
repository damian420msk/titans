import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBot, BOT_NICKS, QUICK_SEARCH_S } from '../shared/quick.ts';
import { checkNick } from '../shared/names.ts';
import { mulberry32 } from '../shared/bot.ts';

test('quick search waits 20 seconds', () => assert.equal(QUICK_SEARCH_S, 20));
test('every bot nick passes the nick filter', () => { for (const n of BOT_NICKS) assert.equal(checkNick(n).ok, true, n); });
test('bot is never easy; weak players get normal, stronger ones sometimes hard', () => {
  const r = mulberry32(5); const low = new Set<string>(), high = new Set<string>();
  for (let i = 0; i < 200; i++) { low.add(pickBot(1000, r).level); high.add(pickBot(1400, r).level); }
  assert.deepEqual([...low], ['normal']); assert.deepEqual([...high].sort(), ['hard', 'normal']);
});
