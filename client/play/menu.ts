// Menu screens: main, bot, online lobby, room, rating, settings, how to play.
// Pure DOM. The online part renders whatever it is given (setRooms / renderRoom); a network layer plugs in later.
import type { Difficulty } from '../../shared/bot';
import type { Sfx } from './audio';
import type { NetState } from './online';

import type { RoomInfo, RoomView, MyProfile } from '../../shared/net';
import { UPGRADES, COSMETICS, QUESTS, league, type PublicEntry, type CosmeticKind } from '../../shared/progress';
export type { RoomInfo, RoomView };
export type Screen = 'main' | 'bot' | 'online' | 'create' | 'room' | 'rating' | 'settings' | 'howto' | 'shop' | 'quick' | 'quests';

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
  onScreen: (s: Screen) => void;
  onCreate: (name: string, password: string, ranked: boolean) => void;
  onQuick: (on: boolean) => void;
  onBuy: (kind: 'up' | 'item', id: string) => void;
  onEquip: (id: string) => void;
  onClaim: () => void;
  onTop: () => void;
  onJoin: (id: string, password: string) => void;
  onReady: (on: boolean) => void;
  onLeave: () => void;
  onRefresh: () => void;
};

export function initMenu(h: MenuHooks) {
  const root = $('menu'), { sfx } = h;
  let level: Difficulty = 'normal', current: Screen = 'main', view: RoomView | null = null, netState: NetState = 'off', slow = false;
  let prof: MyProfile | null = null, top: PublicEntry[] = [], topRank: number | null = null, tab: 'up' | CosmeticKind = 'up';
  document.body.classList.toggle('touch', h.touch);

  const nick = () => (store.get('nick', '').trim() || 'Игрок');
  const sens = () => Math.max(.6, Math.min(1.8, parseFloat(store.get('sens', '1')) || 1));
  const paintNick = () => { $('nick-label').textContent = nick(); $('rate-me').textContent = nick(); document.querySelectorAll('#menu .avatar').forEach(a => { a.textContent = nick().slice(0, 1).toUpperCase(); }); };

  function open(s: Screen) {
    current = s;
    root.querySelectorAll<HTMLElement>('.scr').forEach(x => { x.hidden = x.dataset.scr !== s; });
    $('pwd').hidden = true;
    h.onScreen(s);
    if (s === 'online') setRooms(rooms);
    if (s === 'rating') { renderTop(); h.onTop(); }
    if (s === 'shop') renderShop();
    if (s === 'quests') renderQuests();
    if (s === 'create') { $<HTMLInputElement>('room-name').value = `Комната ${nick()}`; $<HTMLInputElement>('room-pass').value = ''; }
    if (s === 'settings') { $<HTMLInputElement>('nick').value = store.get('nick', ''); paintSound(); paintHaptic(); $('set-rating').textContent = String(prof?.rating ?? 1000); $('set-wins').textContent = String(prof?.wins ?? 0); $('set-games').textContent = String(prof?.games ?? 0); }
  }
  let noticeT = 0;
  function notice(t: string) { const el = $('menu-toast'); el.textContent = t; el.classList.add('on'); window.clearTimeout(noticeT); noticeT = window.setTimeout(() => el.classList.remove('on'), 2800); }
  const show = (s: Screen = 'main') => { root.hidden = false; open(s); };
  const hide = () => { root.hidden = true; };

  // navigation
  root.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!t) return;
    sfx.unlock(); sfx.click();
    if (t.dataset.go) open(t.dataset.go as Screen);
    if (t.id === 'quick-btn') { h.onQuick(true); open('quick'); }
    if (t.id === 'quick-cancel') { h.onQuick(false); open('main'); }
    if (t.id === 'daily') h.onClaim();
    if (t.dataset.tab) { tab = t.dataset.tab as typeof tab; renderShop(); }
    if (t.dataset.buy) h.onBuy(t.dataset.kind as 'up' | 'item', t.dataset.buy);
    if (t.dataset.eq) h.onEquip(t.dataset.eq);
    if (t.dataset.level) { level = t.dataset.level as Difficulty; root.querySelectorAll('[data-level]').forEach(x => x.classList.toggle('sel', x === t)); }
  });
  $('start').addEventListener('click', () => h.onStartBot(level));

  // online lobby
  let rooms: RoomInfo[] = [];
  function setNet(state: NetState, isSlow = false) {
    netState = state; slow = isSlow;
    const p = $('net-pill'); p.classList.toggle('ok', state === 'on');
    p.lastElementChild!.textContent = state === 'on' ? 'сервер на связи' : state === 'connecting' ? (isSlow ? 'сервер просыпается, до минуты…' : 'подключаемся…') : 'нет связи, нажми «Обновить»';
    setRooms(rooms);
  }
  function setRooms(list: RoomInfo[]) {
    rooms = list; const el = $('rooms');
    if (!list.length) { el.innerHTML = `<div class="empty">${netState === 'on' ? 'Пока нет комнат. Создай первую и позови друга.' : netState === 'connecting' ? (slow ? 'Бесплатный сервер просыпается после простоя, это занимает до минуты. Подожди немного.' : 'Подключаемся к серверу…') : 'Не удалось подключиться к серверу. Проверь интернет и нажми «Обновить».'}</div>`; return; }
    el.innerHTML = list.map(r => `<div class="room${r.players >= 2 ? ' full' : ''}"><b>${r.locked ? '🔒 ' : ''}${r.ranked ? '🏆 ' : ''}${esc(r.name)}</b><span>${esc(r.host)}</span><span>${r.players}/2</span><button data-join="${esc(r.id)}" ${r.players >= 2 ? 'disabled' : ''}>${r.playing ? 'Идёт бой' : r.players >= 2 ? 'Занято' : 'Войти'}</button></div>`).join('');
  }
  let joining: RoomInfo | null = null;
  $('rooms').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-join]') as HTMLElement | null; if (!b) return;
    const r = rooms.find(x => x.id === b.dataset.join); if (!r) return;
    if (!r.locked) { h.onJoin(r.id, ''); return; }
    joining = r; $('pwd-title').textContent = `Пароль: ${r.name}`; $('pwd-err').textContent = ''; $<HTMLInputElement>('pwd-in').value = ''; $('pwd').hidden = false; $<HTMLInputElement>('pwd-in').focus();
  });
  $('pwd-cancel').onclick = () => { $('pwd').hidden = true; sfx.click(); };
  $<HTMLFormElement>('pwd').querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); if (joining) h.onJoin(joining.id, $<HTMLInputElement>('pwd-in').value); });
  const pwdError = (t: string) => { $('pwd-err').textContent = t; };
  $('refresh').onclick = () => h.onRefresh();
  $<HTMLFormElement>('create-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $<HTMLInputElement>('room-name').value.trim() || `Комната ${nick()}`, pass = $<HTMLInputElement>('room-pass').value.trim();
    sfx.click();
    h.onCreate(name, pass, $<HTMLInputElement>('room-ranked').checked);
  });

  // waiting room
  function renderRoom(v: RoomView) {
    view = v; $('room-title').textContent = v.name;
    const lock = $('room-lock'); lock.textContent = (v.locked ? '🔒 с паролем' : 'открытая') + (v.ranked ? ' · 🏆 на рейтинг' : ' · дружеская'); lock.classList.add('pill');
    v.seats.forEach((s, i) => {
      const el = $(`seat${i}`); el.classList.toggle('empty-seat', !s); el.classList.toggle('ready', !!s?.ready);
      el.querySelector('.nm')!.textContent = s ? s.nick + (i === v.me ? ' (ты)' : '') : '—';
      el.querySelector('.rt')!.textContent = s ? `${league(s.rating).name} · ${s.rating}` : '';
      el.querySelector('.st')!.textContent = s ? (s.ready ? 'ГОТОВ' : 'не готов') : 'ждём соперника…';
    });
    const rb = $<HTMLButtonElement>('ready'), mine = v.seats[v.me], both = !!v.seats[0] && !!v.seats[1];
    rb.disabled = !both || v.count !== null; rb.classList.toggle('on', !!mine?.ready); rb.textContent = mine?.ready ? 'ОТМЕНА' : 'ГОТОВ';
    $('count').textContent = v.count === null ? '' : String(v.count);
  }
  $('ready').onclick = () => { if (view) h.onReady(!view.seats[view.me]?.ready); };
  $('leave').onclick = () => { view = null; h.onLeave(); open('online'); };

  // profile, shop, rating
  const paintProfile = () => {
    const p = prof; const r = p?.rating ?? 1000, lg = league(r);
    $('rating-label').textContent = String(r); $('league-label').textContent = lg.name; $('league-label').style.color = lg.color;
    $('coins-label').textContent = String(p?.coins ?? 0); $('shop-coins').textContent = String(p?.coins ?? 0);
    $('daily').hidden = !(p && p.dailyReady);
    $('quests-count').textContent = `${p ? p.quest.paid.filter(Boolean).length : 0}/${QUESTS.length}`;
    $('rate-pts').textContent = String(r); $('rate-wins').textContent = String(p?.wins ?? 0);
  };
  function renderQuests() {
    const q = prof?.quest;
    $('quests-list').innerHTML = QUESTS.map((d, i) => { const v = Math.min(d.goal, q?.[d.key] ?? 0), done = !!q?.paid[i]; return `<div class="item quest${done ? ' eq' : ''}"><span class="ic">${done ? '✅' : '🎯'}</span><div class="tx"><b>${esc(d.text)}</b><span class="bar"><i style="width:${100 * v / d.goal}%"></i></span><em>${v} / ${d.goal}</em></div><span class="${done ? 'maxed' : 'rw'}">${done ? 'ГОТОВО' : '+' + d.reward + ' 🪙'}</span></div>`; }).join('');
  }
  function setProfile(p: MyProfile) { prof = p; paintProfile(); if (current === 'quests') renderQuests(); if (current === 'shop') renderShop(); if (current === 'rating') renderTop(); }
  function renderShop() {
    root.querySelectorAll<HTMLElement>('#shop-tabs [data-tab]').forEach(b => b.classList.toggle('sel', b.dataset.tab === tab));
    const el = $('shop-list'), p = prof, coins = p?.coins ?? 0;
    if (!p) { el.innerHTML = '<div class="empty">Магазин работает с сервером. Подключаемся…</div>'; return; }
    if (tab === 'up') {
      el.innerHTML = UPGRADES.map(u => {
        const lv = p.up[u.id], max = u.costs.length, cost = lv < max ? u.costs[lv] : null;
        const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
        return `<div class="item"><span class="ic">${u.icon}</span><div class="tx"><b>${esc(u.name)}</b><em>${esc(u.desc)}</em><span class="pips">${pips}</span></div>${cost === null ? '<span class="maxed">МАКС</span>' : `<button class="buy" data-kind="up" data-buy="${u.id}" ${coins < cost ? 'disabled' : ''}>🪙 ${cost}</button>`}</div>`;
      }).join('');
      return;
    }
    el.innerHTML = COSMETICS.filter(c => c.kind === tab).map(c => {
      const own = p.own.includes(c.id), on = p.eq[c.kind] === c.id;
      const btn = on ? '<span class="maxed">ВЫБРАНО</span>' : own ? `<button class="buy ok" data-eq="${c.id}">Выбрать</button>` : `<button class="buy" data-kind="item" data-buy="${c.id}" ${coins < c.cost ? 'disabled' : ''}>🪙 ${c.cost}</button>`;
      return `<div class="item${on ? ' eq' : ''}"><span class="sw" style="background:${c.color ?? 'linear-gradient(135deg,#fff,#aab)'}"></span><div class="tx"><b>${esc(c.name)}</b></div>${btn}</div>`;
    }).join('');
  }
  function setTop(list: PublicEntry[], rank: number | null) { top = list; topRank = rank; if (current === 'rating') renderTop(); }
  function renderTop() {
    const el = $('top-list');
    el.innerHTML = top.length ? top.map((e, i) => `<div class="trow"><span>${i + 1}</span><span style="color:${league(e.rating).color}">${esc(e.nick)}</span><span>${e.wins}</span><span>${e.rating}</span></div>`).join('') : '<div class="empty">Рейтинг пока пуст. Сыграй рейтинговый бой.</div>';
    $('top-me').children[0].textContent = topRank ? String(topRank) : '—';
    $('rate-me').textContent = nick(); $('rate-pts').textContent = String(prof?.rating ?? 1000); $('rate-wins').textContent = String(prof?.wins ?? 0);
  }
  const setQueue = (on: boolean) => { if (!on && current === 'quick') open('main'); if (on && current !== 'quick') open('quick'); };

  // settings
  function paintSound() { const b = $('set-sound'); b.textContent = sfx.muted ? 'Выкл' : 'Вкл'; b.classList.toggle('on', !sfx.muted); }
  const paintHaptic = () => { const b = $('set-haptic'), on = store.get('haptic', '1') !== '0'; b.textContent = on ? 'Вкл' : 'Выкл'; b.classList.toggle('on', on); };
  $('set-haptic').onclick = () => { store.set('haptic', store.get('haptic', '1') !== '0' ? '0' : '1'); paintHaptic(); };
  $('set-sound').onclick = () => { sfx.setMuted(!sfx.muted); paintSound(); document.getElementById('mute-btn')!.textContent = sfx.muted ? '🔇' : '🔊'; if (!sfx.muted) sfx.click(); };
  $<HTMLInputElement>('nick').addEventListener('input', e => { store.set('nick', (e.target as HTMLInputElement).value); paintNick(); });
  const sl = $<HTMLInputElement>('sens'); sl.value = String(sens()); $('sens-val').textContent = `×${sens().toFixed(1)}`;
  sl.addEventListener('input', () => { store.set('sens', sl.value); $('sens-val').textContent = `×${sens().toFixed(1)}`; });
  paintNick(); paintSound(); paintHaptic(); setRooms([]); paintProfile();

  return { setProfile, setTop, setQueue, show, hide, notice, get hidden() { return root.hidden; }, open, nick, sens, setRooms, setNet, renderRoom, pwdError, get screen() { return current; }, get inRoom() { return view; }, clearRoom() { view = null; } };
}
export type Menu = ReturnType<typeof initMenu>;
