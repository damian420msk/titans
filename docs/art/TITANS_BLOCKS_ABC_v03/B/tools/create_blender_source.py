import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
data=json.loads((ROOT/'tools/geometry.json').read_text(encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system='METRIC'
texture=bpy.data.images.load(str(ROOT/'textures/sandstone_b_basecolor.png'))
texture.pack()
mats=[]
for name,color,textured in data['materials']:
    mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=color
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value=.94
    bsdf.inputs['Metallic'].default_value=0
    bsdf.inputs['Base Color'].default_value=color
    if textured:
        img=mat.node_tree.nodes.new('ShaderNodeTexImage');img.image=texture
        mul=mat.node_tree.nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1
        mul.inputs[2].default_value=color
        mat.node_tree.links.new(img.outputs['Color'],mul.inputs[1])
        mat.node_tree.links.new(mul.outputs[0],bsdf.inputs['Base Color'])
    mats.append(mat)
for asset,objects in data['assets'].items():
    col=bpy.data.collections.new(asset);bpy.context.scene.collection.children.link(col)
    for item in objects:
        mesh=bpy.data.meshes.new(item['name']+'_Mesh');mesh.from_pydata(item['vertices'],[],item['faces']);mesh.update()
        uv=mesh.uv_layers.new(name='UVMap')
        for loop in mesh.loops:
            co=mesh.vertices[loop.vertex_index].co
            uv.data[loop.index].uv=((co.x+1.4)/2.8,(co.y+1.4)/2.8)
        for mat in mats:mesh.materials.append(mat)
        for face,idx in zip(mesh.polygons,item['material_indices']):face.material_index=idx;face.use_smooth=False
        obj=bpy.data.objects.new(item['name'],mesh);col.objects.link(obj);obj['variant']='B';obj['visual_only']=True
    col.hide_viewport=asset!='tile_b_intact';col.hide_render=asset!='tile_b_intact'
target=ROOT/'TITANS_BLOCK_B_v01.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(target))
assert target.is_file()
print('TITANS_BLEND_OK',target)
