from pathlib import Path
import json,math,struct,hashlib,zipfile,shutil,io
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from scipy.spatial import cKDTree
from shapely.geometry import Polygon
from shapely.ops import triangulate
from shapely import constrained_delaunay_triangles
import trimesh

ROOT=Path(__file__).resolve().parent.parent
for n in ['models','textures','previews','tools']:(ROOT/n).mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(241026)
SIZE=512
grid=np.stack(np.meshgrid(np.linspace(0,1,SIZE),np.linspace(0,1,SIZE)),axis=-1)
# A restrained field of broad stone facets, not cracks or realistic noisy pores.
sites=rng.random((260,2));dist,idx=cKDTree(sites).query(grid.reshape(-1,2));values=rng.uniform(-6,6,len(sites))
tone=values[idx].reshape(SIZE,SIZE)
broad=Image.fromarray(np.uint8(rng.uniform(60,190,(9,9)))).resize((SIZE,SIZE),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(30))
tone+= (np.array(broad,dtype=float)-128)*.055
base=np.array([226,207,171],float)
tex=np.clip(base[None,None,:]+tone[:,:,None]*np.array([1,.93,.78]),0,255).astype(np.uint8)
im=Image.fromarray(tex);im.save(ROOT/'textures/sandstone_a_basecolor.png')
png=(ROOT/'textures/sandstone_a_basecolor.png').read_bytes()
MATS=[('StoneTop',[1,1,1,1],True),('StoneBevel',[.94,.90,.82,1],True),('StoneSide',[.75,.70,.60,1],True),('Fracture',[.19,.16,.12,1],False)]

def triang(poly,z):
 ts=list(constrained_delaunay_triangles(poly).geoms)
 assert abs(sum(t.area for t in ts)-poly.area)<1e-6
 return [[(float(x),float(y),z) for x,y in list(t.exterior.coords)[:3]] for t in ts]
class Mesh:
 def __init__(self,name):self.name=name;self.v=[];self.f=[];self.m=[]
 def tri(self,a,b,c,mat):
  va,vb,vc=np.array(a),np.array(b),np.array(c)
  if np.linalg.norm(np.cross(vb-va,vc-va))<1e-10:return
  i=len(self.v);self.v.extend([list(a),list(b),list(c)]);self.f.append([i,i+1,i+2]);self.m.append(mat)
 def quad(self,a,b,c,d,mat):self.tri(a,b,c,mat);self.tri(a,c,d,mat)
 def cap(self,poly,z,mat,up=True):
  for t in triang(poly,z):
   if np.cross(np.array(t[1])-t[0],np.array(t[2])-t[0])[2]<0:t=t[::-1]
   self.tri(*t,mat) if up else self.tri(*t[::-1],mat)
 def slab(self,poly,top=0,bottom=-.4,bevel=.035,fracture=False):
  p=np.array(poly.exterior.coords[:-1]);
  if not poly.exterior.is_ccw:p=p[::-1]
  ctr=np.array(poly.representative_point().coords[0]);span=np.max(np.ptp(p,axis=0))
  # Same vertex correspondence keeps chipped silhouette and avoids topology drift.
  local_rng=np.random.default_rng(len(p)*31+7)
  amount=local_rng.uniform(.043,.065,len(p)) if span>2 else local_rng.uniform(.025,.045,len(p))
  inner=ctr+(p-ctr)*(1-amount[:,None])
  zbevel=local_rng.uniform(.045,.083,len(p))
  rings=[np.column_stack([inner,np.full(len(p),bottom)]),np.column_stack([p,bottom+zbevel*.65]),np.column_stack([p,top-zbevel]),np.column_stack([inner,np.full(len(p),top)])]
  self.cap(Polygon(inner),bottom,2,False)
  for j in range(3):
   for i in range(len(p)):
    k=(i+1)%len(p);self.quad(rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i],2 if j==1 else 1)
  self.cap(Polygon(inner),top,0)
 def overlay(self,poly):
  p=np.array(poly.exterior.coords[:-1]);
  if not poly.exterior.is_ccw:p=p[::-1]
  inner=Polygon(p).buffer(-.008,join_style=2)
  # Fracture upper regions are thin closed prisms; no gameplay holes.
  self.cap(Polygon(p),-.045,3,False);self.cap(Polygon(p),-.008,1)
  self.cap(inner,0,0)
  ip=np.array(inner.exterior.coords[:-1]);
  # Buffer may change vertex count; top gap covered by a bevel ring triangulated as polygon with hole.
  ring=Polygon(p).difference(inner)
  for t in triang(ring,-.004):self.tri(*t,1)
  for i in range(len(p)):
   k=(i+1)%len(p);self.quad((*p[i],-.045),(*p[k],-.045),(*p[k],-.008),(*p[i],-.008),3)

# Eight restrained chips per side, with fixed outer size and no raised walking surface.
points=[]
corners=[(-1.4,-1.4),(1.4,-1.4),(1.4,1.4),(-1.4,1.4)]
for side in range(4):
 a=np.array(corners[side]);b=np.array(corners[(side+1)%4]);u=(b-a)/2.8;n=np.array([-u[1],u[0]])
 for t in [.018,.13,.26,.39,.52,.65,.78,.982]:
  d=float(rng.uniform(0,.045));p=a+(b-a)*t+n*d;points.append(p.tolist())
# include exact extrema at central side points, still within grid square
for side in range(4):
 i=side*8+4
 if side==0:points[i][1]=-1.4
 if side==1:points[i][0]=1.4
 if side==2:points[i][1]=1.4
 if side==3:points[i][0]=-1.4
outer=Polygon(points);assert outer.is_valid
center=np.array([.10,-.06]);ends=[3,13,24];paths=[]
for k,e in enumerate(ends):
 end=np.array(points[e]);d=end-center;n=np.array([-d[1],d[0]]);n/=np.linalg.norm(n)
 paths.append([center.tolist(),(center+d*.32+n*(.075 if k!=1 else -.085)).tolist(),(center+d*.62-n*.065).tolist(),(center+d*.84+n*.045).tolist(),end.tolist()])
regions=[]
for k in range(3):
 a,b=ends[k],ends[(k+1)%3];arc=[];i=a
 while i!=b:arc.append(points[i]);i=(i+1)%len(points)
 arc.append(points[b]);poly=Polygon(paths[k]+arc[1:]+list(reversed(paths[(k+1)%3]))[1:]);assert poly.is_valid
 regions.append(poly)
assert abs(sum(p.area for p in regions)-outer.area)<1e-6
intact=Mesh('tile_a_intact');intact.slab(outer)
cracked=Mesh('tile_a_cracked');cracked.slab(outer,top=-.045)
# Make the underlying recess uniformly dark, then add naturally fractured caps.
for i in range(len(cracked.m)):
 if cracked.m[i]==0:cracked.m[i]=3
for poly in regions:cracked.overlay(poly.buffer(-.024,join_style=2))
pieces=[]
for i,poly in enumerate(regions):
 m=Mesh('fragment_a_%02d'%(i+1));m.slab(poly,bevel=.025);pieces.append(m)
assets={'tile_a_intact':[intact],'tile_a_cracked':[cracked],'tile_a_fragments':pieces}

def writeglb(meshes,path):
 blob=bytearray();views=[];accessors=[];meshesout=[];nodes=[]
 def raw(data):
  while len(blob)%4:blob.append(0)
  off=len(blob);blob.extend(data);i=len(views);views.append({'buffer':0,'byteOffset':off,'byteLength':len(data)});return i
 def arr(a,typ,comp):
  view=raw(a.tobytes());item={'bufferView':view,'componentType':comp,'count':len(a),'type':typ}
  if typ=='VEC3':item.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
  i=len(accessors);accessors.append(item);return i
 for m in meshes:
  vv=np.array(m.v);gl=vv[:,[0,2,1]].copy();gl[:,2]*=-1;fs=np.array(m.f);prims=[]
  for mat in sorted(set(m.m)):
   ids=fs[np.array(m.m)==mat].reshape(-1);v=gl[ids].astype('<f4');uv=((vv[ids,:2]+1.4)/2.8).astype('<f4');uv[:,1]=1-uv[:,1]
   n=np.cross(v[1::3]-v[::3],v[2::3]-v[::3]);n/=np.linalg.norm(n,axis=1)[:,None]
   prims.append({'attributes':{'POSITION':arr(v,'VEC3',5126),'NORMAL':arr(np.repeat(n,3,axis=0).astype('<f4'),'VEC3',5126),'TEXCOORD_0':arr(uv,'VEC2',5126)},'indices':arr(np.arange(len(v),dtype='<u4'),'SCALAR',5125),'material':mat,'mode':4})
  meshesout.append({'name':m.name,'primitives':prims});nodes.append({'name':m.name,'mesh':len(meshesout)-1})
 imageview=raw(png);materials=[]
 for n,c,textured in MATS:
  pbr={'baseColorFactor':c,'metallicFactor':0,'roughnessFactor':.94}
  if textured:pbr['baseColorTexture']={'index':0}
  materials.append({'name':n,'pbrMetallicRoughness':pbr})
 doc={'asset':{'version':'2.0','generator':'Titans stone block A v0.2'},'scene':0,'scenes':[{'nodes':list(range(len(nodes)))}],'nodes':nodes,'meshes':meshesout,'materials':materials,'images':[{'bufferView':imageview,'mimeType':'image/png'}],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],'textures':[{'sampler':0,'source':0}],'bufferViews':views,'accessors':accessors,'buffers':[{'byteLength':len(blob)}],'extras':{'units':'meters','width':2.8,'thickness':.4,'topY':0,'visual_only':True,'variant':'A'}}
 js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4)
 path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(blob))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(blob),b'BIN\0')+blob)

reports=[]
for name,ms in assets.items():
 p=ROOT/'models'/f'{name}.glb';writeglb(ms,p);scene=trimesh.load(p,force='scene',process=False)
 assert len(scene.geometry)>0
 v=np.concatenate([m.v for m in ms]);bounds=np.array([v.min(axis=0),v.max(axis=0)])
 assert np.allclose(bounds,[[-1.4,-1.4,-.4],[1.4,1.4,0]],atol=1e-6)
 for m in ms:
  mesh=trimesh.Trimesh(vertices=m.v,faces=m.f,process=False)
  assert mesh.area_faces.min()>1e-10
 assert sum(len(g.faces) for g in scene.geometry.values())==sum(len(m.f) for m in ms)
 reports.append({'file':p.name,'triangles':sum(len(m.f) for m in ms),'bytes':p.stat().st_size,'bounds_zup':bounds.tolist(),'nodes':[m.name for m in ms]})

def render(ms,explode=False,size=1200):
 bg=np.array([.947,.949,.955]);rgb=np.tile(bg,(size,size,1));depth=np.full((size,size),-np.inf)
 az,el=np.radians([-54,38]);cam=np.array([np.cos(az)*np.cos(el),np.sin(az)*np.cos(el),np.sin(el)]);right=np.array([-np.sin(az),np.cos(az),0]);up=np.cross(cam,right);light=np.array([-.4,-.7,1.5]);light/=np.linalg.norm(light)
 for j,m in enumerate(ms):
  v=np.array(m.v);orig=v.copy()
  if explode:
   ct=v.mean(axis=0);v[:,:2]+=ct[:2]*.22;v[:,2]+=[.02,.12,-.03][j]
  ss=np.column_stack([v@right,-v@up,v@cam]);ss[:,:2]*=size/4.8;ss[:,0]+=size/2;ss[:,1]+=size*.46
  for ids,mat in zip(m.f,m.m):
   tri=v[ids];nn=np.cross(tri[1]-tri[0],tri[2]-tri[0]);nn/=np.linalg.norm(nn)
   if nn@cam<=0:continue
   a,b,c=ss[ids];x0=max(0,int(np.floor(min(a[0],b[0],c[0]))));x1=min(size-1,int(np.ceil(max(a[0],b[0],c[0]))));y0=max(0,int(np.floor(min(a[1],b[1],c[1]))));y1=min(size-1,int(np.ceil(max(a[1],b[1],c[1]))))
   if x1<x0 or y1<y0:continue
   x,y=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5);den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
   if abs(den)<1e-10:continue
   w1=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;w2=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;w3=1-w1-w2;z=w1*a[2]+w2*b[2]+w3*c[2];sub=depth[y0:y1+1,x0:x1+1];hit=(w1>=-1e-8)&(w2>=-1e-8)&(w3>=-1e-8)&(z>sub)
   q=orig[ids];u=(w1*q[0,0]+w2*q[1,0]+w3*q[2,0]+1.4)/2.8;tv=(w1*q[0,1]+w2*q[1,1]+w3*q[2,1]+1.4)/2.8
   if MATS[mat][2]:color=tex[np.clip(((1-tv)*(SIZE-1)).astype(int),0,SIZE-1),np.clip((u*(SIZE-1)).astype(int),0,SIZE-1)]/255*np.array(MATS[mat][1][:3])
   else:color=np.tile(np.array(MATS[mat][1][:3]),(*hit.shape,1))
   shade=.74+.26*max(0,nn@light);sub[hit]=z[hit];rgb[y0:y1+1,x0:x1+1][hit]=np.clip(color[hit]*shade,0,1)
 return Image.fromarray(np.uint8(rgb*255))
sheet=Image.new('RGB',(2100,820),(242,242,244));dr=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',23)
for i,(name,ms) in enumerate(assets.items()):
 img=render(ms,i==2).resize((700,700),Image.Resampling.LANCZOS);sheet.paste(img,(700*i,60));img.save(ROOT/'previews'/f'{name}.png');dr.text((700*i+350,35),['A — INTACT','A — CRACKED','A — 3 FRAGMENTS'][i],font=font,fill='#283344',anchor='mm')
dr.text((1050,775),'ACTUAL MESH PREVIEW  ·  2.80 × 2.80 × 0.40 m  ·  texture + chipped bevel + irregular fracture',font=font,fill='#283344',anchor='mm');sheet.save(ROOT/'previews/block_a_overview.png')
(ROOT/'tools/geometry.json').write_text(json.dumps({'materials':MATS,'assets':{name:[{'name':m.name,'vertices':m.v,'faces':m.f,'material_indices':m.m} for m in ms] for name,ms in assets.items()}}))
(ROOT/'validation.json').write_text(json.dumps({'assets':reports,'passed':['independent GLB import via trimesh','matching imported triangle counts','exact shared bounds','nondegenerate triangles','embedded PNG base color texture'],'not_tested':['Blender execution','Babylon/browser','physical phone','performance']},indent=2))
print(json.dumps(reports))
