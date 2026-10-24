import { World } from './world';
import { Sfx } from './audio';
import { Controls } from './controls';
import { Battle, kindForHold, MATCH_SECONDS, LIVES, type Kind } from '../../shared/battle';
import { Bot, mulberry32, type Difficulty } from '../../shared/bot';
import { rules, type Cell } from '../../shared/world';

const sfx = new Sfx();
const haptic = (ms: number | number[]) => { try { if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(ms); } catch { /* optional */ } };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const NAMES: Record<Difficulty, string> = { easy: 'ГРОМ', normal: 'БОРГАР', hard: 'ТОРВАЛЬД' };
const KIND_LABEL: Record<Kind, string> = { normal: 'ОБЫЧНЫЙ', spin: 'КРУЧЁНЫЙ', heavy: 'МОЩНЫЙ' };
const KIND_COLOR: Record<Kind, string> = { normal: '#FFF3B0', spin: '#FFB050', heavy: '#C08CFF' };

let level: Difficulty = 'normal', battle = new Battle(), bot = new Bot(battle, 1, level), mode: 'menu' | 'playing' | 'over' = 'menu';
let seenAimHint = (() => { try { return localStorage.getItem('titans.aimhint') === '1'; } catch { return false; } })();
let charging = false, hover: Cell | null = null, acc = 0, toastTimer = 0, seed = 1, userPause = false, anchorCell: Cell | null = null;
const TOUCH_PX_X = 24, TOUCH_PX_Z = 15; // finger px per cell

async function boot() {
  const world = await World.create(canvas), controls = new Controls(canvas);
  const touchDevice = matchMedia('(pointer: coarse)').matches;
  $('help').textContent = touchDevice
    ? 'Левый палец: ходьба. Правый: нажми, и прицел встанет на врага; тяни, чтобы сдвинуть; отпусти для броска, дольше держишь, сильнее бросок. Палец на ✕: отмена.'
    : 'WASD — ходьба · ЛКМ — бросок (держи — сильнее) · ПКМ или Esc — отмена · Пробел — ремонт';
  $('hint').textContent = touchDevice ? '' : 'ЛКМ бросок · держи — сильнее · ПКМ отмена · Пробел ремонт';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-level]')) b.onclick = () => { level = b.dataset.level as Difficulty; document.querySelectorAll('[data-level]').forEach(x => x.classList.toggle('sel', x === b)); };
  const startMatch = () => {
    sfx.unlock(); sfx.startMusic(); sfx.click();
    world.resetPoses(); battle = new Battle(); bot = new Bot(battle, 1, level, mulberry32(seed++ * 7919)); charging = false; acc = 0; controls.reset();
    $('foe-name').textContent = NAMES[level]; $('menu').hidden = true; $('end').hidden = true; $('hud').hidden = false; mode = 'playing'; (window as any).titans.battle = battle;
  };
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true }); window.addEventListener('keydown', () => sfx.unlock(), { once: true });
  const muteBtn = $('mute-btn'); const paintMute = () => { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; }; paintMute(); muteBtn.onclick = () => { sfx.unlock(); sfx.setMuted(!sfx.muted); paintMute(); };
  $('start').onclick = startMatch; $('again').onclick = startMatch;
  $('to-menu').onclick = () => { $('end').hidden = true; $('hud').hidden = true; $('menu').hidden = false; mode = 'menu'; };
  $('loading').hidden = true;
  const toast = (t: string) => { const el = $('toast'); el.textContent = t; el.classList.add('on'); toastTimer = 1.4; };
  const hearts = (n: number) => '♥'.repeat(n) + `<i>${'♥'.repeat(LIVES - n)}</i>`;
  const slots = $('slots'); slots.innerHTML = '<div class="slot"><b></b></div>'.repeat(rules.inventory.capacity);

  const setPause = (on: boolean) => { if (on && mode !== 'playing') return; userPause = on; $('pause').hidden = !on; if (on) { controls.reset(); charging = false; battle.cancelCharge(0); battle.cancelRepair(0); } };
  $('pause-btn').onclick = () => setPause(true); $('resume').onclick = () => setPause(false);
  $('pause-menu').onclick = () => { setPause(false); $('hud').hidden = true; $('menu').hidden = false; mode = 'menu'; };
  window.addEventListener('blur', () => setPause(true));
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
  const paused = () => document.hidden || userPause || (controls.touch && innerWidth < innerHeight);
  Object.assign(window, { titans: { battle, world, controls, setPause, state: () => ({ mode, charging, aimBlend: world.aimBlend, lives: battle.actors.map(a => a.lives), stones: battle.actors.map(a => a.stones), time: battle.time, ready: world.isReady() }) } });

  world.engine.runRenderLoop(() => {
    const dt = Math.min(world.engine.getDeltaTime() / 1000, .05), isPaused = paused();
    $('portrait').hidden = !(controls.touch && innerWidth < innerHeight && mode === 'playing');
    if (controls.pauseRequested) { controls.pauseRequested = false; setPause(!userPause); }
    if (mode === 'playing' && !isPaused) {
      const b = battle, me = b.actors[0];
      b.setMove(0, b.canAct(0) ? controls.move.x : 0, b.canAct(0) ? controls.move.z : 0);
      // Touch aiming is relative and works in cells, not screen pixels: perspective squeezes depth, so a pixel gain would be too twitchy.
      const unit = Math.max(.8, Math.min(1.6, innerHeight / 390));
      const touchCell = (): Cell => ({
        x: Math.max(0, Math.min(rules.arena.width_cells - 1, Math.round(anchorCell!.x - controls.touchDelta.x / (TOUCH_PX_X * unit)))),
        z: Math.max(0, Math.min(rules.arena.depth_cells - 1, Math.round(anchorCell!.z + controls.touchDelta.y / (TOUCH_PX_Z * unit)))),
      });
      const pick = () => controls.touch && anchorCell ? touchCell() : world.pick(controls.aim.x, controls.aim.y);
      if (!charging && b.charges[0]) b.cancelCharge(0);
      if (controls.pressed) {
        controls.pressed = false;
        if (b.beginCharge(0)) {
          charging = true;
          if (controls.touch) {
            const foe = b.cellOf(1), ok = foe && b.hp(foe, 1) > 0;
            anchorCell = ok ? foe : (anchorCell ?? { x: 4, z: 6 });
            if (!seenAimHint) { seenAimHint = true; toast('Тяни палец, чтобы сдвинуть прицел'); try { localStorage.setItem('titans.aimhint', '1'); } catch { /* optional */ } }
          }
        }
        else if (me.stones < 1) toast('Нет камней — иди к арсеналу'); else if (me.cooldown > 0) toast('Рука отдыхает'); else if (!b.canAct(0)) { /* knocked down */ }
      }
      if (charging && !b.charges[0]) { charging = false; controls.held = false; controls.cancelled = false; controls.released = false; }
      if (charging) { const c = pick(); if (c) b.setTarget(0, c); }
      if (controls.released) {
        controls.released = false;
        if (charging) { if (controls.cancelled || controls.overCancel) b.cancelCharge(0); else if (!b.releaseCharge(0)) toast('Цель вне острова'); charging = false; }
        controls.cancelled = false; controls.overCancel = false; $('cancel').classList.remove('over');
      }
      if (controls.repairHeld && !b.repairs[0] && !b.charges[0]) b.beginRepair(0);
      if (!controls.repairHeld && b.repairs[0]) b.cancelRepair(0);
      hover = !charging && controls.aim.seen && !controls.touch ? pick() : null;
      acc += dt;
      while (acc >= 1 / 60) { acc -= 1 / 60; bot.update(1 / 60); b.step(1 / 60); if (b.phase !== 'playing') break; }
    }
    const b = battle, ch = b.charges[0], kind: Kind | null = ch ? kindForHold(ch.t) : hover ? 'normal' : null;
    world.update(b, isPaused ? 0 : dt, { aiming: charging, kind, aimCell: ch ? ch.target : hover, cancel: controls.cancelled || controls.overCancel });
    for (const e of b.events) {
      if (e.type === 'hit' && e.side === 0) toast('Сбили с ног!'); if (e.type === 'fall' && e.side === 0) toast('Падаешь!'); if (e.type === 'fall' && e.side === 1) toast('Враг упал!');
      if (e.type === 'over') { showEnd(e.winner); sfx.charge(false, 0); sfx.repair(false); if (e.winner === 0) { sfx.win(); haptic([40, 60, 40, 60, 120]); } else sfx.lose(); }
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
    world.scene.render();
  });
  function showEnd(winner: 0 | 1 | null) {
    mode = 'over'; charging = false; controls.reset();
    $('end-title').textContent = winner === 0 ? 'ПОБЕДА' : winner === 1 ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';
    $('end-text').textContent = winner === 0 ? 'Враг рухнул вниз. Небесные камни твои.' : winner === 1 ? 'Тебя сбросили с острова. Попробуй ещё раз.' : 'Время вышло, силы равны.';
    setTimeout(() => { $('end').hidden = false; }, 900);
  }
}
boot().catch(e => { console.error(e); $('loading').querySelector('h1')!.textContent = 'Ошибка загрузки'; });
