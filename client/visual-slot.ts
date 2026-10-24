import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VisualAsset } from './visual-assets';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

/** Presentation-only replaceable slot. Its anchor is driven by simulation, never by imported meshes. */
export class VisualSlot {
  status: 'placeholder' | 'loading' | 'loaded' | 'error' = 'placeholder';
  error = '';
  private container: AssetContainer | null = null;
  private revision = 0;
  private clips = new Map<string,AnimationGroup>();
  private pose = 'idle'; private poseTime=0; private walkWeight=0; private throwWeight=0;
  private stone:ReturnType<typeof MeshBuilder.CreateSphere>|null=null;
  private previousPosition:{x:number;z:number}|null=null;
  private throws=0;
  private height=0;
  constructor(private scene: Scene, private anchor: TransformNode, private placeholder: TransformNode) {}
  async load(asset: VisualAsset | null) {
    const revision = ++this.revision;
    this.stone?.dispose(false,true);this.stone=null;this.clips.clear();this.pose='idle';this.previousPosition=null;this.throwWeight=0;this.walkWeight=0;
    this.container?.dispose(); this.container = null; this.placeholder.setEnabled(true); this.error = '';
    if (!asset) { this.status = 'placeholder'; return; }
    this.status = 'loading';
    let container: AssetContainer | null = null;
    try {
      // The matching official glTF plugin is fetched as a code chunk only when a slot has a URL.
      await import('@babylonjs/loaders/glTF/2.0');
      container = await LoadAssetContainerAsync(asset.url, this.scene, { pluginExtension: '.glb' });
      if (revision !== this.revision || this.scene.isDisposed) { container.dispose(); return; }
      if (!container.meshes.some(mesh => mesh.getTotalVertices() > 0)) throw Error('GLB has no renderable geometry');
      // Imported lights/cameras/animation never become gameplay systems or the active camera.
      for (const light of container.lights) light.setEnabled(false);
      for (const camera of container.cameras) camera.setEnabled(false);
      for (const group of container.animationGroups) group.stop();
      const root = container.createRootMesh();
      root.scaling.setAll(asset.visualHeight ? asset.visualHeight/(asset.nativeHeight??3.2) : asset.scale ?? 1);
      this.height=asset.visualHeight??0;
      root.rotation.y = asset.yaw ?? 0;
      for (const mesh of container.meshes) { mesh.isPickable = false; mesh.checkCollisions = false; mesh.receiveShadows=true; }
      container.addAllToScene();
      root.parent = this.anchor;
      this.container = container; this.placeholder.setEnabled(false); this.status = 'loaded';
      for(const group of container.animationGroups){this.clips.set(group.name.split('.').pop()!,group);group.enableBlending=true;group.blendingSpeed=.12;}
      for(const name of ['idle','walk']){const clip=this.clips.get(name);clip?.start(true);clip?.setWeightForAllAnimatables(name==='idle'?1:0);}
      const socket=container.transformNodes.find(n=>n.name==='stone_socket_R');
      if(socket){this.stone=MeshBuilder.CreateSphere('decorative held stone',{diameter:.5,segments:8},this.scene);this.stone.parent=socket;this.stone.isPickable=false;const m=new StandardMaterial('held stone',this.scene);m.diffuseColor=Color3.FromHexString('#A49A87').toLinearSpace();m.specularColor=Color3.Black();this.stone.material=m;this.stone.setEnabled(false);}
    } catch (error) {
      container?.dispose();
      if (revision !== this.revision || this.scene.isDisposed) return;
      this.error = String((error as Error).message ?? error); this.status = 'error'; this.placeholder.setEnabled(true);
      console.warn('Visual asset unavailable; procedural placeholder retained:', asset.url, this.error);
    }
  }
  /** Local preparation stays local. Only confirmed public shot IDs trigger the release pose. */
  animate(dt:number, preparing:boolean, released:boolean, reset:boolean){
    const p=this.anchor.position,old=this.previousPosition;this.previousPosition={x:p.x,z:p.z};
    const moving=!!old&&dt>0&&Math.hypot(p.x-old.x,p.z-old.z)/dt>.15;
    this.walkWeight+=(Number(moving)-this.walkWeight)*Math.min(1,dt*10);
    const clip=this.clips.get('throw');let started=false;
    if(reset){this.pose='idle';this.poseTime=0;this.throwWeight=0;clip?.stop();}
    else if(released&&clip){this.pose='throw';this.poseTime=0;started=true;this.throws++;clip.stop();clip.start(false,1,(clip.from+clip.to)/2,clip.to);}
    else if(preparing&&this.pose==='idle'&&clip){this.pose='prepare';this.poseTime=0;started=true;clip.stop();clip.start(false,1,clip.from,clip.to);}
    else if(!preparing&&this.pose==='prepare'){this.pose='idle';}
    if(!started)this.poseTime+=dt;
    if(this.pose==='prepare'&&this.poseTime>=.35&&clip){clip.pause();clip.goToFrame((clip.from+clip.to)/2);}
    if(this.pose==='throw'&&this.poseTime>=.375)this.pose='idle';
    const weight=this.pose==='idle'?0:this.pose==='throw'?Math.min(1,(.375-this.poseTime)/.10):1;
    this.throwWeight+=(weight-this.throwWeight)*Math.min(1,dt*18);
    if(this.pose==='idle'&&this.throwWeight<.01){clip?.stop();this.throwWeight=0;}
    clip?.setWeightForAllAnimatables(this.throwWeight);
    this.clips.get('idle')?.setWeightForAllAnimatables((1-this.walkWeight)*(1-this.throwWeight));
    const walk=this.clips.get('walk');if(walk)walk.speedRatio=1.6;
    walk?.setWeightForAllAnimatables(this.walkWeight*(1-this.throwWeight));
    this.stone?.setEnabled(this.pose==='prepare'&&!reset);
  }
  meshes(){return this.container?.meshes.filter(m=>m.getTotalVertices()>0)??[];}
  /** Read-only, test-only CPU skin inspection of the actual rendered mesh (not a synthetic rig). */
  inspect(){const mesh=this.meshes()[0];if(!mesh)return null;const positions=mesh.getPositionData(true);const weights=mesh.getVerticesData('matricesWeights');if(!positions||!weights)return null;const sample:number[]=[];for(let i=0;i<mesh.getTotalVertices();i++)if(i%97===0||weights[i*4+1]>.1&&i%7===0)sample.push(i,...Array.from(positions.slice(i*3,i*3+3)));return sample;}
  dispose() { ++this.revision; this.stone?.dispose(false,true);this.container?.dispose(); this.container = null; }
  diagnostics() { return { status:this.status,error:this.error,placeholderEnabled:this.placeholder.isEnabled(),importedMeshes:this.meshes().length,interactiveMeshes:this.container?.meshes.filter(mesh=>mesh.isPickable||mesh.checkCollisions).length??0,visualHeight:this.height,clips:[...this.clips.keys()],pose:this.pose,walkWeight:this.walkWeight,throwWeight:this.throwWeight,throws:this.throws,bones:this.container?.skeletons[0]?.bones.length??0,boneSample:this.container?.skeletons[0]?.getTransformMatrices(null).slice(5*16,6*16),vertices:this.meshes().reduce((n,m)=>n+m.getTotalVertices(),0),triangles:this.meshes().reduce((n,m)=>n+m.getTotalIndices()/3,0),materials:new Set(this.meshes().map(m=>m.material)).size }; }
}
