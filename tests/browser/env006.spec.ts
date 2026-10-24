import {test,expect,type Page} from '@playwright/test';
import {state,ready,enter,aim,release,centre} from './helpers';
import {assertScreenPick,renderedLayout,send,touchFire} from './mobile-helpers';
import {cellCentre} from '../../shared/world';

const visible=(s:any,side:number,x:number,z:number)=>s.foundationVisuals.cells.find((c:any)=>c.side===side&&c.x===x&&c.z===z).visible;
async function loaded(page:Page){await expect.poll(async()=>(await state(page))?.floorVisuals.readyTemplates).toBe(9);}
async function playing(page:Page){await expect.poll(async()=>(await state(page))?.network?.status,{timeout:20000}).toBe('playing');await expect.poll(async()=>(await state(page)).input.blocked).toBe(false);}

test('ENV-006 independent foundations, sealed seams, ordinary destruction and clear through-hole rays',async({page})=>{
  await ready(page);await loaded(page);await enter(page);const s=await state(page),f=s.foundationVisuals;
  expect(f).toMatchObject({instances:198,active:198,geometryCount:1,materialCount:1,interactive:0});expect(f.bounds.min[0]).toBeCloseTo(-1.4,5);expect(f.bounds.max[0]).toBeCloseTo(1.4,5);expect(f.bounds.min[1]).toBeCloseTo(-1.65,5);expect(f.bounds.max[1]).toBeCloseTo(-.4,5);
  const seam=await page.evaluate(()=>(window as any).titans.inspectFoundationRays([{x:1.3995,z:-15.6},{x:1.4,z:-15.6},{x:1.4005,z:-15.6}]));expect(seam.every((p:any)=>p.hit&&Math.abs(p.y+.4)<.001)).toBe(true);
  const target={x:2,z:8},p=cellCentre(target,1);await aim(page,target.x,target.z);await release(page);await expect.poll(async()=>(await state(page)).hp['2,8']).toBe(1);expect(visible(await state(page),1,2,8)).toBe(true);
  await release(page);await expect.poll(async()=>(await state(page)).hp['2,8']).toBe(0);expect(visible(await state(page),1,2,8)).toBe(false);expect((await state(page)).foundationVisuals.active).toBe(197);
  const rays=await page.evaluate(p=>(window as any).titans.inspectFoundationRays([{...p},{x:p.x-1.35,z:p.z-1.35},{x:p.x+1.35,z:p.z+1.35},{x:p.x+2.8,z:p.z}]),p);
  expect(rays.slice(0,3).every((p:any)=>!p.hit)).toBe(true);expect(rays[3].hit).toBe(true);await assertScreenPick(page);
  await page.screenshot({path:'reports/screenshots/env006-hole-far.png'});
});

test('ENV-006 reticle is 24 percent and real projected cells agree at desktop/mobile DPR and offset canvas',async({browser})=>{
  for(const [width,height,dpr] of [[1280,720,1],[844,390,2],[740,340,3]]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:dpr>1,isMobile:dpr>1}),page=await context.newPage();await ready(page);await loaded(page);
    const s=await assertScreenPick(page),mark=await centre(page,'#reticle');expect(mark.y/height).toBeCloseTo(.24,3);expect(s.selected).toEqual({x:4,z:6});expect(s.cameraMode).toBe('env');
    if(dpr>1){const cdp=await context.newCDPSession(page),a=await centre(page,'#primary');await send(cdp,'touchStart',[{...a,id:5}]);await page.waitForTimeout(350);await assertScreenPick(page);expect((await state(page)).selected).toEqual(s.selected);await send(cdp,'touchCancel',[]);expect((await state(page)).ammo).toBe(3);}
    await page.addStyleTag({content:'#game{position:absolute;left:19px;top:11px;width:calc(100% - 38px);height:calc(100% - 22px)}'});await renderedLayout(page);await assertScreenPick(page);await context.close();
  }
});

test('ENV-006 two real sides: native aiming, hole survives reload, walking into it falls and restores all foundations (video)',async({browser},info)=>{
  test.setTimeout(120000);
  const ac=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true,recordVideo:{dir:info.outputPath('video'),size:{width:844,height:390}}}),bc=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const a=await ac.newPage(),b=await bc.newPage(),errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
  try{
    await ready(a);await ready(b);await loaded(a);await loaded(b);await a.locator('#open-modes').click();await a.locator('#create-room').click();await expect.poll(async()=>(await state(a)).network.status).toBe('waiting');const code=await a.locator('#room-code').innerText();await b.locator('#open-modes').click();await b.locator('#join-code').fill(code);await b.locator('#join-room').click();await expect.poll(async()=>(await state(b)).network.status).toBe('waiting');await a.locator('#ready-room').click();await b.locator('#ready-room').click();await playing(a);await playing(b);
    await assertScreenPick(a,1);await assertScreenPick(b,0);expect((await centre(a,'#reticle')).y/390).toBeCloseTo(.24,3);expect((await centre(b,'#reticle')).y/390).toBeCloseTo(.24,3);
    const ca=await ac.newCDPSession(a);await send(ca,'touchStart',[{x:620,y:210,id:1}]);await send(ca,'touchMove',[{x:665,y:210,id:1}]);await send(ca,'touchEnd',[]);await assertScreenPick(a,1);const target=(await state(a)).selected;expect(target).not.toBeNull();expect(target.x).not.toBe(4);
    await touchFire(a,ca);await expect.poll(async()=>(await state(a)).hp[`${target.x},${target.z}`]).toBe(1);await touchFire(a,ca);await expect.poll(async()=>(await state(a)).hp[`${target.x},${target.z}`]).toBe(0);
    await expect.poll(async()=>visible(await state(b),1,target.x,target.z)).toBe(false);expect((await state(a)).foundationVisuals.active).toBe(197);expect((await state(b)).foundationVisuals.active).toBe(197);
    await b.bringToFront();await b.reload();await expect.poll(async()=>(await state(b))?.ready,{timeout:30000}).toBe(true);await playing(a);await playing(b);await loaded(b);expect(visible(await state(b),1,target.x,target.z)).toBe(false);expect((await state(b)).foundationVisuals.active).toBe(197);await assertScreenPick(b,0);
    const cb=await bc.newCDPSession(b);await send(cb,'touchStart',[{x:620,y:180,id:2}]);await send(cb,'touchMove',[{x:620,y:230,id:2}]);await send(cb,'touchEnd',[]);await b.screenshot({path:'reports/screenshots/env006-hole-own.png'});await a.screenshot({path:'reports/screenshots/env006-net-a.png'});await b.screenshot({path:'reports/screenshots/env006-net-b.png'});
    // Its own hole is on world +X, at the spawn's row: side 1 moves left locally into it.
    await send(cb,'touchStart',[{x:150,y:245,id:3}]);await send(cb,'touchMove',[{x:105,y:245,id:3}]);await expect.poll(async()=>(await state(b)).phase,{timeout:6000,intervals:[80]}).toBe('falling');await send(cb,'touchEnd',[]);await b.screenshot({path:'reports/screenshots/env006-fall.png'});
    await expect.poll(async()=>(await state(a)).round).toBe(2);await expect.poll(async()=>(await state(b)).round).toBe(2);expect((await state(a)).foundationVisuals.active).toBe(198);expect((await state(b)).foundationVisuals.active).toBe(198);expect((await state(b)).foundationVisuals.geometryCount).toBe(1);await b.screenshot({path:'reports/screenshots/env006-reset.png'});expect(errors).toEqual([]);
  }finally{const video=a.video();await ac.close();await bc.close();if(video)await video.saveAs('reports/recordings/env006-hole-reset.webm');}
});
