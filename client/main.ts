import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { createArenaPresentation } from './presentation';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Culling/ray';
import { rules, map, size, cellCentre, targetCell, type Cell, type Side } from '../shared/world';
import { Simulation, shotPosition, otherSide } from '../shared/simulation';
import { InputController, type GameAction } from './input';
import { Display } from './display';
import { CameraRig } from './camera-rig';
import { NetworkSession } from './network';
import { LocalClock } from './local-clock';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const engine = new Engine(canvas, true, { stencil: true }, false);
const scene = new Scene(engine);
const instrumentation=new SceneInstrumentation(scene);instrumentation.captureRenderTime=true;
scene.clearColor = new Color4(.72,.79,.85,1);
scene.fogMode = Scene.FOGMODE_LINEAR; scene.fogStart = 95; scene.fogEnd = 260; scene.fogColor = new Color3(.70,.67,.77);
const camera = new FreeCamera('follow', Vector3.Zero(), scene);
camera.inputs.clear(); camera.minZ = .1; camera.maxZ = 300;
camera.fov = rules.camera.fov_normal_degrees * Math.PI / 180;
const fill=new HemisphericLight('sky',new Vector3(.2,1,.3),scene);fill.intensity=.75;fill.diffuse=new Color3(.78,.87,1);fill.groundColor=new Color3(.35,.38,.43);
const sun = new DirectionalLight('sun',new Vector3(-.45,-1,.35),scene);sun.position.set(24,50,-22);sun.diffuse=new Color3(1,.90,.75);sun.intensity=2.1;
sun.shadowMinZ=1;sun.shadowMaxZ=110;sun.orthoLeft=-48;sun.orthoRight=48;sun.orthoTop=48;sun.orthoBottom=-48;sun.autoUpdateExtends=false;
const shadows=new ShadowGenerator(1024,sun);shadows.usePercentageCloserFiltering=true;shadows.filteringQuality=ShadowGenerator.QUALITY_LOW;shadows.bias=.0003;shadows.normalBias=.025;shadows.setDarkness(.25);
const presentation=createArenaPresentation(scene);
const {player,enemy,tileViews,crackedFloor,outline,wash,box,material}=presentation;
const sim = new Simulation();
const localVisualSeed=crypto.getRandomValues(new Uint32Array(1))[0];
let localSide:Side=0;
let network:NetworkSession|undefined;
const primary=()=>network?.enabled?network.primary:sim.primaries[localSide];
let selected:Cell|null=null,arsenal=false,movement={x:0,z:0};
let aimHit:{x:number;z:number}|null=null;
function act(action:GameAction){
  if(action.type==='move')movement={x:action.x,z:action.z};
  if(action.type==='look')rig.look(action.dx,action.dy);
  if(action.type==='cancel'){if(network?.enabled)network.suspend();else sim.cancel(localSide);}
  if(action.type==='primary'){
    updateAim();
    if(network?.enabled){if(action.pressed)network.begin(selected,arsenal);else network.release(selected);}
    else if(action.pressed)sim.press(selected,arsenal,localSide);else sim.release(selected,localSide);
  }
}
const input=new InputController(canvas,act);
const root=document.querySelector<HTMLElement>('#game-root')!;
const display=new Display(root,canvas,engine,()=>input.clear());
const rig=new CameraRig(camera,scene,display,()=>network?.actor(localSide)??sim.actors[localSide],()=>input.clear(),()=>otherSide(localSide));
network=new NetworkSession(sim,()=>input.clear(),side=>{localSide=side;rig.resetFacing(side);document.body.classList.toggle('side1',side===1);});
let paused=false;
function updateAim(){
  const pick=rig.read();aimHit=pick.hit;
  selected=sim.phase==='playing'&&pick.hit?targetCell(pick.hit,selected,otherSide(localSide)):null;
  const pile=scene.pickWithRay(pick.ray,m=>m.name===`R stone ${localSide}`);
  arsenal=sim.arsenalAvailable(!!pile?.hit,localSide);
}
function updatePause(){
  paused=input.effective==='touch'&&display.portrait;
  document.querySelector<HTMLElement>('#portrait')!.hidden=!paused;
  input.setBlocked(paused||(document.getElementById('mode-panel') as HTMLDialogElement).open||!!network?.enabled&&!network.playing);
  document.querySelector('#portrait p')!.textContent=network?.enabled?'Матч продолжается. Вернитесь в горизонтальную ориентацию.':'Раунд приостановлен. Продолжим после поворота.';
}
async function fullscreen(){
  input.clear();
  const status=document.getElementById('fullscreen-status')!;
  try{
    if(!document.fullscreenElement){
      if(!root.requestFullscreen){status.textContent='Полный экран недоступен. Можно играть горизонтально без него.';return;}
      await root.requestFullscreen();
    }
    const orientation=screen.orientation as ScreenOrientation & {lock?:(value:string)=>Promise<void>};
    if(orientation?.lock){try{await orientation.lock('landscape');status.textContent='Полный экран · горизонтальная ориентация';}catch{status.textContent='Поверните устройство вручную. Игра доступна без блокировки.';}}
    else status.textContent='Поверните устройство горизонтально вручную';
  }catch{status.textContent='Полный экран отклонён. Горизонтальная игра доступна без него.';}
  display.sync();updatePause();
}
for(const id of ['fullscreen','rotate-fullscreen'])document.getElementById(id)!.addEventListener('click',()=>{void fullscreen();});
const diagnosticPanel=document.querySelector<HTMLElement>('#diagnostics')!;
const diagnosticToggle=document.querySelector<HTMLInputElement>('#show-diagnostics')!;
diagnosticToggle.addEventListener('change',()=>{diagnosticPanel.hidden=!diagnosticToggle.checked;});
const projectileViews=new Map<number,ReturnType<typeof MeshBuilder.CreateSphere>>();
const shotMaterial=material('ordinary stone','#D9D0B6');
const boundaryMaterial=material('selected boundary','#FFF0A0');boundaryMaterial.emissiveColor=new Color3(.8,.65,.3);
const boundary=new TransformNode('selected boundary',scene);
for(const x of [-size/2,size/2])box('target edge',.075,.04,size,new Vector3(x,.06,0),boundaryMaterial,boundary);
for(const z of [-size/2,size/2])box('target edge',size,.04,.075,new Vector3(0,.06,z),boundaryMaterial,boundary);
let lastRound=sim.round,frameMs=0,diagnosticTime=0,wasFalling=false;
const localClock=new LocalClock();let discardElapsed=true;
for(const event of ['blur','focus'])window.addEventListener(event,()=>{discardElapsed=true;localClock.reset();});
document.addEventListener('visibilitychange',()=>{discardElapsed=true;localClock.reset();});
function frame(dt:number){
  const wasPaused=paused;
  display.sync();updatePause();
  const elapsed=paused||document.hidden||discardElapsed||wasPaused&&!paused?0:dt;discardElapsed=false;
  // Preserve the existing input/camera smoothing bound; only physics needs to catch up.
  const step=Math.min(elapsed,.05);
  input.update(step);
  if(network?.enabled){
    localClock.reset();
    network.update(Math.min(dt,.05),(movement.x*Math.cos(rig.yaw)+movement.z*Math.sin(rig.yaw)),(movement.z*Math.cos(rig.yaw)-movement.x*Math.sin(rig.yaw)),rig.yaw,input.blocked||document.hidden);
    rig.update(step,input.effective==='touch'&&primary()==='shot');updateAim();
  }else if(step>0){
    rig.update(step,input.effective==='touch'&&primary()==='shot');
    const round=sim.round;
    localClock.advance(elapsed,seconds=>{
      sim.movePlayer((movement.x*Math.cos(rig.yaw)+movement.z*Math.sin(rig.yaw))*rules.character.walk_speed_mps*seconds,(movement.z*Math.cos(rig.yaw)-movement.x*Math.sin(rig.yaw))*rules.character.walk_speed_mps*seconds);
      updateAim();sim.step(seconds,arsenal);return sim.round===round;
    });
    updateAim();
  }else{localClock.reset();rig.update(0,false);updateAim();}
  if(sim.round!==lastRound){lastRound=sim.round;input.clear();rig.resetFacing(localSide);selected=null;updateAim();}
  if(sim.phase==='falling'&&!wasFalling)input.clear();wasFalling=sim.phase==='falling';
  for(const [side,node] of [[0,player],[1,enemy]] as const){const a=network?.actor(side)??sim.actors[side];node.setEnabled(!network?.enabled||side===localSide||!!network.room&&[...network.room.state.players.values()].some(p=>p.side===side));node.position.set(a.pos.x,a.y,a.pos.z);node.rotation.y=side===localSide?rig.yaw:network?.room?[...network.room.state.players.values()].find(p=>p.side===side)?.yaw??0:side===0?0:Math.PI;}
  (localSide===0?player:enemy).rotation.y=rig.yaw;
  presentation.stoneFloor.update(sim,network?.enabled&&network.room?.state.visualSeed?network.room.state.visualSeed:localVisualSeed,step>0?engine.getDeltaTime()/1000:0);
  presentation.animate(sim,elapsed,localSide,primary()==='shot',sim.phase!=='playing'||!!network?.enabled&&!network.playing,network?.enabled?`${network.room?.roomId}/${network.room?.state.epoch}`:'local');
  const shadowSize=input.effective==='touch'?512:1024;if(shadows.getShadowMap()?.getSize().width!==shadowSize)shadows.mapSize=shadowSize;
  shadows.getShadowMap()!.renderList=presentation.casters();
  for(const [id,mesh] of projectileViews)if(!sim.shots.some(s=>s.id===id)){mesh.dispose();projectileViews.delete(id);}
  for(const shot of sim.shots){
    let mesh=projectileViews.get(shot.id);
    if(!mesh){mesh=MeshBuilder.CreateSphere('ordinary projectile',{diameter:.65,segments:10},scene);mesh.material=shotMaterial;projectileViews.set(shot.id,mesh);}
    const p=shotPosition(network?.enabled?{...shot,elapsed:shot.elapsed+network.shotAge()}:shot);mesh.position.set(p.x,p.y,p.z);
  }
  outline.setEnabled(!!selected);wash.setEnabled(!!selected);boundary.setEnabled(!!selected);
  if(selected){const c=cellCentre(selected,otherSide(localSide)),hp=sim.hp(selected,otherSide(localSide));outline.position.x=wash.position.x=boundary.position.x=c.x;outline.position.z=wash.position.z=boundary.position.z=c.z;wash.setEnabled(hp>0);outline.color=boundaryMaterial.diffuseColor=hp===0?new Color3(.65,.70,.75):Color3.FromHexString('#FFF0A0');boundaryMaterial.emissiveColor=hp===0?new Color3(.25,.25,.25):new Color3(.8,.65,.3);}
  const hp=selected?sim.hp(selected,otherSide(localSide)):0;
  document.querySelector('#target')!.textContent=selected?hp===Infinity?'Защищённый пол':hp===2?'Целая':hp===1?'Трещина':'Отверстие':'Нет цели';
  const context=primary()??sim.context(selected,arsenal,localSide);
  const label=context==='refill'?'Запас':context==='shot'?'Бросок':arsenal?'Полон':sim.cooldowns[localSide]>0?'Пауза':sim.inventories[localSide]===0?'Пусто':'—';
  document.querySelector('#ammo')!.textContent=`${'●'.repeat(sim.inventories[localSide])}${'○'.repeat(rules.inventory.capacity-sim.inventories[localSide])} · ${sim.inventories[localSide]} / ${rules.inventory.capacity}`;
  document.querySelector('#round')!.textContent=`Раунд ${sim.round}`;
  document.querySelector('.enemy span')!.firstChild!.textContent=network?.enabled?'СОПЕРНИК':'ТЕСТОВАЯ ЦЕЛЬ';
  document.querySelector('.enemy small')!.textContent=network?.enabled?`Камни: ${sim.inventories[otherSide(localSide)]} / 3`:'Неподвижна · это не бот';
  document.querySelector('#status')!.textContent=sim.message.startsWith('Обычный бросок')?'Обычный бросок':sim.message;
  document.querySelector('#context')!.textContent=context==='refill'?`Удерживайте: +1 камень / ${rules.interaction.refill_per_stone_s} с`:
    primary()==='shot'?'Отпустите для обычного броска · ПКМ — отменить':label==='Бросок'?'Обычный бросок · нажмите и отпустите':label;
  document.querySelector('#primary-label')!.textContent=label;
  document.body.classList.toggle('aiming',primary()==='shot');document.body.classList.toggle('refilling',primary()==='refill');
  document.querySelector('#gesture-hint')!.textContent=document.body.classList.contains('handoff')?'Отменено · обзор':primary()==='refill'?'Пополнение · вниз — отмена':input.touchLayout==='zones'?'Вниз в область — отмена':'Вниз к джойстику — отмена';
  document.body.style.setProperty('--refill',`${100*sim.refills[localSide]/rules.interaction.refill_per_stone_s}%`);
  frameMs=frameMs?frameMs*.9+engine.getDeltaTime()*.1:engine.getDeltaTime();
  diagnosticTime+=dt;
  if(diagnosticToggle.checked&&diagnosticTime>.2){
    diagnosticTime=0;const d=display.diagnostics(),f=(n:number|undefined)=>Number(n??0).toFixed(2);
    diagnosticPanel.textContent=[
      `Viewport ${f(d.viewport.width)} × ${f(d.viewport.height)} · offset ${f(d.viewport.offsetLeft)}, ${f(d.viewport.offsetTop)}`,
      `Canvas rect ${f(d.canvas.width)} × ${f(d.canvas.height)} @ ${f(d.canvas.left)}, ${f(d.canvas.top)}`,
      `Framebuffer ${d.render.width} × ${d.render.height} · ${d.quality}`,
      `DPR ${d.dpr} · scaling ${f(d.scaling)} · ratio ${f(d.effectiveRatio)}`,
      `Кадр ${f(frameMs)} мс (интервал, не GPU-таймер)`,
      `Прицел client: ${f(d.reticle.client.x)}, ${f(d.reticle.client.y)}`,
      `Прицел render: ${f(d.reticle.render.x)}, ${f(d.reticle.render.y)}`,
      `Draw calls ${instrumentation.drawCallsCounter.current} · CPU render ${f(instrumentation.renderTimeCounter.current)} ms · shadows ${shadows.mapSize}/${presentation.casters().length}`,
      `GLB: ${presentation.diagnostics().map((v,i)=>`${i}: ${v.status}${v.error?` (${v.error})`:''}`).join(' | ')}`,
      `Babylon API: ${f(d.reticle.api.x)}, ${f(d.reticle.api.y)}`,
      `Плоскость: ${aimHit?`${f(aimHit.x)}, ${f(aimHit.z)}`:'нет пересечения'}`,
      `Клетка: ${selected?`${selected.x}, ${selected.z}`:'нет'} · пауза ${paused}`
    ].join('\n');
  }
}
updatePause();updateAim();
engine.runRenderLoop(()=>{frame(Math.min(engine.getDeltaTime()/1000,.25));scene.render();});
const diagnostics=()=>({pos:{...sim.actors[localSide].pos},y:sim.actors[localSide].y,falling:sim.actors[localSide].falling,enemy:{...sim.actors[otherSide(localSide)],pos:{...sim.actors[otherSide(localSide)].pos}},respawns:sim.round-1,round:sim.round,phase:sim.phase,yaw:rig.yaw,pitch:rig.pitch,selected:selected?{...selected}:null,camera:camera.position.asArray(),fov:camera.fov,cameraMode:rig.mode,framing:{...rig.shape,attackBlend:rig.attackBlend},tiles:map.cells.length*2,ready:scene.isReady(),ammo:sim.inventories[localSide],released:sim.released,primary:primary(),arsenal,cooldown:sim.cooldowns[localSide],refill:sim.refills[localSide],paused,screen:display.diagnostics(),frameMs,renderStats:{shadowMap:shadows.mapSize,shadowCasters:presentation.casters().length,drawCalls:instrumentation.drawCallsCounter.current,renderMs:instrumentation.renderTimeCounter.current,activeMeshes:scene.getActiveMeshes().length,totalMeshes:scene.meshes.length},intersection:aimHit,viewProjection:scene.getTransformMatrix().asArray(),shots:sim.shots.map(s=>({...s,target:{...s.target},start:{...s.start},position:shotPosition(s)})),lastImpact:sim.lastImpact,hp:Object.fromEntries(sim.floors[otherSide(localSide)]),input:{touchLayout:input.touchLayout,preference:input.preference,effective:input.effective,pending:input.pending,locked:input.locked,fallback:input.fallback,busy:input.busy,handoffs:input.handoffs,blocked:input.blocked,sensitivity:input.sensitivity,gestures:input.gestures},network:network?.diagnostics(),localSide,visuals:presentation.diagnostics(),floorVisuals:presentation.stoneFloor.diagnostics(),foundationVisuals:presentation.foundations.diagnostics(),standardCameraInputs:Object.keys(camera.inputs.attached)});
Object.assign(window,{titans:{state:diagnostics,...(new URLSearchParams(location.search).has('test')?{
  loadVisualAssets:presentation.loadAssets,
  inspectVisuals:presentation.inspect,
  inspectFoundationRays:(points:{x:number;z:number}[])=>presentation.foundations.inspect(points),
  place:(x:number,z:number,side:Side=0)=>{sim.cancel();sim.actors[side]={pos:{x,z},y:0,vy:0,falling:false};},
  view:(a:number,b:number)=>{rig.yaw=a;rig.pitch=b;selected=null;updateAim();},
  aim:(x:number,z:number)=>{
    const a=sim.actors[localSide],p=cellCentre({x,z},otherSide(localSide));
    rig.yaw=Math.atan2(p.x-a.pos.x,p.z-a.pos.z);
    const distance=Math.hypot(p.x-a.pos.x,p.z-a.pos.z)+rig.shape.distance;
    rig.pitch=Math.atan2(a.y+rig.shape.height,distance)+Math.atan((1-2*rig.shape.aimTop)*Math.tan(camera.fov/2));
    selected=null;updateAim();
  }
}:{})}});

