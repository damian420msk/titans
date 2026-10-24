import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../shared/battle.ts';
import { Predictor } from '../shared/predict.ts';
import { Lobby, type Conn } from '../server/lobby.ts';
import type { S2C, C2S, Snap } from '../shared/net.ts';

// Real server code + two simulated clients behind a lagging network and a slow frame rate.
type Msg = { at: number; fn: () => void };
function run(lag: number, frameMs: number, seat: 0 | 1, seconds = 14) {
  const q: Msg[] = [], lobby = new Lobby(); let T = 0;
  const later = (d: number, fn: () => void) => q.push({ at: T + d, fn });
  const inbox: { s: Snap; at: number }[][] = [[], []];
  const conns: Conn[] = [0, 1].map(i => ({ send: (m: S2C) => { later(lag, () => { if (m.t === 'snap') inbox[i].push({ s: m.s, at: T }); }); } }));
  const lobbyConns = conns.map(c => { lobby.connect(c); return c; });
  const send = (i: number, m: C2S) => later(lag, () => lobby.handle(lobbyConns[i], m));
  // lobby setup happens instantly (not under test)
  lobby.handle(lobbyConns[0], { t: 'hello', nick: 'A' }); lobby.handle(lobbyConns[1], { t: 'hello', nick: 'B' });
  lobby.handle(lobbyConns[0], { t: 'create', name: 'R', pass: '' });
  const rooms: any[] = []; const probe: Conn = { send: m => { if (m.t === 'rooms') rooms.push(...m.rooms); } }; lobby.connect(probe);
  lobby.handle(lobbyConns[1], { t: 'join', id: rooms[0].id, pass: '' });
  lobby.handle(lobbyConns[0], { t: 'ready', on: true }); lobby.handle(lobbyConns[1], { t: 'ready', on: true }); lobby.tick(3.05);
  inbox[0].length = 0; inbox[1].length = 0;

  const me = seat, b = new Battle(), pred = new Predictor(); pred.rtt = 2 * lag + .01;
  let nextFrame = 0, acc = 0, lastMoveSent = '', prev = { ...b.actors[0].pos }, maxStep = 0, maxErr = 0, frames = 0, last = 0;
  const dirs = [[1, 0], [0, 0], [-1, 0], [0, 0], [0, 1], [0, 0], [0, -1], [0, 0], [-1, 0], [0, 0], [1, 0], [0, 0]];
  for (T = 0; T < seconds; T += 1 / 240) {
    q.sort((a, c) => a.at - c.at); while (q.length && q[0].at <= T) q.shift()!.fn();
    lobby.tick(1 / 240);
    if (T >= nextFrame) {
      const dt = Math.min(T - last, .25) || 1 / 60; last = T; nextFrame = T + frameMs / 1000; frames++;
      const box = inbox[me]; if (box.length) { const { s, at } = box[box.length - 1]; box.length = 0; pred.reconcile(b, s, at, T); }
      pred.record(T, b.actors[0].pos.x, b.actors[0].pos.z);
      const [dx, dz] = dirs[Math.floor(T / .9) % dirs.length];
      b.setMove(0, dx, dz); const key = `${dx},${dz}`; if (key !== lastMoveSent) { lastMoveSent = key; send(me, { t: 'move', x: dx, z: dz }); }
      acc += dt; while (acc >= 1 / 60) { acc -= 1 / 60; b.step(1 / 60); b.events.length = 0; }
      const p = b.actors[0].pos, step = Math.hypot(p.x - prev.x, p.z - prev.z); const before = prev; prev = { ...p };
      if (T > 4) { if (step / dt > 9 && process.env.DBG) console.log('JUMP', T.toFixed(2), 'dt', dt.toFixed(3), 'from', JSON.stringify(before), 'to', JSON.stringify(p), 'falling', b.actors[0].falling, 'stun', b.actors[0].stun, 'lives', b.actors[0].lives); maxStep = Math.max(maxStep, step / dt); }
      // distance to the server truth, in the client's own view
      const truth = (me === 0 ? lobbyBattle(lobby).actors[0].pos : { x: -lobbyBattle(lobby).actors[1].pos.x, z: -lobbyBattle(lobby).actors[1].pos.z });
      if (process.env.DBG2 && frames % 4 === 0 && T > 2 && T < 8.5) console.log('T', T.toFixed(2), 'local', p.x.toFixed(2), 'truth', truth.x.toFixed(2), 'in', dx, 'srvIn', (me === 0 ? lobbyBattle(lobby).input[0].x : -lobbyBattle(lobby).input[1].x));
      if (T > 4) maxErr = Math.max(maxErr, Math.hypot(p.x - truth.x, p.z - truth.z));
    }
  }
  return { maxSpeed: maxStep, maxErr, frames };
}
const lobbyBattle = (l: Lobby): Battle => [...(l as any).rooms.values()][0].battle;

for (const [lag, frameMs] of [[.03, 16], [.08, 33], [.15, 50], [.25, 66]] as const) {
  for (const seat of [0, 1] as const) {
    test(`prediction stays smooth and close to the server: one-way lag ${lag * 1000} ms, ${Math.round(1000 / frameMs)} fps, seat ${seat}`, () => {
      const r = run(lag, frameMs, seat); if (process.env.DBG3) console.log('METRIC', lag, frameMs, seat, r.maxSpeed.toFixed(2), r.maxErr.toFixed(2));
      assert.ok(r.maxSpeed < 9, `own titan never visibly teleports (peak ${r.maxSpeed.toFixed(1)} m/s, walk is 5)`);
      assert.ok(r.maxErr < 1.6 + 5 * lag * 2, `own titan stays near the server truth (peak gap ${r.maxErr.toFixed(2)} m)`);
    });
  }
}
