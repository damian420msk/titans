import { expect, type Page, type CDPSession } from '@playwright/test';
import { state, centre } from './helpers';
import { map, cellCentre, size } from '../../shared/world';
export type Touch = {x:number;y:number;id:number};
export const send = (cdp:CDPSession,type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',points:Touch[]) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
export const renderedLayout=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
export async function openGame(page:Page,layout:'zones'|'joysticks'='joysticks') { await page.goto('/'); await expect.poll(async()=>(await state(page))?.ready).toBe(true); await page.selectOption('#touch-layout',layout,{force:true}); }
export function project(s:any,p:{x:number;y?:number;z:number}) {
  const m=s.viewProjection,x=p.x,y=p.y??0,z=p.z;
  const w=x*m[3]+y*m[7]+z*m[11]+m[15];
  return {x:s.screen.canvas.left+(1+(x*m[0]+y*m[4]+z*m[8]+m[12])/w)*s.screen.canvas.width/2,
    y:s.screen.canvas.top+(1-(x*m[1]+y*m[5]+z*m[9]+m[13])/w)*s.screen.canvas.height/2,w};
}
/** Independent oracle: project all physical cell polygons, then find the polygon under the DOM crosshair.
 * Does not call picking, targetCell, aim(), or place(). Also includes holes and protected cells. */
export async function assertScreenPick(page:Page,targetSide:0|1=1) {
  const {s,mark}=await page.evaluate(()=>{const r=document.getElementById('reticle')!.getBoundingClientRect();return {s:(window as any).titans.state(),mark:{x:r.left+r.width/2,y:r.top+r.height/2}};});
  let expected:{x:number;z:number}|null=null;
  for(const c of map.cells){
    const p=cellCentre(c,targetSide),h=size/2;
    const corners=[[-h,-h],[h,-h],[h,h],[-h,h]].map(([x,z])=>project(s,{x:p.x+x,z:p.z+z}));
    if(corners.some(p=>p.w<=0))continue;
    const cross=corners.map((a,i)=>{const b=corners[(i+1)%4];return (b.x-a.x)*(mark.y-a.y)-(b.y-a.y)*(mark.x-a.x);});
    if(cross.every(v=>v>=0)||cross.every(v=>v<=0)){expected={x:c.x,z:c.z};break;}
  }
  if(JSON.stringify(s.selected)!==JSON.stringify(expected))console.log('screen-pick mismatch',JSON.stringify({selected:s.selected,expected,intersection:s.intersection,screen:s.screen,camera:s.camera,framing:s.framing,pitch:s.pitch}));
  expect(s.selected).toEqual(expected);
  if(s.intersection){const p=project(s,s.intersection);expect(Math.hypot(p.x-mark.x,p.y-mark.y)).toBeLessThan(.4);}
  return s;
}
/** Aim by actually operating the rate joystick, using screen-space feedback. No game state setters. */
export async function steerWorld(page:Page,cdp:CDPSession,p:{x:number;y?:number;z:number},id=25) {
  const c=await centre(page,'#look-stick'),r=await page.locator('#look-stick').boundingBox();const radius=r!.width*.32;
  await send(cdp,'touchStart',[{...c,id}]);
  let error=Infinity;
  for(let i=0;i<160;i++){
    const {s,mark}=await page.evaluate(()=>{const r=document.getElementById('reticle')!.getBoundingClientRect();return {s:(window as any).titans.state(),mark:{x:r.left+r.width/2,y:r.top+r.height/2}};});
    const projected=project(s,p);
    if(projected.w<=0)throw new Error('Steering target is behind the camera');
    const dx=projected.x-mark.x,dy=projected.y-mark.y;error=Math.hypot(dx,dy);
    if(error<.18)break;
    // The joystick has a radial dead zone. Two minimum per-axis commands combined
    // produced a much larger rate and oscillated under software-render frame jitter.
    // Keep the same <0.2 px acceptance, but converge one axis at a time near the point.
    const axis=(v:number)=>Math.abs(v)<.04?0:Math.sign(v)*Math.max(.12+1/radius,.12+.88*Math.sqrt(Math.min(1,Math.abs(v)/220)/3));
    const fine=error<4,x=fine&&Math.abs(dx)<Math.abs(dy)?0:axis(dx),y=fine&&Math.abs(dy)<=Math.abs(dx)?0:axis(dy);
    await send(cdp,'touchMove',[{x:c.x+x*radius,y:c.y+y*radius,id}]);
    // Every impulse must reach a rendered input update. A 40ms timeout can start and
    // centre the stick entirely between two software-rendered frames, doing nothing.
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
    await send(cdp,'touchMove',[{...c,id}]);
  }
  await send(cdp,'touchEnd',[]);
  if(error>=.2){const s=await state(page);console.log('steering debug',JSON.stringify({target:p,error,projected:project(s,p),mark:await centre(page,'#reticle'),selected:s.selected,yaw:s.yaw,pitch:s.pitch,framing:s.framing}));}
  expect(error).toBeLessThan(.2);
}
export async function steerCell(page:Page,cdp:CDPSession,x:number,z:number){await steerWorld(page,cdp,cellCentre({x,z},1));await assertScreenPick(page);expect((await state(page)).selected).toEqual({x,z});}
export async function touchFire(page:Page,cdp:CDPSession,id=40){const c=await centre(page,'#primary');await send(cdp,'touchStart',[{...c,id}]);await page.waitForTimeout(240);await send(cdp,'touchEnd',[]);}
