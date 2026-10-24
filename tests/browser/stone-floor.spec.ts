import {test,expect,type Page} from '@playwright/test';
import {state,ready,enter,aim,place,release} from './helpers';
import {spawn as playerSpawn} from '../../shared/world';
const floor=(p:Page)=>state(p).then(s=>s.floorVisuals);
const appearance=(f:any)=>f.tiles.map((t:any)=>({side:t.side,x:t.x,z:t.z,variant:t.variant,rotation:t.rotation}));
async function refill(page:Page){await expect.poll(async()=>(await state(page)).cooldown).toBe(0);await place(page,-2.8,-32.4);await expect.poll(async()=>(await state(page)).arsenal).toBe(true);await page.mouse.down();await expect.poll(async()=>(await state(page)).ammo).toBe(3);await page.mouse.up();await place(page,playerSpawn.x,playerSpawn.z);}

test('A/B/C real floor, bounds/shared catalogue, cracks, 3/4/5 falling fragments, dedup and restored appearance (video)',async({browser},info)=>{
  test.setTimeout(80000);const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:info.outputPath('video'),size:{width:1280,height:720}}}),page=await context.newPage();
  const requests:Record<string,number>={};page.on('request',r=>{if(r.url().includes('/art/blocks-abc-v03/')&&r.url().endsWith('.glb'))requests[r.url()]=(requests[r.url()]??0)+1;});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await ready(page);await expect.poll(async()=>(await floor(page)).readyTemplates).toBe(9);await enter(page);const original=await floor(page),startAppearance=appearance(original);expect(original.materialCount).toBe(12);expect(Object.keys(requests)).toHaveLength(9);expect(Object.values(requests)).toEqual(Array(9).fill(1));
    for(const bounds of Object.values(original.bounds) as any[]){expect(bounds.min[0]).toBeCloseTo(-1.4,4);expect(bounds.min[1]).toBeCloseTo(-.4,4);expect(bounds.min[2]).toBeCloseTo(-1.4,4);expect(bounds.max[0]).toBeCloseTo(1.4,4);expect(bounds.max[1]).toBeCloseTo(0,4);expect(bounds.max[2]).toBeCloseTo(1.4,4);}
    const cells=['A','B','C'].map(variant=>original.tiles.find((t:any)=>t.side===1&&t.variant===variant&&t.z>=8&&t.z<=10));expect(cells.every(Boolean)).toBe(true);
    for(let i=0;i<cells.length;i++){
      const cell=cells[i];if((await state(page)).ammo<2)await refill(page);
      await aim(page,cell.x,cell.z);await page.screenshot({path:`reports/screenshots/art003-${cell.variant}-intact.png`});await release(page);await expect.poll(async()=>(await state(page)).hp[`${cell.x},${cell.z}`]).toBe(1);
      let visual=(await floor(page)).tiles.find((t:any)=>t.side===1&&t.x===cell.x&&t.z===cell.z);expect(visual).toMatchObject({variant:cell.variant,rotation:cell.rotation,kind:'cracked',model:true});await page.screenshot({path:`reports/screenshots/art003-${cell.variant}-cracked.png`});
      await release(page);await expect.poll(async()=>{const s=await state(page),effect=s.floorVisuals.activeBursts.find((b:any)=>b.id.endsWith(`/1/${cell.z}/${cell.x}/destroy`));return {hp:s.hp[`${cell.x},${cell.z}`],parts:effect?.parts};},{intervals:[50]}).toEqual({hp:0,parts:3+i});await page.screenshot({path:`reports/screenshots/art003-${cell.variant}-debris.png`});
      await expect.poll(async()=>(await floor(page)).activeBursts,{timeout:2000}).toEqual([]);expect((await floor(page)).emitted).toBe(i+1);await expect.poll(async()=>(await state(page)).cooldown).toBe(0);
    }
    await refill(page);await aim(page,4,6);await release(page);await expect.poll(async()=>(await state(page)).hp['4,6']).toBe(1);await release(page);await expect.poll(async()=>(await state(page)).phase).toBe('falling');await expect.poll(async()=>(await state(page)).round).toBe(2);expect((await floor(page)).activeBursts).toEqual([]);expect(appearance(await floor(page))).toEqual(startAppearance);const emitted=(await floor(page)).emitted;await page.waitForTimeout(200);expect((await floor(page)).emitted).toBe(emitted);await page.screenshot({path:'reports/screenshots/art003-restored.png'});expect(Object.values(requests)).toEqual(Array(9).fill(1));expect(errors).toEqual([]);
  }finally{const video=page.video()!;await context.close();await video.saveAs('reports/recordings/art003-abc-destruction.webm');}
});

test('one failed GLB uses procedural fallback, a hole remains targetable and page reload needs no art state setters',async({page})=>{
  await page.route('**/tile_c_cracked.glb',route=>route.fulfill({status:404,body:'missing test asset'}));await ready(page);await enter(page);await expect.poll(async()=>Object.keys((await floor(page)).failures).length).toBe(1);const cell=(await floor(page)).tiles.find((t:any)=>t.side===1&&t.variant==='C'&&t.z>=8);expect(cell).toBeDefined();await aim(page,cell.x,cell.z);await release(page);await expect.poll(async()=>(await state(page)).hp[`${cell.x},${cell.z}`]).toBe(1);expect((await floor(page)).tiles.find((t:any)=>t.side===1&&t.x===cell.x&&t.z===cell.z).model).toBe(false);await release(page);await expect.poll(async()=>(await state(page)).hp[`${cell.x},${cell.z}`]).toBe(0);await aim(page,cell.x,cell.z);expect((await state(page)).selected).toEqual({x:cell.x,z:cell.z});
});
