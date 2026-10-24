// Run after browser tests, without another GPU workload. Same viewport/DPR/quality as baseline.
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chromium',args:['--use-angle=swiftshader','--enable-webgl']});
const results=[];const phase=process.argv[2]??'after';
try{
  for(const [name,viewport,dpr] of [['pc',{width:1280,height:720},1],['mobile',{width:844,height:390},2]]){
    const context=await browser.newContext({viewport,deviceScaleFactor:dpr,isMobile:name==='mobile',hasTouch:name==='mobile'});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:5173/');
    await page.waitForFunction(()=>window.titans?.state().floorVisuals.readyTemplates===9&&window.titans?.state().visuals.slice(0,2).every(v=>v.status==='loaded'));
    if(name==='pc')await page.locator('#capture').click();else await page.waitForTimeout(4600);
    const result=await page.evaluate(async()=>{
      const samples=[];for(let i=0;i<45;i++){await new Promise(requestAnimationFrame);const s=window.titans.state();samples.push({frame:s.frameMs,...s.renderStats});}
      const s=window.titans.state();return {render:s.screen.render,quality:s.screen.quality,ratio:s.screen.effectiveRatio,camera:s.camera,fov:s.fov,pitch:s.pitch,framing:s.framing,selected:s.selected,samples};
    });results.push({name,viewport,dpr,...result,errors});await page.screenshot({path:`reports/screenshots/env006-${phase}-${name}.png`});await context.close();
  }
  writeFileSync(`reports/env006-${phase}-metrics.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
