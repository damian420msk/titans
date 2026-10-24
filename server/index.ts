import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DuelRoom } from './duel-room.ts';
import { PORT, TICK_RATE, SNAPSHOT_RATE, LATENCY_MS } from './config.ts';
const server=new Server({transport:new WebSocketTransport({pingInterval:1000,pingMaxRetries:2,maxPayload:4096}),greet:false,express:app=>{
  app.get('/health',(_req:unknown,res:{json:(data:unknown)=>void})=>res.json({ok:true,tickRate:TICK_RATE,snapshotRate:SNAPSHOT_RATE}));
}});
server.define('duel',DuelRoom);
if(LATENCY_MS)server.simulateLatency(LATENCY_MS);
await server.listen(PORT,'0.0.0.0');
console.log(`Titans NET-001 :${PORT} · simulation ${TICK_RATE}Hz · snapshots ${SNAPSHOT_RATE}Hz · artificial RTT ${LATENCY_MS}ms`);
