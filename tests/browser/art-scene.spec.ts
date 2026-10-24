import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {state,ready,enter} from './helpers';
import {project,renderedLayout} from './mobile-helpers';

test('ART-005 actual renderer: comparable heights and camera angles, PC and mobile',async({browser})=>{
  test.setTimeout(120000);const results:any[]=[];
  for(const [name,viewport,dpr] of [['pc',{width:1280,height:720},1],['mobile',{width:844,height:390},2]] as const){
    const context=await browser.newContext({viewport,deviceScaleFactor:dpr,isMobile:name==='mobile',hasTouch:name==='mobile'}),page=await context.newPage();
    await ready(page);await expect.poll(async()=>(await state(page)).visuals[1].status).toBe('loaded');await expect.poll(async()=>(await state(page)).floorVisuals.readyTemplates).toBe(9);
    if(name==='pc')await enter(page);else await page.waitForTimeout(4600);
    for(const degrees of [35,42,48]){
      await page.selectOption('#camera-mode',`art${degrees}`,{force:true});
      await page.waitForTimeout(250);await page.evaluate(degrees=>(window as any).titans.view(0,degrees*Math.PI/180),degrees);await renderedLayout(page);
      const s=await state(page),ownFoot=project(s,{...s.pos,y:0}),ownHead=project(s,{...s.pos,y:3.2}),enemyFoot=project(s,{...s.enemy.pos,y:0}),enemyHead=project(s,{...s.enemy.pos,y:3.2});
      results.push({name,degrees,camera:s.camera,fov:s.fov,ownHeight:(ownFoot.y-ownHead.y)/viewport.height,enemyHeight:(enemyFoot.y-enemyHead.y)/viewport.height,ownFoot,ownHead,enemyFoot,enemyHead});
      if(degrees===35){expect((ownFoot.y-ownHead.y)/viewport.height).toBeGreaterThan(.18);expect((ownFoot.y-ownHead.y)/viewport.height).toBeLessThan(.26);expect((enemyFoot.y-enemyHead.y)/viewport.height).toBeGreaterThan(.05);expect(enemyHead.y).toBeGreaterThan(0);expect(ownFoot.y).toBeLessThan(viewport.height);}
      await page.screenshot({path:`reports/screenshots/art005-${name}-camera-${degrees}.png`});
    }
    await page.selectOption('#camera-mode','art35',{force:true});await page.waitForTimeout(250);await page.evaluate(()=>(window as any).titans.view(0,35*Math.PI/180));
    for(const height of [2.8,3.2,3.6]){
      await page.evaluate(async height=>(window as any).titans.loadVisualAssets({characters:['teal','coral'].map(color=>({url:`/art/titans-v02/titan_${color}_v02.glb`,visualHeight:height,nativeHeight:3.2})),environment:null}),height);await renderedLayout(page);
      expect((await state(page)).visuals[0].visualHeight).toBe(height);await page.screenshot({path:`reports/screenshots/art005-${name}-height-${height}.png`});
    }
    // Same world, no changes to support, hitbox, battle rules or camera distance for the height comparison.
    await page.evaluate(async()=>(window as any).titans.loadVisualAssets({characters:['teal','coral'].map(color=>({url:`/art/titans-v02/titan_${color}_v02.glb`,visualHeight:3.2,nativeHeight:3.2})),environment:null}));
    await page.screenshot({path:`reports/screenshots/art005-after-${name}.png`});
    // Back/side/near-edge framing, with the actual player anchor and render camera.
    for(const [label,x,z,yaw] of [['arsenal',-2.8,-32.4,0],['left-edge',-11.7,-15.6,0],['right-edge',11.7,-15.6,0],['side',0,-15.6,Math.PI/2]] as const){
      await page.evaluate(([x,z,yaw])=>{(window as any).titans.place(x,z);(window as any).titans.view(yaw,35*Math.PI/180);},[x,z,yaw]);await renderedLayout(page);await page.screenshot({path:`reports/screenshots/art005-${name}-${label}.png`});
    }
    await context.close();
  }
  writeFileSync('reports/art005-camera-comparison.json',JSON.stringify(results,null,2));
});

test('ART-005 real skinned animation, ordinary shot dedup, cancellation and character fallback',async({page})=>{
  await ready(page);await expect.poll(async()=>(await state(page)).visuals[0].status).toBe('loaded');await enter(page);
  const initial=await state(page);expect(initial.visuals[0]).toMatchObject({visualHeight:3.2,bones:16,materials:1,vertices:8026,triangles:15456});expect(initial.visuals[1].triangles).toBe(14696);expect(initial.visuals[0].clips).toEqual(['idle','walk','throw']);
  const inspect=()=>page.evaluate(()=>(window as any).titans.inspectVisuals()[0]);
  const idleA=await inspect();await page.waitForTimeout(180);expect(await inspect()).not.toEqual(idleA);
  await page.keyboard.down('KeyD');await page.waitForTimeout(250);const walkA=await inspect();expect((await state(page)).visuals[0].walkWeight).toBeGreaterThan(.4);await page.waitForTimeout(160);expect(await inspect()).not.toEqual(walkA);await page.keyboard.up('KeyD');
  await page.evaluate(()=>(window as any).titans.place(0,-15.6));await page.evaluate(pitch=>(window as any).titans.view(0,pitch),initial.pitch);await renderedLayout(page);
  await page.mouse.down();await page.waitForTimeout(260);const prepared=await inspect();expect((await state(page)).visuals[0].pose).toBe('prepare');await page.screenshot({path:'reports/screenshots/art005-pc-preparing.png'});
  await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.up();expect((await state(page)).ammo).toBe(3);expect((await state(page)).released).toBe(0);
  await page.mouse.down();await page.waitForTimeout(260);await page.mouse.up();await expect.poll(async()=>(await state(page)).visuals[0].throws).toBe(1);expect((await state(page)).released).toBe(1);expect((await state(page)).ammo).toBe(2);expect(await inspect()).not.toEqual(prepared);await expect.poll(async()=>(await state(page)).hp['4,6']).toBe(1);expect((await state(page)).visuals[0].throws).toBe(1);
  await page.route('**/titan_teal_v02.glb',r=>r.fulfill({status:404,body:'ART-005 fallback test'}));await page.reload();await expect.poll(async()=>(await state(page))?.visuals[0].status).toBe('error');await expect.poll(async()=>(await state(page)).visuals[1].status).toBe('loaded');const fallback=await state(page);expect(fallback.visuals[0].placeholderEnabled).toBe(true);expect(fallback.visuals[1].status).toBe('loaded');expect(fallback.selected).toEqual({x:4,z:6});expect(fallback.ammo).toBe(3);
});
