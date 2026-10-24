import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { map, size, cellCentre, type Cell, type Side } from '../shared/world';
import { visualAssets, type VisualAssets } from './visual-assets';
import { VisualSlot } from './visual-slot';
import { StoneFloor } from './stone-floor';
import { CellFoundations } from './cell-foundations';
import { createEnvironment } from './environment';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Simulation } from '../shared/simulation';

export type TileView={ side:Side;cell:Cell;root:TransformNode;tile:ReturnType<typeof MeshBuilder.CreateBox>;originalMaterial:StandardMaterial;crackedMaterial:StandardMaterial;cracks:TransformNode };

/** Procedural arena and replaceable visual slots. No movement, collision, damage or network decisions. */
export function createArenaPresentation(scene: Scene) {
function material(name:string, hex:string) { const m=new StandardMaterial(name,scene); m.diffuseColor=Color3.FromHexString(hex).toLinearSpace();m.specularColor=Color3.Black();return m; }
const teal=material('teal','#248F8D'),coral=material('coral','#C76D5E'),stone=material('stone','#989792'),dark=material('protected','#535E6C'),skin=material('dummy head','#D5BE97'),boots=material('boots','#374353');
const floors=Array.from({length:4},(_,i)=>material('limestone'+i,['#B2AEA0','#A6A598','#BDB5A5','#A9ADA4'][i]));
const crackedFloor=material('cracked limestone','#887D6B');
const crackInk=material('crack ink','#28252A');
function box(name:string,w:number,h:number,d:number,pos:Vector3,mat:StandardMaterial,parent?:TransformNode) {const m=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);m.position=pos;m.material=mat;if(parent)m.parent=parent;return m;}
const tileViews:TileView[]=[];
const arsenalCasters:Mesh[]=[];
for(const side of [0,1] as Side[]) {
  const color=side===0?teal:coral;
  for(const cell of map.cells) {
    const p=cellCentre(cell,side);
    const root=new TransformNode(`cell-${side}-${cell.x}-${cell.z}`,scene);
    const originalMaterial=cell.role==='normal'?floors[(cell.x*7+cell.z*3)%4]:dark;
    const tile=box(`tile-${side}-${cell.x}-${cell.z}`,size-.045,1.1,size-.045,new Vector3(p.x,-.55,p.z),originalMaterial,root);
    const crackPaths=[
      [new Vector3(-1.35,0,-.8),new Vector3(-.4,0,-.3),new Vector3(-.6,0,.25),new Vector3(.3,0,.6),new Vector3(.7,0,1.35)],
      [new Vector3(-.4,0,-.3),new Vector3(.3,0,-.8),new Vector3(1.35,0,-.5)],
      [new Vector3(-.6,0,.25),new Vector3(-1.35,0,.9)]
    ];
    const cracks=new TransformNode('contrast cracks',scene);cracks.parent=root;cracks.position.set(p.x,.055,p.z);
    for(const path of crackPaths)for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],mid=a.add(b).scale(.5);
      const segment=box('crack',.14,.025,Vector3.Distance(a,b),mid,crackInk,cracks);segment.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);
    }
    cracks.setEnabled(false);
    tileViews.push({side,cell,root,tile,originalMaterial,crackedMaterial:crackedFloor,cracks});
    if(cell.x===0||cell.x===8||cell.z===10)box('side inlay',.45,.025,.08,new Vector3(p.x,.018,p.z-size/2+.12),color,root);
    if(cell.role==='protected') {
      box('P inlay',size-.18,.04,.13,new Vector3(p.x,.025,p.z),color,root);
      const ring=MeshBuilder.CreateTorus('P protected',{diameter:.65,thickness:.035,tessellation:4},scene);ring.parent=root;ring.position.set(p.x,.035,p.z);ring.material=color;
    }
    if(cell.role==='arsenal') {
      const rocks:Mesh[]=[];
      for(let row=0;row<3;row++) for(let x=0;x<3-row;x++) for(let z=0;z<3-row;z++) {
        const rock=box(`R stone ${side}`,.78,.7,.78,new Vector3(p.x+(x-(2-row)/2)*.79,.36+row*.65,p.z+(z-(2-row)/2)*.79),stone,root);
        rock.rotation.y=(x+z+row)*.12;
        rocks.push(rock);
      }
      const pile=Mesh.MergeMeshes(rocks,true,true);if(pile){pile.name=`R stone ${side}`;pile.parent=root;pile.receiveShadows=false;arsenalCasters.push(pile);}
    }
  }
}
function dummy(side:Side) {
  const root=new TransformNode('temporary dummy '+side,scene);const color=side===0?teal:coral;
  const body=MeshBuilder.CreateCapsule('placeholder torso',{height:1.2,radius:.5,tessellation:12},scene);body.parent=root;body.position.y=1.05;body.material=color;
  const head=MeshBuilder.CreateSphere('placeholder head',{diameter:.55,segments:12},scene);head.parent=root;head.position.y=1.725;head.material=skin;
  for(const x of [-.27,.27])box('foot',.32,.45,.47,new Vector3(x,.225,.02),boots,root);
  for(const x of [-.65,.65])box('arm',.22,.7,.28,new Vector3(x,1.05,0),color,root);
  box('front marker',.3,.12,.05,new Vector3(0,1.3,.48),skin,root);
  return root;
}
const player=new TransformNode("actor view 0",scene),enemy=new TransformNode("actor view 1",scene);enemy.rotation.y=Math.PI; const actorFallbacks=[dummy(0),dummy(1)];actorFallbacks[0].parent=player;actorFallbacks[1].parent=enemy;
const environment=new TransformNode('environment view',scene),environmentFallback=createEnvironment(scene,environment);
const outline=MeshBuilder.CreateLines('one cell border',{points:[new Vector3(-size/2,.06,-size/2),new Vector3(size/2,.06,-size/2),new Vector3(size/2,.06,size/2),new Vector3(-size/2,.06,size/2),new Vector3(-size/2,.06,-size/2)]},scene);outline.color=Color3.FromHexString('#FFF1A3');outline.isPickable=false;
const glow=material('target wash','#FFE4A0');glow.alpha=.18;glow.emissiveColor=new Color3(.35,.28,.1);
const wash=MeshBuilder.CreateGround('selected cell',{width:size-.08,height:size-.08},scene);wash.material=glow;wash.position.y=.03;wash.isPickable=false;

const slots=[new VisualSlot(scene,player,actorFallbacks[0]),new VisualSlot(scene,enemy,actorFallbacks[1]),new VisualSlot(scene,environment,environmentFallback)];
const foundations=new CellFoundations(scene,tileViews);
const stoneFloor=new StoneFloor(scene,tileViews);
function loadAssets(assets:VisualAssets) { return Promise.all([slots[0].load(assets.characters[0]),slots[1].load(assets.characters[1]),slots[2].load(assets.environment)]); }
void loadAssets(visualAssets);
let round=-1,context='';const seenShots=new Set<number>();
function animate(sim:Simulation,dt:number,localSide:Side,preparing:boolean,reset:boolean,identity:string){
  const changed=round!==sim.round||context!==identity;if(changed){round=sim.round;context=identity;seenShots.clear();}
  const released=[false,false];for(const shot of sim.shots){if(!seenShots.has(shot.id)&&!changed)released[shot.owner]=true;seenShots.add(shot.id);}
  slots.slice(0,2).forEach((slot,side)=>slot.animate(dt,side===localSide&&preparing,released[side],reset||changed||sim.actors[side as Side].falling));
}
scene.onDisposeObservable.add(()=>slots.forEach(slot=>slot.dispose()));
return { player,enemy,tileViews,crackedFloor,outline,wash,box,material,loadAssets,stoneFloor,foundations,animate,inspect:()=>slots.slice(0,2).map(s=>s.inspect()),casters:()=>[...arsenalCasters,...slots.slice(0,2).flatMap(s=>s.meshes())],diagnostics:()=>slots.map(slot=>slot.diagnostics()) };
}
