// Rooms, quick-match queue, profiles and authoritative matches.
// Transport-agnostic: index.ts feeds it WebSocket messages, tests feed it fake connections.
import { createHash } from 'node:crypto';
import type { Difficulty } from '../shared/bot.ts';
import { Battle, type GameEvent } from '../shared/battle.ts';
import { cellsValid } from './validate.ts';
import { MemoryStore, type Store } from './store.ts';
import { PHRASES, REMATCH_S, snapshot, mirrorSnap, mirrorEvents, type C2S, type S2C, type RoomInfo, type RoomView, type Seat, type ErrCode, type MyProfile } from '../shared/net.ts';
import { newProfile, modsFor, buyUpgrade, buyCosmetic, equip, claimDaily, dailyStreak, claimTrained, dayIndex, rewardBot, botRatingDelta, BOT_REWARD, applyOnline, recordQuest, pushRecent, freshQuest, countEvents, cleanStats, noStats, type FightStats, ONLINE_REWARD, UPGRADES, type Profile, type PublicEntry } from '../shared/progress.ts';

export interface Conn { send(m: S2C): void }
type Client = {
  conn: Conn; id: string; nick: string; room: Room | null; seat: 0 | 1;
  pid: string | null; profile: Profile | null; queuedAt: number | null; lastResult: number; away: number | null; lastEmote: number; lastSay: number; lastGain: number;
};
type Phase = 'lobby' | 'count' | 'playing';
type Room = {
  id: string; name: string; pass: string; ranked: boolean; hidden: boolean; players: [Client | null, Client | null]; ready: [boolean, boolean];
  until: number; phase: Phase; count: number; countLeft: number; battle: Battle | null; acc: number; sinceSnap: number; pending: GameEvent[];
  /** what each seat did in the current fight, for the daily tasks */
  stats: [FightStats, FightStats];
};

const STEP = 1 / 60, SNAP_EVERY = 3, COUNT_FROM = 3, MAX_ROOMS = 60, BOT_RESULT_GAP_MS = 25000, FARM_LIMIT = 6, TOP_TTL_MS = 10000, GRACE_MS = 15000;
import { checkNick, checkText } from '../shared/names.ts';
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const BOT_NAMES = { easy: 'ИИ · лёгкий', normal: 'ИИ · средний', hard: 'ИИ · сложный' };
const FRIENDLY = { win: 30, loss: 10, draw: 15 };

export class Lobby {
  private clients = new Map<Conn, Client>();
  private rooms = new Map<string, Room>();
  private profiles = new Map<string, Profile>();
  private queue: Client[] = [];
  private pairLog = new Map<string, number[]>();
  /** last paid bot fight per player (profile id, or socket id for a guest) */
  private lastBot = new Map<string, number>();
  private topCache: { at: number; list: PublicEntry[] } | null = null;
  private seq = 0;
  private store: Store;
  private now: () => number;
  /** Finished matches, for logs. */
  onResult?: (r: { names: [string, string]; winner: 0 | 1 | null; reason: 'over' | 'left'; ranked: boolean; dur: number }) => void;
  /** Paid bot fights, for logs. */
  onBot?: (r: { nick: string; level: Difficulty; won: boolean; dur: number | null; coins: number }) => void;

  constructor(store: Store = new MemoryStore(), now: () => number = Date.now) { this.store = store; this.now = now; }

  get stats() { return { clients: this.clients.size, rooms: this.rooms.size, playing: [...this.rooms.values()].filter(r => r.phase === 'playing').length, queued: this.queue.length }; }

  connect(conn: Conn) {
    const id = `p${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    this.clients.set(conn, { conn, id, nick: 'Игрок', room: null, seat: 0, pid: null, profile: null, queuedAt: null, lastResult: 0, away: null, lastEmote: -1e9, lastSay: -1e9, lastGain: 0 });
    conn.send({ t: 'welcome', id }); conn.send({ t: 'rooms', rooms: this.list() });
  }

  disconnect(conn: Conn) {
    const c = this.clients.get(conn); if (!c) return;
    this.dequeue(c); this.clients.delete(conn);
    const room = c.room, b = room?.battle;
    // a saved account that drops in the middle of a match keeps its seat for a while: mobile networks blink
    if (room && b && room.phase === 'playing' && b.phase === 'playing' && c.pid) {
      c.away = this.now(); b.setMove(c.seat, 0, 0); b.setSprint(c.seat, false); b.cancelCharge(c.seat); b.cancelRepair(c.seat);
      room.players[c.seat === 0 ? 1 : 0]?.conn.send({ t: 'away', on: true }); return;
    }
    this.leave(c);
    // nobody else is signed in with this profile: drop it from memory (the store keeps it; the next hello loads it again)
    if (c.pid && ![...this.clients.values()].some(x => x.pid === c.pid) && ![...this.rooms.values()].some(r => r.players.some(p => p?.pid === c.pid))) this.profiles.delete(c.pid);
  }
  /** Profiles held in memory right now (for tests and /health). */
  get loaded() { return this.profiles.size; }

  /** A client that says hello with the token of an away player takes that seat back. */
  private resume(c: Client) {
    if (!c.pid || c.room) return;
    for (const room of this.rooms.values()) for (const i of [0, 1] as const) {
      const old = room.players[i];
      if (!old || old.away === null || old.pid !== c.pid || room.phase !== 'playing' || !room.battle) continue;
      old.away = null; c.room = room; c.seat = i; room.players[i] = c; c.profile = old.profile; c.nick = old.nick; c.lastResult = old.lastResult;
      c.conn.send(this.startMsg(room, i)); const s = snapshot(room.battle); c.conn.send({ t: 'snap', s: i === 0 ? s : mirrorSnap(s), ev: [] });
      room.players[i === 0 ? 1 : 0]?.conn.send({ t: 'away', on: false });
      return;
    }
  }
  private startMsg(room: Room, i: 0 | 1): S2C {
    const b = room.battle!, me = room.players[i]!, foe = room.players[i === 0 ? 1 : 0]!, look = (p: Client) => (p.profile ?? newProfile('x')).eq;
    return { t: 'start', foe: foe.nick, foeRating: foe.profile?.rating ?? 1000, mods: [b.mods[i], b.mods[i === 0 ? 1 : 0]], look: [look(me), look(foe)], ranked: room.ranked, quick: room.hidden };
  }

  handle(conn: Conn, raw: unknown) {
    const c = this.clients.get(conn); if (!c || !raw || typeof raw !== 'object') return;
    const m = raw as C2S;
    switch (m.t) {
      case 'hello': return this.hello(c, m.nick, m.token);
      case 'nick': { const w = clean(m.nick, 14), ck = checkNick(w); if (!ck.ok) return this.err(c, 'bad_nick', ck.text); c.nick = w; if (c.profile) { c.profile.nick = c.nick; this.persist(c.profile); } if (c.room) this.pushRoom(c.room); return; }
      case 'list': conn.send({ t: 'rooms', rooms: this.list() }); return;
      case 'create': return this.create(c, m.name, m.pass, m.ranked !== false);
      case 'join': return this.join(c, m.id, m.pass);
      case 'leave': this.leave(c); return;
      case 'ready': return this.ready(c, !!m.on);
      case 'quick': return m.on ? this.enqueue(c) : this.dequeue(c);
      case 'buy': return this.buy(c, m.kind, String(m.id));
      case 'equip': return this.doEquip(c, String(m.id));
      case 'claim': return this.claim(c);
      case 'trained': return this.trained(c);
      case 'top': return this.sendTop(c);
      case 'result': return this.botResult(c, m.level, !!m.won, m.foe, m.dur, m.quit === true, m.st);
      case 'bonus': return this.bonus(c);
      case 'emote': {
        const room = c.room, id = Number(m.id);
        if (!room || room.phase !== 'playing' || !Number.isInteger(id) || id < 0 || id > 3 || this.now() - c.lastEmote < 1500) return;
        c.lastEmote = this.now(); room.players[c.seat === 0 ? 1 : 0]?.conn.send({ t: 'emote', id }); return;
      }
      case 'say': {
        const room = c.room, id = Number(m.id), other = room && room.players[c.seat === 0 ? 1 : 0];
        if (!room || !other || room.phase === 'playing' || !Number.isInteger(id) || id < 0 || id >= PHRASES.length || this.now() - c.lastSay < 1000) return;
        c.lastSay = this.now(); other.conn.send({ t: 'say', id }); return;
      }
      case 'ping': conn.send({ t: 'pong', n: Number(m.n) || 0 }); return;
      default: return this.intent(c, m);
    }
  }

  // ---- profiles ----
  private hello(c: Client, nick: unknown, token: unknown) {
    const wish = clean(nick, 14); c.nick = wish && checkNick(wish).ok ? wish : 'Игрок';
    const tk = typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
    if (!tk) { c.pid = null; c.profile = newProfile(`guest-${c.id}`, c.nick); this.sendProfile(c); if (c.room) this.pushRoom(c.room); return; }
    const pid = createHash('sha256').update(tk).digest('hex').slice(0, 32); c.pid = pid;
    const done = (p: Profile | null) => {
      if (this.clients.get(c.conn) !== c) return;
      const known = this.profiles.get(pid); const prof = known ?? p ?? newProfile(pid, c.nick);
      this.profiles.set(pid, prof); c.profile = prof; if (!known) this.persist(prof); // also rewrites a profile that was migrated on load (e.g. a refund)
      if (prof.nick !== c.nick) { prof.nick = c.nick; this.persist(prof); }
      this.resume(c); this.sendProfile(c); if (c.room) this.pushRoom(c.room);
    };
    const cached = this.profiles.get(pid) ?? this.store.peek?.(pid);
    if (cached !== undefined) done(cached); else this.store.load(pid).then(done, e => { console.error('profile load failed', e); done(null); });
  }
  private persist(p: Profile) { if (p.id.startsWith('guest-')) return; this.topCache = null; this.store.save(p).catch(e => console.error('profile save failed', e)); }
  private view(p: Profile): MyProfile { const { id: _id, ...rest } = p; const day = dayIndex(this.now()); return { ...rest, streak: dailyStreak(p, day), quest: p.quest.day === day ? p.quest : freshQuest(day, p.id), dailyReady: p.daily < day }; }
  private sendProfile(c: Client) { if (c.profile) c.conn.send({ t: 'profile', p: this.view(c.profile) }); }
  private shop(c: Client, ok: boolean, text: string) { c.conn.send({ t: 'shop', ok, text }); }

  private buy(c: Client, kind: 'up' | 'item', id: string) {
    const p = c.profile; if (!p) return;
    const r = kind === 'up' ? (UPGRADES.some(u => u.id === id) ? buyUpgrade(p, id as any) : { ok: false as const, error: 'Нет такого улучшения' }) : buyCosmetic(p, id);
    if (r.ok) this.persist(p); this.sendProfile(c); this.shop(c, r.ok, r.ok ? 'Куплено!' : r.error);
  }
  private doEquip(c: Client, id: string) { const p = c.profile; if (!p) return; const r = equip(p, id); if (r.ok) this.persist(p); this.sendProfile(c); if (!r.ok) this.shop(c, false, r.error); }
  private claim(c: Client) { const p = c.profile; if (!p) return; const g = claimDaily(p, dayIndex(this.now())); if (g) this.persist(p); this.sendProfile(c); this.shop(c, g > 0, g ? `Подарок дня: +${g} монет` : 'Подарок уже получен сегодня'); }
  private trained(c: Client) { const p = c.profile; if (!p) return; const g = claimTrained(p); if (g) this.persist(p); this.sendProfile(c); this.shop(c, g > 0, g ? `Обучение пройдено: +${g} монет` : 'Награда за обучение уже получена'); }
  private botResult(c: Client, level: unknown, won: boolean, foe?: unknown, dur?: unknown, quit = false, st?: unknown) {
    const p = c.profile; if (!p || !['easy', 'normal', 'hard'].includes(level as string)) return;
    const lv = level as Difficulty, key = c.pid ?? c.id, day = dayIndex(this.now());
    if (quit) { // left the fight (button or closed tab): a loss without coins or quest progress, never skipped by the anti-spam gap
      const dr = botRatingDelta(p, lv, false); p.rating += dr; p.games++; p.losses++;
      pushRecent(p, { nick: typeof foe === 'string' && checkNick(clean(foe, 14)).ok ? clean(foe, 14) : BOT_NAMES[lv], won: false, delta: dr, online: false });
      this.onBot?.({ nick: p.nick, level: lv, won: false, dur: null, coins: 0 }); this.persist(p); this.sendProfile(c); c.lastGain = 0;
      return this.shop(c, true, `Бой покинут: поражение · ${dr} рейтинг`);
    }
    // the gap is kept per player, not per socket: a reconnect or a second tab does not reset it
    if (this.now() - Math.max(c.lastResult, this.lastBot.get(key) ?? 0) < BOT_RESULT_GAP_MS) return this.shop(c, false, 'Награда за слишком быстрый бой не засчитана');
    c.lastResult = this.now(); this.lastBot.set(key, this.now());
    const dr = botRatingDelta(p, lv, won); p.rating += dr;
    pushRecent(p, { nick: typeof foe === 'string' && checkNick(clean(foe, 14)).ok ? clean(foe, 14) : BOT_NAMES[lv], won, delta: dr, online: false });
    const r = rewardBot(p, lv, won, day), qc = recordQuest(p, day, cleanStats(st, won, lv === 'hard'));
    this.onBot?.({ nick: p.nick, level: lv, won, dur: typeof dur === 'number' && Number.isFinite(dur) ? Math.round(dur) : null, coins: r });
    this.persist(p); this.sendProfile(c); c.lastGain = c.pid ? r + qc : 0;
    const capped = r === 0 && BOT_REWARD[lv][won ? 'win' : 'loss'] > 0;
    this.shop(c, true, (capped ? 'Лимит монет за ботов на сегодня исчерпан' : `+${r} монет`) + ` · ${dr > 0 ? '+' : ''}${dr} рейтинг` + (qc ? ` · задание +${qc}` : ''));
  }
  /** Rewarded-ad bonus: repeats the last reward once. The server cannot see the ad, so it only trusts one claim per match. */
  private bonus(c: Client) {
    const p = c.profile; if (!p || c.lastGain <= 0) return;
    const n = Math.min(c.lastGain, 150); c.lastGain = 0; p.coins += n; this.persist(p); this.sendProfile(c); this.shop(c, true, `Награда удвоена: +${n} монет`);
  }
  private async sendTop(c: Client) {
    try {
      if (!this.topCache || this.now() - this.topCache.at > TOP_TTL_MS) this.topCache = { at: this.now(), list: await this.store.top(100) };
      const list = this.topCache.list, i = c.profile ? list.findIndex(e => e.nick === c.profile!.nick && e.rating === c.profile!.rating) : -1;
      c.conn.send({ t: 'top', list, rank: i >= 0 ? i + 1 : null });
    } catch (e) { console.error('top failed', e); c.conn.send({ t: 'top', list: [], rank: null }); }
  }

  // ---- lobby ----
  private list(): RoomInfo[] {
    return [...this.rooms.values()].filter(r => !r.hidden).map(r => ({ id: r.id, name: r.name, host: r.players[0]?.nick ?? r.players[1]?.nick ?? '', players: r.players.filter(Boolean).length, locked: !!r.pass, playing: r.phase === 'playing', ranked: r.ranked }))
      .sort((a, b) => Number(a.players >= 2) - Number(b.players >= 2) || a.name.localeCompare(b.name));
  }
  private broadcastList() { const rooms = this.list(); for (const c of this.clients.values()) if (!c.room) c.conn.send({ t: 'rooms', rooms }); }
  private err(c: Client, code: ErrCode, text: string) { c.conn.send({ t: 'err', code, text }); }
  private makeRoom(name: string, pass: string, ranked: boolean, hidden: boolean): Room {
    const room: Room = { id: Math.random().toString(36).slice(2, 7), name, pass, ranked, hidden, players: [null, null], ready: [false, false], until: 0, phase: 'lobby', count: 0, countLeft: 0, battle: null, acc: 0, sinceSnap: 0, pending: [], stats: [noStats(false), noStats(false)] };
    this.rooms.set(room.id, room); return room;
  }

  private create(c: Client, name: unknown, pass: unknown, ranked: boolean) {
    if (c.room) return this.err(c, 'busy', 'Сначала выйди с текущего сервера');
    if (this.rooms.size >= MAX_ROOMS) return this.err(c, 'busy', 'Сервер переполнен, попробуй позже');
    this.dequeue(c);
    const rn = clean(name, 24), rck = rn ? checkText(rn) : { ok: true as const };
    if (!rck.ok) return this.err(c, 'bad_nick', 'Название сервера: ' + rck.text.toLowerCase());
    const room = this.makeRoom(rn || `Комната ${c.nick}`, clean(pass, 16), ranked, false);
    room.players[0] = c; c.room = room; c.seat = 0;
    this.pushRoom(room); this.broadcastList();
  }

  private join(c: Client, id: unknown, pass: unknown) {
    if (c.room) return this.err(c, 'busy', 'Сначала выйди с текущего сервера');
    const room = this.rooms.get(String(id));
    if (!room || room.hidden) { this.err(c, 'gone', 'Комната закрыта'); return void c.conn.send({ t: 'rooms', rooms: this.list() }); }
    if (room.players[1] || room.phase === 'playing') return this.err(c, 'full', 'На сервере уже двое');
    if (room.pass && room.pass !== clean(pass, 16)) return this.err(c, 'wrong_pass', 'Неверный пароль');
    this.dequeue(c);
    room.players[1] = c; room.ready = [false, false]; c.room = room; c.seat = 1;
    this.pushRoom(room); this.broadcastList();
  }

  private leave(c: Client) {
    const room = c.room; if (!room) return;
    const wasPlaying = room.phase === 'playing', seat = c.seat, rival = room.players[seat === 0 ? 1 : 0];
    const names: [string, string] = [room.players[0]?.nick ?? '', room.players[1]?.nick ?? ''];
    let gains: ReturnType<Lobby['settle']> | null = null;
    if (wasPlaying && rival) gains = this.settle(room, seat === 0 ? 1 : 0);
    c.room = null; room.players[seat] = null; room.ready = [false, false];
    if (wasPlaying) {
      this.onResult?.({ names, winner: seat === 0 ? 1 : 0, reason: 'left', ranked: gains?.ranked ?? false, dur: Math.round(room.battle?.time ?? 0) });
      rival?.conn.send({ t: 'end', winner: 0, reason: 'left', gain: gains ? gains.g[seat === 0 ? 1 : 0] : null });
      if (rival) this.sendProfile(rival);
      this.sendProfile(c); // the one who left lost the fight: show the new rating at once
    }
    room.phase = 'lobby'; room.battle = null; room.pending = [];
    if (room.hidden) { if (rival) { rival.room = null; rival.conn.send({ t: 'room', room: null }); } this.rooms.delete(room.id); }
    else {
      // the remaining player moves to the first (blue) seat
      if (room.players[1] && !room.players[0]) { room.players[0] = room.players[1]; room.players[1] = null; room.players[0].seat = 0; }
      if (!room.players[0] && !room.players[1]) this.rooms.delete(room.id); else this.pushRoom(room);
    }
    c.conn.send({ t: 'room', room: null }); c.conn.send({ t: 'rooms', rooms: this.list() });
    this.broadcastList();
  }

  private ready(c: Client, on: boolean) {
    const room = c.room; if (!room || room.phase !== 'lobby') return;
    room.ready[c.seat] = on;
    if (room.players[0] && room.players[1] && room.ready[0] && room.ready[1]) { room.phase = 'count'; room.count = COUNT_FROM; room.countLeft = 1; }
    this.pushRoom(room);
  }

  private seatOf(room: Room, i: 0 | 1): Seat { const p = room.players[i]; return p ? { nick: p.nick, ready: room.ready[i], rating: p.profile?.rating ?? 1000 } : null; }
  private viewOf(room: Room, seat: 0 | 1): RoomView { return { id: room.id, name: room.name, locked: !!room.pass, ranked: room.ranked, seats: [this.seatOf(room, 0), this.seatOf(room, 1)], me: seat, count: room.phase === 'count' ? room.count : null }; }
  private pushRoom(room: Room) { for (const p of room.players) if (p) p.conn.send({ t: 'room', room: this.viewOf(room, p.seat) }); }

  // ---- quick match ----
  private enqueue(c: Client) {
    if (c.room || c.queuedAt !== null) return;
    c.queuedAt = this.now(); this.queue.push(c); c.conn.send({ t: 'queue', on: true });
  }
  private dequeue(c: Client) { if (c.queuedAt === null) return; c.queuedAt = null; this.queue = this.queue.filter(x => x !== c); c.conn.send({ t: 'queue', on: false }); }
  private matchmake() {
    const q = this.queue, now = this.now();
    for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
      const a = q[i], b = q[j]; if (a.pid && a.pid === b.pid) continue;
      const waited = Math.min(now - a.queuedAt!, now - b.queuedAt!) / 1000, gap = Math.abs((a.profile?.rating ?? 1000) - (b.profile?.rating ?? 1000));
      if (gap > 150 + 40 * waited && waited < 30) continue;
      this.dequeue(a); this.dequeue(b);
      const room = this.makeRoom('Быстрый бой', '', true, true);
      room.players = [a, b]; a.room = room; b.room = room; a.seat = 0; b.seat = 1; room.ready = [true, true]; room.phase = 'count'; room.count = COUNT_FROM; room.countLeft = 1;
      this.pushRoom(room); return;
    }
  }

  // ---- match ----
  private startMatch(room: Room) {
    const [p0, p1] = room.players as [Client, Client], m0 = modsFor(p0.profile ?? newProfile('x')), m1 = modsFor(p1.profile ?? newProfile('x'));
    room.phase = 'playing'; room.battle = new Battle([m0, m1]); room.acc = 0; room.sinceSnap = SNAP_EVERY; room.pending = []; room.stats = [noStats(false), noStats(false)];
    p0.conn.send(this.startMsg(room, 0)); p1.conn.send(this.startMsg(room, 1));
    this.broadcastList();
  }

  /** Pay out a finished match. Rating only for ranked rooms between saved accounts that are not farming each other. */
  private settle(room: Room, winner: 0 | 1 | null) {
    const [a, b] = room.players, pa = a?.profile, pb = b?.profile;
    if (!a || !b || !pa || !pb) return { ranked: false, g: [null, null] as [null, null] };
    let ranked = room.ranked && !!a.pid && !!b.pid && a.pid !== b.pid, note = '';
    if (!room.ranked) note = 'Дружеский бой: рейтинг не меняется'; else if (a.pid && a.pid === b.pid) note = 'Оба игрока с одного аккаунта: рейтинг не меняется'; else if (!a.pid || !b.pid) note = 'Игра без сохранения: рейтинг не меняется';
    if (ranked) {
      const key = [a.pid, b.pid].sort().join(':'), log = (this.pairLog.get(key) ?? []).filter(t => this.now() - t < 3600e3);
      if (log.length >= FARM_LIMIT) { ranked = false; note = 'Много боёв с этим соперником за час: рейтинг не меняется'; } else { log.push(this.now()); this.pairLog.set(key, log); }
    }
    let g: [{ rating: number; coins: number; ranked: boolean }, { rating: number; coins: number; ranked: boolean }];
    if (ranked) { const [ga, gb] = applyOnline(pa, pb, winner); g = [{ ...ga, ranked }, { ...gb, ranked }]; }
    else {
      const give = (p: Profile, won: boolean | null) => { const coins = won === null ? FRIENDLY.draw : won ? FRIENDLY.win : FRIENDLY.loss; p.coins += coins; return { rating: 0, coins, ranked: false, note }; };
      g = [give(pa, winner === null ? null : winner === 0), give(pb, winner === null ? null : winner === 1)];
    }
    pushRecent(pa, { nick: b.nick, won: winner === null ? null : winner === 0, delta: g[0].rating, online: true }); pushRecent(pb, { nick: a.nick, won: winner === null ? null : winner === 1, delta: g[1].rating, online: true });
    const day = dayIndex(this.now());
    g[0].coins += recordQuest(pa, day, { ...room.stats[0], won: winner === 0, ranked }); g[1].coins += recordQuest(pb, day, { ...room.stats[1], won: winner === 1, ranked });
    if (a.pid) a.lastGain = g[0].coins; if (b.pid) b.lastGain = g[1].coins;
    this.persist(pa); this.persist(pb);
    return { ranked, g };
  }

  private intent(c: Client, m: C2S) {
    const room = c.room, b = room?.battle; if (!room || !b || room.phase !== 'playing' || b.phase !== 'playing') return;
    const s = c.seat, num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    switch (m.t) {
      // the guest's view is rotated by 180 degrees, so its stick direction is mirrored in server (world) coordinates
      case 'move': if (num(m.x) && num(m.z)) { const g = s === 1 ? -1 : 1; b.setMove(s, g * Math.max(-1, Math.min(1, m.x)), g * Math.max(-1, Math.min(1, m.z))); } return;
      case 'begin': b.beginCharge(s); return;
      case 'target': if (cellsValid(m.x, m.z)) b.setTarget(s, { x: m.x, z: m.z }); return;
      case 'release': if (cellsValid(m.x, m.z)) b.setTarget(s, { x: m.x, z: m.z }); b.releaseCharge(s, m.k === 'spin' || m.k === 'heavy' ? m.k : undefined); return;
      case 'cancel': b.cancelCharge(s); return;
      case 'sprint': b.setSprint(s, m.on === true); return;
      case 'jump': b.jump(s); return;
      case 'repair': if (m.on) { if (!b.charges[s]) b.beginRepair(s); } else b.cancelRepair(s); return;
    }
  }

  /** Advance everything by `dt` seconds of real time. */
  tick(dt: number) {
    if (this.queue.length > 1) this.matchmake();
    for (const room of [...this.rooms.values()]) {
      if (room.hidden && room.until && room.phase === 'lobby' && this.now() > room.until) {
        for (const p of room.players) if (p) { p.room = null; p.conn.send({ t: 'room', room: null }); }
        this.rooms.delete(room.id); continue;
      }
      if (room.phase === 'count') {
        room.countLeft -= dt;
        while (room.phase === 'count' && room.countLeft <= 0) { room.count--; room.countLeft += 1; if (room.count <= 0) this.startMatch(room); else this.pushRoom(room); }
        if (room.phase === 'count') continue;
      }
      if (room.phase !== 'playing' || !room.battle) continue;
      const gone = room.players.find(p => p && p.away !== null && this.now() - p.away > GRACE_MS);
      if (gone) { gone.away = null; this.leave(gone); continue; }
      const b = room.battle; room.acc += Math.min(dt, .25);
      while (room.acc >= STEP && b.phase === 'playing') {
        room.acc -= STEP; b.step(STEP); countEvents(room.stats[0], b.events, 0); countEvents(room.stats[1], b.events, 1); room.pending.push(...b.events); b.events.length = 0;
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
    const b = room.battle!, [p0, p1] = room.players as [Client, Client]; this.sendSnap(room);
    const res = this.settle(room, b.winner);
    this.onResult?.({ names: [p0.nick, p1.nick], winner: b.winner, reason: 'over', ranked: res.ranked, dur: Math.round(b.time) });
    p0.conn.send({ t: 'end', winner: b.winner, reason: 'over', gain: res.g[0] });
    p1.conn.send({ t: 'end', winner: b.winner === null ? null : b.winner === 0 ? 1 : 0, reason: 'over', gain: res.g[1] });
    this.sendProfile(p0); this.sendProfile(p1);
    room.phase = 'lobby'; room.battle = null; room.ready = [false, false]; room.pending = [];
    // both kinds of room stay open for a rematch; a quick-match room closes by itself after REMATCH_S seconds
    room.until = room.hidden ? this.now() + REMATCH_S * 1000 : 0;
    for (const p of [p0, p1]) if (p.away !== null) { p.away = null; this.leave(p); }
    if (this.rooms.has(room.id)) this.pushRoom(room);
    this.broadcastList();
  }
}
