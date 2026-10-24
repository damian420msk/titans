import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, type Conn } from '../server/lobby.ts';
import { MemoryStore } from '../server/store.ts';
import type { S2C, MyProfile, RoomInfo } from '../shared/net.ts';

type Fake = Conn & { log: S2C[]; last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined };
const fake = (): Fake => { const log: S2C[] = []; return { log, send: m => { log.push(m); }, last: (t: any) => [...log].reverse().find(m => m.t === t) as any }; };
const tokenOf = (n: string) => (Buffer.from(n).toString('hex') + 'x0123456789abcdefghijklmnop').slice(0, 32);
const player = (lobby: Lobby, nick: string) => { const c = fake(); lobby.connect(c); lobby.handle(c, { t: 'hello', nick, token: tokenOf(nick) }); return c; };
const prof = (c: Fake) => c.last('profile')!.p as MyProfile;
const roomId = (c: Fake) => (c.last('rooms')!.rooms as RoomInfo[])[0].id;
const startRanked = (lobby: Lobby, a: Fake, b: Fake, ranked = true) => {
  lobby.handle(a, { t: 'create', name: 'R', pass: '', ranked }); lobby.handle(b, { t: 'join', id: roomId(b), pass: '' });
  lobby.handle(a, { t: 'ready', on: true }); lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1);
};
const finish = (lobby: Lobby, loser: Fake) => { lobby.disconnect(loser); };

test('a token gives a profile with defaults; without a valid token the profile is a throwaway guest', () => {
  const lobby = new Lobby(), a = player(lobby, 'Аня'); assert.equal(prof(a).rating, 1000); assert.equal(prof(a).coins, 100); assert.equal(prof(a).nick, 'Аня');
  const g = fake(); lobby.connect(g); lobby.handle(g, { t: 'hello', nick: 'Гость', token: 'short' }); lobby.handle(g, { t: 'buy', kind: 'up', id: 'quarry' });
  assert.equal(prof(g).up.quarry, 1); const g2 = fake(); lobby.connect(g2); lobby.handle(g2, { t: 'hello', nick: 'Гость', token: 'short' }); assert.equal(prof(g2).up.quarry, 0, 'guests are not saved');
});
test('shop: refused without coins, daily gift once a day, purchases persist across reconnect', () => {
  let t = Date.UTC(2026, 9, 25, 12); const store = new MemoryStore(), lobby = new Lobby(store, () => t), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'buy', kind: 'item', id: 'skin_gold' }); assert.equal(a.last('shop')!.ok, false); assert.equal(prof(a).coins, 100);
  assert.equal(prof(a).dailyReady, true); lobby.handle(a, { t: 'claim' }); assert.equal(prof(a).coins, 150); assert.equal(prof(a).dailyReady, false);
  lobby.handle(a, { t: 'claim' }); assert.equal(a.last('shop')!.ok, false); assert.equal(prof(a).coins, 150);
  lobby.handle(a, { t: 'buy', kind: 'up', id: 'legs' }); assert.equal(a.last('shop')!.ok, true); assert.equal(prof(a).up.legs, 1); assert.equal(prof(a).coins, 30);
  t += 24 * 3600e3; lobby.disconnect(a);
  const a2 = player(lobby, 'Аня'); assert.equal(prof(a2).up.legs, 1); assert.equal(prof(a2).coins, 30); assert.equal(prof(a2).dailyReady, true);
  const lobby2 = new Lobby(store, () => t), a3 = player(lobby2, 'Аня'); assert.equal(prof(a3).up.legs, 1, 'a fresh server process reads the store');
});
test('upgrades reach the match: bigger bag in the start message and in the battle', () => {
  const lobby = new Lobby(), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  (a as any).log.length = 0; const pa = (lobby as any).profiles.get([...(lobby as any).profiles.keys()][0]); pa.coins = 1000; pa.up.bag = 0;
  lobby.handle(a, { t: 'buy', kind: 'up', id: 'bag' }); lobby.handle(a, { t: 'buy', kind: 'up', id: 'bag' }); assert.equal(prof(a).up.bag, 2);
  startRanked(lobby, a, b);
  const sa = a.last('start')!, sb = b.last('start')!;
  assert.equal(sa.mods[0].capacity, 5); assert.equal(sa.mods[1].capacity, 3); assert.equal(sb.mods[0].capacity, 3); assert.equal(sb.mods[1].capacity, 5, 'mirrored for the guest');
  assert.equal(sa.foe, 'Боря'); assert.equal(sb.foeRating, 1000); assert.equal(sa.ranked, true);
  const snapA = a.last('snap'); lobby.tick(.2); assert.equal(a.last('snap')!.s.a[0].s, 5);
});
test('ranked room: the winner gains rating and coins, the loser drops; both profiles are saved', () => {
  const store = new MemoryStore(), lobby = new Lobby(store), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  startRanked(lobby, a, b); finish(lobby, b);
  assert.equal(a.last('end')!.gain!.ranked, true); assert.ok(prof(a).rating > 1000); assert.equal(prof(a).wins, 1); assert.equal(prof(a).coins, 100 + 60);
  const b2 = player(lobby, 'Боря'); assert.ok(prof(b2).rating < 1000); assert.equal(prof(b2).losses, 1);
});
test('unranked room: only coins change; farming the same opponent stops giving rating', () => {
  const lobby = new Lobby(), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  startRanked(lobby, a, b, false); lobby.handle(b, { t: 'leave' }); assert.equal(a.last('end')!.gain!.ranked, false); assert.equal(prof(a).rating, 1000); assert.equal(prof(a).coins, 130); assert.equal(prof(a).games, 0);
  lobby.disconnect(a); lobby.disconnect(b); let gained = 0;
  for (let i = 0; i < 8; i++) {
    const x = player(lobby, 'Аня'), y = player(lobby, 'Боря'); startRanked(lobby, x, y); lobby.handle(y, { t: 'leave' }); if (x.last('end')!.gain!.ranked) gained++;
    lobby.disconnect(x); lobby.disconnect(y);
  }
  assert.equal(gained, 6, 'only the first six games in an hour count for rating');
});
test('bot results pay coins but not twice in a row', () => {
  let t = 1e9; const lobby = new Lobby(new MemoryStore(), () => t), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'result', level: 'hard', won: true }); assert.equal(prof(a).coins, 160); lobby.handle(a, { t: 'result', level: 'hard', won: true }); assert.equal(prof(a).coins, 160);
  t += 26000; lobby.handle(a, { t: 'result', level: 'nonsense' as any, won: true }); assert.equal(prof(a).coins, 160); lobby.handle(a, { t: 'result', level: 'easy', won: false }); assert.equal(prof(a).coins, 165);
});
test('quick match pairs two queued players of similar rating into a ranked match', () => {
  let t = 1e9; const lobby = new Lobby(new MemoryStore(), () => t), a = player(lobby, 'Аня'), b = player(lobby, 'Боря'), c = player(lobby, 'Вася');
  const pc = (lobby as any).profiles; for (const p of pc.values()) if (p.nick === 'Вася') p.rating = 1900;
  lobby.handle(a, { t: 'quick', on: true }); lobby.handle(c, { t: 'quick', on: true }); lobby.tick(.1); assert.equal(a.last('start'), undefined, 'rating gap is too large at first');
  lobby.handle(b, { t: 'quick', on: true }); lobby.tick(.1); assert.equal(a.last('room')!.room!.seats[1]!.nick, 'Боря'); assert.equal(c.last('queue')!.on, true);
  lobby.tick(3.2); assert.equal(a.last('start')!.foe, 'Боря'); assert.equal(a.last('start')!.ranked, true); assert.equal(c.last('start'), undefined);
  assert.equal((a.last('rooms')?.rooms ?? []).length, 0, 'quick rooms are not listed');
  t += 40000; lobby.tick(.1); // a long wait widens the window, but c is still alone: nobody to pair with
  lobby.handle(c, { t: 'quick', on: false }); assert.equal(c.last('queue')!.on, false);
});
test('leaderboard lists played accounts by rating', async () => {
  const lobby = new Lobby(), a = player(lobby, 'Аня'), b = player(lobby, 'Боря'); startRanked(lobby, a, b); finish(lobby, b);
  const v = player(lobby, 'Вася'); lobby.handle(v, { t: 'top' }); await new Promise(r => setImmediate(r));
  const top = v.last('top')!; assert.deepEqual(top.list.map(e => e.nick), ['Аня', 'Боря']); assert.ok(top.list[0].rating > top.list[1].rating);
  lobby.handle(a, { t: 'top' }); await new Promise(r => setImmediate(r)); assert.equal(a.last('top')!.rank, 1);
});
