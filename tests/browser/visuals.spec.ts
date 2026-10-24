import {test,expect} from '@playwright/test';
import {state} from './helpers';

/** Tiny uncompressed GLB fixture, generated in memory. No downloaded art or production model. */
function triangleGLB(){
  const binary=Buffer.alloc(36);[0,0,0,0,2,0,1,0,0].forEach((v,i)=>binary.writeFloatLE(v,i*4));
  const json=JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},mode:4}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,2,0]}]});
  const text=Buffer.from(json.padEnd(Math.ceil(Buffer.byteLength(json)/4)*4,' ')),head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(28+text.length+binary.length,8);head.writeUInt32LE(text.length,12);head.writeUInt32LE(0x4e4f534a,16);const chunk=Buffer.alloc(8);chunk.writeUInt32LE(36,0);chunk.writeUInt32LE(0x004e4942,4);return Buffer.concat([head,text,chunk,binary]);
}
test('GLB presentation loads fixture, preserves game geometry and retains fallback after failed replacement',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/fixtures/actor.glb',route=>route.fulfill({contentType:'model/gltf-binary',body:triangleGLB()}));
  await page.route('**/fixtures/unavailable.glb',route=>route.fulfill({status:404,body:'unavailable'}));
  await page.goto('/?test');await expect.poll(async()=>(await state(page))?.ready).toBe(true);await expect.poll(async()=>(await state(page)).visuals.map((v:any)=>v.status)).toEqual(['loaded','loaded','placeholder']);const before=await state(page);
  const load=async(url:string|null)=>page.evaluate(async url=>(window as any).titans.loadVisualAssets({characters:[url?{url}:null,null],environment:url?{url}:null}),url);
  await load('/fixtures/actor.glb');expect((await state(page)).visuals.map((v:any)=>v.status)).toEqual(['loaded','placeholder','loaded']);const loaded=await state(page);expect(loaded.visuals[0].placeholderEnabled).toBe(false);expect(loaded.visuals[0].importedMeshes).toBeGreaterThan(0);expect(loaded.visuals[0].interactiveMeshes).toBe(0);expect(loaded.tiles).toBe(before.tiles);expect(loaded.pos).toEqual(before.pos);expect(loaded.hp).toEqual(before.hp);expect(loaded.selected).toEqual(before.selected);expect(loaded.standardCameraInputs).toEqual([]);
  await load('/fixtures/unavailable.glb');expect((await state(page)).visuals.map((v:any)=>v.status)).toEqual(['error','placeholder','error']);expect((await state(page)).visuals[0].placeholderEnabled).toBe(true);expect((await state(page)).visuals[0].importedMeshes).toBe(0);expect((await state(page)).selected).toEqual(before.selected);expect((await state(page)).pos).toEqual(before.pos);expect((await state(page)).ammo).toBe(3);
  await load(null);expect((await state(page)).visuals.map((v:any)=>v.status)).toEqual(['placeholder','placeholder','placeholder']);expect(errors).toEqual([]);
});
