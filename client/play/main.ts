import { World } from './world';
import { Sfx } from './audio';
import { Controls } from './controls';
import { Battle, kindForHold, MATCH_SECONDS, LIVES, type Kind } from '../../shared/battle';
import { Bot, mulberry32, type Difficulty } from '../../shared/bot';
import { rules, type Cell } from '../../shared/world';
import { initMenu } from './menu';
import { Online } from './online';
import type { Snap } from '../../shared/net';
import { Predictor } from '../../shared/predict';
import type { GameEvent } from '../../shared/battle';

const sfx = new Sfx();
const haptic = (ms: number | number[]) => { try { if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(ms); } catch { /* optional */ } };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const NAMES: Record<Difficulty, string> = { easy: 'ГРОМ', normal: 'БОРГАР', hard: 'ТОРВАЛЬД' };
const KIND_LABEL: Record<Kind, string> = { normal: 'ОБЫЧНЫЙ', spin: 'КРУЧЁНЫЙ', heavy: 'МОЩНЫЙ' };
const KIND_COLOR: Record<Kind, string> = { normal: '#FFF3B0', spin: '#FFB050', heavy: '#C08CFF' };

const pred = new Predictor();
let online = false, lastMove = { x: 9, z: 9, t: 0 }, lastTarget = '';
const srvEvents: GameEvent[] = [];
let pendingSnap: { s: Snap; at: number } | null = null;
let level: Difficulty = 'normal', battle = new Battle(), bot = new Bot(battle, 1, level), mode: 'menu' | 'playing' | 'over' = 'menu';
let seenAimHint = (() => { try { return localStorage.getItem('titans.aimhint') === '1'; } catch { return false; } })();
let charging = false, hover: Cell | null = null, acc = 0, toastTimer = 0, seed = 1, userPause = false, anchorCell: Cell | null = null;
const TOUCH_PX_X = 24, TOUCH_PX_Z = 15; // finger px per cell at sensitivity 1

async function boot() {
  const world = await World.create(canvas), controls = new Controls(canvas);
  const touchDevice = matchMedia('(pointer: coarse)').matches;
  $('hint').textContent = touchDevice ? '' : 'ЛКМ бросок · держи — сильнее · ПКМ отмена · Пробел ремонт';
  const net = new Online(); let menu!: ReturnType<typeof initMenu>; net.nick = () => menu.nick();
  const hello = () => net.send({ t: 'hello', nick: menu.nick() });
  menu = initMenu({
    sfx, touch: touchDevice, onStartBot: l => { level = l; startMatch(); },
    onScreen: sc => { if (sc === 'online') { if (net.state === 'off') net.connect(); else net.send({ t: 'list' }); } },
    onCreate: (name, pass) => { hello(); net.send({ t: 'create', name, pass }); },
    onJoin: (id, pass) => { hello(); net.send({ t: 'join', id, pass }); },
    onReady: on => net.send({ t: 'ready', on }),
    onLeave: () => net.send({ t: 'leave' }),
    onRefresh: () => { if (net.state === 'off') net.connect(); else net.send({ t: 'list' }); },
  });
  let retries = 0;
  net.onState = st => {
    menu.setNet(st, net.slow);
    if (st === 'on') retries = 0;
    if (st === 'off' && online && mode === 'playing') showEnd(1, 'conn');
    // a sleeping free server needs up to a minute: keep knocking while the player waits in the lobby
    else if (st === 'off' && !menu.hidden && ['online', 'create', 'room'].includes(menu.screen) && retries++ < 15) window.setTimeout(() => { if (net.state === 'off' && !menu.hidden && ['online', 'create', 'room'].includes(menu.screen)) net.connect(); }, 4000);
  };
  net.onMsg = m => {
    switch (m.t) {
      case 'rooms': menu.setRooms(m.rooms); break;
      case 'room':
        if (m.room) { menu.renderRoom(m.room); if (!menu.hidden && (menu.screen === 'online' || menu.screen === 'create')) menu.open('room'); }
        else { menu.clearRoom(); if (!menu.hidden && menu.screen === 'room') menu.open('online'); }
        break;
      case 'err': if (!$('pwd').hidden && m.code === 'wrong_pass') menu.pwdError(m.text); else menu.notice(m.text); break;
      case 'start': startMatch(m.foe); break;
      case 'snap': if (online) { pendingSnap = { s: m.s, at: performance.now() / 1000 }; srvEvents.push(...m.ev); } break;
      case 'end': if (online && mode === 'playing') showEnd(m.winner, m.reason === 'left' ? 'left' : undefined); break;
    }
  };
  const startMatch = (foe?: string) => {
    sfx.unlock(); sfx.startMusic(); sfx.click();
    online = typeof foe === 'string'; try { (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}); } catch { /* needs fullscreen on most browsers */ } pendingSnap = null; srvEvents.length = 0; pred.reset(); lastTarget = ''; setPause(false);
    world.resetPoses(); battle = new Battle(); bot = new Bot(battle, 1, level, mulberry32(seed++ * 7919)); charging = false; acc = 0; controls.reset();
    $('foe-name').textContent = online ? foe! : NAMES[level]; $('foe-face').textContent = online ? foe!.slice(0, 1).toUpperCase() : 'ИИ'; menu.hide(); $('end').hidden = true; $('hud').hidden = false; mode = 'playing'; (window as any).titans.battle = battle;
  };
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true }); window.addEventListener('keydown', () => sfx.unlock(), { once: true });
  const muteBtn = $('mute-btn'); const paintMute = () => { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; }; paintMute(); muteBtn.onclick = () => { sfx.unlock(); sfx.setMuted(!sfx.muted); paintMute(); };
  $('again').onclick = () => { if (online) { online = false; $('end').hidden = true; $('hud').hidden = true; mode = 'menu'; menu.show(menu.inRoom ? 'room' : 'online'); } else startMatch(); };
  const toMenu = () => { if (online) { net.send({ t: 'leave' }); online = false; } $('end').hidden = true; $('hud').hidden = true; menu.show('main'); mode = 'menu'; };
  $('to-menu').onclick = toMenu;
  $('loading').hidden = true;
  const toast = (t: string) => { const el = $('toast'); el.textContent = t; el.classList.add('on'); toastTimer = 1.4; };
  const hearts = (n: number) => '♥'.repeat(n) + `<i>${'♥'.repeat(LIVES - n)}</i>`;
  const slots = $('slots'); slots.innerHTML = '<div class="slot"><b></b></div>'.repeat(rules.inventory.capacity);

  const setPause = (on: boolean) => { if (on && mode !== 'playing') return; userPause = on && !online; $('pause').hidden = !on; $('pause-menu').textContent = online ? 'Сдаться и выйти' : 'Выйти в меню'; if (on) { controls.reset(); charging = false; battle.cancelCharge(0); battle.cancelRepair(0); } };
  $('pause-btn').onclick = () => setPause(true); $('resume').onclick = () => setPause(false);
  $('pause-menu').onclick = () => { setPause(false); toMenu(); };
  window.addEventListener('blur', () => { if (!online) setPause(true); });
  const fsBtn = $('fs-btn');
  fsBtn.hidden = !touchDevice && !document.fullscreenEnabled;
  fsBtn.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await document.documentElement.requestFullscreen(); await (screen.orientation as any)?.lock?.('landscape').catch(() => {}); }
    } catch { toast('Полный экран недоступен'); }
  };
  const resize = () => world.engine.resize();
  window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  const paused = () => !online && (document.hidden || userPause || (controls.touch && innerWidth < innerHeight));
  Object.assign(window, { titans: { battle, world, controls, setPause, state: () => ({ mode, charging, aimBlend: world.aimBlend, lives: battle.actors.map(a => a.lives), stones: battle.actors.map(a => a.stones), time: battle.time, ready: world.isReady() }) } });

  world.engine.runRenderLoop(() => {
    const rawDt = world.engine.getDeltaTime() / 1000, dt = Math.min(rawDt, .05), isPaused = paused();
    $('portrait').hidden = !(controls.touch && innerWidth < innerHeight && mode === 'playing'); $('portrait-text').textContent = online ? 'Бой идёт, соперник не ждёт. Переверни телефон набок.' : 'Игра идёт в горизонтальном режиме. Бой на паузе.';
    if (controls.pauseRequested) { controls.pauseRequested = false; setPause($('pause').hidden === true); }
    const nowS = performance.now() / 1000;
    if (online && mode !== 'menu') {
      pred.rtt = net.rtt;
      if (pendingSnap) { pred.reconcile(battle, pendingSnap.s, pendingSnap.at, nowS); pendingSnap = null; }
      if (mode === 'playing') pred.record(nowS, battle.actors[0].pos.x, battle.actors[0].pos.z);
    }
    if (mode === 'playing' && !isPaused) {
      const b = battle, me = b.actors[0];
      b.setMove(0, b.canAct(0) ? controls.move.x : 0, b.canAct(0) ? controls.move.z : 0);
      if (online) {
        const mx = Math.round(b.input[0].x * 100) / 100, mz = Math.round(b.input[0].z * 100) / 100;
        if ((mx !== lastMove.x || mz !== lastMove.z) && nowS - lastMove.t > .04 || nowS - lastMove.t > 1) { lastMove = { x: mx, z: mz, t: nowS }; net.send({ t: 'move', x: mx, z: mz }); }
      }
      // Touch aiming is relative and works in cells, not screen pixels: perspective squeezes depth, so a pixel gain would be too twitchy.
      const unit = Math.max(.8, Math.min(1.6, innerHeight / 390));
      const touchCell = (): Cell => ({
        x: Math.max(0, Math.min(rules.arena.width_cells - 1, Math.round(anchorCell!.x - controls.touchDelta.x / (TOUCH_PX_X / menu.sens() * unit)))),
        z: Math.max(0, Math.min(rules.arena.depth_cells - 1, Math.round(anchorCell!.z + controls.touchDelta.y / (TOUCH_PX_Z / menu.sens() * unit)))),
      });
      const pick = () => controls.touch && anchorCell ? touchCell() : world.pick(controls.aim.x, controls.aim.y);
      if (!charging && b.charges[0]) { b.cancelCharge(0); if (online && nowS - pred.lastEnd > .6) { net.send({ t: 'cancel' }); pred.lastEnd = nowS; } }
      if (controls.pressed) {
        controls.pressed = false;
        if (b.beginCharge(0)) {
          charging = true; if (online) { net.send({ t: 'begin' }); lastTarget = ''; }
          if (controls.touch) {
            const foe = b.cellOf(1), ok = foe && b.hp(foe, 1) > 0;
            anchorCell = ok ? foe : (anchorCell ?? { x: 4, z: 6 });
            if (!seenAimHint) { seenAimHint = true; toast('Тяни палец, чтобы сдвинуть прицел'); try { localStorage.setItem('titans.aimhint', '1'); } catch { /* optional */ } }
          }
        }
        else if (me.stones < 1) toast('Нет камней — иди к арсеналу'); else if (me.cooldown > 0) toast('Рука отдыхает'); else if (!b.canAct(0)) { /* knocked down */ }
      }
      if (charging && !b.charges[0]) { charging = false; controls.held = false; controls.cancelled = false; controls.released = false; }
      if (charging) { const c = pick(); if (c) { b.setTarget(0, c); const k = `${c.x},${c.z}`; if (online && k !== lastTarget) { lastTarget = k; net.send({ t: 'target', x: c.x, z: c.z }); } } }
      if (controls.released) {
        controls.released = false;
        if (charging) {
          if (controls.cancelled || controls.overCancel) { b.cancelCharge(0); if (online) net.send({ t: 'cancel' }); pred.lastEnd = nowS; }
          else if (online) { const tg = b.charges[0]?.target; if (tg) { net.send({ t: 'release', x: tg.x, z: tg.z }); b.cancelCharge(0); pred.lastEnd = nowS; } else toast('Цель вне острова'); }
          else if (!b.releaseCharge(0)) toast('Цель вне острова');
          charging = false;
        }
        controls.cancelled = false; controls.overCancel = false; $('cancel').classList.remove('over');
      }
      if (controls.repairHeld && !b.repairs[0] && !b.charges[0]) { if (b.beginRepair(0) && online) net.send({ t: 'repair', on: true }); }
      if (!controls.repairHeld && b.repairs[0]) { b.cancelRepair(0); if (online) net.send({ t: 'repair', on: false }); }
      hover = !charging && controls.aim.seen && !controls.touch ? pick() : null;
      // Online the simulation must keep real time even on a slow phone, or the server (real time) outruns the local copy and pulls it back.
      acc += online ? Math.min(rawDt, .25) : dt;
      while (acc >= 1 / 60) { acc -= 1 / 60; if (!online) bot.update(1 / 60); b.step(1 / 60); if (online) b.events.length = 0; if (b.phase !== 'playing') break; }
    }
    if (online && srvEvents.length) { battle.events.push(...srvEvents); srvEvents.length = 0; }
    const b = battle, ch = b.charges[0], kind: Kind | null = ch ? kindForHold(ch.t) : hover ? 'normal' : null;
    world.update(b, isPaused ? 0 : dt, { aiming: charging, kind, aimCell: ch ? ch.target : hover, cancel: controls.cancelled || controls.overCancel });
    for (const e of b.events) {
      if (e.type === 'hit' && e.side === 0) toast('Сбили с ног!'); if (e.type === 'fall' && e.side === 0) toast('Падаешь!'); if (e.type === 'fall' && e.side === 1) toast('Враг упал!');
      if (e.type === 'over') { if (mode !== 'over') showEnd(e.winner); sfx.charge(false, 0); sfx.repair(false); if (e.winner === 0) { sfx.win(); haptic([40, 60, 40, 60, 120]); } else sfx.lose(); }
      if (e.type === 'throw') { sfx.throwSfx(e.kind, e.side === 0); if (e.side === 0) haptic(e.kind === 'heavy' ? 40 : 18); }
      if (e.type === 'impact') sfx.impact(e.kind, e.hpBefore, e.hpAfter, e.side === 0 ? 1 : .75);
      if (e.type === 'hit') { sfx.hit(e.side === 0); if (e.side === 0) haptic(e.kind === 'heavy' ? [90, 40, 90] : 70); }
      if (e.type === 'fall') { sfx.fall(e.side === 0); if (e.side === 0) haptic(200); }
      if (e.type === 'respawn') sfx.respawn();
      if (e.type === 'refill' && e.side === 0) sfx.refill();
      if (e.type === 'repaired' && e.side === 0) { sfx.repaired(); haptic(30); }
    }
    sfx.charge(mode === 'playing' && !isPaused && !!ch, ch?.t ?? 0); sfx.repair(mode === 'playing' && !isPaused && !!b.repairs[0]);
    world.handle(b.events); b.events.length = 0;
    // HUD
    if (mode !== 'menu') {
      $('hearts0').innerHTML = hearts(b.actors[0].lives); $('hearts1').innerHTML = hearts(b.actors[1].lives);
      const left = Math.max(0, Math.ceil(MATCH_SECONDS - b.time)); $('timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      [...slots.children].forEach((s, i) => s.classList.toggle('e', i >= b.actors[0].stones));
      const rp = b.repairs[0], can = b.canRepair(0) || !!rp; $('repair').hidden = !can && !controls.repairHeld;
      $('repair').textContent = rp ? `${Math.round(100 * rp.t / rp.need)}%` : 'РЕМОНТ';
      const bar = $('charge'); bar.classList.toggle('on', !!ch);
      if (ch) { const k = kindForHold(ch.t), tgt = k === 'heavy' ? 1 : k === 'spin' ? (ch.t - .9) / 1.7 : ch.t / .9; (bar.firstElementChild as HTMLElement).style.width = `${Math.min(1, ch.t / 2.6) * 100}%`; (bar.firstElementChild as HTMLElement).style.background = KIND_COLOR[k]; bar.lastElementChild!.textContent = KIND_LABEL[k]; void tgt; }
      $('cancel').hidden = !(charging && controls.touch);
      if ((toastTimer -= dt) <= 0) $('toast').classList.remove('on');
    }
    if (mode !== 'menu') world.scene.render();
  });
  function showEnd(winner: 0 | 1 | null, why?: 'left' | 'conn') {
    mode = 'over'; charging = false; controls.reset(); $('pause').hidden = true; userPause = false;
    $('end-title').textContent = winner === 0 ? 'ПОБЕДА' : winner === 1 ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';
    $('end-text').textContent = why === 'left' ? 'Соперник вышел из боя. Победа твоя.' : why === 'conn' ? 'Связь с сервером потеряна.' : winner === 0 ? 'Враг рухнул вниз. Небесные камни твои.' : winner === 1 ? 'Тебя сбросили с острова. Попробуй ещё раз.' : 'Время вышло, силы равны.';
    $('again').textContent = online ? 'В КОМНАТУ' : 'ЕЩЁ РАЗ';
    if (why === 'left') { sfx.win(); }
    setTimeout(() => { $('end').hidden = false; }, 900);
  }
}
boot().catch(e => { console.error(e); $('loading').querySelector('h1')!.textContent = 'Ошибка загрузки'; });
