import { test, expect } from '@playwright/test';
import { state, centre } from './helpers';
import { openGame, send, assertScreenPick, steerCell, steerWorld, touchFire, renderedLayout } from './mobile-helpers';
import { mkdirSync } from 'node:fs';

for(const dpr of [1,2,3])test(`DOM crosshair agrees with physical cell polygons at DPR ${dpr}, quality changes and offset canvas`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:dpr,isMobile:true,hasTouch:true});
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openGame(page);
  expect((await state(page)).paused).toBe(false);expect((await state(page)).selected).not.toBeNull();
  for(const quality of ['auto','clear','fast']){
    await page.selectOption('#quality',quality,{force:true});await renderedLayout(page);const s=await assertScreenPick(page);
    expect(s.screen.quality).toBe(quality);expect(s.screen.render.width).toBeGreaterThan(0);
    expect(s.screen.render.width*s.screen.render.height).toBeLessThanOrEqual(quality==='auto'?1_800_000:quality==='clear'?3_000_000:800_000);
    expect(s.screen.effectiveRatio).toBeLessThanOrEqual(quality==='auto'?1.5:quality==='clear'?2:1);
  }
  await page.addStyleTag({content:'#game{position:absolute;left:32px;top:16px;width:calc(100% - 64px);height:calc(100% - 48px)}'});
  await renderedLayout(page);expect((await state(page)).screen.canvas.left).toBe(32);await assertScreenPick(page);
  const cdp=await context.newCDPSession(page),button=await centre(page,'#primary'),locked=(await state(page)).selected;
  await send(cdp,'touchStart',[{...button,id:9}]);
  for(let i=0;i<6;i++){await page.waitForTimeout(40);await assertScreenPick(page);expect((await state(page)).selected).toEqual(locked);}
  const look=await centre(page,'#look-stick');await send(cdp,'touchMove',[{...look,id:9}]);await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(0);
  await page.setViewportSize({width:1920,height:1080});await renderedLayout(page);const capped=await assertScreenPick(page);
  expect(capped.screen.scaling).toBeGreaterThan(1);expect(capped.screen.render.width*capped.screen.render.height).toBeLessThanOrEqual(800000);
  expect(errors).toEqual([]);await context.close();
});

test('front, rear and extreme cells are chosen by real joystick input; out of field has no target',async({browser})=>{
  test.setTimeout(90000);
  const context=await browser.newContext({viewport:{width:812,height:375},deviceScaleFactor:3,isMobile:true,hasTouch:true});const page=await context.newPage();await openGame(page);const cdp=await context.newCDPSession(page);
  for(const [x,z] of [[4,10],[4,0],[0,6],[8,6],[1,1]])await steerCell(page,cdp,x,z);
  const c=await centre(page,'#look-stick');await send(cdp,'touchStart',[{...c,id:5}]);await send(cdp,'touchMove',[{x:c.x+35,y:c.y,id:5}]);await page.waitForTimeout(1000);await send(cdp,'touchEnd',[]);
  await assertScreenPick(page);expect((await state(page)).selected).toBeNull();
  await touchFire(page,cdp);expect((await state(page)).ammo).toBe(3);await context.close();
});

test('portrait is a real pause; rotation, browser-height changes and fullscreen rejection preserve the round',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const page=await context.newPage();await openGame(page);const cdp=await context.newCDPSession(page);
  await expect(page.locator('#portrait')).toBeVisible();expect((await state(page)).paused).toBe(true);
  await page.screenshot({path:'reports/screenshots/16-mobile-portrait.png'});
  const before=await state(page);await page.touchscreen.tap(200,500);await page.waitForTimeout(150);expect((await state(page)).ammo).toBe(before.ammo);expect((await state(page)).pos).toEqual(before.pos);
  await page.setViewportSize({width:844,height:390});await expect.poll(async()=>(await state(page)).paused).toBe(false);await assertScreenPick(page);
  let c=await centre(page,'#primary');await send(cdp,'touchStart',[{...c,id:1}]);await page.waitForTimeout(240);
  expect((await state(page)).primary).toBe('shot');
  await page.setViewportSize({width:390,height:844});await expect.poll(async()=>(await state(page)).paused).toBe(true);await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(0);
  await page.setViewportSize({width:844,height:390});await expect.poll(async()=>(await state(page)).paused).toBe(false);await touchFire(page,cdp);
  await page.setViewportSize({width:390,height:844});await expect.poll(async()=>(await state(page)).paused).toBe(true);const frozen=await state(page);
  expect(frozen.shots).toHaveLength(1);await page.waitForTimeout(350);expect((await state(page)).shots[0].elapsed).toBe(frozen.shots[0].elapsed);expect((await state(page)).ammo).toBe(2);
  for(const dimensions of [{width:844,height:330},{width:360,height:760},{width:760,height:360},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(dimensions);await expect.poll(async()=>(await state(page)).paused).toBe(dimensions.height>=dimensions.width);await assertScreenPick(page);
    const s=await state(page);expect(s.screen.canvas.width).toBeCloseTo(dimensions.width);expect(s.screen.canvas.height).toBeCloseTo(dimensions.height);expect(s.released).toBe(1);
  }
  await page.evaluate(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new Error('test denied'));});
  await page.locator('#settings summary').click();await page.locator('#fullscreen').click();await expect(page.locator('#fullscreen-status')).toContainText('отклонён');expect((await state(page)).paused).toBe(false);
  await page.locator('#settings summary').click();await expect.poll(async()=>(await state(page)).hp['4,6']).toBe(1);await context.close();
});

test('diagnostics can be opened and dismissed at small landscape height without blocking the menu',async({browser})=>{
  const context=await browser.newContext({viewport:{width:667,height:300},deviceScaleFactor:3,isMobile:true,hasTouch:true});const page=await context.newPage();await openGame(page);
  await expect(page.locator('#diagnostics')).toBeHidden();await page.locator('#settings summary').click();await page.locator('#show-diagnostics').check();await page.locator('#settings summary').click();
  await expect(page.locator('#diagnostics')).toContainText('Framebuffer');await page.locator('#settings summary').click();await page.locator('#show-diagnostics').uncheck();await page.locator('#settings summary').click();await expect(page.locator('#diagnostics')).toBeHidden();
  expect((await state(page)).screen.canvas.width).toBe(667);expect((await state(page)).screen.canvas.height).toBe(300);await context.close();
});

test('two rate sticks, attack correction, continuous same-pointer cancellation, new throw and destruction (video)',async({browser},testInfo)=>{
  test.setTimeout(60000);mkdirSync('reports/recordings',{recursive:true});
  const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true,recordVideo:{dir:'reports/recordings',size:{width:844,height:390}}});
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await openGame(page);const cdp=await context.newCDPSession(page);
  const l=await centre(page,'#stick'),r=await centre(page,'#look-stick');
  await page.screenshot({path:'reports/screenshots/13-mobile-overview.png'});
  const initial=await state(page);await send(cdp,'touchStart',[{...l,id:1},{...r,id:2}]);
  await send(cdp,'touchMove',[{x:l.x,y:l.y-25,id:1},{x:r.x+13,y:r.y+3,id:2}]);await page.waitForTimeout(300);await send(cdp,'touchEnd',[]);
  const moved=await state(page);expect(Math.hypot(moved.pos.x-initial.pos.x,moved.pos.z-initial.pos.z)).toBeGreaterThan(.7);expect(moved.yaw).toBeGreaterThan(.025);
  await page.waitForTimeout(220);expect((await state(page)).yaw).toBe(moved.yaw);expect((await state(page)).pos).toEqual(moved.pos);
  await send(cdp,'touchStart',[{x:r.x+2,y:r.y+1,id:3}]);await page.waitForTimeout(200);await send(cdp,'touchEnd',[]);expect((await state(page)).yaw).toBe(moved.yaw);
  await steerCell(page,cdp,3,5);
  let button=await centre(page,'#primary');await send(cdp,'touchStart',[{...button,id:8}]);const target=(await state(page)).selected;
  for(let i=0;i<7;i++){await page.waitForTimeout(40);expect((await state(page)).selected).toEqual(target);await assertScreenPick(page);}
  expect((await state(page)).framing.height).toBeCloseTo(10.5);expect((await state(page)).framing.distance).toBeCloseTo(9.4);
  await page.screenshot({path:'reports/screenshots/14-mobile-preparing.png'});
  const prepared=await state(page);await send(cdp,'touchMove',[{x:button.x+8,y:button.y-4,id:8}]);expect((await state(page)).yaw).toBeGreaterThan(prepared.yaw+.015);
  const rect=await page.locator('#look-stick').boundingBox();
  await send(cdp,'touchMove',[{x:r.x,y:rect!.y+10,id:8}]);
  const handoff=await state(page);expect(handoff.primary).toBeNull();expect(handoff.released).toBe(0);expect(handoff.ammo).toBe(3);expect(handoff.input.handoffs).toBe(1);
  expect(handoff.input.gestures).toHaveLength(1);expect(handoff.input.gestures[0].role).toBe('aimStick');expect(handoff.input.gestures[0].id).toBe(prepared.input.gestures[0].id);
  expect(await page.evaluate(id=>document.getElementById('primary')!.hasPointerCapture(id),handoff.input.gestures[0].id)).toBe(true);
  const hit=handoff.intersection;await page.waitForTimeout(240);const stationary=await state(page);expect(Math.hypot(stationary.intersection.x-hit.x,stationary.intersection.z-hit.z)).toBeLessThan(.01);
  await page.screenshot({path:'reports/screenshots/15-mobile-handoff.png'});
  await send(cdp,'touchMove',[{x:r.x+18,y:rect!.y+10,id:8}]);
  // Video/software rendering can take longer than 180ms between input updates.
  // Keep the same angular criterion and wait for the actual processed joystick frames.
  await expect.poll(async()=>(await state(page)).yaw,{timeout:1500,intervals:[50]}).toBeGreaterThan(stationary.yaw+.04);
  await send(cdp,'touchMove',[{...button,id:8}]);await page.waitForTimeout(60);await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(0);expect((await state(page)).ammo).toBe(3);
  await steerCell(page,cdp,3,5);
  for(let i=0;i<3;i++){button=await centre(page,'#primary');await send(cdp,'touchStart',[{...button,id:10+i}]);await send(cdp,'touchMove',[{...r,id:10+i}]);await send(cdp,'touchEnd',[]);}
  expect((await state(page)).ammo).toBe(3);
  await touchFire(page,cdp);expect((await state(page)).released).toBe(1);expect((await state(page)).ammo).toBe(2);await expect.poll(async()=>(await state(page)).hp['3,5']).toBe(1);
  await page.screenshot({path:'reports/screenshots/17-mobile-cracked.png'});
  await assertScreenPick(page);await touchFire(page,cdp);await expect.poll(async()=>(await state(page)).hp['3,5']).toBe(0);
  await assertScreenPick(page);expect((await state(page)).round).toBe(1);await page.screenshot({path:'reports/screenshots/18-mobile-hole.png'});
  expect(errors).toEqual([]);const video=page.video()!;await context.close();await video.saveAs(testInfo.outputPath('mobile-handoff-throw.webm'));await video.delete();
});

test('real mobile round and arsenal loop without state setters, cancellation of refill and release stays safe',async({browser})=>{
  test.setTimeout(90000);const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true});const page=await context.newPage();await openGame(page);const cdp=await context.newCDPSession(page);
  await touchFire(page,cdp);await expect.poll(async()=>(await state(page)).hp['4,6']).toBe(1);await touchFire(page,cdp);await expect.poll(async()=>(await state(page)).phase).toBe('falling');await expect.poll(async()=>(await state(page)).round).toBe(2);
  expect((await state(page)).ammo).toBe(3);expect((await state(page)).hp['4,6']).toBe(2);
  for(const [x,z] of [[2,5],[3,5],[5,5]]){await steerCell(page,cdp,x,z);await touchFire(page,cdp);await expect.poll(async()=>(await state(page)).cooldown).toBe(0);}
  expect((await state(page)).ammo).toBe(0);
  const r=await centre(page,'#look-stick');await send(cdp,'touchStart',[{...r,id:6}]);
  for(let i=0;i<50;i++){const yaw=(await state(page)).yaw;if(yaw>=Math.PI-.025)break;await send(cdp,'touchMove',[{x:r.x+Math.min(35,Math.max(6,(Math.PI-yaw)*35)),y:r.y,id:6}]);await page.waitForTimeout(60);}
  await send(cdp,'touchEnd',[]);const l=await centre(page,'#stick');await send(cdp,'touchStart',[{...l,id:7}]);await send(cdp,'touchMove',[{x:l.x,y:l.y-35,id:7}]);
  await expect.poll(async()=>(await state(page)).pos.z,{timeout:5000}).toBeLessThan(-26);await send(cdp,'touchEnd',[]);
  await steerWorld(page,cdp,{x:0,y:.8,z:-29.6});await expect.poll(async()=>(await state(page)).arsenal).toBe(true);
  let b=await centre(page,'#primary');await send(cdp,'touchStart',[{...b,id:8}]);expect((await state(page)).primary).toBe('refill');await expect.poll(async()=>(await state(page)).ammo).toBe(1);
  await send(cdp,'touchMove',[{...r,id:8}]);await send(cdp,'touchEnd',[]);expect((await state(page)).primary).toBeNull();expect((await state(page)).released).toBe(5);
  b=await centre(page,'#primary');await send(cdp,'touchStart',[{...b,id:9}]);await expect.poll(async()=>(await state(page)).ammo).toBe(3);await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(5);
  await context.close();
});

test('touch cancellation, page hiding, mode change, dead zone and vertical limit leave no drift or shot',async({browser})=>{
  const context=await browser.newContext({viewport:{width:740,height:340},deviceScaleFactor:2,isMobile:true,hasTouch:true});const page=await context.newPage();await openGame(page);const cdp=await context.newCDPSession(page);
  let b=await centre(page,'#primary');await send(cdp,'touchStart',[{...b,id:1}]);await send(cdp,'touchCancel',[]);expect((await state(page)).released).toBe(0);expect((await state(page)).input.busy).toBe(false);
  await send(cdp,'touchStart',[{...b,id:2}]);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(0);
  await send(cdp,'touchStart',[{...b,id:3}]);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(0);expect((await state(page)).primary).toBeNull();
  await page.evaluate(()=>{delete (document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
  b=await centre(page,'#primary');await send(cdp,'touchStart',[{...b,id:4}]);await page.selectOption('#input-mode','desktop',{force:true});await send(cdp,'touchEnd',[]);
  expect((await state(page)).released).toBe(0);expect((await state(page)).ammo).toBe(3);expect((await state(page)).input.effective).toBe('desktop');
  await page.selectOption('#input-mode','touch',{force:true});const position=(await state(page)).pos;const r=await centre(page,'#look-stick');await send(cdp,'touchStart',[{...r,id:5}]);await send(cdp,'touchMove',[{x:r.x,y:r.y+35,id:5}]);
  await page.waitForTimeout(1200);await send(cdp,'touchEnd',[]);const capped=await state(page);expect(capped.pitch).toBeCloseTo(1.10);expect(capped.pos).toEqual(position);await page.waitForTimeout(200);expect((await state(page)).pitch).toBe(capped.pitch);
  await context.close();
});
