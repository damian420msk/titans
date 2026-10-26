import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, type Conn } from '../server/lobby.ts';
import { MemoryStore } from '../server/store.ts';
import { questDef } from '../shared/progress.ts';
import type { S2C, MyProfile, RoomInfo } from '../shared/net.ts';

type Fake = Conn & { log: S2C[]; last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined };
const fake = (): Fake => { const log: S2C[] = []; return { log, send: m => { log.push(m); }, last: (t: any) => [...log].reverse().find(m => m.t === t) as any }; };
const tokenOf = (n: string) => (Buffer.from(n).toString('hex') + 'x0123456789abcdefghijklmnop').slice(0, 32);
const player = (lobby: Lobby, nick: string) => { const c = fake(); lobby.connect(c); lobby.handle(c, { t: 'hello', nick, token: tokenOf(nick) }); return c; };
const prof = (c: Fake) => c.last('profile')!.p as MyProfile;
/** coins paid by today's daily tasks so far (the tasks differ per player, so tests subtract them) */
const questPaid = (p: MyProfile) => p.quest.ids.reduce((s, id, i) => s + (p.quest.paid[i] ? questDef(id)!.reward : 0), 0);
const fightCoins = (p: MyProfile) => p.coins - questPaid(p);
const roomId = (c: Fake) => (c.last('rooms')!.rooms as RoomInfo[])[0].id;
const startRanked = (lobby: Lobby, a: Fake, b: Fake, ranked = true) => {
  lobby.handle(a, { t: 'create', name: 'R', pass: '', ranked }); lobby.handle(b, { t: 'join', id: roomId(b), pass: '' });
  lobby.handle(a, { t: 'ready', on: true }); lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1);
};
const finish = (lobby: Lobby, loser: Fake) => { lobby.handle(loser, { t: 'leave' }); };

test('a token gives a profile with defaults; without a valid token the profile is a throwaway guest', () => {
  const lobby = new Lobby(), a = player(lobby, 'Аня'); assert.equal(prof(a).rating, 1000); assert.equal(prof(a).coins, 100); assert.equal(prof(a).nick, 'Аня');
  const g = fake(); lobby.connect(g); lobby.handle(g, { t: 'hello', nick: 'Гость', token: 'short' }); lobby.handle(g, { t: 'buy', kind: 'up', id: 'quarry' });
  assert.equal(prof(g).up.quarry, 1); const g2 = fake(); lobby.connect(g2); lobby.handle(g2, { t: 'hello', nick: 'Гость', token: 'short' }); assert.equal(prof(g2).up.quarry, 0, 'guests are not saved');
});
test('shop: refused without coins, daily gift once a day, purchases persist across reconnect', () => {
  let t = Date.UTC(2026, 9, 25, 12); const store = new MemoryStore(), lobby = new Lobby(store, () => t), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'buy', kind: 'item', id: 'tiles_terracotta' }); assert.equal(a.last('shop')!.ok, false); assert.equal(prof(a).coins, 100);
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
  assert.equal(a.last('end')!.gain!.ranked, true); assert.ok(prof(a).rating > 1000); assert.equal(prof(a).wins, 1); assert.equal(fightCoins(prof(a)), 100 + 60, 'win reward (plus whatever daily task it completed)');
  const b2 = player(lobby, 'Боря'); assert.ok(prof(b2).rating < 1000); assert.equal(prof(b2).losses, 1);
});
test('unranked room: only coins change; farming the same opponent stops giving rating', () => {
  const lobby = new Lobby(), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  startRanked(lobby, a, b, false); lobby.handle(b, { t: 'leave' }); assert.equal(a.last('end')!.gain!.ranked, false); assert.equal(prof(a).rating, 1000); assert.equal(fightCoins(prof(a)), 130); assert.equal(prof(a).games, 0);
  lobby.disconnect(a); lobby.disconnect(b); let gained = 0;
  for (let i = 0; i < 8; i++) {
    const x = player(lobby, 'Аня'), y = player(lobby, 'Боря'); startRanked(lobby, x, y); lobby.handle(y, { t: 'leave' }); if (x.last('end')!.gain!.ranked) gained++;
    lobby.disconnect(x); lobby.disconnect(y);
  }
  assert.equal(gained, 6, 'only the first six games in an hour count for rating');
});
test('bot results pay coins but not twice in a row', () => {
  let t = 1e9; const lobby = new Lobby(new MemoryStore(), () => t), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'result', level: 'hard', won: true }); assert.equal(fightCoins(prof(a)), 160); const c1 = prof(a).coins; lobby.handle(a, { t: 'result', level: 'hard', won: true }); assert.equal(prof(a).coins, c1);
  t += 26000; lobby.handle(a, { t: 'result', level: 'nonsense' as any, won: true }); assert.equal(prof(a).coins, c1); lobby.handle(a, { t: 'result', level: 'easy', won: false }); assert.equal(fightCoins(prof(a)), 165);
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

test('a dropped saved player keeps the seat for 15 s and gets back into the running match', () => {
  const clock = { t: 1e9 }, lobby = new Lobby(new MemoryStore(), () => clock.t), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  startRanked(lobby, a, b);
  for (let i = 0; i < 60; i++) lobby.tick(1 / 60);
  lobby.disconnect(b); assert.equal((a.last('away') as any).on, true); assert.equal(a.last('end'), undefined, 'match goes on');
  clock.t += 5000; lobby.tick(1 / 60);
  const b2 = player(lobby, 'Боря');
  assert.equal(b2.last('start')!.foe, 'Аня'); assert.ok(b2.last('snap'), 'gets the state right away'); assert.equal((a.last('away') as any).on, false);
  lobby.handle(b2, { t: 'move', x: 1, z: 0 }); for (let i = 0; i < 30; i++) lobby.tick(1 / 60); // the new connection controls the seat
  assert.ok(b2.last('snap')!.s.a[0].x !== 0, 'b2 moves');
  assert.equal(a.last('end'), undefined);
});
test('an away player who does not come back forfeits after the grace period; a guest forfeits at once', () => {
  const clock = { t: 1e9 }, lobby = new Lobby(new MemoryStore(), () => clock.t), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  startRanked(lobby, a, b); lobby.tick(.5);
  lobby.disconnect(b); clock.t += 14000; lobby.tick(.1); assert.equal(a.last('end'), undefined);
  clock.t += 2000; lobby.tick(.1); assert.equal(a.last('end')!.reason, 'left'); assert.equal(a.last('end')!.winner, 0);
  const g1 = fake(), g2 = fake(); lobby.connect(g1); lobby.connect(g2); lobby.handle(g1, { t: 'hello', nick: 'Г1' }); lobby.handle(g2, { t: 'hello', nick: 'Г2' });
  lobby.handle(g1, { t: 'create', name: 'G', pass: '' }); lobby.handle(g2, { t: 'join', id: (g2.last('rooms')!.rooms as RoomInfo[]).find(r => r.name === 'G')!.id, pass: '' });
  lobby.handle(g1, { t: 'ready', on: true }); lobby.handle(g2, { t: 'ready', on: true }); lobby.tick(3.1); lobby.disconnect(g2); assert.equal(g1.last('end')!.reason, 'left');
});

test('emotes reach only the rival, only during a match, at most one per 1.5 s, ids 0-3', () => {
  const clock = { t: 1e9 }, lobby = new Lobby(new MemoryStore(), () => clock.t), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  lobby.handle(a, { t: 'emote', id: 1 }); assert.equal(b.last('emote'), undefined, 'not in a match');
  startRanked(lobby, a, b);
  lobby.handle(a, { t: 'emote', id: 2 }); assert.equal((b.last('emote') as any).id, 2); assert.equal(a.last('emote'), undefined);
  lobby.handle(a, { t: 'emote', id: 3 }); assert.equal((b.last('emote') as any).id, 2, 'rate limited');
  clock.t += 1600; lobby.handle(a, { t: 'emote', id: 9 }); assert.equal((b.last('emote') as any).id, 2, 'bad id');
  lobby.handle(a, { t: 'emote', id: 0 }); assert.equal((b.last('emote') as any).id, 0);
});
test('quick match marks the start message so the client can offer "search again"', () => {
  const lobby = new Lobby(new MemoryStore()), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  lobby.handle(a, { t: 'quick', on: true }); lobby.handle(b, { t: 'quick', on: true }); lobby.tick(.1); lobby.tick(3.1);
  assert.equal(a.last('start')!.quick, true);
});

test('rewarded bonus repeats the last reward once, capped, and only for saved accounts', () => {
  const lobby = new Lobby(new MemoryStore(), () => 1e9), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'bonus' }); assert.equal(prof(a).coins, 100, 'nothing to double yet');
  lobby.handle(a, { t: 'result', level: 'hard', won: true }); const after = prof(a).coins, gain = after - 100; assert.equal(fightCoins(prof(a)), 160);
  lobby.handle(a, { t: 'bonus' }); assert.equal(prof(a).coins, after + Math.min(gain, 150), 'fight and task doubled, capped'); lobby.handle(a, { t: 'bonus' }); assert.equal(prof(a).coins, after + Math.min(gain, 150), 'only once');
  const g = fake(); lobby.connect(g); lobby.handle(g, { t: 'hello', nick: 'Гость' }); lobby.handle(g, { t: 'result', level: 'hard', won: true }); lobby.handle(g, { t: 'bonus' });
  assert.equal(fightCoins(g.last('profile')!.p), 100 + 60, 'guest got only the plain reward');
});

test('a bot win raises rating, a bot loss lowers it (after the anti-spam gap); the message says so', () => {
  const clock = { t: 1e9 }, lobby = new Lobby(new MemoryStore(), () => clock.t), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'result', level: 'normal', won: true }); const up = prof(a).rating; assert.ok(up > 1000); assert.match((a.last('shop') as any).text, /\+\d+ рейтинг/);
  clock.t += 30000; lobby.handle(a, { t: 'result', level: 'normal', won: false }); assert.ok(prof(a).rating < up); assert.match((a.last('shop') as any).text, /-\d+ рейтинг/);
});
test('the end message says why rating did not change: same account, friendly room', () => {
  const lobby = new Lobby(new MemoryStore()), a = player(lobby, 'Аня'), a2 = player(lobby, 'Аня'); // same token = same account
  startRanked(lobby, a, a2); finish(lobby, a2); assert.match(a.last('end')!.gain!.note!, /одного аккаунта/); assert.equal(a.last('end')!.gain!.rating, 0);
  const b = player(lobby, 'Боря'), c = player(lobby, 'Вася');
  lobby.handle(b, { t: 'create', name: 'Д', pass: '', ranked: false }); lobby.handle(c, { t: 'join', id: (c.last('rooms')!.rooms as RoomInfo[]).find(r => r.name === 'Д')!.id, pass: '' });
  lobby.handle(b, { t: 'ready', on: true }); lobby.handle(c, { t: 'ready', on: true }); lobby.tick(3.1); finish(lobby, c);
  assert.match(b.last('end')!.gain!.note!, /Дружеский/);
});

const playOut = (lobby: Lobby, t: { v: number }) => { for (let i = 0; i < 1500; i++) { t.v += 250; lobby.tick(.25); if ([...(lobby as any).rooms.values()].every((r: any) => r.phase === "lobby")) break; } };

test('rematch: a quick-match room stays open after the fight, both press ready → new match; otherwise it closes after 40 s', () => {
  const t = { v: Date.UTC(2026, 9, 25, 12) }, lobby = new Lobby(new MemoryStore(), () => t.v), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  lobby.handle(a, { t: 'quick', on: true }); lobby.handle(b, { t: 'quick', on: true }); lobby.tick(.1); lobby.tick(3.1);
  assert.equal(a.last('start')!.quick, true); const starts = a.log.filter(m => m.t === 'start').length;
  playOut(lobby, t); assert.ok(a.last('end'), 'match over');
  assert.notEqual(a.last('room')!.room, null, 'room is still there for a rematch'); assert.equal(a.last('room')!.room!.seats[1]!.nick, 'Боря');
  lobby.handle(a, { t: 'ready', on: true }); assert.equal(b.last('room')!.room!.seats[0]!.ready, true, 'the rival sees the rematch request');
  lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1);
  assert.equal(a.log.filter(m => m.t === 'start').length, starts + 1); assert.equal(b.last('start')!.quick, true);
  // second fight ends, nobody asks again: room closes
  playOut(lobby, t); assert.notEqual(b.last('room')!.room, null);
  t.v += 41000; lobby.tick(.1); assert.equal(a.last('room')!.room, null); assert.equal(b.last('room')!.room, null); assert.equal((lobby as any).rooms.size, 0);
});

test('rematch: leaving the room tells the rival (room closes) and a listed room keeps both players inside', () => {
  const t = { v: Date.UTC(2026, 9, 25, 12) }, lobby = new Lobby(new MemoryStore(), () => t.v), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  lobby.handle(a, { t: 'quick', on: true }); lobby.handle(b, { t: 'quick', on: true }); lobby.tick(.1); lobby.tick(3.1); playOut(lobby, t);
  lobby.handle(b, { t: 'leave' }); assert.equal(a.last('room')!.room, null);
  const c = player(lobby, 'Вера'), d = player(lobby, 'Гоша'); startRanked(lobby, c, d, false); t.v += 1; playOut(lobby, t);
  assert.notEqual(c.last('room')!.room, null); assert.notEqual(d.last('room')!.room, null); t.v += 120000; lobby.tick(.1); assert.notEqual(c.last('room')!.room, null, 'listed rooms do not expire');
});

test('say: a lobby phrase reaches only the rival, is rate limited, and is refused for bad ids or mid-match', () => {
  const t = { v: 1e6 }, lobby = new Lobby(new MemoryStore(), () => t.v), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  lobby.handle(a, { t: 'say', id: 1 }); assert.equal(b.log.filter(m => m.t === 'say').length, 0, 'no room, no phrase');
  lobby.handle(a, { t: 'create', name: 'R', pass: '' }); lobby.handle(a, { t: 'say', id: 1 }); assert.equal(b.log.filter(m => m.t === 'say').length, 0, 'alone in the room');
  lobby.handle(b, { t: 'join', id: roomId(b), pass: '' });
  lobby.handle(a, { t: 'say', id: 1 }); assert.deepEqual(b.last('say'), { t: 'say', id: 1 }); assert.equal(a.log.filter(m => m.t === 'say').length, 0);
  lobby.handle(a, { t: 'say', id: 2 }); assert.equal(b.log.filter(m => m.t === 'say').length, 1, 'rate limit 1 s');
  t.v += 1100; for (const id of [-1, 99, 1.5, 'x']) lobby.handle(a, { t: 'say', id } as any); assert.equal(b.log.filter(m => m.t === 'say').length, 1);
  lobby.handle(a, { t: 'ready', on: true }); lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1); t.v += 1100;
  lobby.handle(a, { t: 'say', id: 0 }); assert.equal(b.log.filter(m => m.t === 'say').length, 1, 'not during a match');
});

test('fight history: online and bot fights land in profile.recent (newest first, 8 kept) and survive a reload', () => {
  const t = { v: Date.UTC(2026, 9, 25, 12) }, store = new MemoryStore(), lobby = new Lobby(store, () => t.v), a = player(lobby, 'Аня'), b = player(lobby, 'Боря');
  startRanked(lobby, a, b); finish(lobby, b);
  assert.deepEqual(prof(a).recent[0], { nick: 'Боря', won: true, delta: prof(a).rating - 1000, online: true });
  assert.equal(prof(b).recent[0].won, false); assert.equal(prof(b).recent[0].nick, 'Аня'); assert.ok(prof(b).recent[0].delta < 0);
  for (let i = 0; i < 10; i++) { t.v += 30000; lobby.handle(a, { t: 'result', level: 'easy', won: i % 2 === 0 }); }
  const r = prof(a).recent; assert.equal(r.length, 8); assert.equal(r[0].nick, 'ИИ · лёгкий'); assert.equal(r[0].online, false); assert.equal(r[0].won, false); assert.equal(r[1].won, true);
  lobby.disconnect(a); const a2 = player(lobby, 'Аня'); assert.deepEqual(prof(a2).recent, r);
});
test('training reward: paid once, never gives rating, survives reconnect', () => {
  const store = new MemoryStore(), lobby = new Lobby(store, () => Date.UTC(2026, 9, 25, 12)), a = player(lobby, 'Аня');
  assert.equal(prof(a).trained, false); lobby.handle(a, { t: 'trained' });
  assert.equal(a.last('shop')!.ok, true); assert.equal(prof(a).coins, 200); assert.equal(prof(a).trained, true); assert.equal(prof(a).rating, 1000); assert.equal(prof(a).games, 0);
  lobby.handle(a, { t: 'trained' }); assert.equal(a.last('shop')!.ok, false); assert.equal(prof(a).coins, 200, 'second claim pays nothing');
  lobby.disconnect(a); const a2 = player(lobby, 'Аня'); assert.equal(prof(a2).trained, true); assert.equal(prof(a2).coins, 200);
});

test('the bot-fight gap is kept per player: a reconnect or a second tab does not reset it', () => {
  let t = Date.UTC(2026, 9, 26, 12); const lobby = new Lobby(new MemoryStore(), () => t), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'result', level: 'hard', won: true }); const c1 = prof(a).coins;
  const a2 = player(lobby, 'Аня'); lobby.handle(a2, { t: 'result', level: 'hard', won: true }); assert.equal(prof(a2).coins, c1, 'second tab');
  lobby.disconnect(a); const a3 = player(lobby, 'Аня'); lobby.handle(a3, { t: 'result', level: 'hard', won: true }); assert.equal(prof(a3).coins, c1, 'reconnect');
  t += 26000; lobby.handle(a3, { t: 'result', level: 'hard', won: true }); assert.ok(prof(a3).coins > c1);
});

test('leaving a bot fight is a loss: rating goes down, no coins, no quest progress, and the anti-spam gap does not hide it', () => {
  let t = Date.UTC(2026, 9, 27, 12); const lobby = new Lobby(new MemoryStore(), () => t), a = player(lobby, 'Аня');
  lobby.handle(a, { t: 'result', level: 'normal', won: true }); const after = prof(a);
  lobby.handle(a, { t: 'result', level: 'normal', won: false, quit: true }); const q = prof(a);
  assert.ok(q.rating < after.rating, 'rating lost right away'); assert.equal(q.coins, after.coins); assert.deepEqual(q.quest.prog, after.quest.prog);
  assert.equal(q.losses, after.losses + 1); assert.match((a.last('shop') as any).text, /поражение/);
});
