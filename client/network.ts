import { type Room } from '@colyseus/sdk';
import {multiplayerClient,consumeEarlyReconnection} from './network-connection';
import { DuelState } from '../shared/net-schema';
import { Simulation, cellKey, type Actor, type PrimaryContext } from '../shared/simulation';
import { map, move, rules, type Side, type Cell } from '../shared/world';
import type { Command } from '../shared/protocol';
type MoveFrame={seq:number;dx:number;dz:number};
const node=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;

export class NetworkSession {
  enabled=false;
  room:Room<any,DuelState>|null=null;
  side:Side=0;
  primary:PrimaryContext=null;
  status='offline';
  reason='';
  raw:Record<string,unknown>|null=null;
  private dropped=false;
  private busy=false;
  private seq=0;
  private epoch=0;
  private round=0;
  private accumulator=0;
  private lastInputTime=performance.now();
  private pending:MoveFrame[]=[];
  private predicted={x:0,z:0};
  private lastSnapshot=performance.now();
  private lastStatus='';
  private generation=0;
  visual:Actor[]=[];
  private client=multiplayerClient;
  constructor(private sim:Simulation,private resetInput:()=>void,private changeSide:(side:Side)=>void){
    node('open-modes').onclick=()=>{this.suspend();node<HTMLDialogElement>('mode-panel').showModal();};
    node('close-modes').onclick=()=>node<HTMLDialogElement>('mode-panel').close();
    node('local-training').onclick=()=>{void this.local();};
    node('create-room').onclick=()=>{void this.connect('create');};
    node('join-room').onclick=()=>{void this.connect('join',node<HTMLInputElement>('join-code').value.trim());};
    node('ready-room').onclick=()=>this.send({type:'ready'});
    node('leave-room').onclick=()=>{void this.local();};
    node('mode-panel').addEventListener('close',()=>this.resetInput());
    window.addEventListener('pagehide',()=>this.suspend());
    document.addEventListener('visibilitychange',()=>{this.lastInputTime=performance.now();this.accumulator=0;});
    try{if(sessionStorage.getItem('titans.reconnect'))void this.connect('reconnect');}catch{/* Storage optional. */}
  }
  get playing(){return this.enabled&&!!this.room&&!this.dropped&&this.room.state?.status==='playing'&&this.sim.phase==='playing';}
  private token(value:string|null){try{if(value)sessionStorage.setItem('titans.reconnect',value);else sessionStorage.removeItem('titans.reconnect');}catch{/* Storage optional. */}}
  async local(){
    const old=this.room;this.room=null;this.generation++;this.enabled=false;this.token(null);this.resetInput();this.pending=[];this.primary=null;this.visual=[];this.sim.reset();this.changeSide(0);this.status='offline';this.reason='';
    if(old){old.reconnection.enabled=false;void old.leave().catch(()=>{});}
    node<HTMLDialogElement>('mode-panel').close();this.ui();
  }
  async connect(kind:'create'|'join'|'reconnect',code=''){
    if(this.busy)return;if(kind==='join'&&!/^[A-Za-z0-9_-]{4,32}$/.test(code)){this.reason='Введите код комнаты без пробелов';this.ui();return;}
    this.busy=true;const generation=++this.generation;const old=this.room;this.room=null;this.enabled=true;this.primary=null;this.pending=[];this.seq=0;this.epoch=0;this.round=0;this.dropped=false;this.resetInput();
    if(old){old.reconnection.enabled=false;void old.leave().catch(()=>{});}
    this.status='connecting';this.reason='Подключение к серверу…';this.ui();
    try{
      const token=(()=>{try{return sessionStorage.getItem('titans.reconnect');}catch{return null;}})();
      const room=kind==='create'?await this.client.create<DuelState>('duel',{},DuelState):kind==='join'?await this.client.joinById<DuelState>(code,{},DuelState):await (consumeEarlyReconnection()??this.client.reconnect<DuelState>(token!,DuelState));
      if(!room.connection.isOpen)throw Error('Соединение завершено во время загрузки сцены');
      if(generation!==this.generation){void room.leave();return;}
      this.room=room;
      room.reconnection.maxEnqueuedMessages=0;room.reconnection.minUptime=0;room.reconnection.delay=250;room.reconnection.minDelay=250;room.reconnection.maxDelay=1000;room.reconnection.maxRetries=15;
      this.token(room.reconnectionToken);
      room.onStateChange(state=>{if(this.room===room)this.snapshot(state);});
      room.onMessage('command-error',()=>{this.primary=null;});
      room.onDrop(()=>{if(this.room!==room)return;this.dropped=true;this.primary=null;this.pending=[];this.resetInput();this.reason='Связь потеряна · автоматическое переподключение';this.ui();});
      room.onReconnect(()=>{if(this.room!==room)return;this.dropped=false;this.token(room.reconnectionToken);this.primary=null;this.pending=[];this.resetInput();this.snapshot(room.state);});
      room.onLeave(()=>{if(this.room!==room)return;this.room=null;this.token(null);this.pending=[];this.primary=null;this.status='ended';this.reason=this.reason||'Соединение завершено. Создайте новую комнату';this.resetInput();this.ui(true);});
      room.onError((_code,message)=>{this.reason=message||'Ошибка соединения';this.ui();});
      if(room.state?.players?.size)this.snapshot(room.state);
      this.reason='';this.ui(room.state.status!=='playing');
    }catch(e){
      if(generation!==this.generation)return;
      const message=String((e as Error)?.message??e);
      this.status='ended';this.token(null);
      this.reason=/full|locked|maxClients|filled/i.test(message)?'Комната заполнена или закрыта. Создайте другую.':/not found|not defined|not available|room.*exist/i.test(message)?'Комната не найдена или уже закрыта. Проверьте код.':'Сервер недоступен или комната закрыта. Проверьте запуск сервера и повторите подключение.';
      this.ui(true);
    }finally{this.busy=false;this.ui();}
  }
  private snapshot(state:DuelState){
    const own=state.players.get(this.room!.sessionId);if(!own)return;
    this.seq=Math.max(this.seq,own.ackCommand);
    const first=this.epoch===0,side=own.side as Side,barrier=this.epoch!==state.epoch||this.round!==state.round||this.side!==side;
    // Cancel from resetInput must carry the newly received epoch/round, not the old one.
    this.epoch=state.epoch;this.round=state.round;this.status=state.status;this.reason=state.reason;this.sim.round=state.round;
    if(this.side!==side||first){this.side=side;this.changeSide(side);}
    if(barrier){this.pending=[];this.primary=null;this.accumulator=0;this.resetInput();}
    this.sim.phase=state.phase as 'playing'|'falling';this.sim.message=state.message;this.sim.released=state.released;
    for(const p of state.players.values()){
      const s=p.side as Side;this.sim.actors[s]={pos:{x:p.x,z:p.z},y:p.y,vy:0,falling:p.falling};
      this.sim.inventories[s]=p.ammo;this.sim.cooldowns[s]=p.cooldown;this.sim.refills[s]=p.refill;
    }
    for(const side of [0,1] as Side[])for(let i=0;i<map.cells.length;i++){const hp=state.floors[side*map.cells.length+i];this.sim.floors[side].set(cellKey(map.cells[i]),hp<0?Infinity:hp);}
    this.sim.shots=[...state.shots.values()].map(s=>({id:s.id,owner:s.owner as Side,target:{x:s.x,z:s.z},start:{x:s.startX,z:s.startZ},elapsed:s.elapsed}));
    this.pending=this.pending.filter(f=>f.seq>own.ackMove);
    this.predicted={...this.sim.actors[this.side].pos};
    for(const f of this.pending)this.predict(f,1/state.tickRate);
    if(barrier||state.phase==='falling'||state.status!=='playing')this.visual=this.sim.actors.map(a=>({...a,pos:{...a.pos}}));
    if(state.status!=='playing'||state.phase==='falling'){this.primary=null;this.pending=[];}
    if(this.primary==='refill'&&own.ammo===rules.inventory.capacity)this.primary=null;
    this.lastSnapshot=performance.now();this.raw=state.toJSON();
    const changed=this.lastStatus!==state.status;
    if(changed){this.lastStatus=state.status;if(state.status==='playing')node<HTMLDialogElement>('mode-panel').close();}
    this.ui(changed&&(state.status==='waiting'||state.status==='ended'));
  }
  private send(data:Record<string,unknown>){
    if(!this.room||this.dropped||!this.epoch)return 0;
    const seq=++this.seq;this.room.send('command',{...data,seq,round:this.sim.round,epoch:this.epoch});return seq;
  }
  begin(target:Cell|null,arsenal:boolean){
    if(!this.playing)return;
    this.primary=this.sim.context(target,arsenal,this.side);
    if(this.primary)this.send({type:'begin',kind:this.primary});
  }
  release(target:Cell|null){const kind=this.primary;this.primary=null;if(!this.playing)return;if(kind==='shot'&&target)this.send({type:'release',target:{...target}});else this.send({type:'cancel'});}
  suspend(){
    this.primary=null;this.pending=[];this.accumulator=0;this.lastInputTime=performance.now();
    this.send({type:'cancel'});
  }
  private predict(frame:MoveFrame,dt:number){this.predicted=move(this.predicted,frame.dx*rules.character.walk_speed_mps*dt,frame.dz*rules.character.walk_speed_mps*dt,p=>this.sim.supported(p,this.side),this.side);}
  update(dt:number,dx:number,dz:number,yaw:number,blocked:boolean){
    const now=performance.now(),elapsed=Math.min(.25,(now-this.lastInputTime)/1000);this.lastInputTime=now;
    if(this.playing&&!blocked){
      const step=1/this.room!.state.tickRate;this.accumulator+=elapsed;
      while(this.accumulator>=step){this.accumulator-=step;const seq=this.send({type:'move',dx,dz,yaw:Math.atan2(Math.sin(yaw),Math.cos(yaw))});if(seq){const frame={seq,dx,dz};this.pending.push(frame);this.predict(frame,step);}if(this.pending.length>64){this.pending=[];this.predicted={...this.sim.actors[this.side].pos};}}
    }else this.accumulator=0;
    if(!this.visual.length)this.visual=this.sim.actors.map(a=>({...a,pos:{...a.pos}}));
    for(const side of [0,1] as Side[]){
      const a=this.sim.actors[side],v=this.visual[side];
      if(side===this.side&&this.playing&&!a.falling){v.pos={...this.predicted};v.y=a.y;v.falling=a.falling;}
      else{const lerp=a.falling||this.sim.phase==='falling'?1:1-Math.exp(-dt/.08);v.pos.x+=(a.pos.x-v.pos.x)*lerp;v.pos.z+=(a.pos.z-v.pos.z)*lerp;v.y+=(a.y-v.y)*lerp;v.falling=a.falling;}
    }
  }
  actor(side:Side){return this.enabled&&this.visual[side]?this.visual[side]:this.sim.actors[side];}
  shotAge(){return this.room?.state.status==='playing'?Math.min(.1,(performance.now()-this.lastSnapshot)/1000):0;}
  private ui(open=false){
    const room=this.room,own=room?.state?.players?.get(room.sessionId);
    node('open-modes').textContent=this.enabled?'Комната ▾':'Тренировка ▾';
    node('net-banner').textContent=!this.enabled?'':this.dropped?this.reason:this.status==='playing'?'':this.status==='countdown'?`Начало через ${Math.ceil(room?.state.countdown??0)}`:this.status==='paused'?`Техническая пауза · ${Math.ceil(room?.state.countdown??10)} с`:this.reason;
    node('network-error').textContent=this.reason;
    node('room-details').hidden=!room;
    node('room-code').textContent=room?.roomId??'';
    node('ready-count').textContent=room?.state?.players?`Готовы ${[...room.state.players.values()].filter(p=>p.ready).length} / 2 · подключено ${room.state.players.size} / 2`:'';
    node<HTMLButtonElement>('ready-room').disabled=!!own?.ready||this.status!=='waiting';
    for(const id of ['create-room','join-room'])node<HTMLButtonElement>(id).disabled=this.busy;
    if(open&&!node<HTMLDialogElement>('mode-panel').open)node<HTMLDialogElement>('mode-panel').showModal();
  }
  diagnostics(){return {enabled:this.enabled,status:this.status,side:this.side,roomId:this.room?.roomId??null,dropped:this.dropped,pending:this.pending.length,raw:this.raw,reason:this.reason};}
}
