"""Verify embedded exported PNGs, not just in-memory authoring pixels."""
from pathlib import Path
import bpy,numpy as np,json,hashlib
ROOT=Path(__file__).resolve().parent.parent
results=[]
for variant in 'ABC':
    samples=[]
    for phase in ['source','runtime']:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        path=ROOT/(f'docs/art/TITANS_BLOCKS_ABC_v03/{variant}/models/tile_{variant.lower()}_intact.glb' if phase=='source' else f'public/art/blocks-abc-v03/tile_{variant.lower()}_intact.glb')
        bpy.ops.import_scene.gltf(filepath=str(path))
        image=next(i for i in bpy.data.images if i.type=='IMAGE')
        pixels=np.array(image.pixels[:],dtype=np.float32).reshape(-1,4)[:,:3]
        samples.append(dict(phase=phase,mean=pixels.mean(axis=0).tolist(),std=pixels.std(axis=0).tolist(),glbSHA256=hashlib.sha256(path.read_bytes()).hexdigest()))
    ratio=np.array(samples[1]['std'])/np.array(samples[0]['std'])
    assert np.all((ratio>.15)&(ratio<.30)),(variant,ratio)
    assert np.max(np.abs(np.array(samples[0]['mean'])-np.array(samples[1]['mean'])))<.015
    results.append(dict(variant=variant,samples=samples,contrastRatio=ratio.tolist()))
(ROOT/'reports/art005-texture-validation.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print('ART005_EXPORTED_TEXTURES_OK')
