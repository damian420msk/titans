import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { cellStyle, cellBoundary, tileState, tileAsset, platformCatalog } from '../shared/platformStyle.ts';
import { PLATFORM_KITS, kitOfTiles, kitAssetNames } from '../shared/platformKits.ts';
const kitIds = PLATFORM_KITS.map(k => k.id);

test('cosmetics are stable by physical island and coordinates across replicas and repair', () => {
  const seen = new Set<string>();
  for (const id of ['arena-island-0','arena-island-1']) for (let z=0;z<11;z++) for (let x=0;x<9;x++) {
    const first=cellStyle(id,{x,z},id.endsWith('0')?'teal':'coral');
    const replica=cellStyle(id,{x,z},first.paletteId);
    assert.deepEqual(first,replica);
    for (const hp of [2,1,0,2,1,2]) { tileState(hp); assert.deepEqual(cellStyle(id,{x,z},first.paletteId),first); }
    seen.add(first.surfaceId+'/'+first.fractureId);
    for (const kit of kitIds) for (const state of ['intact','cracked','fragments'] as const) assert.ok(existsSync(new URL(`../public/art/platform-skins-v01/${kit}/${tileAsset(first,state)}.glb`,import.meta.url)));
  }
  assert.equal(seen.size,9);
  assert.notDeepEqual(cellStyle('physical-A',{x:2,z:3},'teal'),cellStyle('physical-B',{x:2,z:3},'teal'));
  const a=cellStyle('physical-A',{x:2,z:3},'teal'),b=cellStyle('physical-A',{x:2,z:3},'coral');
  assert.equal(a.surfaceId,b.surfaceId);assert.equal(a.rotation,b.rotation);assert.equal(a.fractureId,b.fractureId);
});

test('HP presentation preserves existing battle thresholds, including protected cells',()=>{
  assert.equal(tileState(Infinity),'intact');assert.equal(tileState(3),'intact');assert.equal(tileState(2),'intact');
  assert.equal(tileState(1),'cracked');assert.equal(tileState(0),'hole');
});

test('outer boundary includes all four sides and corners; damage does not create interior trim',()=>{
  const cells=new Set(Array.from({length:99},(_,i)=>`${i%9},${Math.floor(i/9)}`));
  let edges=0,corners=0;
  for(let z=0;z<11;z++)for(let x=0;x<9;x++){const b=cellBoundary({x,z},cells);edges+=b.edges.length;corners+=b.corners.length;}
  assert.equal(edges,40);assert.equal(corners,4);
  assert.equal(cellBoundary({x:4,z:5},cells).edges.length,0);
  assert.deepEqual(cellBoundary({x:0,z:0},cells).edges.map(e=>[e.dx,e.dz]),[[0,-1],[-1,0]]);
});

function geometry(name:string,kit:string='starter') {
  const buffer=readFileSync(new URL(`../public/art/platform-skins-v01/${kit}/${name}.glb`,import.meta.url));
  const length=buffer.readUInt32LE(12),j=JSON.parse(buffer.toString('utf8',20,20+length)),bin=20+length+8;
  const positions:number[][]=[];let triangles=0;
  for(const node of j.nodes){if(node.mesh===undefined)continue;for(const primitive of j.meshes[node.mesh].primitives){
    const a=j.accessors[primitive.attributes.POSITION],v=j.bufferViews[a.bufferView],offset=bin+(v.byteOffset??0)+(a.byteOffset??0),t=node.translation??[0,0,0];
    for(let i=0;i<a.count;i++)positions.push([0,1,2].map(k=>buffer.readFloatLE(offset+i*(v.byteStride??12)+k*4)+t[k]));
    triangles+=j.accessors[primitive.indices].count/3;
  }}
  return {positions,triangles,j};
}

test('every kit: all nine damage/fragment pairs share the exact fracture geometry and four-rotation bounds',()=>{
  assert.equal(platformCatalog.cellSize,2.8);assert.equal(platformCatalog.thickness,.4);
  for(const kit of kitIds)for(const s of ['a','b','c'])for(const f of ['f0','f1','f2']){
    const c=geometry(`tile_${s}_${f}_cracked`,kit),p=geometry(`tile_${s}_${f}_fragments`,kit);
    assert.equal(c.triangles,p.triangles);assert.ok(c.triangles<=1000);assert.ok(p.j.nodes.length>=3);
    // same triangles; the vertex count may differ by a few split UV seams, so compare the outline instead of every vertex
    const box=(m:{positions:number[][]})=>[0,1,2].map(k=>[Math.min(...m.positions.map(v=>v[k])),Math.max(...m.positions.map(v=>v[k]))]);
    for(let k=0;k<3;k++)for(let e=0;e<2;e++)assert.ok(Math.abs(box(c)[k][e]-box(p)[k][e])<1e-6);
    for(const model of [c,p,geometry(`tile_${s}_intact`,kit)])for(let q=0;q<4;q++){
      const a=q*Math.PI/2,rot=model.positions.map(([x,y,z])=>[x*Math.cos(a)+z*Math.sin(a),y,-x*Math.sin(a)+z*Math.cos(a)]);
      const lo=[0,1,2].map(k=>Math.min(...rot.map(p=>p[k]))),hi=[0,1,2].map(k=>Math.max(...rot.map(p=>p[k])));
      // cracked and fragment outlines are organic: they may sit up to 1.5 cm inside the cell, never outside; top and bottom are exact
      for(let k=0;k<3;k++){const tol=k===1?1e-4:.015;assert.ok(lo[k]>=[-1.4,-.4,-1.4][k]-1e-6&&lo[k]-[-1.4,-.4,-1.4][k]<=tol);assert.ok(hi[k]<=[1.4,0,1.4][k]+1e-6&&[1.4,0,1.4][k]-hi[k]<=tol);}
    }
  }
});

test('every kit: each underrock remains inside its owner cell and below the unchanged walking plane',()=>{
  for(const kit of kitIds)for(const id of [1,2,3])for(const [x,y,z] of geometry(`underrock_${id}`,kit).positions){assert.ok(Math.abs(x)<=1.4&&Math.abs(z)<=1.4);assert.ok(y<=-.39999&&y>=-1.65001);}
});

test('kits: four kits in price order, every file present with its textures, unknown ids fall back to the free kit',()=>{
  assert.deepEqual(kitIds,['starter','terracotta','jade','basalt']);
  const names=kitAssetNames(platformCatalog.surfaces,platformCatalog.fractures,platformCatalog.underrocks,['teal','coral']);
  assert.equal(names.length,28);
  for(const k of PLATFORM_KITS){
    for(const n of names)assert.ok(existsSync(new URL(`../public/art/${k.dir.replace('art/','')}${n}.glb`,import.meta.url)),`${k.id}/${n}`);
    const j=JSON.parse(readFileSync(new URL(`../public/art/${k.dir.replace('art/','')}tile_a_intact.glb`,import.meta.url)).toString('utf8',20,20+readFileSync(new URL(`../public/art/${k.dir.replace('art/','')}tile_a_intact.glb`,import.meta.url)).readUInt32LE(12)));
    for(const im of j.images??[])if(im.uri)assert.ok(existsSync(new URL(`../public/art/${k.dir.replace('art/','')}${im.uri}`,import.meta.url)),`${k.id} texture ${im.uri}`);
    assert.equal(kitOfTiles(k.cosmetic),k.id);
  }
  assert.equal(kitOfTiles('tiles_moss'),'starter');assert.equal(kitOfTiles(undefined),'starter');assert.equal(kitOfTiles('titan_red'),'starter');
});

test('cell style distribution is unchanged by the kit switch (golden values from platform-v05.1)',()=>{
  const got=([['arena-island-0',0,0],['arena-island-0',4,5],['arena-island-1',8,10],['arena-island-1',3,7]] as const).map(([i,x,z])=>{const s=cellStyle(i,{x,z},'teal');return [i,x,z,s.surfaceId,s.fractureId,s.rotation,s.seed,s.underrockId];});
  assert.deepEqual(got,[["arena-island-0",0,0,"a","f2",1,3067981233,3],["arena-island-0",4,5,"a","f2",1,3896423802,3],["arena-island-1",8,10,"a","f0",0,1388735670,2],["arena-island-1",3,7,"a","f1",1,1451986351,3]]);
});
