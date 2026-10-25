import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, type Conn } from '../server/lobby.ts';
import type { S2C, RoomView } from '../shared/net.ts';

type Fake = Conn & { log: S2C[]; last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined; all<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] };
const fake = (): Fake => { const log: S2C[] = []; return { log, send: m => { log.push(m); }, last: (t: any) => [...log].reverse().find(m => m.t === t) as any, all: (t: any) => log.filter(m => m.t === t) as any }; };
const setup = () => { const lobby = new Lobby(), a = fake(), b = fake(); lobby.connect(a); lobby.connect(b); lobby.handle(a, { t: 'hello', nick: 'Аня' }); lobby.handle(b, { t: 'hello', nick: 'Боря' }); return { lobby, a, b }; };
const roomOf = (c: Fake) => c.last('room')!.room as RoomView | null;

test('create, list, join: creator is seat 0 (blue), joiner seat 1 (red)', () => {
  const { lobby, a, b } = setup();
  lobby.handle(a, { t: 'create', name: 'Дуэль', pass: '' });
  assert.equal(roomOf(a)!.me, 0); assert.equal(roomOf(a)!.seats[1], null);
  const info = b.last('rooms')!.rooms; assert.equal(info.length, 1); assert.equal(info[0].host, 'Аня'); assert.equal(info[0].locked, false);
  lobby.handle(b, { t: 'join', id: info[0].id, pass: '' });
  assert.equal(roomOf(b)!.me, 1); assert.deepEqual(roomOf(a)!.seats.map(s => s?.nick), ['Аня', 'Боря']);
});

test('password: wrong one is rejected, right one lets in; a third player gets "full"', () => {
  const { lobby, a, b } = setup(), c = fake(); lobby.connect(c);
  lobby.handle(a, { t: 'create', name: 'Секрет', pass: '1234' });
  const id = b.last('rooms')!.rooms[0].id; assert.equal(b.last('rooms')!.rooms[0].locked, true);
  lobby.handle(b, { t: 'join', id, pass: 'nope' }); assert.equal(b.last('err')!.code, 'wrong_pass'); assert.equal(b.last('room'), undefined);
  lobby.handle(b, { t: 'join', id, pass: '1234' }); assert.equal(roomOf(b)!.me, 1);
  lobby.handle(c, { t: 'join', id, pass: '1234' }); assert.equal(c.last('err')!.code, 'full');
});

test('both ready starts a 3-2-1 countdown, then a mirrored authoritative match', () => {
  const { lobby, a, b } = setup();
  lobby.handle(a, { t: 'create', name: 'R', pass: '' }); lobby.handle(b, { t: 'join', id: a.last('rooms')!.rooms[0]?.id ?? (b.last('rooms')!.rooms[0].id), pass: '' });
  lobby.handle(a, { t: 'ready', on: true }); assert.equal(roomOf(a)!.count, null);
  lobby.handle(b, { t: 'ready', on: true }); assert.equal(roomOf(a)!.count, 3);
  lobby.tick(1.01); assert.equal(roomOf(a)!.count, 2); lobby.tick(1); assert.equal(roomOf(a)!.count, 1); lobby.tick(1);
  assert.equal(a.last('start')!.foe, 'Боря'); assert.equal(b.last('start')!.foe, 'Аня');
  assert.equal(a.last('start')!.look[0].titan, 'titan_blue'); assert.equal(a.last('start')!.look[1].titan, 'titan_blue'); // the titan pick travels with the look
  // Anna walks right-forward; Boris stands still. Both see themselves at the same world spot (mirror).
  lobby.handle(a, { t: 'move', x: 1, z: 0 }); for (let i = 0; i < 20; i++) lobby.tick(1 / 20);
  const sa = a.last('snap')!.s, sb = b.last('snap')!.s;
  assert.ok(sa.a[0].x > 0.5, 'Anna moved'); assert.ok(Math.abs(sb.a[1].x + sa.a[0].x) < 1e-6, 'Boris sees Anna mirrored as his enemy');
  assert.equal(sb.a[0].x, -sa.a[1].x);
});

test('throw from the guest lands on the host island; a match ends on time and the room returns to the lobby', () => {
  const { lobby, a, b } = setup();
  lobby.handle(a, { t: 'create', name: 'R', pass: '' }); lobby.handle(b, { t: 'join', id: b.last('rooms')!.rooms[0].id, pass: '' });
  lobby.handle(a, { t: 'ready', on: true }); lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1);
  lobby.handle(b, { t: 'begin' }); lobby.handle(b, { t: 'release', x: 4, z: 5 });
  for (let i = 0; i < 120; i++) lobby.tick(1 / 60);
  const ev = [...a.all('snap'), ...b.all('snap')].flatMap(m => m.ev);
  assert.ok(ev.some(e => e.type === 'throw'), 'throw event'); assert.ok(ev.some(e => e.type === 'impact'), 'impact event');
  const hostSees = a.all('snap').flatMap(m => m.ev).find(e => e.type === 'impact') as any, guestSees = b.all('snap').flatMap(m => m.ev).find(e => e.type === 'impact') as any;
  assert.equal(hostSees.side, 0, 'host island was hit'); assert.equal(guestSees.side, 1, 'guest sees it on the enemy island');
  for (let i = 0; i < 800; i++) lobby.tick(.25);
  assert.equal(a.last('end')!.reason, 'over'); assert.equal(roomOf(a)!.count, null); assert.equal(roomOf(a)!.seats[0]!.ready, false);
});

test('leaving mid-match gives the other player the win; host leaving moves the guest to blue; empty room is removed', () => {
  const { lobby, a, b } = setup();
  lobby.handle(a, { t: 'create', name: 'R', pass: '' }); lobby.handle(b, { t: 'join', id: b.last('rooms')!.rooms[0].id, pass: '' });
  lobby.handle(a, { t: 'ready', on: true }); lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1);
  lobby.disconnect(a); assert.equal(b.last('end')!.winner, 0); assert.equal(b.last('end')!.reason, 'left');
  assert.equal(roomOf(b)!.me, 0); assert.equal(roomOf(b)!.seats[1], null);
  lobby.handle(b, { t: 'leave' }); assert.equal(lobby.stats.rooms, 0);
});

test('garbage input does not crash the lobby', () => {
  const { lobby, a } = setup();
  for (const m of [null, 5, 'x', {}, { t: 'create', name: 7, pass: {} }, { t: 'join', id: {}, pass: 1 }, { t: 'move', x: 'a' }, { t: 'release', x: 1e9, z: -1 }, { t: 'nope' }]) lobby.handle(a, m);
  lobby.tick(1); assert.ok(true);
});

test('the guest steers in its own view: stick right moves the guest titan to ITS right (mirrored on the server)', () => {
  const { lobby, a, b } = setup();
  lobby.handle(a, { t: 'create', name: 'R', pass: '' }); lobby.handle(b, { t: 'join', id: b.last('rooms')!.rooms[0].id, pass: '' });
  lobby.handle(a, { t: 'ready', on: true }); lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1);
  lobby.handle(b, { t: 'move', x: 1, z: 0 }); for (let i = 0; i < 30; i++) lobby.tick(1 / 30);
  const guestView = b.last('snap')!.s, hostView = a.last('snap')!.s;
  assert.ok(guestView.a[0].x > 1, `guest sees itself moving right (${guestView.a[0].x})`);
  assert.ok(hostView.a[1].x < -1, 'host sees the guest moving to the mirrored side');
  lobby.handle(b, { t: 'move', x: 0, z: 1 }); for (let i = 0; i < 20; i++) lobby.tick(1 / 30);
  assert.ok(b.last('snap')!.s.a[0].z > guestView.a[0].z, 'guest forward (+z in own view) is forward for the guest');
});

test('sprint and jump intents reach the battle for both seats; jump from the guest works too', () => {
  const { lobby, a, b } = setup();
  lobby.handle(a, { t: 'create', name: 'S', pass: '' }); lobby.handle(b, { t: 'join', id: a.last('room')!.room!.id, pass: '' });
  lobby.handle(a, { t: 'ready', on: true }); lobby.handle(b, { t: 'ready', on: true }); lobby.tick(3.1);
  const room = [...(lobby as any).rooms.values()][0], bt = room.battle;
  lobby.handle(a, { t: 'move', x: 0, z: 1 }); lobby.handle(a, { t: 'sprint', on: true }); lobby.tick(.5);
  assert.equal(bt.actors[0].running, true); lobby.handle(a, { t: 'sprint', on: false }); lobby.tick(.05); assert.equal(bt.actors[0].running, false);
  lobby.handle(b, { t: 'jump' }); assert.ok(bt.actors[1].air > 0); lobby.handle(a, { t: 'sprint', on: 'yes' as any }); lobby.tick(.05); assert.equal(bt.sprint[0], false, 'only a real true counts');
  lobby.tick(.3); lobby.handle(b, { t: 'jump' }); assert.ok(bt.actors[1].air > 0, 'still the first hop or a refused second one, never a crash');
  const snap = a.last('snap')!.s; assert.ok('ja' in snap.a[0]);
});

test('bad nicks and room names are refused by the server', () => {
  const { lobby, a } = setup();
  lobby.handle(a, { t: 'nick', nick: 'с у к а' });
  assert.equal(a.last('err')?.code, 'bad_nick');
  lobby.handle(a, { t: 'create', name: 'Сервер для пидоров', pass: '', ranked: false });
  assert.equal(a.all('err').length, 2); assert.equal(a.last('err')?.code, 'bad_nick');
  const c = fake(); lobby.connect(c); lobby.handle(c, { t: 'hello', nick: 'fuck' });
  assert.equal(c.last('profile')?.p.nick, 'Игрок');
});
