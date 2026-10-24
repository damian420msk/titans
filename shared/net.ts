// Wire protocol and state snapshots for online duels. No DOM, no Babylon: used by server/ and client/.
// The server runs the only real Battle. Guests (seat 1) receive a mirrored snapshot, so every client sees itself as side 0.
import { map, type Cell, type Side } from './world.ts';
import { Battle, cellKey, type GameEvent, type Kind, type Mods } from './battle.ts';
import type { Profile, PublicEntry, CosmeticKind } from './progress.ts';
import type { Difficulty } from './bot.ts';

export type RoomInfo = { id: string; name: string; host: string; players: number; locked: boolean; playing: boolean; ranked: boolean };
export type Seat = { nick: string; ready: boolean; rating: number } | null;
export type RoomView = { name: string; locked: boolean; ranked: boolean; seats: [Seat, Seat]; me: 0 | 1; count: number | null };
export type Look = Record<CosmeticKind, string>;
export type MyProfile = Omit<Profile, 'id'> & { dailyReady: boolean };

export type C2S =
  | { t: 'hello'; nick: string; token?: string }
  | { t: 'nick'; nick: string }
  | { t: 'buy'; kind: 'up' | 'item'; id: string }
  | { t: 'equip'; id: string }
  | { t: 'claim' }
  | { t: 'top' }
  | { t: 'result'; level: Difficulty; won: boolean }
  | { t: 'quick'; on: boolean }
  | { t: 'list' }
  | { t: 'create'; name: string; pass: string; ranked?: boolean }
  | { t: 'join'; id: string; pass: string }
  | { t: 'leave' }
  | { t: 'ready'; on: boolean }
  | { t: 'move'; x: number; z: number }
  | { t: 'begin' }
  | { t: 'target'; x: number; z: number }
  | { t: 'release'; x: number; z: number }
  | { t: 'cancel' }
  | { t: 'repair'; on: boolean }
  | { t: 'emote'; id: number }
  | { t: 'ping'; n: number };

export type ErrCode = 'wrong_pass' | 'full' | 'gone' | 'busy' | 'bad';
export type S2C =
  | { t: 'welcome'; id: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'room'; room: RoomView | null }
  | { t: 'err'; code: ErrCode; text: string }
  | { t: 'profile'; p: MyProfile }
  | { t: 'top'; list: PublicEntry[]; rank: number | null }
  | { t: 'queue'; on: boolean }
  | { t: 'shop'; ok: boolean; text: string }
  | { t: 'start'; foe: string; foeRating: number; mods: [Mods, Mods]; look: [Look, Look]; ranked: boolean; quick?: boolean }
  | { t: 'snap'; s: Snap; ev: GameEvent[] }
  | { t: 'end'; winner: Side | null; reason: 'over' | 'left'; gain: { rating: number; coins: number; ranked: boolean } | null }
  | { t: 'away'; on: boolean }
  | { t: 'emote'; id: number }
  | { t: 'pong'; n: number };

type V2 = [number, number];
export type ActorSnap = { x: number; z: number; y: number; vy: number; f: 0 | 1; l: number; s: number; c: number; st: number; sl: [number, number, number] | null };
export type Snap = {
  tm: number; over: 0 | 1; w: Side | null;
  a: [ActorSnap, ActorSnap];
  fl: [number[], number[]];
  in: [V2, V2];
  ch: [[number, number, number] | null, [number, number, number] | null]; // t, target x, target z (-1 = none)
  rp: [[number, number, number, number] | null, [number, number, number, number] | null]; // cell x, z, t, need
  rf: [number, number];
  sh: { id: number; o: Side; k: Kind; sx: number; sz: number; e: number; c: Cell[] }[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const HP_INF = 99;
const other = (s: Side): Side => s === 0 ? 1 : 0;

export function snapshot(b: Battle): Snap {
  const act = (i: Side): ActorSnap => { const a = b.actors[i]; return { x: r3(a.pos.x), z: r3(a.pos.z), y: r3(a.y), vy: r3(a.vy), f: a.falling ? 1 : 0, l: a.lives, s: a.stones, c: r3(a.cooldown), st: r3(a.stun), sl: a.slide ? [r3(a.slide.dx), r3(a.slide.dz), r3(a.slide.t)] : null }; };
  const floor = (i: Side) => map.cells.map(c => { const v = b.floors[i].get(cellKey(c)) ?? 0; return Number.isFinite(v) ? v : HP_INF; });
  const ch = (i: Side): Snap['ch'][0] => { const c = b.charges[i]; return c ? [r3(c.t), c.target ? c.target.x : -1, c.target ? c.target.z : -1] : null; };
  const rp = (i: Side): Snap['rp'][0] => { const r = b.repairs[i]; return r ? [r.cell.x, r.cell.z, r3(r.t), r.need] : null; };
  return {
    tm: r3(b.time), over: b.phase === 'over' ? 1 : 0, w: b.winner,
    a: [act(0), act(1)], fl: [floor(0), floor(1)],
    in: [[r3(b.input[0].x), r3(b.input[0].z)], [r3(b.input[1].x), r3(b.input[1].z)]],
    ch: [ch(0), ch(1)], rp: [rp(0), rp(1)], rf: [r3(b.refills[0]), r3(b.refills[1])],
    sh: b.shots.map(s => ({ id: s.id, o: s.owner, k: s.kind, sx: r3(s.start.x), sz: r3(s.start.z), e: r3(s.elapsed), c: s.cells.map(c => ({ x: c.x, z: c.z })) })),
  };
}

/** Overwrite the battle state with a snapshot (does not touch `events`). */
export function applySnap(b: Battle, s: Snap) {
  b.time = s.tm; b.phase = s.over ? 'over' : 'playing'; b.winner = s.w;
  for (const i of [0, 1] as Side[]) {
    const a = s.a[i];
    b.actors[i] = { pos: { x: a.x, z: a.z }, y: a.y, vy: a.vy, falling: a.f === 1, lives: a.l, stones: a.s, cooldown: a.c, stun: a.st, slide: a.sl ? { dx: a.sl[0], dz: a.sl[1], t: a.sl[2] } : null };
    map.cells.forEach((c, k) => { const v = s.fl[i][k]; b.floors[i].set(cellKey(c), v >= HP_INF ? Infinity : v); });
    b.input[i] = { x: s.in[i][0], z: s.in[i][1] };
    const ch = s.ch[i]; b.charges[i] = ch ? { t: ch[0], target: ch[1] >= 0 ? { x: ch[1], z: ch[2] } : null } : null;
    const rp = s.rp[i]; b.repairs[i] = rp ? { cell: { x: rp[0], z: rp[1] }, t: rp[2], need: rp[3] } : null;
    b.refills[i] = s.rf[i];
  }
  b.shots = s.sh.map(x => ({ id: x.id, owner: x.o, kind: x.k, cells: x.c.map(c => ({ ...c })), start: { x: x.sx, z: x.sz }, elapsed: x.e }));
}

/** View from the other side: swap players and rotate the world by 180 degrees. Applying it twice gives the original. */
export function mirrorSnap(s: Snap): Snap {
  const act = (a: ActorSnap): ActorSnap => ({ ...a, x: -a.x, z: -a.z, sl: a.sl ? [-a.sl[0], -a.sl[1], a.sl[2]] : null });
  return {
    tm: s.tm, over: s.over, w: s.w === null ? null : other(s.w),
    a: [act(s.a[1]), act(s.a[0])], fl: [s.fl[1], s.fl[0]],
    in: [[-s.in[1][0], -s.in[1][1]], [-s.in[0][0], -s.in[0][1]]],
    ch: [s.ch[1], s.ch[0]], rp: [s.rp[1], s.rp[0]], rf: [s.rf[1], s.rf[0]],
    sh: s.sh.map(x => ({ ...x, o: other(x.o), sx: -x.sx, sz: -x.sz })),
  };
}
export function mirrorEvents(ev: GameEvent[]): GameEvent[] {
  return ev.map(e => e.type === 'over' ? { ...e, winner: e.winner === null ? null : other(e.winner) } : { ...e, side: other(e.side) } as GameEvent);
}

export const isCell = (x: unknown, z: unknown) => Number.isInteger(x) && Number.isInteger(z);
