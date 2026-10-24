"""Installed Blender validation of the supplied v02 source, without re-export."""
from pathlib import Path
import bpy,json
ROOT=Path(__file__).resolve().parent.parent
results=[]
for color in ['teal','coral']:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'docs/art/TITANS_ART_REWORK_v02/characters/TITAN_{color.upper()}_v02.blend'))
    mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    assert len(arm.data.bones)==16
    assert any(m.type=='ARMATURE' and m.object==arm for m in mesh.modifiers)
    assert len(mesh.data.color_attributes)>0
    multi=sum(1 for v in mesh.data.vertices if sum(g.weight>.001 for g in v.groups)>1)
    assert multi>500
    actions=[a.name for a in bpy.data.actions]
    assert all(any(clip in a for a in actions) for clip in ['idle','walk','throw'])
    results.append(dict(color=color,vertices=len(mesh.data.vertices),triangles=sum(len(p.vertices)-2 for p in mesh.data.polygons),bones=len(arm.data.bones),mixedWeightVertices=multi,colors=[c.name for c in mesh.data.color_attributes],actions=actions,dimensions=list(mesh.dimensions),materials=len(mesh.data.materials)))
(ROOT/'reports/art005-character-validation.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print('TITANS_V02_BLENDER_OK')
