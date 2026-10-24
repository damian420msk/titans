import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { state, centre } from './helpers';
import { send, touchFire, assertScreenPick } from './mobile-helpers';

async function open(page:Page){await page.goto('/');await expect.poll(async()=>(await state(page))?.ready).toBe(true);expect((await state(page)).input.touchLayout).toBe('zones');}
const roles=async(p:Page)=>(await state(p)).input.gestures.map((f:any)=>f.role);
async function cancelToLook(page:Page,cdp:CDPSession,id=10){
  const attack=await centre(page,'#primary');await send(cdp,'touchStart',[{...attack,id}]);await expect.poll(async()=>(await state(page)).primary).not.toBeNull();
  // Small relative correction remains a preparation, even outside the small button.
  await send(cdp,'touchMove',[{x:attack.x+7,y:attack.y+3,id}]);expect((await state(page)).primary).not.toBeNull();
  const cancel=await centre(page,'#cancel-zone'),ammo=(await state(page)).ammo;
  const before=await state(page),yaw=before.yaw;await send(cdp,'touchMove',[{...cancel,id}]);const after=await state(page);expect(after.primary).toBeNull();expect(await roles(page)).toContain('look');
  // Framing can change yaw by microradians while preserving the world aim point.
  // A no-jump assertion therefore compares the world point, not bitwise camera angles.
  expect(Math.hypot(after.intersection.x-before.intersection.x,after.intersection.z-before.intersection.z)).toBeLessThan(.005);
  await send(cdp,'touchMove',[{x:cancel.x+12,y:cancel.y,id}]);await expect.poll(async()=>(await state(page)).yaw).toBeGreaterThan(yaw+.02);
  await send(cdp,'touchMove',[{...attack,id}]);expect((await state(page)).primary).toBeNull();await send(cdp,'touchEnd',[]);expect((await state(page)).ammo).toBe(ammo);
}

for(const dpr of [1,3])test(`free zones DPR ${dpr}: arbitrary starts, safe bounds, fixed roles, simultaneous fingers, no idle drift`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:dpr}),page=await context.newPage();await open(page);const cdp=await context.newCDPSession(page);
  await expect(page.locator('#look-stick')).toBeHidden();await expect(page.locator('#stick')).toBeHidden();await expect(page.locator('#zones-tip')).toBeVisible();await assertScreenPick(page);
  for(const start of [{x:2,y:120},{x:180,y:185},{x:345,y:370}]){
    const before=await state(page);await send(cdp,'touchStart',[{...start,id:1}]);await expect(page.locator('#stick')).toBeVisible();const r=(await page.locator('#stick').boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(8);expect(r.y).toBeGreaterThanOrEqual(8);expect(r.y+r.height).toBeLessThanOrEqual(382.1);expect((await state(page)).pos.x).toBeCloseTo(before.pos.x,4);
    await send(cdp,'touchMove',[{x:start.x+25,y:start.y,id:1}]);await page.waitForTimeout(140);await send(cdp,'touchEnd',[]);expect((await state(page)).pos.x).toBeGreaterThan(before.pos.x+.15);expect((await state(page)).yaw).toBe(before.yaw);await expect(page.locator('#stick')).toBeHidden();
  }
  for(const start of [{x:480,y:110},{x:625,y:260},{x:820,y:370}]){
    const before=await state(page);await send(cdp,'touchStart',[{...start,id:6}]);await send(cdp,'touchMove',[{x:start.x+6,y:start.y,id:6}]);await expect.poll(async()=>(await state(page)).yaw).toBeGreaterThan(before.yaw+.01);const yaw=(await state(page)).yaw;await page.waitForTimeout(100);expect((await state(page)).yaw).toBeCloseTo(yaw,6);await send(cdp,'touchEnd',[]);expect((await state(page)).pos).toEqual(before.pos);
  }
  const before=await state(page),l={x:370,y:220,id:2},r={x:510,y:210,id:3};await send(cdp,'touchStart',[l,r]);await send(cdp,'touchMove',[{...l,x:480},{...r,x:530}]);await page.waitForTimeout(180);expect((await state(page)).pos.x).toBeGreaterThan(before.pos.x+.4);expect((await state(page)).yaw).toBeGreaterThan(before.yaw+.04);expect(await roles(page)).toEqual(['stick','look']);
  const yaw=(await state(page)).yaw;await page.waitForTimeout(180);expect((await state(page)).yaw).toBeCloseTo(yaw,6);
  await send(cdp,'touchMove',[{...l,x:480},{...r,x:390}]);expect(await roles(page)).toEqual(['stick','look']);await send(cdp,'touchEnd',[]);const stopped=await state(page);await page.waitForTimeout(200);expect((await state(page)).pos).toEqual(stopped.pos);expect((await state(page)).yaw).toEqual(stopped.yaw);
  expect((await state(page)).released).toBe(0);await context.close();
});

test('free zones: HUD exclusion, persisted alternative, cancellation/relative handoff, orientation and pointercancel',async({browser})=>{
  const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true}),page=await context.newPage();await open(page);const cdp=await context.newCDPSession(page),before=await state(page);
  await page.locator('#settings summary').tap();await page.selectOption('#touch-layout','joysticks');await page.locator('#settings summary').tap();await expect(page.locator('#look-stick')).toBeVisible();await page.reload();await expect.poll(async()=>(await state(page))?.input.touchLayout).toBe('joysticks');
  await page.selectOption('#touch-layout','zones',{force:true});await page.reload();await expect.poll(async()=>(await state(page))?.input.touchLayout).toBe('zones');await expect(page.locator('#zones-tip')).toBeHidden();
  await page.locator('#open-modes').tap();await page.locator('#join-code').fill('NOT_A_ROOM');await page.locator('#close-modes').tap();expect((await state(page)).pos).toEqual(before.pos);expect((await state(page)).released).toBe(0);expect(await roles(page)).toEqual([]);
  // Ordinary look may slide across attack without starting it.
  const attack=await centre(page,'#primary');await send(cdp,'touchStart',[{x:550,y:190,id:8}]);await send(cdp,'touchMove',[{...attack,id:8}]);expect((await state(page)).primary).toBeNull();await send(cdp,'touchEnd',[]);
  // Restore view through actual relative input so the target is valid.
  await page.reload();await expect.poll(async()=>(await state(page))?.ready).toBe(true);await cancelToLook(page,cdp);
  await page.reload();await expect.poll(async()=>(await state(page))?.ready).toBe(true);const a=await centre(page,'#primary');await send(cdp,'touchStart',[{...a,id:20}]);await send(cdp,'touchCancel',[]);expect((await state(page)).ammo).toBe(3);expect(await roles(page)).toEqual([]);
  await send(cdp,'touchStart',[{...a,id:22}]);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await send(cdp,'touchEnd',[]);expect((await state(page)).ammo).toBe(3);expect(await roles(page)).toEqual([]);
  await send(cdp,'touchStart',[{...a,id:23}]);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(0);await page.evaluate(()=>{delete (document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await send(cdp,'touchStart',[{...a,id:24}]);await page.selectOption('#touch-layout','joysticks',{force:true});await send(cdp,'touchEnd',[]);expect((await state(page)).ammo).toBe(3);expect(await roles(page)).toEqual([]);await page.selectOption('#touch-layout','zones',{force:true});
  await send(cdp,'touchStart',[{...a,id:21}]);await page.setViewportSize({width:390,height:844});await expect(page.locator('#portrait')).toBeVisible();await send(cdp,'touchEnd',[]);expect((await state(page)).ammo).toBe(3);expect((await state(page)).released).toBe(0);await page.setViewportSize({width:844,height:390});await expect(page.locator('#portrait')).toBeHidden();expect(await roles(page)).toEqual([]);await context.close();
});

test('free zones recording: movement + look, attack correction, same-pointer cancellation, new throw and refill',async({browser},info)=>{
  test.setTimeout(45000);mkdirSync('reports/screenshots',{recursive:true});const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:2,recordVideo:{dir:info.outputPath('video'),size:{width:844,height:390}}}),page=await context.newPage();await open(page);const cdp=await context.newCDPSession(page);
  const l={x:140,y:280,id:1},r={x:550,y:230,id:2};await send(cdp,'touchStart',[l,r]);await send(cdp,'touchMove',[{...l,y:260},{...r,x:560}]);await page.waitForTimeout(260);await page.screenshot({path:'reports/screenshots/input002-01-zones.png'});await send(cdp,'touchEnd',[]);
  const attack=await centre(page,'#primary');await send(cdp,'touchStart',[{...attack,id:3}]);await page.waitForTimeout(250);await page.screenshot({path:'reports/screenshots/input002-02-prepare.png'});const cancel=await centre(page,'#cancel-zone');await send(cdp,'touchMove',[{...cancel,id:3}]);await page.screenshot({path:'reports/screenshots/input002-03-handoff.png'});await send(cdp,'touchMove',[{x:cancel.x+12,y:cancel.y,id:3}]);await send(cdp,'touchEnd',[]);expect((await state(page)).ammo).toBe(3);await touchFire(page,cdp);await expect.poll(async()=>(await state(page)).ammo).toBe(2);await expect.poll(async()=>(await state(page)).cooldown).toBe(0);
  // Restore yaw through real relative input, then walk backwards with a bypass of R.
  const s=await state(page),view={x:560,y:160,id:40};await send(cdp,'touchStart',[view]);await send(cdp,'touchMove',[{...view,x:view.x-s.yaw/.003,y:view.y+(.2-s.pitch)/.002}]);await send(cdp,'touchEnd',[]);
  const move=async(x:number,y:number,id:number,reached:()=>Promise<number>,threshold:number)=>{const p={x:160,y:230,id};await send(cdp,'touchStart',[p]);await send(cdp,'touchMove',[{...p,x:p.x+x,y:p.y+y}]);try{await expect.poll(reached,{timeout:8000,intervals:[40]}).toBeLessThan(threshold);}finally{await send(cdp,'touchEnd',[]);}};
  // Stop the same actual gesture on position feedback, rather than assuming a wall-clock
  // duration always advances the local capped visual/simulation timestep at software-GPU speed.
  await move(-38,0,4,async()=>(await state(page)).pos.x,-2.7);await move(0,38,5,async()=>(await state(page)).pos.z,-31.8);
  await expect.poll(async()=>(await state(page)).arsenal).toBe(true);
  const b=await centre(page,'#primary');await send(cdp,'touchStart',[{...b,id:6}]);await expect.poll(async()=>(await state(page)).primary).toBe('refill');await send(cdp,'touchMove',[{...await centre(page,'#cancel-zone'),id:6}]);await send(cdp,'touchEnd',[]);expect((await state(page)).ammo).toBe(2);
  await send(cdp,'touchStart',[{...b,id:7}]);await expect.poll(async()=>(await state(page)).ammo).toBe(3);await send(cdp,'touchEnd',[]);expect((await state(page)).released).toBe(1);
  const video=page.video()!;await context.close();await video.saveAs('reports/recordings/input002-free-zones.webm');
});
