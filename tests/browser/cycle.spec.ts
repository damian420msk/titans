import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { state, ready, enter, aim, place, release } from './helpers';

test('normal release locks its target, damages once, second hit opens a hole; no off-grid shot', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ready(page);await enter(page);await aim(page,3,5);
  await page.mouse.down();await page.waitForTimeout(1000);expect((await state(page)).ammo).toBe(3);expect((await state(page)).released).toBe(0);
  await aim(page,4,5);await page.mouse.up();expect((await state(page)).ammo).toBe(2);expect((await state(page)).shots[0].target).toEqual({x:4,z:5});
  await page.mouse.down();expect((await state(page)).primary).toBeNull();await page.waitForTimeout(1200);await page.mouse.up();expect((await state(page)).released).toBe(1);
  await aim(page,2,7);await expect.poll(async()=>(await state(page)).hp['4,5']).toBe(1);expect((await state(page)).hp['3,5']).toBe(2);
  await aim(page,4,5);await release(page);expect((await state(page)).ammo).toBe(1);
  await expect.poll(async()=>(await state(page)).hp['4,5']).toBe(0);
  expect((await state(page)).round).toBe(1);
  await page.keyboard.press('Escape');await page.selectOption('#input-mode','touch',{force:true});
  expect((await state(page)).hp['4,5']).toBe(0);expect((await state(page)).ammo).toBe(1);expect((await state(page)).round).toBe(1);
  await page.selectOption('#input-mode','desktop',{force:true});await enter(page);
  await page.evaluate(()=>(window as any).titans.view(Math.PI,.2));await expect.poll(async()=>(await state(page)).selected).toBeNull();
  await release(page);expect((await state(page)).released).toBe(2);expect((await state(page)).ammo).toBe(1);
  expect(errors).toEqual([]);
});

test('cancel button chord, focus loss, mode change and pointercancel do not spend or release', async ({page}) => {
  await ready(page);await enter(page);await aim(page,3,5);
  await page.mouse.down();await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.up();
  expect((await state(page)).ammo).toBe(3);expect((await state(page)).released).toBe(0);
  await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();expect((await state(page)).released).toBe(0);
  await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'mouse'})));await page.mouse.up();expect((await state(page)).released).toBe(0);
  await page.mouse.down();await page.selectOption('#input-mode','touch',{force:true});
  const deferred=await state(page);expect(deferred.input.effective).toBe('desktop');expect(deferred.input.pending).toBe('touch');
  await page.mouse.up();await expect.poll(async()=>(await state(page)).input.effective).toBe('touch');
  expect((await state(page)).released).toBe(0);expect((await state(page)).ammo).toBe(3);expect((await state(page)).input.locked).toBe(false);
});

test('three stones, cooldown without queued shot, real arsenal hold refills and release cannot attack', async ({page}) => {
  await ready(page);await enter(page);
  for(const [x,z] of [[2,5],[3,5],[5,5]]){
    await aim(page,x,z);await release(page);await expect.poll(async()=>(await state(page)).cooldown).toBe(0);
  }
  expect((await state(page)).ammo).toBe(0);
  await release(page);expect((await state(page)).released).toBe(3);
  // Standing on any protected cell permits refill without requiring a direct ray on the pile.
  await place(page,-2.8,-32.4);await expect.poll(async()=>(await state(page)).arsenal).toBe(true);
  await page.mouse.down();await page.waitForTimeout(400);expect((await state(page)).ammo).toBe(0);
  await expect.poll(async()=>(await state(page)).ammo).toBe(3);await page.mouse.up();
  expect((await state(page)).released).toBe(3);
  await place(page,0,-26);
  // Look at the actual pile (y=.8, z=-29.6) through the DOM reticle with the current camera.
  // A hard-coded pitch .3 belongs to the old 3.2m-high camera and now points above the pile.
  await page.evaluate(()=>{const s=(window as any).titans.state();const pitch=Math.atan2(s.framing.height-.8,s.framing.distance+3.6)+Math.atan((1-2*s.framing.aimTop)*Math.tan(s.fov/2));(window as any).titans.view(Math.PI,pitch);});
  await expect.poll(async()=>(await state(page)).arsenal).toBe(true);
});

test('camera comparisons and short recording: ordinary hits, target fall, restored round', async ({browser},testInfo) => {
  mkdirSync('reports/screenshots',{recursive:true});mkdirSync('reports/recordings',{recursive:true});
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:'reports/recordings',size:{width:1280,height:720}}});
  const page=await context.newPage();await ready(page);await enter(page);await aim(page,4,6);
  await page.screenshot({path:'reports/screenshots/05-pc-base.png'});
  await page.keyboard.press('Escape');await page.selectOption('#camera-mode','closer',{force:true});await page.waitForTimeout(300);await enter(page);await aim(page,4,6);
  await page.screenshot({path:'reports/screenshots/06-pc-closer.png'});
  await release(page);await page.waitForTimeout(900);expect((await state(page)).shots[0].position.y).toBeGreaterThan(5);
  await page.screenshot({path:'reports/screenshots/07-normal-shot.png'});
  await expect.poll(async()=>(await state(page)).hp['4,6']).toBe(1);await page.waitForTimeout(300);
  await page.screenshot({path:'reports/screenshots/08-cracked.png'});
  await release(page);await expect.poll(async()=>(await state(page)).phase).toBe('falling');
  expect((await state(page)).hp['4,6']).toBe(0);expect((await state(page)).shots).toEqual([]);
  await page.screenshot({path:'reports/screenshots/09-hole-and-fall.png'});
  await expect.poll(async()=>(await state(page)).round).toBe(2);
  expect((await state(page)).ammo).toBe(3);expect((await state(page)).hp['4,6']).toBe(2);
  await page.waitForTimeout(400);await page.screenshot({path:'reports/screenshots/10-round-reset.png'});
  const video=page.video()!;await context.close();await video.saveAs(testInfo.outputPath('pc-regression.webm'));await video.delete();
});
