import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { cellStyle, cellBoundary, tileState, tileAsset, platformCatalog } from '../shared/platformStyle.ts';

test('cosmetics are stable by physical island and coordinates across replicas and repair', () => {
  const seen = new Set<string>();
  for (const id of ['arena-island-0','arena-island-1']) for (let z=0;z<11;z++) for (let x=0;x<9;x++) {
    const first=cellStyle(id,{x,z},id.endsWith('0')?'teal':'coral');
    const replica=cellStyle(id,{x,z},first.paletteId);
    assert.deepEqual(first,replica);
    for (const hp of [2,1,0,2,1,2]) { tileState(hp); assert.deepEqual(cellStyle(id,{x,z},first.paletteId),first); }
    seen.add(first.surfaceId+'/'+first.fractureId);
    for (const state of ['intact','cracked','fragments'] as const) assert.ok(existsSync(new URL(`../public/art/platform-v05/${tileAsset(first,state)}.glb`,import.meta.url)));
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

function geometry(name:string) {
  const buffer=readFileSync(new URL(`../public/art/platform-v05/${name}.glb`,import.meta.url));
  const length=buffer.readUInt32LE(12),j=JSON.parse(buffer.toString('utf8',20,20+length)),bin=20+length+8;
  const positions:number[][]=[];let triangles=0;
  for(const node of j.nodes){if(node.mesh===undefined)continue;for(const primitive of j.meshes[node.mesh].primitives){
    const a=j.accessors[primitive.attributes.POSITION],v=j.bufferViews[a.bufferView],offset=bin+(v.byteOffset??0)+(a.byteOffset??0),t=node.translation??[0,0,0];
    for(let i=0;i<a.count;i++)positions.push([0,1,2].map(k=>buffer.readFloatLE(offset+i*(v.byteStride??12)+k*4)+t[k]));
    triangles+=j.accessors[primitive.indices].count/3;
  }}
  return {positions,triangles,j};
}

test('all nine damage/fragment pairs share the exact fracture geometry and four-rotation bounds',()=>{
  assert.equal(platformCatalog.cellSize,2.8);assert.equal(platformCatalog.thickness,.4);
  for(const s of ['a','b','c'])for(const f of ['f0','f1','f2']){
    const c=geometry(`tile_${s}_${f}_cracked`),p=geometry(`tile_${s}_${f}_fragments`);
    assert.equal(c.triangles,p.triangles);assert.ok(c.triangles<=1000);assert.ok(p.j.nodes.length>=3);
    assert.equal(c.positions.length,p.positions.length);
    for(let i=0;i<c.positions.length;i++)for(let k=0;k<3;k++)assert.ok(Math.abs(c.positions[i][k]-p.positions[i][k])<1e-6);
    for(const model of [c,p,geometry(`tile_${s}_intact`)])for(let q=0;q<4;q++){
      const a=q*Math.PI/2,rot=model.positions.map(([x,y,z])=>[x*Math.cos(a)+z*Math.sin(a),y,-x*Math.sin(a)+z*Math.cos(a)]);
      const lo=[0,1,2].map(k=>Math.min(...rot.map(p=>p[k]))),hi=[0,1,2].map(k=>Math.max(...rot.map(p=>p[k])));
      for(let k=0;k<3;k++){assert.ok(Math.abs(lo[k]-[-1.4,-.4,-1.4][k])<1e-6);assert.ok(Math.abs(hi[k]-[1.4,0,1.4][k])<1e-6);}
    }
  }
});

test('each underrock remains inside its owner cell and below the unchanged walking plane',()=>{
  for(const id of [1,2,3])for(const [x,y,z] of geometry(`underrock_${id}`).positions){assert.ok(Math.abs(x)<=1.4&&Math.abs(z)<=1.4);assert.ok(y<=-.39999&&y>=-1.65001);}
});
