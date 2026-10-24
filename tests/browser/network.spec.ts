import {test,expect,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {state,centre} from './helpers';
import {send,touchFire,openGame,project} from './mobile-helpers';
import {cellCentre,size,map} from '../../shared/world';
import {spawn,type ChildProcess} from 'node:child_process';

async function create(p:Page){await p.locator('#open-modes').click();await p.locator('#create-room').click();await expect.poll(async()=>(await state(p)).network?.raw?.players&&Object.keys((await state(p)).network.raw.players).length).toBe(1);return await p.locator('#room-code').innerText();}
async function join(p:Page,code:string){await p.locator('#open-modes').click();await p.locator('#join-code').fill(code);await p.locator('#join-room').click();await expect.poll(async()=>(await state(p)).network?.raw&&Object.keys((await state(p)).network.raw.players).length).toBe(2);}
async function playing(p:Page){await expect.poll(async()=>(await state(p))?.network?.status,{timeout:10000}).toBe('playing');await expect.poll(async()=>(await state(p)).input.blocked).toBe(false);}
async function screenPick(p:Page,side:0|1){
  const s=await state(p),mark=await centre(p,'#reticle');let expected=null;
  for(const c of map.cells){const w=cellCentre(c,side),h=size/2,poly=[[-h,-h],[h,-h],[h,h],[-h,h]].map(([x,z])=>project(s,{x:w.x+x,z:w.z+z}));if(poly.some(v=>v.w<=0))continue;const signs=poly.map((a,i)=>{const b=poly[(i+1)%4];return(b.x-a.x)*(mark.y-a.y)-(b.y-a.y)*(mark.x-a.x);});if(signs.every(v=>v>=0)||signs.every(v=>v<=0)){expected={x:c.x,z:c.z};break;}}
  expect(s.selected).toEqual(expected);expect(expected).not.toBeNull();
}

for(const layout of ['joysticks','zones'] as const)test('two independent rendered clients: '+layout+' controls, private aim, portrait, mutual destruction, reload reconnect',async({browser},info)=>{
  test.setTimeout(90000);mkdirSync('reports/screenshots',{recursive:true});
  const aContext=await browser.newContext({viewport:{width:1280,height:720},hasTouch:true,deviceScaleFactor:1.5,recordVideo:{dir:info.outputPath('video'),size:{width:1280,height:720}}});
  const bContext=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:3});
  const a=await aContext.newPage(),b=await bContext.newPage(),errors:string[]=[];for(const p of[a,b])p.on('pageerror',e=>errors.push(e.message));
  try{
    await openGame(a,layout);await openGame(b,layout);for(const p of[a,b])await p.selectOption('#input-mode','touch',{force:true});
    const code=await create(a);await join(b,code);await a.locator('#ready-room').click();await b.locator('#ready-room').click();await playing(a);await playing(b);
    await expect.poll(async()=>(await state(a)).floorVisuals.readyTemplates).toBe(9);await expect.poll(async()=>(await state(b)).floorVisuals.readyTemplates).toBe(9);const appearance=(s:any)=>s.floorVisuals.tiles.map((t:any)=>({side:t.side,x:t.x,z:t.z,variant:t.variant,rotation:t.rotation}));const initialAppearance=appearance(await state(a));expect(appearance(await state(b))).toEqual(initialAppearance);expect((await state(a)).floorVisuals.seed).toBe((await state(b)).floorVisuals.seed);expect((await state(a)).localSide).toBe(0);expect((await state(b)).localSide).toBe(1);await screenPick(a,1);await screenPick(b,0);
    const ca=await aContext.newCDPSession(a),cb=await bContext.newCDPSession(b);
    // World motion from both clients, then return to the same initial cell using actual joysticks.
    for(const[p,cdp,other]of[[a,ca,b],[b,cb,a]] as const){const c=layout==='zones'?{x:140,y:220}:await centre(p,'#stick'),before=(await state(p)).pos.x;await send(cdp,'touchStart',[{...c,id:10}]);await send(cdp,'touchMove',[{x:c.x+38,y:c.y,id:10}]);await p.waitForTimeout(220);await send(cdp,'touchEnd',[]);await expect.poll(async()=>Math.abs((await state(other)).enemy.pos.x-before)).toBeGreaterThan(.2);await send(cdp,'touchStart',[{...c,id:11}]);await send(cdp,'touchMove',[{x:c.x-38,y:c.y,id:11}]);await p.waitForTimeout(220);await send(cdp,'touchEnd',[]);}
    await a.bringToFront();await a.screenshot({timeout:15000,path:layout==='zones'?'reports/screenshots/input002-net-a.png':'reports/screenshots/net-01-client-a.png'});await b.bringToFront();await b.screenshot({timeout:15000,path:layout==='zones'?'reports/screenshots/input002-net-b.png':'reports/screenshots/net-02-client-b.png'});
    // Preparing is local: no target or pitch is published, no stone spent by cancellation.
    const attack=await centre(b,'#primary');await send(cb,'touchStart',[{...attack,id:21}]);await b.waitForTimeout(250);expect((await state(b)).primary).toBe('shot');expect((await state(a)).network.raw.shots).toEqual({});
    await expect(b.locator(layout==='zones'?'#cancel-zone':'#look-stick')).toBeVisible();const look=await centre(b,layout==='zones'?'#cancel-zone':'#look-stick');await send(cb,'touchMove',[{...look,id:21}]);await send(cb,'touchEnd',[]);await b.waitForTimeout(150);expect((await state(b)).ammo).toBe(3);
    // One client's portrait screen cannot pause the common server.
    await b.setViewportSize({width:390,height:844});await expect(b.locator('#portrait')).toBeVisible();const tick=(await state(a)).network.raw.tick;await a.waitForTimeout(250);expect((await state(a)).network.raw.tick).toBeGreaterThan(tick);expect((await state(a)).network.status).toBe('playing');await b.setViewportSize({width:844,height:390});await playing(b);
    // No aim()/place(): initial reticle selects the opponent's actual spawn cell.
    expect((await state(a)).selected).toEqual({x:4,z:6});expect((await state(b)).selected).toEqual({x:4,z:6});
    await touchFire(a,ca);await touchFire(b,cb);await expect.poll(async()=>(await state(a)).hp['4,6']).toBe(1);await expect.poll(async()=>(await state(b)).hp['4,6']).toBe(1);expect((await state(a)).ammo).toBe(2);expect((await state(b)).ammo).toBe(2);
    await a.screenshot({path:'reports/screenshots/net-03-mutual-damage.png'});
    await touchFire(a,ca);await touchFire(b,cb);await expect.poll(async()=>(await state(a)).phase).toBe('falling');await expect.poll(async()=>(await state(b)).phase).toBe('falling');
    await expect.poll(async()=>(await state(a)).floorVisuals.emitted).toBeGreaterThan(0);await expect.poll(async()=>(await state(b)).floorVisuals.emitted).toBe((await state(a)).floorVisuals.emitted);await a.screenshot({path:'reports/screenshots/net-04-shared-fall.png'});await expect.poll(async()=>(await state(a)).round).toBe(2);await expect.poll(async()=>(await state(b)).round).toBe(2);expect((await state(a)).ammo).toBe(3);expect((await state(b)).ammo).toBe(3);
    await b.bringToFront();await b.reload();await expect.poll(async()=>(await state(b))?.ready,{timeout:30000}).toBe(true);await playing(b);await playing(a);expect((await state(b)).localSide).toBe(1);expect((await state(b)).round).toBe(2);expect(appearance(await state(a))).toEqual(initialAppearance);expect(appearance(await state(b))).toEqual(initialAppearance);const emitted=(await state(b)).floorVisuals.emitted;await b.waitForTimeout(200);expect((await state(b)).floorVisuals.emitted).toBe(emitted);await a.screenshot({path:'reports/screenshots/net-05-restored-round.png'});expect(errors).toEqual([]);
  }finally{const video=a.video();await aContext.close();await bContext.close();if(video)await video.saveAs('reports/recordings/net001-duel.webm');}
});

test('invalid room has a readable retry and local training remains available',async({page})=>{await openGame(page);await page.locator('#open-modes').click();await page.locator('#join-code').fill('NOT_A_ROOM');await page.locator('#join-room').click();await expect(page.locator('#network-error')).toContainText(/не найдена|недоступен|закрыта/);await expect(page.locator('#join-room')).toBeEnabled();await page.locator('#local-training').click();expect((await state(page)).network.enabled).toBe(false);});

test('actually stopped backend: proxy error, retry after restart, no localhost in phone endpoint',async({page})=>{
  test.setTimeout(30000);const env={...process.env,TITANS_SERVER_PORT:'2570'};let backend:ChildProcess|undefined;
  const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5175','--strictPort'],{env,stdio:'ignore'});
  const waitURL=async(url:string)=>{for(let i=0;i<100;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,60));}throw Error(`Unavailable ${url}`);};
  try{
    await waitURL('http://127.0.0.1:5175');await page.goto('http://127.0.0.1:5175/');await expect.poll(async()=>(await state(page))?.ready).toBe(true);
    await page.locator('#open-modes').click();await page.locator('#create-room').click();await expect(page.locator('#network-error')).toContainText('Сервер недоступен');await expect(page.locator('#create-room')).toBeEnabled();
    backend=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{env,stdio:'ignore'});await waitURL('http://127.0.0.1:2570/health');await page.locator('#create-room').click();await expect.poll(async()=>(await state(page)).network.raw?.players&&Object.keys((await state(page)).network.raw.players).length).toBe(1);
    expect((await state(page)).network.status).toBe('waiting');await page.locator('#local-training').click();
  }finally{backend?.kill();vite.kill();}
});

test('desktop network input: entry click, WASD, free mouse, Escape, cancellation and release',async({browser})=>{
  const ca=await browser.newContext({viewport:{width:1280,height:720}}),cb=await browser.newContext({viewport:{width:1000,height:600}}),a=await ca.newPage(),b=await cb.newPage();
  // Deliberately reduce rendered frames to about 15 Hz. Movement still sends elapsed fixed input steps.
  await ca.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(()=>{setTimeout(()=>callback(performance.now()),50);});});
  try{
    await openGame(a);await openGame(b);const code=await create(a);await join(b,code);await a.locator('#ready-room').click();await b.locator('#ready-room').click();await playing(a);await playing(b);
    await a.bringToFront();const cursor=await centre(a,'#capture');await a.locator('#capture').click();await expect.poll(async()=>(await state(a)).input.locked).toBe(true);expect((await state(a)).released).toBe(0);
    const x=(await state(a)).pos.x;await a.keyboard.down('KeyD');await a.waitForTimeout(1000);await a.keyboard.up('KeyD');await a.waitForTimeout(200);const distance=(await state(a)).pos.x-x;expect(distance).toBeGreaterThan(4);expect(distance).toBeLessThan(5.8);await expect.poll(async()=>(await state(b)).enemy.pos.x-x).toBeGreaterThan(4);
    await a.keyboard.down('KeyA');await a.waitForTimeout(1000);await a.keyboard.up('KeyA');await a.waitForTimeout(200);
    const yaw=(await state(a)).yaw;await a.mouse.move(cursor.x+10,cursor.y);await expect.poll(async()=>Math.abs((await state(a)).yaw-yaw)).toBeGreaterThan(.01);
    await a.keyboard.press('Escape');await expect.poll(async()=>(await state(a)).input.locked).toBe(false);await a.locator('#capture').click();await expect.poll(async()=>(await state(a)).input.locked).toBe(true);expect((await state(a)).ammo).toBe(3);
    await a.mouse.down();await a.mouse.down({button:'right'});await a.mouse.up({button:'right'});await a.mouse.up();await a.waitForTimeout(150);expect((await state(a)).ammo).toBe(3);
    expect((await state(a)).selected).not.toBeNull();await a.mouse.down();await a.mouse.up();await expect.poll(async()=>(await state(a)).ammo).toBe(2);await expect.poll(async()=>(await state(b)).released).toBe(1);
  }finally{await ca.close();await cb.close();}
});

