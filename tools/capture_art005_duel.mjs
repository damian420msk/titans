// Actual independent clients and native controls. Read-only diagnostics; no aim/place setters.
import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chromium',args:['--use-angle=swiftshader','--enable-webgl']});
const desktop=await browser.newContext({viewport:{width:1280,height:720}});
const mobile=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true,recordVideo:{dir:'test-results/art005-short-video',size:{width:844,height:390}}});
const a=await desktop.newPage(),b=await mobile.newPage(),errors=[];
const state=p=>p.evaluate(()=>window.titans?.state());
const centre=async(p,id)=>{await expect(p.locator(id)).toBeVisible();const r=await p.locator(id).boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};};
const cdp=await mobile.newCDPSession(b);
const touch=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
const check=async(p,f)=>expect.poll(async()=>f(await state(p)),{timeout:15000,intervals:[80]}).toBe(true);
let video;
try{
  for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));await p.goto('http://localhost:5173/');await check(p,s=>s?.ready&&s.visuals[0].status==='loaded'&&s.visuals[1].status==='loaded'&&s.floorVisuals.readyTemplates===9);}
  await b.selectOption('#touch-layout','zones',{force:true});
  await a.locator('#open-modes').click();await a.locator('#create-room').click();await check(a,s=>s.network.status==='waiting');const code=await a.locator('#room-code').innerText();
  await b.locator('#open-modes').click();await b.locator('#join-code').fill(code);await b.locator('#join-room').click();await check(b,s=>s.network.status==='waiting');
  await a.locator('#ready-room').click();await b.locator('#ready-room').click();await check(a,s=>s.network.status==='playing'&&!s.input.blocked);await check(b,s=>s.network.status==='playing'&&!s.input.blocked);
  const playingStart=Date.now();
  await a.bringToFront();await a.locator('#capture').click();await a.keyboard.down('KeyD');await a.waitForTimeout(250);await a.keyboard.up('KeyD');await a.keyboard.down('KeyA');await a.waitForTimeout(250);await a.keyboard.up('KeyA');
  await b.bringToFront();
  const left={x:150,y:235,id:1},look={x:620,y:225,id:2};await touch('touchStart',[left,look]);await touch('touchMove',[{...left,x:left.x+32},{...look,x:look.x+16}]);await b.waitForTimeout(250);await touch('touchMove',[{...left,x:left.x-32},look]);await b.waitForTimeout(250);await touch('touchEnd');
  await check(b,s=>s.selected?.x===4&&s.selected?.z===6);
  await a.screenshot({path:'reports/screenshots/art005-net-a.png'});await b.screenshot({path:'reports/screenshots/art005-net-b.png'});
  let attack=await centre(b,'#primary');await touch('touchStart',[{...attack,id:3}]);await b.waitForTimeout(450);await b.screenshot({path:'reports/screenshots/art005-mobile-preparing.png'});
  const cancel=await centre(b,'#cancel-zone');await touch('touchMove',[{...cancel,id:3}]);await b.screenshot({path:'reports/screenshots/art005-mobile-handoff.png'});await touch('touchMove',[{x:cancel.x+18,y:cancel.y,id:3}]);await touch('touchMove',[{...cancel,id:3}]);await touch('touchEnd');expect((await state(b)).ammo).toBe(3);expect((await state(b)).released).toBe(0);
  const fireMobile=async()=>{await b.bringToFront();attack=await centre(b,'#primary');await touch('touchStart',[{...attack,id:4}]);await b.waitForTimeout(450);await touch('touchEnd');};
  const fireDesktop=async()=>{await a.bringToFront();if(!(await state(a)).input.locked)await a.locator('#capture').click();await a.mouse.down();await a.mouse.up();};
  await fireMobile();await fireDesktop();await check(a,s=>s.hp['4,6']===1);await check(b,s=>s.hp['4,6']===1);
  await b.screenshot({path:'reports/screenshots/art005-net-mutual-cracks.png'});
  await check(a,s=>s.cooldown===0);await check(b,s=>s.cooldown===0);await fireMobile();await fireDesktop();
  await check(b,s=>s.phase==='falling');await b.screenshot({path:'reports/screenshots/art005-net-fall.png'});await check(a,s=>s.round===2);await check(b,s=>s.round===2);
  expect((await state(a)).ammo).toBe(3);expect((await state(b)).ammo).toBe(3);await b.bringToFront();await b.waitForTimeout(800);await b.screenshot({path:'reports/screenshots/art005-net-reset.png'});expect(errors).toEqual([]);
  writeFileSync('reports/art005-capture-duel.json',JSON.stringify({room:code,clients:['1280x720 DPR1 desktop','844x390 DPR2 touch zones'],activeSeconds:(Date.now()-playingStart)/1000,errors,localSideA:(await state(a)).localSide,localSideB:(await state(b)).localSide,round:2},null,2));
}finally{
  video=b.video();await desktop.close();await mobile.close();if(video)await video.saveAs('reports/recordings/art005-duel-short.webm');await browser.close();
}
