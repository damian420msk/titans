import { Room, type Client } from '@colyseus/core';
import { randomInt } from 'node:crypto';
import { APPEARANCE_VERSION } from '../shared/tile-appearance.ts';
import { DuelState, PlayerState, ShotState } from '../shared/net-schema.ts';
import { Simulation, cellKey } from '../shared/simulation.ts';
import { rules, map, type Side } from '../shared/world.ts';
import { validCommand, type Command } from '../shared/protocol.ts';
import { TICK_RATE, SNAPSHOT_RATE } from './config.ts';
type Peer = { side:Side; sequence:number; queue:Command[]; dropUsed:boolean; lastMove:number; window:number; count:number };

export class DuelRoom extends Room<{state:DuelState}> {
  state=new DuelState();
  maxClients=2;
  maxMessagesPerSecond=150;
  private sim=new Simulation();
  private peers=new Map<string,Peer>();
  private pauseDeadline=0;
  onCreate(){
    this.state.visualSeed=randomInt(1,0x100000000);this.state.visualVersion=APPEARANCE_VERSION;
    this.sim.message='Приватная дуэль · ожидаем готовности';
    void this.setPrivate(true);
    this.state.tickRate=TICK_RATE;this.state.snapshotRate=SNAPSHOT_RATE;this.patchRate=1000/SNAPSHOT_RATE;
    for(let i=0;i<map.cells.length*2;i++)this.state.floors.push(2);
    this.onMessage('command',(client,data)=>this.receive(client,data));
    this.setFixedTimestep(({dt})=>this.advance(dt),TICK_RATE);
    this.clock.setTimeout(()=>{if(this.state.status==='waiting')this.finish('Время ожидания второго игрока истекло');},rules.online.empty_private_room_expiry_s*1000);
    this.publish();
  }
  onJoin(client:Client){
    if(this.state.status==='ended'||this.peers.size>=2)throw Error('Комната закрыта или заполнена');
    const side:Side=this.peers.size===0?0:1;
    this.peers.set(client.sessionId,{side,sequence:0,queue:[],dropUsed:false,lastMove:0,window:Date.now(),count:0});
    const p=new PlayerState();p.side=side;p.yaw=side===0?0:Math.PI;this.state.players.set(client.sessionId,p);this.publish();
  }
  private receive(client:Client,value:unknown){
    const peer=this.peers.get(client.sessionId);if(!peer)return;
    const now=Date.now();if(now-peer.window>=1000){peer.window=now;peer.count=0;}
    if(++peer.count>100){this.error(client,'Слишком много команд');return;}
    if(!validCommand(value)){this.error(client,'Неверный формат команды');return;}
    const c=value;
    if(c.seq<=peer.sequence)return; // Idempotent, including duplicate release/cancel.
    if(c.seq>peer.sequence+256||c.round!==this.sim.round||c.epoch!==this.state.epoch){this.error(client,'Устаревшая команда');return;}
    peer.sequence=c.seq;this.state.players.get(client.sessionId)!.ackCommand=c.seq;
    if(c.type==='cancel'){
      peer.queue=[];this.sim.cancel(peer.side);this.state.players.get(client.sessionId)!.ackMove=peer.lastMove;this.publish();return;
    }
    if(c.type==='ready'){
      if(this.state.status==='waiting')this.state.players.get(client.sessionId)!.ready=true;
      if(this.canStart())this.countdown();return;
    }
    if(this.state.status!=='playing'||this.sim.phase!=='playing'){this.error(client,'Раунд ещё не доступен');return;}
    if(peer.queue.length>=16){this.error(client,'Очередь ввода переполнена');return;}
    if(c.type==='move')peer.lastMove=c.seq;
    peer.queue.push(c);
  }
  private error(client:Client,reason:string){client.send('command-error',{reason});}
  private canStart(){return this.state.players.size===2&&[...this.state.players.values()].every(p=>p.connected&&p.ready)&&this.state.status==='waiting';}
  private barrier(){
    this.state.epoch++;this.sim.cancelAll();
    for(const [id,p]of this.peers){p.queue=[];const actor=this.state.players.get(id);if(actor)actor.ackMove=p.lastMove;}
  }
  private countdown(){this.barrier();this.state.status='countdown';this.state.countdown=rules.match.countdown_s;this.state.reason='';}
  private advance(dt:number){
    this.state.tick++;
    if(this.state.status==='paused')this.state.countdown=Math.max(0,(this.pauseDeadline-Date.now())/1000);
    if(this.state.status==='countdown'){
      this.state.countdown=Math.max(0,this.state.countdown-dt);
      if(this.state.countdown<1e-8){this.state.countdown=0;this.state.status='playing';this.sim.message='Приватная дуэль · два игрока';}
    }else if(this.state.status==='playing'){
      for(const [id,peer]of this.peers){
        let moved=false;
        while(peer.queue.length){
          const c=peer.queue[0];if(c.type==='move'&&moved)break;peer.queue.shift();
          if(c.round!==this.sim.round||c.epoch!==this.state.epoch)continue;
          const actor=this.state.players.get(id)!;
          if(c.type==='move'){
            moved=true;actor.yaw=c.yaw;
            this.sim.movePlayer(c.dx*rules.character.walk_speed_mps*dt,c.dz*rules.character.walk_speed_mps*dt,peer.side,true);actor.ackMove=c.seq;
          }else if(c.type==='begin'){
            const supply=this.sim.arsenalAvailable(this.sim.looksAtArsenal(actor.yaw,peer.side),peer.side);
            if(c.kind==='refill'){if(supply)this.sim.begin('refill',peer.side);}
            else if(supply&&this.sim.inventories[peer.side]<rules.inventory.capacity)this.sim.begin('refill',peer.side);
            else this.sim.begin('shot',peer.side);
          }else if(c.type==='release')this.sim.release(c.target,peer.side);
        }
      }
      const before=this.sim.round;
      this.sim.step(dt,([0,1] as Side[]).map(side=>{
        const actor=[...this.state.players.values()].find(p=>p.side===side);
        return this.sim.arsenalAvailable(this.sim.looksAtArsenal(actor?.yaw??0,side),side);
      }) as [boolean,boolean]);
      if(this.sim.round!==before){this.barrier();for(const p of this.state.players.values())p.yaw=p.side===0?0:Math.PI;}
      if(this.sim.phase==='falling')for(const p of this.peers.values())p.queue=[];
    }
    this.publish();
  }
  private publish(){
    this.state.round=this.sim.round;this.state.phase=this.sim.phase;this.state.message=this.sim.message;this.state.released=this.sim.released;
    for(const [id,peer]of this.peers){
      const p=this.state.players.get(id);if(!p)continue;const a=this.sim.actors[peer.side];
      p.x=a.pos.x;p.z=a.pos.z;p.y=a.y;p.falling=a.falling;p.ammo=this.sim.inventories[peer.side];p.cooldown=this.sim.cooldowns[peer.side];p.refill=this.sim.refills[peer.side];
    }
    for(const side of [0,1] as Side[])for(let i=0;i<map.cells.length;i++){const hp=this.sim.floors[side].get(cellKey(map.cells[i]))!;this.state.floors[side*map.cells.length+i]=Number.isFinite(hp)?hp:-1;}
    const active=new Set(this.sim.shots.map(s=>String(s.id)));
    for(const id of this.state.shots.keys())if(!active.has(id))this.state.shots.delete(id);
    for(const shot of this.sim.shots){let p=this.state.shots.get(String(shot.id));if(!p){p=new ShotState();p.id=shot.id;p.owner=shot.owner;p.x=shot.target.x;p.z=shot.target.z;p.startX=shot.start.x;p.startZ=shot.start.z;this.state.shots.set(String(shot.id),p);}p.elapsed=shot.elapsed;}
  }
  onDrop(client:Client){
    const peer=this.peers.get(client.sessionId);if(!peer||this.state.status==='ended')return;
    this.state.players.get(client.sessionId)!.connected=false;
    if(peer.dropUsed){this.finish('Повторный обрыв соединения. Тестовая дуэль завершена');return;}
    peer.dropUsed=true;
    if(!this.pauseDeadline)this.pauseDeadline=Date.now()+rules.online.disconnect_grace_s*1000;
    this.barrier();this.state.status='paused';this.state.reason='Обрыв соединения · до 10 секунд на возврат';
    this.allowReconnection(client,Math.max(.001,(this.pauseDeadline-Date.now())/1000));
  }
  onReconnect(client:Client){
    if(this.state.status==='ended'){void client.leave();return;}
    const p=this.state.players.get(client.sessionId);if(!p)return;p.connected=true;
    if([...this.state.players.values()].every(a=>a.connected)){
      this.pauseDeadline=0;
      if(this.state.players.size===2&&[...this.state.players.values()].every(a=>a.ready))this.countdown();
      else{this.barrier();this.state.status='waiting';this.state.reason='';}
    }
  }
  onLeave(client:Client){
    if(this.state.status!=='ended')this.finish(this.state.status==='paused'?'Игрок не вернулся за 10 секунд. Тестовая дуэль завершена':'Игрок вышел. Тестовая дуэль завершена');
    this.state.players.delete(client.sessionId);this.peers.delete(client.sessionId);
  }
  private finish(reason:string){if(this.state.status==='ended')return;this.barrier();this.state.status='ended';this.state.reason=reason;void this.lock();this.clock.setTimeout(()=>{void this.disconnect();},1500);}
  onDispose(){this.peers.clear();}
}
