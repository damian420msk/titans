import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, type Conn } from '../server/lobby.ts';
import { MemoryStore } from '../server/store.ts';
import { mulberry32 } from '../shared/bot.ts';
import type { S2C, RoomInfo } from '../shared/net.ts';

// Random players hammer the server with legal and illegal messages, connect, drop and come back. Nothing may throw and the state must stay sane.
const tokenOf = (n: number) => `fuzztoken${String(n).padStart(8, '0')}abcdef`;
test('fuzz: random intents, drops and reconnects never break the server or the battle state', () => {
  const rnd = mulberry32(12345), clock = { t: 1e9 }, lobby = new Lobby(new MemoryStore(), () => clock.t);
  const seen = { starts: 0, ends: 0 };
  type P = { conn: Conn & { log: S2C[] }; n: number };
  const mk = (n: number): P => { const log: S2C[] = []; const conn = { log, send: (m: S2C) => { if (m.t === 'start') seen.starts++; if (m.t === 'end') seen.ends++; if (m.t === 'start' && 0) return; log.push(m); if (log.length > 50) log.shift(); } }; lobby.connect(conn); lobby.handle(conn, { t: 'hello', nick: 'P' + n, token: tokenOf(n) }); return { conn, n }; };
  const players: P[] = [0, 1, 2, 3, 4, 5].map(mk);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const junk = () => pick<unknown>([null, 5, 'x', {}, { t: 'move', x: 'a', z: NaN }, { t: 'target', x: 1.5, z: -3 }, { t: 'release', x: 99, z: 99 }, { t: 'emote', id: 'q' }, { t: 'buy', kind: 'zz', id: 1 }, { t: 'result', level: 'god', won: 1 }, { t: 'join', id: 5, pass: {} }, { t: 'create', name: { a: 1 }, pass: 3 }]);
  for (let step = 0; step < 6000; step++) {
    clock.t += 50;
    const p = pick(players), r = rnd();
    const rooms = (p.conn.log.filter(m => m.t === 'rooms').pop() as any)?.rooms as RoomInfo[] | undefined;
    if (r < .04) lobby.handle(p.conn, { t: 'create', name: 'R' + step, pass: rnd() < .3 ? 'pw' : '', ranked: rnd() < .5 });
    else if (r < .09 && rooms?.length) lobby.handle(p.conn, { t: 'join', id: pick(rooms).id, pass: rnd() < .5 ? 'pw' : '' });
    else if (r < .14) lobby.handle(p.conn, { t: 'ready', on: rnd() < .8 });
    else if (r < .16) lobby.handle(p.conn, { t: 'quick', on: rnd() < .7 });
    else if (r < .17) lobby.handle(p.conn, { t: 'leave' });
    else if (r < .19) { lobby.disconnect(p.conn); players[players.indexOf(p)] = mk(p.n); }
    else if (r < .21) lobby.handle(p.conn, junk());
    else if (r < .23) lobby.handle(p.conn, { t: 'buy', kind: pick(['up', 'item'] as const), id: pick(['bag', 'hands', 'skin_gold', 'tiles_moss', 'nope']) });
    else if (r < .25) lobby.handle(p.conn, { t: 'result', level: pick(['easy', 'normal', 'hard'] as const), won: rnd() < .5 });
    else if (r < .27) lobby.handle(p.conn, { t: 'emote', id: Math.floor(rnd() * 5) });
    else if (r < .5) lobby.handle(p.conn, { t: 'move', x: rnd() * 2 - 1, z: rnd() * 2 - 1 });
    else if (r < .6) { lobby.handle(p.conn, { t: 'begin' }); lobby.handle(p.conn, { t: 'target', x: Math.floor(rnd() * 9), z: Math.floor(rnd() * 11) }); }
    else if (r < .7) lobby.handle(p.conn, { t: 'release', x: Math.floor(rnd() * 9), z: Math.floor(rnd() * 11) });
    else if (r < .75) lobby.handle(p.conn, { t: 'cancel' });
    else if (r < .8) lobby.handle(p.conn, { t: 'repair', on: rnd() < .5 });
    lobby.tick(.05 + rnd() * .1);
    if (step % 50 === 0) for (const q of players) {
      const s = (q.conn.log.filter(m => m.t === 'snap').pop() as any)?.s; if (!s) continue;
      for (const a of s.a) { assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.y), 'finite position'); assert.ok(a.s >= 0 && a.s <= 6, 'stones in range'); assert.ok(a.l >= 0 && a.l <= 3, 'lives in range'); }
      for (const f of s.fl) for (const v of f) assert.ok(Number.isFinite(v) && v >= 0, 'plate hp is a number');
    }
  }
  assert.ok(seen.starts >= 4 && seen.ends >= 2, `the fuzz must really play matches (starts ${seen.starts}, ends ${seen.ends})`);
  const st = lobby.stats; assert.ok(st.clients <= 6 + 40 && st.rooms < 60);
});
