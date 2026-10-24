"""Run with local Blender: blender --background --python PATH/create_blender_source.py"""
from pathlib import Path
import bpy
root=Path(__file__).resolve().parent.parent
for variant in ['teal','coral']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.ops.import_scene.gltf(filepath=str(root/'models'/f'titan_{variant}_v02.glb'))
    # GLB has Y up, 3.2 m native height; Blender importer handles axis conversion.
    # Vertex COLOR_0 and bones must remain present; no external texture dependency.
    out=root/f'TITAN_{variant.upper()}_v02.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print('SAVED',out)
