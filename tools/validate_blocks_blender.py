"""Read-only Blender verification: saved sources and all nine supplied GLBs. Never exports over originals."""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
pack = ROOT / 'docs/art/TITANS_BLOCKS_ABC_v03'
result = {'blender': bpy.app.version_string, 'sources': [], 'glb': []}
for variant in 'ABC':
    folder = pack / variant
    source = next(folder.glob('*.blend'))
    bpy.ops.wm.open_mainfile(filepath=str(source))
    objects = [o for o in bpy.data.objects if o.type == 'MESH']
    assert len(bpy.data.collections) == 3 and len(objects) == 2 + {'A': 3, 'B': 4, 'C': 5}[variant]
    assert all(o.data.uv_layers and len(o.data.materials) == 4 for o in objects)
    assert all(image.packed_file for image in bpy.data.images if image.name.endswith('.png'))
    result['sources'].append({'file': str(source.relative_to(ROOT)), 'collections': list(bpy.data.collections.keys()), 'meshes': len(objects), 'uv': True, 'textures_packed': True, 'units': bpy.context.scene.unit_settings.system})
    for kind in ['intact', 'cracked', 'fragments']:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        path = folder / 'models' / f'tile_{variant.lower()}_{kind}.glb'
        bpy.ops.import_scene.gltf(filepath=str(path))
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        expected = {'A': 3, 'B': 4, 'C': 5}[variant] if kind == 'fragments' else 1
        assert len(meshes) == expected, (path, len(meshes))
        coords = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        low = [min(v[i] for v in coords) for i in range(3)]
        high = [max(v[i] for v in coords) for i in range(3)]
        # Blender importer changes Y-up GLB to Blender Z-up: XY 2.8m, Z -0.4..0.
        for actual, wanted in zip(low + high, [-1.4, -1.4, -0.4, 1.4, 1.4, 0]):
            assert math.isfinite(actual) and abs(actual-wanted) < 1e-4, (path, low, high)
        assert all(o.data.uv_layers for o in meshes)
        assert all(math.isfinite(c) for o in meshes for v in o.data.vertices for c in v.co)
        assert all(p.area > 1e-10 for o in meshes for p in o.data.polygons)
        result['glb'].append({'file': str(path.relative_to(ROOT)), 'bounds_blender_z_up': [low,high], 'meshes': len(meshes), 'uv': True, 'triangles': sum(len(o.data.polygons) for o in meshes)})
(ROOT / 'reports/art003-blender-validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print('ART003_BLENDER_VALIDATION_OK', len(result['glb']))
