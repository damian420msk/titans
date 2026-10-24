import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client, type Room } from '@colyseus/sdk';
import { DuelState } from '../shared/net-schema.ts';
import { Simulation, cellKey } from '../shared/simulation.ts';
import { map, cellCentre } from '../shared/world.ts';
import { validCommand } from '../shared/protocol.ts';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(f:()=>boolean,ms=7000){const end=Date.now()+ms;while(!f()){if(Date.now()>end)throw Error('Timed out');await sleep(20);}}
let server:ReturnType<typeof spawn>;
const rooms:Room<any,DuelState>[]=[];
const client=new Client('http://127.0.0.1:2568');
before(async()=>{
  server=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{env:{...process.env,TITANS_SERVER_PORT:'2568'},stdio:'pipe'});
  let errors='';server.stderr?.on('data',b=>errors+=b);
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:2568/health')).ok)return;}catch{}await sleep(100);}
  throw Error(errors||'Test server did not start');
});
after(async()=>{for(const r of rooms){r.reconnection.enabled=false;void r.leave().catch(()=>{});}server?.kill();});
async function create(){const r=await client.create<DuelState>('duel',{},DuelState);rooms.push(r);r.onMessage('command-error',()=>{});await until(()=>r.state.players.size===1);return r;}
const seq=new WeakMap<object,number>();
function command(r:Room<any,DuelState>,data:Record<string,unknown>){const n=(seq.get(r)??0)+1;seq.set(r,n);const c={...data,seq:n,round:r.state.round,epoch:r.state.epoch};r.send('command',c);return c;}
async function pair(){const a=await create(),b=await client.joinById<DuelState>(a.roomId,{},DuelState);rooms.push(b);b.onMessage('command-error',()=>{});await until(()=>a.state.players.size===2&&b.state.players.size===2);command(a,{type:'ready'});command(b,{type:'ready'});await until(()=>a.state.status==='playing'&&b.state.status==='playing');return [a,b] as const;}
const own=(r:Room<any,DuelState>)=>r.state.players.get(r.sessionId)!;
const hp=(r:Room<any,DuelState>,side:number,x:number,z:number)=>r.state.floors[side*99+map.cells.findIndex(c=>c.x===x&&c.z===z)];
async function fire(r:Room<any,DuelState>,x=4,z=6){command(r,{type:'begin',kind:'shot'});return command(r,{type:'release',target:{x,z}});}

test('protocol rejects result injection, malformed values and private pre-release targets',()=>{
  const c={type:'move',seq:1,round:1,epoch:1,dx:1,dz:0,yaw:0};assert.equal(validCommand(c),true);
  for(const extra of [{x:100},{ammo:3},{dt:1},{dx:NaN},{dx:2},{dz:1},{seq:1.5},{round:0}])assert.equal(validCommand({...c,...extra}),false);
  assert.equal(validCommand({type:'begin',kind:'shot',target:{x:4,z:6},seq:1,round:1,epoch:1}),false);
});
test('shared simulation resolves simultaneous destruction and falling symmetrically in one tick',()=>{
  const s=new Simulation(),c={x:4,z:6};
  for(const side of [0,1] as const){s.floors[side].set(cellKey(c),1);s.begin('shot',side);s.release(c,side);}
  s.step(1.4,[false,false]);assert.deepEqual(s.actors.map(a=>a.falling),[true,true]);assert.equal(s.phase,'falling');
  s.step(1.3,[false,false]);assert.equal(s.round,2);assert.deepEqual(s.inventories,[3,3]);
  for(const side of [0,1] as const)assert.deepEqual(s.actors[side].pos,cellCentre(c,side));
});
test('real clients: private rooms, invalid/duplicate/stale commands, mutual hits and shared reset',async()=>{
  const [a,b]=await pair(),isolated=await create();
  const visualSeed=a.state.visualSeed;assert.ok(visualSeed>0);assert.equal(b.state.visualSeed,visualSeed);assert.equal(a.state.visualVersion,1);assert.notEqual(isolated.state.visualSeed,visualSeed);
  await assert.rejects(()=>client.joinById(a.roomId,{},DuelState));await assert.rejects(()=>client.joinById('NOT_A_ROOM',{},DuelState));
  const before=own(a).x;let errors=0;a.onMessage('command-error',()=>errors++);
  a.send('command',{type:'move',seq:9999,round:1,epoch:a.state.epoch,dx:100,dz:0,yaw:0});await until(()=>errors>0);assert.equal(own(a).x,before);
  command(a,{type:'begin',kind:'shot'});await sleep(100);
  const publicText=JSON.stringify(b.state.toJSON());assert.equal(/selected|pitch|reticle|primary|target/.test(publicText),false);assert.equal(b.state.shots.size,0);
  const release=command(a,{type:'release',target:{x:4,z:6}});a.send('command',release);a.send('command',release);await fire(b);
  await until(()=>hp(a,0,4,6)===1&&hp(b,1,4,6)===1);assert.equal(own(a).ammo,2);assert.equal(own(b).ammo,2);assert.equal(a.state.released,2);
  assert.equal(isolated.state.released,0);assert.equal(hp(isolated,1,4,6),2);
  await fire(a);await fire(b);await until(()=>a.state.phase==='falling'&&b.state.phase==='falling');
  assert.deepEqual(a.state.floors.toJSON(),b.state.floors.toJSON());
  const oldRound=a.state.round,oldEpoch=a.state.epoch;await until(()=>a.state.round===oldRound+1&&b.state.round===oldRound+1);
  assert.equal(a.state.visualSeed,visualSeed);assert.equal(b.state.visualSeed,visualSeed);
  assert.equal(own(a).ammo,3);assert.equal(own(b).ammo,3);assert.equal(a.state.shots.size,0);assert.equal(hp(a,0,4,6),2);
  const n=(seq.get(a)??0)+1;a.send('command',{type:'release',seq:n,round:oldRound,epoch:oldEpoch,target:{x:4,z:6}});await sleep(100);assert.equal(own(a).ammo,3);
});
test('real clients: per-side movement, arsenal refill and release cannot become a shot',async()=>{
  const [a,b]=await pair();await fire(a,2,5);await fire(b,2,5);await until(()=>a.state.shots.size===0&&own(a).ammo===2&&own(b).ammo===2);
  // Move around the physical R obstacle, using only legal fixed-step intentions.
  for(let i=0;i<17;i++){command(a,{type:'move',dx:-1,dz:0,yaw:Math.PI});command(b,{type:'move',dx:1,dz:0,yaw:0});await sleep(34);}
  for(let i=0;i<100;i++){command(a,{type:'move',dx:0,dz:-1,yaw:Math.PI});command(b,{type:'move',dx:0,dz:1,yaw:0});await sleep(34);}
  await sleep(200);assert.ok(own(a).z< -27);assert.ok(own(b).z>27);assert.ok(own(a).x< -2);assert.ok(own(b).x>2);
  command(a,{type:'begin',kind:'refill'});command(b,{type:'begin',kind:'refill'});await until(()=>own(a).ammo===3&&own(b).ammo===3);
  command(a,{type:'release',target:{x:4,z:6}});command(b,{type:'release',target:{x:4,z:6}});await sleep(200);assert.equal(a.state.released,2);assert.equal(b.state.released,2);
});
test('real transport: one grace pause, reconnect countdown, second drop ends duel',async()=>{
  const [a,b]=await pair();const seed=a.state.visualSeed;await fire(a,3,5);await until(()=>hp(b,1,3,5)===1);await fire(a,3,5);await until(()=>hp(b,1,3,5)===0);b.reconnection.minUptime=0;b.reconnection.delay=700;b.reconnection.minDelay=700;b.reconnection.maxDelay=700;b.reconnection.maxRetries=5;b.reconnection.maxEnqueuedMessages=0;
  const round=a.state.round;b.connection.close(4010,'test interruption');await until(()=>a.state.status==='paused');const frozen=own(a).x;
  command(a,{type:'move',dx:1,dz:0,yaw:0});await sleep(150);assert.equal(own(a).x,frozen);
  await until(()=>a.state.status==='countdown');await until(()=>a.state.status==='playing'&&b.state.status==='playing');assert.equal(a.state.round,round);assert.equal(b.state.visualSeed,seed);assert.equal(hp(b,1,3,5),0);
  b.connection.close(4010,'second interruption');await until(()=>a.state.status==='ended');assert.match(a.state.reason,/Повторный/);
});
test('real transport: no return expires within one ten-second grace and closes room',async()=>{
  const [a,b]=await pair();b.reconnection.enabled=false;const started=Date.now();b.connection.close(4010,'no return');await until(()=>a.state.status==='paused');await until(()=>a.state.status==='ended',12000);assert.ok(Date.now()-started<11500);assert.match(a.state.reason,/10 секунд/);await sleep(1700);await assert.rejects(()=>client.joinById(a.roomId,{},DuelState));
});

test('official transport latency injection: 100 and 200 ms RTT, authoritative movement and one release',async()=>{
  for(const latency of [100,200]){
    const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{env:{...process.env,TITANS_SERVER_PORT:'2569',TITANS_TEST_LATENCY_MS:String(latency)},stdio:'ignore'});
    const active:Room<any,DuelState>[]=[];
    try{
      for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:2569/health')).ok)break;}catch{}await sleep(50);}
      const cl=new Client('http://127.0.0.1:2569'),a=await cl.create<DuelState>('duel',{},DuelState),b=await cl.joinById<DuelState>(a.roomId,{},DuelState);active.push(a,b);a.onMessage('command-error',()=>{});b.onMessage('command-error',()=>{});
      await until(()=>a.state.players.size===2&&b.state.players.size===2);command(a,{type:'ready'});command(b,{type:'ready'});await until(()=>a.state.status==='playing'&&b.state.status==='playing');
      const x=own(a).x;for(let i=0;i<15;i++){command(a,{type:'move',dx:1,dz:0,yaw:0});await sleep(34);}
      await until(()=>Math.abs(own(a).x-x-2.5)<.01);await until(()=>Math.abs(b.state.players.get(a.sessionId)!.x-own(a).x)<.01);
      const c=await fire(a,3,5);a.send('command',c);await until(()=>hp(b,1,3,5)===1);assert.equal(own(a).ammo,2);assert.equal(a.state.released,1);
      console.log(`Injected RTT ${latency} ms: movement converged, one stone, matching damage`);
    }finally{for(const r of active){r.reconnection.enabled=false;void r.leave();}await sleep(100);child.kill();await sleep(200);}
  }
});

