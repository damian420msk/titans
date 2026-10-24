"""Presentation-only ART-005 derivatives; originals remain in the approved ABC package.
Run using the installed Blender --background --python tools/art005_assets_blender.py.
"""
from pathlib import Path
import bpy, bmesh, json, numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'docs/art/TITANS_BLOCKS_ABC_v03'
OUT=ROOT/'public/art/blocks-abc-v03'
BLEND=ROOT/'docs/art/ART005-floor'
BLEND.mkdir(parents=True,exist_ok=True)
validation=[]
for variant in 'ABC':
    for kind in ['intact','cracked','fragments']:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        name=f'tile_{variant.lower()}_{kind}'
        bpy.ops.import_scene.gltf(filepath=str(SOURCE/variant/'models'/f'{name}.glb'))
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
        def bounds():
            pts=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
            return [[min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]]
        before=bounds()
        for image in list(bpy.data.images):
            if image.type!='IMAGE':continue
            # Imported packed images are lazy: has_data is false until pixels are read.
            pixels=np.array(image.pixels[:],dtype=np.float32).reshape(-1,4)
            if not len(pixels):continue
            pixels[:,:3]=pixels[:,:3].mean(axis=0)*.78+pixels[:,:3]*.22
            # A fresh generated image avoids glTF exporter reusing the original packed PNG bytes.
            replacement=bpy.data.images.new(f'ART005_{variant}_{image.name}',width=image.size[0],height=image.size[1],alpha=True)
            replacement.colorspace_settings.name=image.colorspace_settings.name
            replacement.pixels.foreach_set(pixels.ravel());replacement.update()
            replacement.filepath_raw=str(BLEND/f'{variant}_calm.png');replacement.file_format='PNG';replacement.save();replacement.pack()
            for mat in bpy.data.materials:
                if mat.use_nodes:
                    for node in mat.node_tree.nodes:
                        if node.type=='TEX_IMAGE' and node.image==image:node.image=replacement
        islands=0
        if kind=='cracked':
            for obj in meshes:
                bm=bmesh.new();bm.from_mesh(obj.data)
                bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
                unseen=set(bm.verts)
                while unseen:
                    seed=unseen.pop();component={seed};stack=[seed]
                    while stack:
                        for edge in stack.pop().link_edges:
                            for vertex in edge.verts:
                                if vertex in unseen:unseen.remove(vertex);component.add(vertex);stack.append(vertex)
                    points=[obj.matrix_world@v.co for v in component]
                    if min(p.z for p in points)>-.046 and max(p.z for p in points)>-.001:
                        centre=sum(points,Vector())/len(points);inverse=obj.matrix_world.inverted()
                        for vertex,point in zip(component,points):
                            point.x=centre.x+(point.x-centre.x)*.94
                            point.y=centre.y+(point.y-centre.y)*.94
                            vertex.co=inverse@point
                        islands+=1
                bm.to_mesh(obj.data);bm.free();obj.data.update()
        after=bounds()
        assert all(abs(before[j][i]-after[j][i])<.001 for j in range(2) for i in range(3)),(name,before,after)
        assert abs(after[1][2])<.001,(name,after)
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND/f'{name}.blend'))
        bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',export_yup=True,export_animations=False,export_extras=True)
        validation.append(dict(name=name,before=before,after=after,widenedIslands=islands,objects=len(meshes),triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)))
(ROOT/'reports/art005-floor-validation.json').write_text(json.dumps(validation,indent=2),encoding='utf-8')
print('ART005_FLOOR_OK',len(validation))
