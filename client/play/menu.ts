// Menu screens: main, bot, online lobby, room, rating, settings, how to play.
// Pure DOM. The online part renders whatever it is given (setRooms / renderRoom); a network layer plugs in later.
import type { Difficulty } from '../../shared/bot';
import type { Sfx } from './audio';
import type { NetState } from './online';

import type { RoomInfo, RoomView, MyProfile } from '../../shared/net';
import { checkNick, checkText } from '../../shared/names';
import { QUICK_SEARCH_S, BOT_OFFER_S } from '../../shared/quick';
import { DAILY_REWARDS } from '../../shared/progress';
import { icon, ico, hydrateIcons, type IconName } from './icons';
import { UPGRADES, COSMETICS, questDef, LEAGUES, league, type PublicEntry, type CosmeticKind } from '../../shared/progress';
export type { RoomInfo, RoomView };
export type Screen = 'main' | 'bot' | 'online' | 'create' | 'room' | 'rating' | 'settings' | 'howto' | 'shop' | 'quick' | 'quests' | 'play';

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
  onTrain: () => void;
  onScreen: (s: Screen) => void;
  onCreate: (name: string, password: string, ranked: boolean) => void;
  onQuick: (on: boolean) => void;
  onQuickTimeout: () => void;
  onBuy: (kind: 'up' | 'item', id: string) => void;
  onEquip: (id: string) => void;
  onClaim: () => void;
  onTop: () => void;
  onJoin: (id: string, password: string) => void;
  onReady: (on: boolean) => void;
  onLeave: () => void;
  onInvite: (roomId: string) => void;
  onRefresh: () => void;
};

export function initMenu(h: MenuHooks) {
  const root = $('menu'), { sfx } = h;
  let level: Difficulty = 'normal', current: Screen = 'main', view: RoomView | null = null, netState: NetState = 'off', slow = false;
  let prof: MyProfile | null = null, top: PublicEntry[] = [], topRank: number | null = null, tab: 'up' | CosmeticKind = 'up';
  document.body.classList.toggle('touch', h.touch);

  const nick = () => { const n = store.get('nick', '').trim(); return n && checkNick(n).ok ? n : 'Игрок'; };
  const sens = () => Math.max(.6, Math.min(1.8, parseFloat(store.get('sens', '1')) || 1));
  const paintNick = () => { $('nick-label').textContent = nick(); $('rate-me').textContent = nick(); document.querySelectorAll('#menu .avatar').forEach(a => { a.textContent = nick().slice(0, 1).toUpperCase(); }); };

  /** Live opponents and rooms open after the first win over a bot (or any recorded win on the profile). */
  const unlocked = () => store.get('botwin', '0') === '1' || (prof?.wins ?? 0) > 0;
  const paintLocks = () => {
    const lk = !unlocked();
    $('online-btn').classList.toggle('locked', lk);
    document.querySelectorAll<HTMLElement>('#menu .lockmark').forEach(x => { x.hidden = !lk; });
  };
  const trainDone = () => store.get('train.done', '0') === '1' || !!prof?.trained;
  const paintTrain = () => { const d = trainDone(), b = $('train-btn'); b.classList.toggle('done', d); b.classList.toggle('todo', !d); $('train-state').innerHTML = d ? '✓ Обучение пройдено, можно повторить' : 'пройди задания и получи 100 <i class="coin"></i>'; };
  const LOCK_TEXT = 'Онлайн откроется после первой победы над ботом';
  function open(s: Screen) {
    current = s;
    if (s === 'play') { paintLocks(); paintTrain(); }
    root.querySelectorAll<HTMLElement>('.scr').forEach(x => { x.hidden = x.dataset.scr !== s; });
    $('pwd').hidden = true;
    h.onScreen(s);
    if (s === 'online') setRooms(rooms);
    if (s === 'rating') { renderTop(); h.onTop(); }
    if (s === 'shop') renderShop();
    if (s === 'quests') renderQuests();
    if (s === 'create') { $<HTMLInputElement>('room-name').value = `Сервер ${nick()}`; $<HTMLInputElement>('room-pass').value = ''; }
    if (s === 'settings') { $<HTMLInputElement>('nick').value = store.get('nick', ''); $('nick-err').textContent = ''; $('nick').classList.remove('bad'); paintSound(); paintHaptic(); $('set-rating').textContent = String(prof?.rating ?? 1000); $('set-wins').textContent = String(prof?.wins ?? 0); $('set-games').textContent = String(prof?.games ?? 0); }
  }
  let noticeT = 0;
  function notice(t: string) { const el = $('menu-toast'); el.textContent = t; el.classList.add('on'); window.clearTimeout(noticeT); noticeT = window.setTimeout(() => el.classList.remove('on'), 2800); }
  const show = (s: Screen = 'main') => { root.hidden = false; open(s); if (s === 'main') maybeAutoGift(); };
  const hide = () => { root.hidden = true; };

  // navigation
  root.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!t) return;
    sfx.unlock(); sfx.click();
    if (t.id === 'play-btn' && !trainDone() && store.get('train.skipped', '0') !== '1') { h.onTrain(); return; }
    if (t.dataset.go === 'online' && !unlocked()) { notice(LOCK_TEXT); return; }
    if (t.dataset.go) open(t.dataset.go as Screen);
    if (t.dataset.soon) notice(t.dataset.soon);
    if (t.id === 'quick-btn') { h.onQuick(true); quickSearch(); }
    if (t.id === 'train-btn') h.onTrain();
    if (t.id === 'quick-cancel') { qStop(); h.onQuick(false); open('online'); }
    if (t.id === 'quick-bot') { qStop(); h.onQuickTimeout(); }
    if (t.id === 'quick-friend') { qStop(); h.onQuick(false); open('create'); }
    if (t.id === 'gift-btn') openGift();
    if (t.id === 'gift-claim') { (t as HTMLButtonElement).disabled = true; h.onClaim(); }
    if (t.id === 'gift-close') $('gift').hidden = true;
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
    if (!list.length) { el.innerHTML = `<div class="empty">${netState === 'on' ? 'Пока нет серверов. Нажми «Быстрая игра» или создай свой.' : netState === 'connecting' ? (slow ? 'Бесплатный сервер просыпается после простоя, это занимает до минуты. Подожди немного.' : 'Подключаемся к серверу…') : 'Не удалось подключиться к серверу. Проверь интернет и нажми «Обновить».'}</div>`; return; }
    el.innerHTML = list.map(r => `<div class="room${r.players >= 2 ? ' full' : ''}"><b title="${esc(r.host)}">${r.locked ? ico('lock') + ' ' : ''}${r.ranked ? ico('trophy') + ' ' : ''}${esc(r.name)}</b><span class="host">${esc(r.host)}</span><span>${r.players}/2</span><button data-join="${esc(r.id)}" ${r.players >= 2 ? 'disabled' : ''}>${r.playing ? 'Идёт бой' : r.players >= 2 ? 'Занято' : 'Войти'}</button></div>`).join('');
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
    const name = $<HTMLInputElement>('room-name').value.trim() || `Сервер ${nick()}`, pass = $<HTMLInputElement>('room-pass').value.trim();
    const ck = checkText(name); $('room-err').textContent = ck.ok ? '' : ck.text; $('room-name').classList.toggle('bad', !ck.ok);
    if (!ck.ok) return;
    sfx.click();
    h.onCreate(name, pass, $<HTMLInputElement>('room-ranked').checked);
  });

  // waiting room
  function renderRoom(v: RoomView) {
    view = v; $('room-title').textContent = v.name;
    const lock = $('room-lock'); lock.innerHTML = (v.locked ? ico('lock') + ' с паролем' : 'открытая') + (v.ranked ? ' · ' + ico('trophy') + ' на рейтинг' : ' · дружеская'); lock.classList.add('pill');
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
  $('invite').onclick = () => { if (view) h.onInvite(view.id); };
  $('ready').onclick = () => { if (view) h.onReady(!view.seats[view.me]?.ready); };
  $('leave').onclick = () => { view = null; h.onLeave(); open('online'); };

  // profile, shop, rating
  // 7-day gift calendar: opens by itself once per visit when today's gift is waiting, and from the 🎁 button
  let giftAuto = false;
  function renderGift() {
    const st = prof?.streak ?? 0, ready = !!prof?.dailyReady, today = ready ? st + 1 : 0;
    $('gift-days').innerHTML = DAILY_REWARDS.map((g, i) => { const d = i + 1, cls = d <= st ? 'done' : d === today ? 'today' : d === st + 1 ? 'tom' : ''; return `<div class="day ${cls}${d === 7 ? ' big7' : ''}"><b>День ${d}</b><span class="gic">${d === 7 ? ico('gift') : '<i class="coin"></i>'}</span><em>+${g}</em>${d <= st ? '<u>✓</u>' : ''}</div>`; }).join('');
    $('gift-sub').textContent = ready ? 'Заходи каждый день: награда растёт, на 7-й день самая большая.' : 'Сегодняшний подарок уже у тебя. Следующий завтра: пропустишь день, и серия начнётся заново.';
    const cl = $<HTMLButtonElement>('gift-claim'); cl.hidden = !ready; cl.disabled = false; cl.textContent = `ЗАБРАТЬ +${DAILY_REWARDS[Math.min(st, 6)]}`;
    $('gift-close').textContent = ready ? 'Позже' : 'Закрыть';
  }
  function openGift() { renderGift(); $('gift').hidden = false; }
  function maybeAutoGift() { if (prof?.dailyReady && !giftAuto && !root.hidden && current === 'main') { giftAuto = true; openGift(); } }
  $('gift').addEventListener('click', e => { if (e.target === $('gift')) $('gift').hidden = true; });
  const paintProfile = () => {
    const p = prof; const r = p?.rating ?? 1000, lg = league(r);
    $('rating-label').textContent = String(r); $('league-label').textContent = lg.name; $('league-label').style.color = lg.color;
    $('coins-label').textContent = String(p?.coins ?? 0);
    paintLocks(); $('shop-coins').textContent = String(p?.coins ?? 0);
    $('gift-btn').classList.toggle('alert', !!p?.dailyReady); $('gift-btn').querySelector('.dot')!.toggleAttribute('hidden', !p?.dailyReady);
    if (!$('gift').hidden) renderGift(); else maybeAutoGift();
    $('quests-count').textContent = `${p ? p.quest.paid.filter(Boolean).length : 0}/${p?.quest.ids.length ?? 5}`;
    $('rate-pts').textContent = String(r); $('rate-wins').textContent = String(p?.wins ?? 0);
  };
  function renderQuests() {
    const q = prof?.quest;
    $('quests-list').innerHTML = (q?.ids ?? []).map((id, i) => { const d = questDef(id); if (!d) return ''; const v = Math.min(d.goal, q!.prog[i] ?? 0), done = !!q!.paid[i]; return `<div class="item quest${done ? ' eq' : ''}"><span class="ic">${ico(done ? 'check' : d.icon as IconName)}</span><div class="tx"><b>${esc(d.text)}</b><span class="bar"><i style="width:${100 * v / d.goal}%"></i></span><em>${v} / ${d.goal}</em></div><span class="${done ? 'maxed' : 'rw'}">${done ? 'ГОТОВО' : '+' + d.reward + ' <i class="coin"></i>'}</span></div>`; }).join('');
  }
  function setProfile(p: MyProfile) { prof = p; paintProfile(); if (current === 'quests') renderQuests(); if (current === 'shop') renderShop(); if (current === 'rating') renderTop(); }
  function renderShop() {
    root.querySelectorAll<HTMLElement>('#shop-tabs [data-tab]').forEach(b => b.classList.toggle('sel', b.dataset.tab === tab));
    const el = $('shop-list'), p = prof, coins = p?.coins ?? 0;
    if (!p) { el.innerHTML = '<div class="empty">Магазин работает с сервером. Подключаемся…</div>'; return; }
    el.classList.remove('gallery');
    if (tab === 'up') {
      el.innerHTML = UPGRADES.map(u => {
        const lv = p.up[u.id], max = u.costs.length, cost = lv < max ? u.costs[lv] : null;
        const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
        return `<div class="item"><span class="ic">${ico(u.icon as IconName)}</span><div class="tx"><b>${esc(u.name)}</b><em>${esc(u.desc)}</em><span class="pips">${pips}</span></div>${cost === null ? '<span class="maxed">МАКС</span>' : `<button class="buy" data-kind="up" data-buy="${u.id}" ${coins < cost ? 'disabled' : ''}><i class="coin"></i> ${cost}</button>`}</div>`;
      }).join('');
      return;
    }
    renderGallery(el, p, coins);
  }
  /** Titans, plates and projectiles: a horizontal slider of picture cards with one big action button under it. */
  const sel: Partial<Record<CosmeticKind, number>> = {};
  function renderGallery(el: HTMLElement, p: MyProfile, coins: number) {
    const kind = tab as CosmeticKind, items = COSMETICS.filter(c => c.kind === kind);
    if (sel[kind] === undefined) sel[kind] = Math.max(0, items.findIndex(c => c.id === p.eq[kind]));
    const base = import.meta.env.BASE_URL;
    const cards = items.map((c, i) => {
      const own = p.own.includes(c.id), on = p.eq[kind] === c.id;
      return `<div class="card${on ? ' eq' : ''}" data-i="${i}"><img src="${base}art/ui/shop/${c.id}.webp" alt="" draggable="false"><span class="tag ${on ? 'on' : own ? '' : 'buy'}">${on ? '✓ Выбрано' : own ? 'Есть' : `<i class="coin"></i> ${c.cost}`}</span><b>${esc(c.name)}</b></div>`;
    }).join('');
    el.classList.add('gallery');
    el.innerHTML = `<div class="gal"><button class="nav" data-nav="-1" aria-label="Назад">‹</button><div class="strip">${cards}</div><button class="nav" data-nav="1" aria-label="Вперёд">›</button></div><button class="act" id="shop-act"></button>`;
    const strip = el.querySelector<HTMLElement>('.strip')!, act = el.querySelector<HTMLButtonElement>('#shop-act')!, cardEls = [...strip.children] as HTMLElement[];
    const paintAct = () => {
      const i = sel[kind]!, c = items[i]!, own = p.own.includes(c.id), on = p.eq[kind] === c.id;
      cardEls.forEach((x, k) => x.classList.toggle('cur', k === i));
      act.removeAttribute('data-eq'); act.removeAttribute('data-buy'); act.removeAttribute('data-kind'); act.disabled = false; act.className = 'act';
      if (on) { act.textContent = '✓ ВЫБРАНО'; act.disabled = true; act.classList.add('on'); }
      else if (own) { act.textContent = 'ВЫБРАТЬ'; act.dataset.eq = c.id; act.classList.add('ok'); }
      else { act.innerHTML = `КУПИТЬ <i class="coin"></i> ${c.cost}`; act.dataset.kind = 'item'; act.dataset.buy = c.id; act.disabled = coins < c.cost; }
    };
    const go = (i: number, smooth = true) => { const n = Math.max(0, Math.min(items.length - 1, i)); const c = cardEls[n]!; strip.scrollTo({ left: c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' }); sel[kind] = n; paintAct(); };
    let t = 0;
    strip.addEventListener('scroll', () => { window.clearTimeout(t); t = window.setTimeout(() => {
      const mid = strip.scrollLeft + strip.clientWidth / 2; let best = 0, d = 1e9;
      cardEls.forEach((c, k) => { const dd = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (dd < d) { d = dd; best = k; } });
      if (best !== sel[kind]) { sel[kind] = best; paintAct(); }
    }, 60); }, { passive: true });
    cardEls.forEach((c, k) => c.addEventListener('click', () => go(k)));
    el.querySelectorAll<HTMLElement>('[data-nav]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); go(sel[kind]! + +b.dataset.nav!); }));
    paintAct(); requestAnimationFrame(() => go(sel[kind]!, false));
  }
  function setTop(list: PublicEntry[], rank: number | null) { top = list; topRank = rank; if (current === 'rating') renderTop(); }
  function renderTop() {
    const el = $('top-list'), r = prof?.rating ?? 1000, mineRow = (e: PublicEntry) => !!prof && e.nick === prof.nick && e.rating === prof.rating;
    el.innerHTML = top.length ? top.map((e, i) => `<div class="trow${mineRow(e) ? ' mine' : ''}"><span>${i + 1}</span><span><i class="ld" style="background:${league(e.rating).color}"></i>${esc(e.nick)}</span><span>${e.wins}</span><span>${e.rating}</span></div>`).join('') : '<div class="empty">Рейтинг пока пуст. Сыграй рейтинговый бой.</div>';
    // own row: highlighted inside the list when we are in the top, otherwise pinned under it with our place (100+ when outside)
    const inList = top.some(mineRow); $('top-me').hidden = inList;
    $('top-me').children[0].textContent = topRank ? String(topRank) : (prof?.games && top.length ? '100+' : '—');
    const place = topRank ?? (top.findIndex(mineRow) + 1 || null); $('rc-place').textContent = place ? `Место в рейтинге: ${place}` : prof?.games ? 'Место в рейтинге: 100+' : 'Сыграй рейтинговый бой';
    $('rate-me').textContent = nick(); $('rate-pts').textContent = String(r); $('rate-wins').textContent = String(prof?.wins ?? 0);
    // own league card: progress to the next league
    const cur = league(r), idx = LEAGUES.findIndex(l => l.min === cur.min), next = LEAGUES[idx + 1];
    const lg = $('rc-league'); lg.textContent = cur.name; lg.style.color = cur.color; $('rc-pts').textContent = String(r);
    $('rc-bar').style.width = next ? `${Math.max(4, Math.min(100, (r - cur.min) / (next.min - cur.min) * 100))}%` : '100%'; $('rc-bar').style.background = cur.color;
    $('rc-next').textContent = next ? `до лиги «${next.name}»: ${next.min - r}` : 'высшая лига';
    const w = prof?.wins ?? 0, l = prof?.losses ?? 0; $('rc-wl').textContent = `${w} поб · ${l} пор${w + l ? ` · ${Math.round(w / (w + l) * 100)}%` : ''}`;
    $('recent-list').innerHTML = prof?.recent?.length ? prof.recent.map(x => `<div class="rrow ${x.won === true ? 'w' : x.won === false ? 'l' : 'd'}"><b>${x.won === true ? 'Победа' : x.won === false ? 'Поражение' : 'Ничья'}</b><span>${x.online ? '' : '🤖 '}${esc(x.nick)}</span><em>${x.delta ? (x.delta > 0 ? '+' : '') + x.delta : '·'}</em></div>`).join('') : '<div class="empty">Здесь появятся твои последние бои</div>';
  }
  // quick search: QUICK_SEARCH_S → 0 quietly, then BOT_OFFER_S more with the offer; a found opponent freezes the number. Nobody found: offer a bot (starts by itself after BOT_OFFER_S) or a server to invite a friend; the queue stays on meanwhile
  let qT = 0, qLeft = 0, qGone = 0;
  const qPaint = () => { $('quick-count').textContent = String(qLeft); };
  const qStop = () => { window.clearInterval(qT); qT = 0; window.clearTimeout(qGone); };
  function quickSearch() {
    qStop(); qLeft = QUICK_SEARCH_S; qPaint(); $('quick-ring').classList.remove('found'); $('quick-alt').hidden = true; $('quick-title').textContent = 'Ищем соперника…'; $('quick-note').textContent = 'Подбираем игрока близкого к тебе по рейтингу.';
    open('quick');
    let offer = false;
    qT = window.setInterval(() => {
      qLeft--; qPaint(); if (qLeft > 0) return;
      if (offer) { qStop(); h.onQuickTimeout(); return; }
      offer = true; qLeft = BOT_OFFER_S; qPaint(); $('quick-alt').hidden = false;
      $('quick-title').textContent = 'Ищем дальше…'; $('quick-note').textContent = `Можно позвать друга или сразу сыграть с ИИ. Через ${BOT_OFFER_S} с начнём бой с ИИ сами.`;
    }, 1000);
  }
  const quickFound = (foe?: string) => { $('quick-ring').classList.add('found'); $('quick-alt').hidden = true; $('quick-title').textContent = 'Соперник найден!'; if (foe) $('quick-note').textContent = `Играем с ${foe}`; };
  const setQueue = (on: boolean) => {
    if (on && current !== 'quick') quickSearch();
    if (!on && current === 'quick' && qT) { qStop(); quickFound(); qGone = window.setTimeout(() => { if (current === 'quick') open('online'); }, 6000); }
  };

  // settings
  function paintSound() { const b = $('set-sound'); b.textContent = sfx.muted ? 'Выкл' : 'Вкл'; b.classList.toggle('on', !sfx.muted); }
  const paintHaptic = () => { const b = $('set-haptic'), on = store.get('haptic', '1') !== '0'; b.textContent = on ? 'Вкл' : 'Выкл'; b.classList.toggle('on', on); };
  $('set-haptic').onclick = () => { store.set('haptic', store.get('haptic', '1') !== '0' ? '0' : '1'); paintHaptic(); };
  $('set-sound').onclick = () => { sfx.setMuted(!sfx.muted); paintSound(); document.getElementById('mute-btn')!.innerHTML = icon(sfx.muted ? 'mute' : 'sound'); if (!sfx.muted) sfx.click(); };
  $<HTMLInputElement>('nick').addEventListener('input', e => {
    const el = e.target as HTMLInputElement, v = el.value.trim(), ck = v ? checkNick(v) : { ok: true as const };
    el.classList.toggle('bad', !ck.ok); $('nick-err').textContent = ck.ok ? '' : ck.text;
    if (ck.ok) { store.set('nick', v); paintNick(); }
  });
  const sl = $<HTMLInputElement>('sens'); sl.value = String(sens()); $('sens-val').textContent = `×${sens().toFixed(1)}`;
  sl.addEventListener('input', () => { store.set('sens', sl.value); $('sens-val').textContent = `×${sens().toFixed(1)}`; });
  for (const k of ['sfx', 'music'] as const) {
    const el = $<HTMLInputElement>('vol-' + k), val = $('vol-' + k + '-val'), paint = () => { val.textContent = `${el.value}%`; };
    el.value = String(Math.round(sfx.volume[k] * 100)); paint();
    el.addEventListener('input', () => { sfx.setVolume(k, +el.value / 100); paint(); });
    el.addEventListener('change', () => { if (k === 'sfx' && !sfx.muted) sfx.click(); }); // a click as a sample of the new level
  }
  paintNick(); paintSound(); paintHaptic(); setRooms([]); paintProfile();

  const setTrained = () => paintTrain();
  const botWin = () => { store.set('botwin', '1'); paintLocks(); };
  return { trainDone, setTrained, botWin, setProfile, setTop, setQueue, quickSearch, quickFound, quickStop: qStop, show, hide, notice, get hidden() { return root.hidden; }, open, nick, sens, setRooms, setNet, renderRoom, pwdError, get screen() { return current; }, get inRoom() { return view; }, clearRoom() { view = null; } };
}
export type Menu = ReturnType<typeof initMenu>;
