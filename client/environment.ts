import type {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';

/** Static, atmospheric 3D layers. The supplied reference is never used as a background texture. */
export function createEnvironment(scene:Scene,parent:TransformNode){
  const root=new TransformNode('ENV-006 distant landscape',scene);root.parent=parent;
  const sky=MeshBuilder.CreateSphere('gradient sky',{diameter:490,segments:24,sideOrientation:Mesh.BACKSIDE},scene);sky.parent=root;sky.applyFog=false;
  const skyMat=new StandardMaterial('soft sky gradient',scene);skyMat.disableLighting=true;skyMat.emissiveColor=Color3.White();sky.material=skyMat;
  const vertices=sky.getVerticesData('position')!,colors:number[]=[];
  for(let i=0;i<vertices.length;i+=3){
    const t=(vertices[i+1]+245)/490,base=Color3.Lerp(Color3.FromHexString('#BBB8D4'),Color3.FromHexString('#A6BADC'),t),warm=Math.max(0,1-Math.abs(t-.34)/.27)*.65;
    const color=Color3.Lerp(base,Color3.FromHexString('#F0D8CC'),warm);colors.push(color.r,color.g,color.b,1);
  }sky.setVerticesData('color',colors);
  const profile=[new Vector3(0,0,0),new Vector3(.85,0,0),new Vector3(1,.2,0),new Vector3(.88,.55,0),new Vector3(.60,.84,0),new Vector3(.27,.98,0),new Vector3(0,1,0)];
  for(let layer=0;layer<3;layer++){
    const source=MeshBuilder.CreateLathe('mountain template '+layer,{shape:profile,tessellation:10},scene);source.parent=root;source.isVisible=false;source.convertToFlatShadedMesh();
    const material=new StandardMaterial('mountain haze '+layer,scene);material.disableLighting=true;material.emissiveColor=Color3.White();source.material=material;
    const normals=source.getVerticesData('normal')!,baked:number[]=[],tint=Color3.FromHexString(['#ADA1B6','#BEB3C8','#CFC8D8'][layer]).toLinearSpace(),light=new Vector3(.45,.8,-.35).normalize();
    for(let i=0;i<normals.length;i+=3){const shade=.78+.22*Math.max(0,normals[i]*light.x+normals[i+1]*light.y+normals[i+2]*light.z);baked.push(tint.r*shade,tint.g*shade,tint.b*shade,1);}source.setVerticesData('color',baked);
    for(let i=0;i<6;i++){const angle=i/6*Math.PI*2+layer*.57+.2,radius=140+layer*35,rock=source.createInstance(`far rock ${layer}/${i}`);rock.parent=root;rock.isVisible=true;rock.position.set(Math.sin(angle)*radius,-70-layer*8,Math.cos(angle)*radius);rock.scaling.set(10+i%3*2,45+i%3*7,11+i%2*3);rock.rotation.y=i*.7;}
  }
  const texture=new DynamicTexture('shared soft cloud',{width:96,height:64},scene,false),ctx=texture.getContext();ctx.clearRect(0,0,96,64);
  for(const [x,y,r] of [[25,39,25],[48,39,28],[70,39,24],[30,29,22],[49,23,22],[68,30,20]]){
    const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,y<35?'rgba(255,236,211,.95)':'rgba(195,182,211,.8)');g.addColorStop(.66,y<35?'rgba(250,222,207,.8)':'rgba(194,181,211,.6)');g.addColorStop(1,'rgba(210,193,216,0)');ctx.fillStyle=g;ctx.fillRect(0,0,96,64);
  }texture.hasAlpha=true;texture.update();
  const cloud=new StandardMaterial('soft cloud banks',scene);cloud.disableLighting=true;cloud.emissiveColor=Color3.White();cloud.emissiveTexture=cloud.diffuseTexture=texture;cloud.useAlphaFromDiffuseTexture=true;cloud.backFaceCulling=false;cloud.alpha=.62;
  for(let i=0;i<10;i++){const m=MeshBuilder.CreatePlane('cloud below arenas',{width:34+i%3*6,height:17+i%2*4},scene);m.position.set(Math.sin(i*2.4)*(65+i%2*30),-14-i%3*4,Math.cos(i*2.4)*(65+i%2*30));m.billboardMode=Mesh.BILLBOARDMODE_ALL;m.material=cloud;m.parent=root;}
  for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=false;}
  return root;
}
