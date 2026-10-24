import {Mesh} from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Ray} from '@babylonjs/core/Culling/ray';
import type {Scene} from '@babylonjs/core/scene';
import {cellCentre,size,type Point} from '../shared/world';
import type {TileView} from './presentation';

/** One independent decorative instance per HP-driven cell root; never gameplay support. */
export class CellFoundations {
  private source:Mesh;
  private instances;
  constructor(private scene:Scene,views:TileView[]){
    const collar=MeshBuilder.CreateBox('rock collar',{width:size,height:.25,depth:size},scene);collar.position.y=-.525;
    const rock=MeshBuilder.CreateCylinder('faceted hanging rock',{diameterTop:size,diameterBottom:1.90,height:1.0,tessellation:8,subdivisions:2},scene);rock.position.y=-1.15;
    const material=new StandardMaterial('shared rock foundation',scene);material.diffuseColor=Color3.FromHexString('#B89775').toLinearSpace();material.specularColor=Color3.Black();material.emissiveColor=new Color3(.07,.045,.03);
    collar.material=rock.material=material;
    const source=this.source=Mesh.MergeMeshes([collar,rock],true,true)!;source.name='foundation template';source.convertToFlatShadedMesh();source.isVisible=false;source.isPickable=false;source.checkCollisions=false;
    this.instances=views.map(view=>{const mesh=source.createInstance(`foundation/${view.side}/${view.cell.z}/${view.cell.x}`),p=cellCentre(view.cell,view.side);mesh.parent=view.root;mesh.position.set(p.x,0,p.z);mesh.rotation.y=((view.cell.x*3+view.cell.z+view.side)%4)*Math.PI/2;mesh.isVisible=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=false;return {view,mesh};});
  }
  diagnostics(){return {bounds:{min:this.source.getBoundingInfo().boundingBox.minimum.asArray(),max:this.source.getBoundingInfo().boundingBox.maximum.asArray()},depth:1.65,top:-.4,geometryCount:new Set(this.instances.map(i=>i.mesh.geometry?.uniqueId)).size,materialCount:new Set(this.instances.map(i=>i.mesh.material?.uniqueId)).size,trianglesPerCell:this.source.getTotalIndices()/3,instances:this.instances.length,active:this.instances.filter(i=>i.mesh.isEnabled()).length,interactive:this.instances.filter(i=>i.mesh.isPickable||i.mesh.checkCollisions).length,cells:this.instances.map(({view,mesh})=>({side:view.side,...view.cell,visible:mesh.isEnabled()}))};}
  /** Test-only read of actual rendered triangles, bypassing their disabled gameplay picking. */
  inspect(points:Point[]){return points.map(point=>{const pick=this.scene.pickWithRay(new Ray(new Vector3(point.x,.2,point.z),new Vector3(0,-1,0),4),m=>m.name.startsWith('foundation/')&&m.isEnabled()&&m.isVisible);return {point,hit:!!pick?.hit,y:pick?.pickedPoint?.y??null,mesh:pick?.pickedMesh?.name??null};});}
}
