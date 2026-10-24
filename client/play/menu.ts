// Menu screens: main, bot, online lobby, room, rating, settings, how to play.
// Pure DOM. The online part renders whatever it is given (setRooms / renderRoom); a network layer plugs in later.
import type { Difficulty } from '../../shared/bot';
import type { Sfx } from './audio';

export type RoomInfo = { id: string; name: string; host: string; players: number; locked: boolean };
export type Seat = { nick: string; ready: boolean } | null;
export type RoomView = { name: string; locked: boolean; seats: [Seat, Seat]; me: 0 | 1; count: number | null };
export type Screen = 'main' | 'bot' | 'online' | 'create' | 'room' | 'rating' | 'settings' | 'howto' | 'shop';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem('titans.' + k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem('titans.' + k, v); } catch { /* optional */ } },
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export type MenuHooks = {
  sfx: Sfx;
  touch: boolean;
  onStartBot: (level: Difficulty) => void;
  /** Online hooks. Without a server these stay unset and the lobby runs as a local preview. */
  onCreate?: (name: string, password: string) => void;
  onJoin?: (id: string, password: string) => void;
  onReady?: () => void;
  onLeave?: () => void;
  onRefresh?: () => void;
};

export function initMenu(h: MenuHooks) {
  const root = $('menu'), { sfx } = h;
  let level: Difficulty = 'normal', current: Screen = 'main', preview: RoomView | null = null, countTimer = 0;
  document.body.classList.toggle('touch', h.touch);

  const nick = () => (store.get('nick', '').trim() || 'Игрок');
  const sens = () => Math.max(.6, Math.min(1.8, parseFloat(store.get('sens', '1')) || 1));
  const paintNick = () => { $('nick-label').textContent = nick(); $('rate-me').textContent = nick(); $<HTMLElement>('menu').querySelector('.avatar')!.textContent = nick().slice(0, 1).toUpperCase(); };

  function open(s: Screen) {
    current = s;
    root.querySelectorAll<HTMLElement>('.scr').forEach(x => { x.hidden = x.dataset.scr !== s; });
    $('pwd').hidden = true;
    if (s === 'online') { setRooms(rooms); h.onRefresh?.(); }
    if (s === 'create') { $<HTMLInputElement>('room-name').value = `Комната ${nick()}`; $<HTMLInputElement>('room-pass').value = ''; }
    if (s === 'settings') { $<HTMLInputElement>('nick').value = store.get('nick', ''); paintSound(); }
  }
  const show = (s: Screen = 'main') => { root.hidden = false; open(s); };
  const hide = () => { root.hidden = true; };

  // navigation
  root.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!t) return;
    sfx.unlock(); sfx.click();
    if (t.dataset.go) open(t.dataset.go as Screen);
    if (t.dataset.level) { level = t.dataset.level as Difficulty; root.querySelectorAll('[data-level]').forEach(x => x.classList.toggle('sel', x === t)); }
  });
  $('start').addEventListener('click', () => h.onStartBot(level));

  // online lobby
  let rooms: RoomInfo[] = [];
  function setNet(state: 'off' | 'connecting' | 'on') {
    const p = $('net-pill'); p.classList.toggle('ok', state === 'on');
    p.lastElementChild!.textContent = state === 'on' ? 'сервер на связи' : state === 'connecting' ? 'подключаемся…' : 'сервер не подключён';
  }
  function setRooms(list: RoomInfo[]) {
    rooms = list; const el = $('rooms');
    if (!list.length) { el.innerHTML = `<div class="empty">${h.onJoin ? 'Пока нет комнат. Создай первую и позови друга.' : 'Онлайн-сервер ещё подключается к игре. Комнату можно создать уже сейчас, это предпросмотр.'}</div>`; return; }
    el.innerHTML = list.map(r => `<div class="room${r.players >= 2 ? ' full' : ''}"><b>${r.locked ? '🔒 ' : ''}${esc(r.name)}</b><span>${esc(r.host)}</span><span>${r.players}/2</span><button data-join="${esc(r.id)}" ${r.players >= 2 ? 'disabled' : ''}>${r.players >= 2 ? 'Идёт бой' : 'Войти'}</button></div>`).join('');
  }
  let joining: RoomInfo | null = null;
  $('rooms').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-join]') as HTMLElement | null; if (!b) return;
    const r = rooms.find(x => x.id === b.dataset.join); if (!r) return;
    if (!r.locked) { h.onJoin?.(r.id, ''); return; }
    joining = r; $('pwd-title').textContent = `Пароль: ${r.name}`; $('pwd-err').textContent = ''; $<HTMLInputElement>('pwd-in').value = ''; $('pwd').hidden = false; $<HTMLInputElement>('pwd-in').focus();
  });
  $('pwd-cancel').onclick = () => { $('pwd').hidden = true; sfx.click(); };
  $<HTMLFormElement>('pwd').querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); if (joining) h.onJoin?.(joining.id, $<HTMLInputElement>('pwd-in').value); });
  const pwdError = (t: string) => { $('pwd-err').textContent = t; };
  $('refresh').onclick = () => h.onRefresh?.();
  $<HTMLFormElement>('create-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $<HTMLInputElement>('room-name').value.trim() || `Комната ${nick()}`, pass = $<HTMLInputElement>('room-pass').value.trim();
    sfx.click();
    if (h.onCreate) h.onCreate(name, pass);
    else { preview = { name, locked: !!pass, seats: [{ nick: nick(), ready: false }, null], me: 0, count: null }; renderRoom(preview); open('room'); }
  });

  // waiting room
  function renderRoom(v: RoomView) {
    $('room-title').textContent = v.name;
    const lock = $('room-lock'); lock.textContent = v.locked ? '🔒 с паролем' : 'открытая'; lock.classList.add('pill');
    v.seats.forEach((s, i) => {
      const el = $(`seat${i}`); el.classList.toggle('empty-seat', !s); el.classList.toggle('ready', !!s?.ready);
      el.querySelector('.nm')!.textContent = s ? s.nick + (i === v.me ? ' (ты)' : '') : '—';
      el.querySelector('.st')!.textContent = s ? (s.ready ? 'ГОТОВ' : 'не готов') : 'ждём соперника…';
    });
    const rb = $<HTMLButtonElement>('ready'), mine = v.seats[v.me], both = !!v.seats[0] && !!v.seats[1];
    rb.disabled = !both || v.count !== null; rb.classList.toggle('on', !!mine?.ready); rb.textContent = mine?.ready ? 'ЖДЁМ…' : 'ГОТОВ';
    $('count').textContent = v.count === null ? '' : String(v.count);
    $('demo-join').hidden = !!h.onJoin || both;
  }
  $('ready').onclick = () => {
    if (h.onReady) { h.onReady(); return; }
    if (!preview) return; preview.seats[0]!.ready = true; renderRoom(preview);
    window.setTimeout(() => { if (preview?.seats[1]) { preview.seats[1].ready = true; renderRoom(preview); startCount(); } }, 700);
  };
  $('demo-join').onclick = () => { if (!preview) return; preview.seats[1] = { nick: 'ГРОМ', ready: false }; renderRoom(preview); sfx.respawn(); };
  function startCount() {
    if (!preview) return; let n = 3; preview.count = n; renderRoom(preview); sfx.click();
    countTimer = window.setInterval(() => {
      if (!preview) { clearInterval(countTimer); return; }
      n--; if (n <= 0) { clearInterval(countTimer); const p = preview; preview = null; p.count = null; h.onStartBot('normal'); return; }
      preview.count = n; renderRoom(preview); sfx.click();
    }, 900);
  }
  $('leave').onclick = () => { clearInterval(countTimer); preview = null; h.onLeave?.(); open('online'); };

  // settings
  function paintSound() { const b = $('set-sound'); b.textContent = sfx.muted ? 'Выкл' : 'Вкл'; b.classList.toggle('on', !sfx.muted); }
  $('set-sound').onclick = () => { sfx.setMuted(!sfx.muted); paintSound(); document.getElementById('mute-btn')!.textContent = sfx.muted ? '🔇' : '🔊'; if (!sfx.muted) sfx.click(); };
  $<HTMLInputElement>('nick').addEventListener('input', e => { store.set('nick', (e.target as HTMLInputElement).value); paintNick(); });
  const sl = $<HTMLInputElement>('sens'); sl.value = String(sens()); $('sens-val').textContent = `×${sens().toFixed(1)}`;
  sl.addEventListener('input', () => { store.set('sens', sl.value); $('sens-val').textContent = `×${sens().toFixed(1)}`; });
  paintNick(); paintSound(); setRooms([]);

  return { show, hide, open, nick, sens, setRooms, setNet, renderRoom, pwdError, get screen() { return current; } };
}
export type Menu = ReturnType<typeof initMenu>;
