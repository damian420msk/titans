// Rooms, lobby and authoritative matches. Transport-agnostic: index.ts feeds it WebSocket messages, tests feed it fake connections.
import { Battle, type GameEvent } from '../shared/battle.ts';
import { cellsValid } from './validate.ts';
import { snapshot, mirrorSnap, mirrorEvents, type C2S, type S2C, type RoomInfo, type RoomView, type Seat, type ErrCode } from '../shared/net.ts';

export interface Conn { send(m: S2C): void }
type Client = { conn: Conn; id: string; nick: string; room: Room | null; seat: 0 | 1 };
type Phase = 'lobby' | 'count' | 'playing';
type Room = {
  id: string; name: string; pass: string; players: [Client | null, Client | null]; ready: [boolean, boolean];
  phase: Phase; count: number; countLeft: number; battle: Battle | null; acc: number; sinceSnap: number; pending: GameEvent[];
};

const STEP = 1 / 60, SNAP_EVERY = 3, COUNT_FROM = 3, MAX_ROOMS = 60;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);

export class Lobby {
  private clients = new Map<Conn, Client>();
  private rooms = new Map<string, Room>();
  private seq = 0;
  /** Matches finished since start, handy for logs and for the rating stage later. */
  onResult?: (r: { names: [string, string]; winner: 0 | 1 | null; reason: 'over' | 'left' }) => void;

  get stats() { return { clients: this.clients.size, rooms: this.rooms.size, playing: [...this.rooms.values()].filter(r => r.phase === 'playing').length }; }

  connect(conn: Conn) {
    const id = `p${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    this.clients.set(conn, { conn, id, nick: 'Игрок', room: null, seat: 0 });
    conn.send({ t: 'welcome', id }); conn.send({ t: 'rooms', rooms: this.list() });
  }

  disconnect(conn: Conn) {
    const c = this.clients.get(conn); if (!c) return;
    this.leave(c); this.clients.delete(conn);
  }

  handle(conn: Conn, raw: unknown) {
    const c = this.clients.get(conn); if (!c || !raw || typeof raw !== 'object') return;
    const m = raw as C2S;
    switch (m.t) {
      case 'hello': c.nick = clean(m.nick, 14) || 'Игрок'; if (c.room) this.pushRoom(c.room); return;
      case 'list': conn.send({ t: 'rooms', rooms: this.list() }); return;
      case 'create': return this.create(c, m.name, m.pass);
      case 'join': return this.join(c, m.id, m.pass);
      case 'leave': this.leave(c); return;
      case 'ready': return this.ready(c, !!m.on);
      case 'ping': conn.send({ t: 'pong', n: Number(m.n) || 0 }); return;
      default: return this.intent(c, m);
    }
  }

  // ---- lobby ----
  private list(): RoomInfo[] {
    return [...this.rooms.values()].map(r => ({ id: r.id, name: r.name, host: r.players[0]?.nick ?? r.players[1]?.nick ?? '', players: r.players.filter(Boolean).length, locked: !!r.pass, playing: r.phase === 'playing' }))
      .sort((a, b) => Number(a.players >= 2) - Number(b.players >= 2) || a.name.localeCompare(b.name));
  }
  private broadcastList() { const rooms = this.list(); for (const c of this.clients.values()) if (!c.room) c.conn.send({ t: 'rooms', rooms }); }
  private err(c: Client, code: ErrCode, text: string) { c.conn.send({ t: 'err', code, text }); }

  private create(c: Client, name: unknown, pass: unknown) {
    if (c.room) return this.err(c, 'busy', 'Сначала выйди из текущей комнаты');
    if (this.rooms.size >= MAX_ROOMS) return this.err(c, 'busy', 'Сервер переполнен, попробуй позже');
    const room: Room = {
      id: Math.random().toString(36).slice(2, 7), name: clean(name, 24) || `Комната ${c.nick}`, pass: clean(pass, 16),
      players: [c, null], ready: [false, false], phase: 'lobby', count: 0, countLeft: 0, battle: null, acc: 0, sinceSnap: 0, pending: [],
    };
    this.rooms.set(room.id, room); c.room = room; c.seat = 0;
    this.pushRoom(room); this.broadcastList();
  }

  private join(c: Client, id: unknown, pass: unknown) {
    if (c.room) return this.err(c, 'busy', 'Сначала выйди из текущей комнаты');
    const room = this.rooms.get(String(id));
    if (!room) { this.err(c, 'gone', 'Комната закрыта'); return void c.conn.send({ t: 'rooms', rooms: this.list() }); }
    if (room.players[1] || room.phase === 'playing') return this.err(c, 'full', 'В комнате уже двое');
    if (room.pass && room.pass !== clean(pass, 16)) return this.err(c, 'wrong_pass', 'Неверный пароль');
    room.players[1] = c; room.ready = [false, false]; c.room = room; c.seat = 1;
    this.pushRoom(room); this.broadcastList();
  }

  private leave(c: Client) {
    const room = c.room; if (!room) return;
    const wasPlaying = room.phase === 'playing', seat = c.seat;
    c.room = null; room.players[seat] = null; room.ready = [false, false];
    if (wasPlaying) {
      const rival = room.players[seat === 0 ? 1 : 0];
      this.onResult?.({ names: [room.players[0]?.nick ?? c.nick, room.players[1]?.nick ?? c.nick], winner: seat === 0 ? 1 : 0, reason: 'left' });
      rival?.conn.send({ t: 'end', winner: 0, reason: 'left' });
    }
    room.phase = 'lobby'; room.battle = null; room.pending = [];
    // the remaining player moves to the first (blue) seat
    if (room.players[1] && !room.players[0]) { room.players[0] = room.players[1]; room.players[1] = null; room.players[0].seat = 0; }
    if (!room.players[0] && !room.players[1]) this.rooms.delete(room.id); else this.pushRoom(room);
    c.conn.send({ t: 'room', room: null }); c.conn.send({ t: 'rooms', rooms: this.list() });
    this.broadcastList();
  }

  private ready(c: Client, on: boolean) {
    const room = c.room; if (!room || room.phase !== 'lobby') return;
    room.ready[c.seat] = on;
    if (room.players[0] && room.players[1] && room.ready[0] && room.ready[1]) { room.phase = 'count'; room.count = COUNT_FROM; room.countLeft = 1; }
    this.pushRoom(room);
  }

  private view(room: Room, seat: 0 | 1): RoomView {
    const s = (i: 0 | 1): Seat => room.players[i] ? { nick: room.players[i]!.nick, ready: room.ready[i] } : null;
    return { name: room.name, locked: !!room.pass, seats: [s(0), s(1)], me: seat, count: room.phase === 'count' ? room.count : null };
  }
  private pushRoom(room: Room) { for (const p of room.players) if (p) p.conn.send({ t: 'room', room: this.view(room, p.seat) }); }

  // ---- match ----
  private startMatch(room: Room) {
    room.phase = 'playing'; room.battle = new Battle(); room.acc = 0; room.sinceSnap = SNAP_EVERY; room.pending = [];
    for (const p of room.players) p!.conn.send({ t: 'start', foe: room.players[p!.seat === 0 ? 1 : 0]!.nick });
    this.broadcastList();
  }

  private intent(c: Client, m: C2S) {
    const room = c.room, b = room?.battle; if (!room || !b || room.phase !== 'playing' || b.phase !== 'playing') return;
    const s = c.seat, num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    switch (m.t) {
      case 'move': if (num(m.x) && num(m.z)) b.setMove(s, Math.max(-1, Math.min(1, m.x)), Math.max(-1, Math.min(1, m.z))); return;
      case 'begin': b.beginCharge(s); return;
      case 'target': if (cellsValid(m.x, m.z)) b.setTarget(s, { x: m.x, z: m.z }); return;
      case 'release': if (cellsValid(m.x, m.z)) b.setTarget(s, { x: m.x, z: m.z }); b.releaseCharge(s); return;
      case 'cancel': b.cancelCharge(s); return;
      case 'repair': if (m.on) { if (!b.charges[s]) b.beginRepair(s); } else b.cancelRepair(s); return;
    }
  }

  /** Advance everything by `dt` seconds of real time. */
  tick(dt: number) {
    for (const room of this.rooms.values()) {
      if (room.phase === 'count') {
        room.countLeft -= dt;
        while (room.phase === 'count' && room.countLeft <= 0) { room.count--; room.countLeft += 1; if (room.count <= 0) this.startMatch(room); else this.pushRoom(room); }
        if (room.phase === 'count') continue;
      }
      if (room.phase !== 'playing' || !room.battle) continue;
      const b = room.battle; room.acc += Math.min(dt, .25);
      while (room.acc >= STEP && b.phase === 'playing') {
        room.acc -= STEP; b.step(STEP); room.pending.push(...b.events); b.events.length = 0;
        if (++room.sinceSnap >= SNAP_EVERY) { room.sinceSnap = 0; this.sendSnap(room); }
      }
      if (b.phase === 'over') this.finishMatch(room);
    }
  }

  private sendSnap(room: Room) {
    const b = room.battle!, s = snapshot(b), ev = room.pending; room.pending = [];
    const [p0, p1] = room.players;
    p0?.conn.send({ t: 'snap', s, ev });
    p1?.conn.send({ t: 'snap', s: mirrorSnap(s), ev: mirrorEvents(ev) });
  }

  private finishMatch(room: Room) {
    const b = room.battle!; this.sendSnap(room);
    this.onResult?.({ names: [room.players[0]!.nick, room.players[1]!.nick], winner: b.winner, reason: 'over' });
    room.players[0]!.conn.send({ t: 'end', winner: b.winner, reason: 'over' });
    room.players[1]!.conn.send({ t: 'end', winner: b.winner === null ? null : b.winner === 0 ? 1 : 0, reason: 'over' });
    room.phase = 'lobby'; room.battle = null; room.ready = [false, false]; room.pending = [];
    this.pushRoom(room); this.broadcastList();
  }
}
