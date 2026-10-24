import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { cellCentre, type Cell, type Side } from '../shared/world';
import { tileAppearance, VARIANTS, type Variant, APPEARANCE_VERSION } from '../shared/tile-appearance';
import type { Simulation } from '../shared/simulation';
import type { TileView } from './presentation';

type Kind='intact'|'cracked'|'fragments';
type TileRender={view:TileView;variant:Variant;rotation:number;hp:number;model:InstantiatedEntries|null;kind:Kind|null};
type Burst={id:string;root:TransformNode;entries:InstantiatedEntries|null;parts:TransformNode[];age:number;newborn:boolean};
const LIFETIME=1.05,MAX_BURSTS=12;
export class StoneFloor {
  private templates=new Map<string,AssetContainer>();
  private materials=new Map<string,Material>();
  private failures:Record<string,string>={};
  private bounds:Record<string,{min:number[];max:number[]}>={};
  private tiles:TileRender[]=[];
  private seed=-1; private round=-1;
  private seen=new Set<string>();
  private bursts:Burst[]=[];
  private emitted=0;
  private emittedParts=0;
  private fallbackMaterial:StandardMaterial;
  constructor(private scene:Scene,private views:TileView[]){
    this.fallbackMaterial=new StandardMaterial('fallback stone debris',scene);this.fallbackMaterial.diffuseColor=Color3.FromHexString('#A9997E');
    void this.load();scene.onDisposeObservable.add(()=>this.dispose());
  }
  private async load(){
    try{await import('@babylonjs/loaders/glTF/2.0');}catch(error){this.failures.plugin=String(error);return;}
    await Promise.all(VARIANTS.map(async variant=>{
      for(const kind of ['intact','cracked','fragments'] as Kind[]){
        const key=`${variant}/${kind}`;
        try{
          const container=await LoadAssetContainerAsync(`/art/blocks-abc-v03/tile_${variant.toLowerCase()}_${kind}.glb`,this.scene,{pluginExtension:'.glb'});
          if(this.scene.isDisposed){container.dispose();return;}
          const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
          for(const mesh of container.meshes){
            if(mesh.getTotalVertices()){mesh.computeWorldMatrix(true);min.minimizeInPlace(mesh.getBoundingInfo().boundingBox.minimumWorld);max.maximizeInPlace(mesh.getBoundingInfo().boundingBox.maximumWorld);}
            mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=true;
            if(mesh.material){const materialKey=`${variant}/${mesh.material.name}`;const existing=this.materials.get(materialKey);if(existing)mesh.material=existing;else this.materials.set(materialKey,mesh.material);}
          }
          const retained=new Set(this.materials.values());
          for(const material of container.materials)if(!retained.has(material))material.dispose(false,true);
          container.materials=container.materials.filter(m=>retained.has(m));
          this.bounds[key]={min:min.asArray(),max:max.asArray()};
          this.templates.set(key,container);
        }catch(error){this.failures[key]=String((error as Error).message??error);console.warn('Stone GLB fallback:',key,this.failures[key]);}
      }
    }));
  }
  private instantiate(variant:Variant,kind:Kind,label:string,parent:TransformNode){
    const template=this.templates.get(`${variant}/${kind}`);if(!template)return null;
    const result=template.instantiateModelsToScene(name=>`${label}/${name}`,false,{doNotInstantiate:false});
    for(const node of result.rootNodes)node.parent=parent;
    for(const node of result.rootNodes)for(const mesh of node.getChildMeshes(false)){mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=true;}
    return result;
  }
  update(sim:Simulation,seed:number,dt:number){
    const changed=this.seed!==seed||this.round!==sim.round;
    if(changed){
      this.clearBursts();this.seen.clear();
      if(this.seed!==seed){for(const tile of this.tiles)tile.model?.dispose();this.tiles=this.views.map(view=>({...tileAppearance(seed,view.side,view.cell),view,hp:sim.hp(view.cell,view.side),model:null,kind:null}));}
      else for(const tile of this.tiles)tile.hp=sim.hp(tile.view.cell,tile.view.side);
      this.seed=seed;this.round=sim.round;
    }
    for(const tile of this.tiles){
      const hp=sim.hp(tile.view.cell,tile.view.side),kind=hp===1?'cracked':'intact';
      if(!changed&&tile.hp>0&&hp===0)this.destroy(tile,`${seed}/${sim.round}/${tile.view.side}/${tile.view.cell.z}/${tile.view.cell.x}/destroy`);
      tile.hp=hp;tile.view.root.setEnabled(hp>0);
      if(hp<=0){tile.model?.dispose();tile.model=null;tile.kind=null;continue;}
      if(tile.kind!==kind||!tile.model&&this.templates.has(`${tile.variant}/${kind}`)){
        tile.model?.dispose();tile.model=null;tile.kind=kind;
        const anchor=new TransformNode(`stone-${tile.view.side}-${tile.view.cell.x}-${tile.view.cell.z}`,this.scene);
        anchor.parent=tile.view.root;const p=cellCentre(tile.view.cell,tile.view.side);anchor.position.set(p.x,0,p.z);anchor.rotation.y=tile.rotation*Math.PI/2;
        tile.model=this.instantiate(tile.variant,kind,'tile',anchor);
        if(tile.model){const entries=tile.model,dispose=entries.dispose.bind(entries);entries.dispose=()=>{dispose();anchor.dispose();};}else anchor.dispose();
      }
      tile.view.tile.setEnabled(!tile.model);tile.view.cracks.setEnabled(!tile.model&&hp===1);tile.view.tile.material=hp===1?tile.view.crackedMaterial:tile.view.originalMaterial;
    }
    for(const burst of [...this.bursts]){
      // dt precedes this frame's impact; it is not time elapsed since a newly created effect.
      if(burst.newborn){burst.newborn=false;continue;}
      burst.age+=dt;const t=burst.age;
      burst.parts.forEach((part,i)=>{part.position.y=-.2*t-(5+i*.7)*t*t;part.position.x=Math.sin(i*2.4)*t*.35;part.position.z=Math.cos(i*2.4)*t*.35;part.rotation.x=t*(i%2?-.7:.7);part.rotation.z=t*.3;});
      if(t>=LIFETIME)this.removeBurst(burst);
    }
  }
  private destroy(tile:TileRender,id:string){
    if(this.seen.has(id))return;this.seen.add(id);
    if(this.bursts.length>=MAX_BURSTS)this.removeBurst(this.bursts[0]);
    const root=new TransformNode(`debris/${id}`,this.scene),p=cellCentre(tile.view.cell,tile.view.side);root.position.set(p.x,0,p.z);root.rotation.y=tile.rotation*Math.PI/2;
    const entries=this.instantiate(tile.variant,'fragments','vfx',root);
    let parts:TransformNode[]=[];
    if(entries){for(const node of entries.rootNodes){if(/\/fragment_[abc]_\d+$/.test(node.name))parts.push(node as TransformNode);parts.push(...node.getDescendants(false).filter(n=>/\/fragment_[abc]_\d+$/.test(n.name)) as TransformNode[]);}for(const part of parts)part.rotationQuaternion=null;}
    else for(let i=0;i<({A:3,B:4,C:5}[tile.variant]);i++){const mesh=MeshBuilder.CreateBox('fallback fragment',{width:.6,height:.25,depth:.6},this.scene);mesh.parent=root;mesh.material=this.fallbackMaterial;mesh.isPickable=false;parts.push(mesh);}
    this.bursts.push({id,root,entries,parts,age:0,newborn:true});this.emitted++;this.emittedParts+=parts.length;
  }
  private removeBurst(burst:Burst){burst.entries?.dispose();burst.root.dispose();this.bursts=this.bursts.filter(b=>b!==burst);}
  private clearBursts(){for(const burst of [...this.bursts])this.removeBurst(burst);}
  private dispose(){this.clearBursts();for(const tile of this.tiles)tile.model?.dispose();for(const template of this.templates.values())template.dispose();}
  diagnostics(){return {seed:this.seed,version:APPEARANCE_VERSION,readyTemplates:this.templates.size,failures:{...this.failures},bounds:{...this.bounds},materialCount:this.materials.size,activeBursts:this.bursts.map(b=>({id:b.id,parts:b.parts.length,age:b.age})),emitted:this.emitted,emittedParts:this.emittedParts,maxBursts:MAX_BURSTS,lifetime:LIFETIME,tiles:this.tiles.map(t=>({side:t.view.side,...t.view.cell,variant:t.variant,rotation:t.rotation,hp:Number.isFinite(t.hp)?t.hp:-1,model:!!t.model,kind:t.kind}))};}
}
