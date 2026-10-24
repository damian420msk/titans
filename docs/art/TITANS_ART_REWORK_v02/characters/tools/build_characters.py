"""Reproducible numpy/Pillow GLB authoring; coordinates: Y up, +Z forward, meters."""
import json,struct,math,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent.parent
V=[];N=[];C=[];J=[];F=[]
PAL={}
# Bind skeleton positions in world space. R is the character's own right (negative X from front).
BONES=[('root',None,(0,0,0)),('hips',0,(0,.77,0)),('spine',1,(0,1.10,0)),('head',2,(0,1.54,0)),
 ('upper_arm_R',2,(-.35,1.36,0)),('forearm_R',4,(-.55,1.08,.025)),('hand_R',5,(-.615,.92,.055)),
 ('upper_arm_L',2,(.35,1.36,0)),('forearm_L',7,(.55,1.08,.025)),('hand_L',8,(.615,.92,.055)),
 ('thigh_R',1,(-.20,.74,0)),('shin_R',10,(-.20,.41,0)),('foot_R',11,(-.20,.13,.035)),
 ('thigh_L',1,(.20,.74,0)),('shin_L',13,(.20,.41,0)),('foot_L',14,(.20,.13,.035))]
BONES=[(n,p,tuple(np.array(pos)*1.6)) for n,p,pos in BONES]

def color(c):
 if isinstance(c,str):c=PAL.get(c,c)
 if isinstance(c,str):return np.array([int(c[i:i+2],16)/255 for i in (1,3,5)])
 return np.array(c)
def add_mesh(v,f,n,col,joint):
 off=len(V);V.extend(v);N.extend(n);C.extend([color(col)]*len(v));J.extend([joint]*len(v));F.extend([[off+i for i in face] for face in f])
def ell(name,center,scale,col,joint,lat=7,lon=12,rotation=None):
 # Unique poles avoid degenerate triangles.
 v=[[0,1,0]];ns=[[0,1,0]]
 for a in range(1,lat):
  t=math.pi*a/lat
  for b in range(lon):
   p=2*math.pi*b/lon;v.append([math.sin(t)*math.cos(p),math.cos(t),math.sin(t)*math.sin(p)]);ns.append(v[-1])
 v.append([0,-1,0]);ns.append(v[-1]);f=[]
 for b in range(lon):f.append([0,1+(b+1)%lon,1+b])
 for a in range(lat-2):
  for b in range(lon):
   k=1+a*lon+b;nb=1+a*lon+(b+1)%lon
   f.extend([[k,nb,k+lon],[nb,nb+lon,k+lon]])
 end=len(v)-1
 for b in range(lon):f.append([end,end-lon+b,end-lon+(b+1)%lon])
 v=np.array(v)*scale;ns=np.array(ns)/scale;ns/=np.linalg.norm(ns,axis=1)[:,None]
 if rotation is not None:v=v@rotation.T;ns=ns@rotation.T
 v+=center
 # Correct winding against analytical vertex normals.
 f=np.array(f);cross=np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]])
 if np.mean(np.sum(cross*ns[f[:,0]],axis=1))<0:f=f[:,[0,2,1]]
 add_mesh(v,f,ns,col,joint)
def segment(a,b,width,depth,col,j,lat=6,lon=12):
 a=np.array(a);b=np.array(b);d=b-a;y=d/np.linalg.norm(d);x=np.cross(y,[0,0,1]);x/=np.linalg.norm(x);z=np.cross(x,y)
 ell('',(a+b)/2,[width,np.linalg.norm(d)/2+.045,depth],col,j,lat,lon,np.array([x,y,z]).T)
def rings(ys,rx,rz,col,j,lon=16):
 v=[]
 for y,x,z in zip(ys,rx,rz):
  for k in range(lon):
   a=2*math.pi*k/lon;v.append([x*math.cos(a),y,z*math.sin(a)])
 f=[]
 for r in range(len(ys)-1):
  for k in range(lon):
   a=r*lon+k;b=r*lon+(k+1)%lon;f.extend([[a,b,a+lon],[b,b+lon,a+lon]])
 v.extend([[0,ys[0],0],[0,ys[-1],0]])
 for k in range(lon):f.extend([[len(v)-2,(k+1)%lon,k],[len(v)-1,(len(ys)-1)*lon+k,(len(ys)-1)*lon+(k+1)%lon]])
 v=np.array(v);f=np.array(f)[:,[0,2,1]];n=np.zeros_like(v)
 for face in f:
  a,b,c=v[face];nn=np.cross(b-a,c-a)
  for idx in face:n[idx]+=nn
 n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-12)
 # Rings constructed with outward winding in Y-up.
 add_mesh(v,f,n,col,j)
def cube(center,scale,col,j):
 c=np.array(center);s=np.array(scale)/2;vs=[];fs=[];ns=[]
 for axis in range(3):
  for sign in [-1,1]:
   other=[a for a in range(3) if a!=axis];base=len(vs)
   for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]:
    p=np.zeros(3);p[axis]=sign*s[axis];p[other]=[a*s[other[0]],b*s[other[1]]];vs.append(p+c);nn=np.zeros(3);nn[axis]=sign;ns.append(nn)
   ff=[[base,base+1,base+2],[base,base+2,base+3]]
   if np.dot(np.cross(np.array(vs[base+1])-vs[base],np.array(vs[base+2])-vs[base]),ns[base])<0:ff=[x[::-1] for x in ff]
   fs.extend(ff)
 add_mesh(vs,fs,ns,col,j)
def build(variant):
 global V,N,C,J,F,PAL,WEIGHT_OVERRIDES
 WEIGHT_OVERRIDES={}
 V=[];N=[];C=[];J=[];F=[]
 PAL={'cloth':'#3c8d99' if variant=='teal' else '#dd7962','edge':'#2f717d' if variant=='teal' else '#be5947',
 'seam':'#59a0a6' if variant=='teal' else '#ed9981','skin':'#efb586','skinshade':'#cb9067',
 'hair':'#ab501e' if variant=='teal' else '#48362b','hairlight':'#c66a29' if variant=='teal' else '#5c4535',
 'leather':'#604837','trim':'#805f43','metal':'#deccaa','metalshade':'#b8a481','dark':'#302b25','white':'#f4e9d3','iris':'#7b6438'}
 def qpoint(t,rx,rz,power=2.9):
  co,si=math.cos(t),math.sin(t)
  return np.array([rx*math.copysign(abs(co)**(2/power),co),0,rz*math.copysign(abs(si)**(2/power),si)])
 def loft(ys,rx,rz,col,joint,lon=20,power=2.7,offsets=None):
  offsets=offsets or [0]*len(ys);vv=[];ff=[]
  for y,x,z,off in zip(ys,rx,rz,offsets):
   for k in range(lon):
    p=qpoint(2*math.pi*k/lon,x,z,power);p[1]=y;p[2]+=off;vv.append(p)
  for r in range(len(ys)-1):
   for k in range(lon):
    a=r*lon+k;b=r*lon+(k+1)%lon;ff.extend([[a,a+lon,b],[b,a+lon,b+lon]])
  vv.extend([[0,ys[0],offsets[0]],[0,ys[-1],offsets[-1]]])
  for k in range(lon):ff.extend([[len(vv)-2,k,(k+1)%lon],[len(vv)-1,(len(ys)-1)*lon+(k+1)%lon,(len(ys)-1)*lon+k]])
  vv=np.array(vv);ff=np.array(ff);nn=np.zeros_like(vv)
  for face in ff:
   normal=np.cross(vv[face[1]]-vv[face[0]],vv[face[2]]-vv[face[0]])
   for k in face:nn[k]+=normal
  nn/=np.maximum(np.linalg.norm(nn,axis=1)[:,None],1e-9);add_mesh(vv,ff,nn,col,joint)
 def tube(a,b,radii,col,joint,lon=14):
  a=np.array(a);b=np.array(b);y=(b-a)/np.linalg.norm(b-a);x=np.cross(y,[0,0,1]);x/=np.linalg.norm(x);z=np.cross(x,y)
  vv=[];ff=[];nn=[]
  for t,rx,rz in radii:
   for k in range(lon):
    th=2*math.pi*k/lon;normal=x*math.cos(th)/rx+z*math.sin(th)/rz
    vv.append(a+(b-a)*t+x*math.cos(th)*rx+z*math.sin(th)*rz);nn.append(normal/np.linalg.norm(normal))
  for r in range(len(radii)-1):
   for k in range(lon):
    aa=r*lon+k;bb=r*lon+(k+1)%lon;ff.extend([[aa,bb,aa+lon],[bb,bb+lon,aa+lon]])
  # cap each end, with dedicated normals to preserve edge.
  for r,sign in [(0,-1),(len(radii)-1,1)]:
   base=len(vv);t,rx,rz=radii[r];vv.append(a+(b-a)*t);nn.append(y*sign)
   for k in range(lon):
    face=[base,r*lon+k,r*lon+(k+1)%lon]
    if np.dot(np.cross(np.array(vv[face[1]])-vv[face[0]],np.array(vv[face[2]])-vv[face[0]]),y*sign)<0:face=face[::-1]
    ff.append(face)
  vv=np.array(vv);ff=np.array(ff);nn=np.array(nn)
  for k,face in enumerate(ff):
   if np.dot(np.cross(vv[face[1]]-vv[face[0]],vv[face[2]]-vv[face[0]]),nn[face].mean(axis=0))<0:ff[k]=face[::-1]
  add_mesh(vv,ff,nn,col,joint)
 # Sculpted continuous tunic and short sleeves via a sampled smooth implicit union.
 # Geometry is exported, vtk is only an optional source rebuild dependency.
 def sculpted_tunic():
  import vtk
  from vtk.util.numpy_support import numpy_to_vtk,vtk_to_numpy
  step=.014
  xs=np.arange(-.70,.701,step);ys=np.arange(.62,1.55,step);zs=np.arange(-.32,.321,step)
  Z,Y,X=np.meshgrid(zs,ys,xs,indexing='ij')
  levels_y=np.array([.67,.685,.72,.82,.94,1.03,1.17,1.33,1.40,1.45,1.47])
  rx=np.interp(Y,levels_y,[.388,.408,.412,.383,.34,.37,.407,.41,.365,.275,.22])
  rz=np.interp(Y,levels_y,[.238,.253,.254,.238,.225,.235,.25,.238,.215,.18,.15])
  # Rounded squircle cross-section; rounded vertical caps.
  power=2.45;rad=(np.abs(X/rx)**power+np.abs(Z/rz)**power)**(1/power)
  d=(rad-1)*.22
  cap=np.maximum(.671-Y,Y-1.464)
  d=np.maximum(d,cap)
  def smoothmin(a,b,k):
   h=np.clip(.5+.5*(b-a)/k,0,1);return b*(1-h)+a*h-k*h*(1-h)
  for side in [-1,1]:
   a=np.array([side*.31,1.377,0]);b=np.array([side*.477,1.215,.006]);axis=(b-a);length=np.linalg.norm(axis);axis/=length
   vx=np.cross(axis,[0,0,1]);vx/=np.linalg.norm(vx);vz=np.cross(vx,axis);center=(a+b)/2
   px=X-center[0];py=Y-center[1];pz=Z-center[2]
   u=px*vx[0]+py*vx[1]+pz*vx[2];v=px*axis[0]+py*axis[1]+pz*axis[2];w=px*vz[0]+py*vz[1]+pz*vz[2]
   r=(u/.174)**2+(v/.225)**2+(w/.174)**2
   sd=(np.sqrt(r)-1)*.174
   # Crop the sleeve at its open end, smoothly meet existing flesh geometry.
   sd=np.maximum(sd,v-.115)
   d=smoothmin(d,sd,.070)
  # Round the outer silhouette by smoothing scalar field only slightly.
  from scipy.ndimage import gaussian_filter
  d=gaussian_filter(d,.55)
  img=vtk.vtkImageData();img.SetDimensions(len(xs),len(ys),len(zs));img.SetOrigin(xs[0],ys[0],zs[0]);img.SetSpacing(step,step,step)
  scalars=numpy_to_vtk(d.astype(np.float32).ravel(),deep=True);img.GetPointData().SetScalars(scalars)
  surf=vtk.vtkFlyingEdges3D();surf.SetInputData(img);surf.SetValue(0,0);surf.Update()
  dec=vtk.vtkQuadricDecimation();dec.SetInputConnection(surf.GetOutputPort());dec.SetTargetReduction(.92);dec.Update()
  smooth=vtk.vtkWindowedSincPolyDataFilter();smooth.SetInputConnection(dec.GetOutputPort());smooth.SetNumberOfIterations(10);smooth.BoundarySmoothingOff();smooth.SetPassBand(.15);smooth.Update()
  norms=vtk.vtkPolyDataNormals();norms.SetInputConnection(smooth.GetOutputPort());norms.SplittingOff();norms.ConsistencyOn();norms.AutoOrientNormalsOn();norms.Update()
  poly=norms.GetOutput();vv=vtk_to_numpy(poly.GetPoints().GetData()).copy();nn=vtk_to_numpy(poly.GetPointData().GetNormals()).copy();ff=vtk_to_numpy(poly.GetPolys().GetData()).reshape(-1,4)[:,1:].copy()
  # Guarantee outward orientation based on front central normals.
  mask=(vv[:,2]>.16)&(abs(vv[:,0])<.2)&(vv[:,1]>1.1)
  if nn[mask,2].mean()<0:nn=-nn;ff=ff[:,::-1]
  base=len(V);add_mesh(vv,ff,nn,'cloth',2)
  for k,p in enumerate(vv):
   x,y,z=p;arm=np.clip((abs(x)-.29)/.18,0,1);arm=arm*arm*(3-2*arm)
   vertical=np.clip((y-1.08)/.16,0,1);arm*=vertical*vertical*(3-2*vertical)
   hip=np.clip((1.09-y)/.18,0,1);hip=hip*hip*(3-2*hip)
   weights=[(4 if x<0 else 7,arm),(1,(1-arm)*hip),(2,(1-arm)*(1-hip))]
   WEIGHT_OVERRIDES[base+k]=[(j,w) for j,w in weights if w>1e-7]
 sculpted_tunic()
 # Broad hem covers its seam. Belt conceals transition from skirt to torso.
 loft([.68,.695,.718],[.414,.418,.414],[.256,.260,.256],'edge',1)
 # Side seam and chest opening: subtle broad lines, no noisy pattern.
 cube([0,1.347,.244],[.037,.198,.009],'edge',2)
 cube([0,1.352,.250],[.015,.183,.008],'seam',2)
 for y in [1.31,1.38]:ell('',[.011,y,.255],[.012,.012,.007],'metal',2,5,8)
 loft([.924,.935,1.015,1.026],[.354,.366,.366,.354],[.236,.247,.247,.236],'leather',1)
 # Rounded buckle, contrasting insert and tongue.
 ell('',[0,.975,.255],[.11,.074,.022],'metalshade',1,7,12)
 cube([0,.975,.275],[.15,.092,.016],'leather',1)
 cube([-.024,.975,.286],[.105,.014,.012],'metal',1)
 for x in [-.19,.19]:cube([x,.975,.242],[.03,.112,.017],'trim',1)
 for side,joints in [(-1,[4,5,6,10,11,12]),(1,[7,8,9,13,14,15])]:
  a,b,h,t,k,ft=joints
  # The upper sleeve is part of the continuous sculpt; a narrow cuff finishes the opening.
  tube([side*.29,1.378,0],[side*.495,1.19,.006],[(.91,.151,.153),(1,.148,.151)],'edge',a)
  segment([side*.46,1.22,.005],[side*.555,1.065,.025],.136,.137,'skin',a,8,14)
  # Tapered leather bracer fits forearm instead of separate stacked rings.
  tube([side*.547,1.087,.024],[side*.613,.918,.055],[(0,.129,.132),(.08,.138,.14),(.22,.134,.138),(.85,.114,.12),(1,.115,.122)],'leather',b)
  tube([side*.547,1.087,.024],[side*.613,.918,.055],[(0,.137,.142),(.10,.14,.145)],'trim',b)
  tube([side*.547,1.087,.024],[side*.613,.918,.055],[(.86,.12,.126),(1,.122,.127)],'trim',b)
  for frac in [.22,.78]:
   p=np.array([side*.547,1.087,.024])*(1-frac)+np.array([side*.613,.918,.055])*frac;p[2]+=.137
   ell('',p,[.012,.013,.008],'metalshade',b,4,8)
  # Palm, four rounded fingers, tucked thumb. Fingers overlap palm and remain part of hand bone.
  ell('',[side*.634,.861,.063],[.105,.112,.09],'skin',h,8,12)
  for finger in range(4):
   x=side*(.566+.044*finger);y=.802+(abs(finger-1.5)*.012)
   ell('',[x,y,.085],[.029,.061,.047],'skin',h,6,10)
  ell('',[side*.542,.853,.137],[.041,.069,.045],'skin',h,7,10)
  # Pants thick enough to meet boots; cream leggings visible only as a short band.
  segment([side*.19,.73,-.018],[side*.20,.41,-.005],.148,.163,'leather',t,8,14)
  ell('',[side*.20,.415,.006],[.146,.085,.166],'metal',k,7,12)
  tube([side*.20,.38,.01],[side*.20,.14,.035],[(0,.157,.165),(.1,.16,.17),(.7,.145,.154),(1,.138,.149)],'leather',k)
  tube([side*.20,.40,.01],[side*.20,.14,.035],[(0,.164,.174),(.16,.171,.181),(.25,.164,.174)],'trim',k)
  ell('',[side*.20,.115,.098],[.17,.112,.235],'leather',ft,9,16)
  ell('',[side*.20,.030,.103],[.175,.03,.242],'dark',ft,6,16)
  # Toe panel and heel strap broad enough to survive mobile downsampling.
  ell('',[side*.20,.095,.25],[.148,.071,.092],'leather',ft,7,12)
 # Sculpted face: smaller eyes recessed in lids, low cheek/nose shapes and broad eyebrows.
 ell('',[0,1.505,-.004],[.14,.14,.135],'skin',3,7,14)
 ell('',[0,1.674,.008],[.245,.248,.215],'skin',3,12,20)
 for s in [-1,1]:
  if variant=='teal':
   ell('',[s*.244,1.674,.004],[.049,.076,.045],'skinshade',3,7,12)
   ell('',[s*.249,1.678,.024],[.033,.052,.028],'skin',3,6,10)
  ell('',[s*.129,1.604,.179],[.106,.074,.050],'skin',3,8,12)
  # Eyelid pad creates an almond outline; upper lip overlaps top of sclera.
  ell('',[s*.095,1.718,.202],[.061,.044,.020],'skinshade',3,8,12)
  ell('',[s*.095,1.716,.221],[.050,.031,.013],'white',3,8,12)
  ell('',[s*.095,1.714,.233],[.023,.027,.008],'iris',3,7,12)
  ell('',[s*.095,1.714,.239],[.013,.021,.006],'dark',3,7,10)
  ell('',[s*.087,1.725,.245],[.006,.007,.003],'white',3,5,8)
  ell('',[s*.095,1.746,.219],[.060,.016,.018],'skin',3,6,12)
  segment([s*.045,1.779,.205],[s*.152,1.776,.184],.023,.024,'hair',3,6,10)
 ell('',[0,1.657,.232],[.063,.065,.068],'skin',3,10,14)
 ell('',[0,1.646,.276],[.069,.044,.042],'skin',3,8,14)
 # Cohesive beard silhouette, tapered lower outline; lobes blend at their bases.
 ell('',[0,1.492,.124],[.237,.197,.145],'hair',3,10,16)
 for x in [-.158,-.08,0,.08,.158]:
  ell('',[x,1.467+.06*abs(x)/.158,.224],[.074,.126-.026*abs(x)/.158,.064],'hairlight' if variant=='teal' else 'hair',3,9,12)
 for s in [-1,1]:
  ell('',[s*.202,1.577,.117],[.064,.103,.080],'hair',3,8,12)
  # Moustache sweeps outward, integrated with beard instead of dangling beads.
  segment([s*.015,1.601,.269],[s*.122,1.574,.244],.037,.040,'hairlight',3,7,12)
 if variant=='teal':
  # Hair visible below rim; broad rounded locks, upper part occluded by helmet.
  for x in [-.18,-.09,0,.09,.18]:ell('',[x,1.641,-.15],[.071,.115,.073],'hairlight',3,8,12)
  rings([1.795,1.855,1.92,1.972,1.998,2.0],[.276,.265,.225,.144,.035,.001],[.240,.230,.196,.126,.032,.001],'metal',3,24)
  rings([1.779,1.792,1.836,1.849],[.276,.288,.288,.272],[.241,.253,.253,.239],'metal',3,24)
  # Crest follows dome from front to crown and back.
  coords=[[0,1.824,.248],[0,1.915,.196],[0,1.978,.096],[0,2.,0],[0,1.978,-.096],[0,1.915,-.196]]
  for aa,bb in zip(coords,coords[1:]):segment(aa,bb,.010,.010,'metalshade',3,5,8)
  for x in [-.18,0,.18]:ell('',[x,1.816,.253 if x==0 else .219],[.013,.014,.008],'metalshade',3,6,8)
 else:
  # Cloth hood has a front opening, enclosed back, thickness and rolled edge.
  steps=24;levels=[(1.455,.247,.198,-.025),(1.52,.277,.231,-.025),(1.66,.292,.246,-.018),(1.81,.27,.231,-.012),(1.93,.18,.17,-.018),(2.,.025,.038,-.043)]
  vv=[];ff=[];nn=[]
  for yy,rx,rz,off in levels:
   for k in range(steps+1):
    th=math.radians(53+254*k/steps);vv.append([rx*math.sin(th),yy,rz*math.cos(th)+off]);normal=np.array([math.sin(th),.28,math.cos(th)]);nn.append(normal/np.linalg.norm(normal))
  for l in range(len(levels)-1):
   for k in range(steps):
    a=l*(steps+1)+k;ff.extend([[a,a+steps+1,a+1],[a+1,a+steps+1,a+steps+2]])
  # Close crown with a tiny rounded cap hidden under rolled edge.
  vv=np.array(vv);ff=np.array(ff);nn=np.array(nn)
  for i,face in enumerate(ff):
   if np.dot(np.cross(vv[face[1]]-vv[face[0]],vv[face[2]]-vv[face[0]]),nn[face].mean(axis=0))<0:ff[i]=face[::-1]
  add_mesh(vv,ff,nn,'cloth',3)
  for side in [-1,1]:
   coords=[]
   for yy,rx,rz,off in levels:
    th=math.radians(53);coords.append([side*rx*math.sin(th),yy,rz*math.cos(th)+off])
   coords.append([0,2.,-.043])
   for aa,bb in zip(coords,coords[1:]):segment(aa,bb,.023,.023,'edge',3,6,10)
  ell('',[0,1.96,-.052],[.085,.041,.094],'cloth',3,8,12)
 v=np.array(V,dtype=np.float32);v[:,1]=np.clip(v[:,1],0,2)
 # Native export height is 3.2 m; skeletal translations are scaled at export as well.
 v*=1.6
 return v,np.array(N,np.float32),np.array(C,np.float32),np.array(J,np.uint16),np.array(F,np.uint32)

def quat(axis,angle):
 q=np.zeros(4);q[axis]=math.sin(angle/2);q[3]=math.cos(angle/2);return q.tolist()
def write_glb(variant):
 v,n,c,j,f=build(variant);blob=bytearray();views=[];acc=[]
 def accessor(a,typ,component,target=None):
  nonlocal blob
  a=np.ascontiguousarray(a);blob+=b'\0'*((-len(blob))%4);off=len(blob);raw=a.tobytes();blob+=raw
  views.append({'buffer':0,'byteOffset':off,'byteLength':len(raw),**({'target':target} if target else {})})
  item={'bufferView':len(views)-1,'componentType':component,'count':len(a),'type':typ}
  if typ in ['VEC3','SCALAR']:item.update(min=np.min(a,axis=0).reshape(-1).tolist(),max=np.max(a,axis=0).reshape(-1).tolist())
  acc.append(item);return len(acc)-1
 pos=accessor(v,'VEC3',5126,34962);norm=accessor(n,'VEC3',5126,34962);c_linear=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4).astype(np.float32);col=accessor(c_linear,'VEC3',5126,34962)
 joints=np.zeros((len(v),4),np.uint16);joints[:,0]=j;weights=np.zeros((len(v),4),np.float32);weights[:,0]=1
 
 for vi,influences in WEIGHT_OVERRIDES.items():
  joints[vi]=0;weights[vi]=0
  for wi,(bone,w) in enumerate(influences):joints[vi,wi]=bone;weights[vi,wi]=w
 ja=accessor(joints,'VEC4',5123,34962);wa=accessor(weights,'VEC4',5126,34962);idx=accessor(f.flatten(),'SCALAR',5125,34963)
 nodes=[{'name':'Titan_'+variant,'children':[1,17],'extras':{'heightMeters':3.2,'forward':'+Z','visualOnly':True}}]
 for i,(name,parent,p) in enumerate(BONES):
  pp=np.array(BONES[parent][2]) if parent is not None else np.zeros(3)
  node={'name':name,'translation':(np.array(p)-pp).tolist()};kids=[k+1 for k,b in enumerate(BONES) if b[1]==i]
  if i==6:kids.append(18)
  if kids:node['children']=kids
  nodes.append(node)
 nodes.append({'name':'body_skinned','mesh':0,'skin':0})
 nodes.append({'name':'stone_socket_R','translation':[0,-.056,.208],'extras':{'purpose':'visual attachment; no projectile authority'}})
 ib=[]
 for _,_,p in BONES:
  m=np.eye(4,dtype=np.float32);m[:3,3]=-np.array(p);ib.append(m.T.reshape(-1))
 inv=accessor(np.array(ib,np.float32),'MAT4',5126)
 animations=[]
 for clip,duration in [('idle',2.4),('walk',.8),('throw',.75)]:
  samplers=[];channels=[];times=np.linspace(0,duration,9,dtype=np.float32);ti=accessor(times,'SCALAR',5126)
  tracks={}
  if clip=='idle':
   for b in [2,4,7]:tracks[b]=(2,[.018*math.sin(t/duration*2*math.pi)*(1 if b==2 else .6) for t in times])
  elif clip=='walk':
   for b,amp,phase in [(10,.48,0),(13,.48,math.pi),(11,.22,math.pi),(14,.22,0),(4,.30,math.pi),(7,.30,0)]:tracks[b]=(0,[amp*math.sin(t/duration*2*math.pi+phase) for t in times])
  else:
   for b,vals in [(4,[0,-.4,-1.4,-2.1,-1.4,-.5,.2,.1,0]),(5,[0,-.3,-.7,-1.,-.65,-.1,0,0,0]),(7,[0,.1,.2,.25,.1,0,-.1,0,0]),(2,[0,-.08,-.15,-.2,-.1,.1,.05,0,0])]:tracks[b]=(0,vals)
  for b,(axis,angles) in tracks.items():
   out=accessor(np.array([quat(axis,a) for a in angles],np.float32),'VEC4',5126);samplers.append({'input':ti,'output':out,'interpolation':'LINEAR'});channels.append({'sampler':len(samplers)-1,'target':{'node':b+1,'path':'rotation'}})
  animations.append({'name':clip,'samplers':samplers,'channels':channels,'extras':{'loop':clip!='throw',**({'releaseTimeSeconds':.375} if clip=='throw' else {})}})
 gltf={'asset':{'version':'2.0','generator':'Titans procedural character authoring v02'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'meshes':[{'name':'titan_'+variant,'primitives':[{'attributes':{'POSITION':pos,'NORMAL':norm,'COLOR_0':col,'JOINTS_0':ja,'WEIGHTS_0':wa},'indices':idx,'material':0}]}],'skins':[{'name':'TitanRig','inverseBindMatrices':inv,'joints':list(range(1,17)),'skeleton':1}],'materials':[{'name':'Titan_Matte_VertexPalette','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0,'roughnessFactor':.9},'doubleSided':True}],'animations':animations,'accessors':acc,'bufferViews':views,'buffers':[{'byteLength':len(blob)}]}
 js=json.dumps(gltf,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4)
 path=ROOT/'models'/('titan_'+variant+'_v02.glb');path.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(blob))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob)
 return v,n,c,j,f

def render(data,angle,size=(520,640)):
 v,n,c,j,f=data;angle=math.radians(angle);R=np.array([[math.cos(angle),0,math.sin(angle)],[0,1,0],[-math.sin(angle),0,math.cos(angle)]])
 vv=v@R.T;nn=n@R.T
 # Slight elevated view.
 pitch=.10;yy=vv[:,1]*math.cos(pitch)-vv[:,2]*math.sin(pitch);zz=vv[:,1]*math.sin(pitch)+vv[:,2]*math.cos(pitch)
 scale=min(size[0]/2.65,(size[1]-100)/3.2);xx=vv[:,0]*scale+size[0]/2;yy=size[1]-50-yy*scale
 im=Image.new('RGB',size,'#f0ede6');draw=ImageDraw.Draw(im);draw.ellipse([90,size[1]-70,size[0]-90,size[1]-25],fill='#dcd7cc')
 light=np.array([-.45,.7,.9]);light/=np.linalg.norm(light)
 pixels=np.array(im);zbuf=np.full((size[1],size[0]),-np.inf)
 for face in f:
  pts=np.stack([xx[face],yy[face]],axis=1)
  cross=np.cross(vv[face[1]]-vv[face[0]],vv[face[2]]-vv[face[0]])
  if cross[2]<0:continue
  lo=np.maximum(np.floor(pts.min(axis=0)).astype(int),0);hi=np.minimum(np.ceil(pts.max(axis=0)).astype(int),[size[0]-1,size[1]-1])
  if (hi<lo).any():continue
  X,Y=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
  a,b,cc=pts;den=(b[1]-cc[1])*(a[0]-cc[0])+(cc[0]-b[0])*(a[1]-cc[1])
  if abs(den)<1e-8:continue
  u=((b[1]-cc[1])*(X-cc[0])+(cc[0]-b[0])*(Y-cc[1]))/den
  w=((cc[1]-a[1])*(X-cc[0])+(a[0]-cc[0])*(Y-cc[1]))/den;t=1-u-w
  depth=u*zz[face[0]]+w*zz[face[1]]+t*zz[face[2]]
  zs=zbuf[lo[1]:hi[1]+1,lo[0]:hi[0]+1];mask=(u>=0)&(w>=0)&(t>=0)&(depth>zs)
  normals=u[...,None]*nn[face[0]]+w[...,None]*nn[face[1]]+t[...,None]*nn[face[2]]
  normals/=np.maximum(np.linalg.norm(normals,axis=2)[...,None],1e-8)
  shade=.52+.48*np.maximum(0,normals@light)
  rgb=np.clip(c[face].mean(axis=0)*shade[...,None]*255,0,255).astype(np.uint8)
  px=pixels[lo[1]:hi[1]+1,lo[0]:hi[0]+1];px[mask]=rgb[mask];zs[mask]=depth[mask]
 im=Image.fromarray(pixels)
 return im
if __name__=='__main__':
 all_data={}
 for var in ['teal','coral']:
  data=write_glb(var);all_data[var]=data
  for name,ang in [('front',0),('side',90),('back',180),('threequarter',-28)]:render(data,ang).save(ROOT/'previews'/f'{var}_{name}.png')
 sheet=Image.new('RGB',(1560,1380),'#f0ede6');d=ImageDraw.Draw(sheet)
 font=ImageFont.truetype('DejaVuSans.ttf',27) if Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf').exists() else ImageFont.load_default()
 for row,var in enumerate(['teal','coral']):
  for col,(name,ang) in enumerate([('front',0),('side',90),('back',180)]):
   sheet.paste(render(all_data[var],ang),(520*col,60+660*row))
   d.text((520*col+30,25+660*row),f'{var.upper()} / {name.upper()}',font=font,fill='#443f38')
 sheet.save(ROOT/'previews/characters_turnaround.png')
 print(json.dumps({var:{'vertices':len(x[0]),'triangles':len(x[4]),'bounds':[x[0].min(axis=0).tolist(),x[0].max(axis=0).tolist()]} for var,x in all_data.items()},indent=2))
