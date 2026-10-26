# Island decor v01 (STYLE_BRIEF «Остров», items 4–5): marble and gold props that stand around the arena, outside the cells.
# Procedural, no Meshy: every piece is built from lathe profiles and primitives, flat-ish stylized, metres, +Y up, origin on the ground.
# Run: "D:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python tools/decor_blender.py
# Output: public/art/decor-v01/<name>.glb. Material names are read by the game: TeamCloth is tinted per side, Flame flickers.
import bpy, bmesh, math, random
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parents[1] / 'public/art/decor-v01'
OUT.mkdir(parents=True, exist_ok=True)

def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c] + [1]

def mat(name, color, rough=.65, metal=0., emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = srgb(color); p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
    if emit: p.inputs['Emission Color'].default_value = srgb(emit); p.inputs['Emission Strength'].default_value = 2.5
    return m

def materials():
    return {
        'Marble': mat('Marble', '#EFE6D8', .55), 'MarbleShade': mat('MarbleShade', '#D8CBB8', .7),
        'Gold': mat('Gold', '#E3B04B', .35, .85), 'TeamCloth': mat('TeamCloth', '#FFFFFF', .85),
        'Stone': mat('Stone', '#8F8578', .9), 'StoneDark': mat('StoneDark', '#6F665C', .95), 'Moss': mat('Moss', '#7FA35A', .9),
        'Water': mat('Water', '#BFEFFF', .2), 'Flame': mat('Flame', '#FF6A1A', .9, 0, '#FF5A12'), 'FlameCore': mat('FlameCore', '#FFD25A', .9, 0, '#FFC23A'), 'Leaf': mat('Leaf', '#7FA35A', .85), 'LeafDark': mat('LeafDark', '#5E8644', .85),
    }

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return materials()

def link(obj): bpy.context.scene.collection.objects.link(obj); return obj

def lathe(name, profile, m, segs=16, smooth=True, jag=None):
    """Revolve [(radius, y)] around the vertical axis. `jag(i, k)` may move the top ring (broken column)."""
    bm = bmesh.new(); rings = []
    for k, (r, y) in enumerate(profile):
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs; dy = jag(i, k) if jag else 0
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), y + dy)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segs): bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    if profile[0][0] > 0: bm.faces.new(list(reversed(rings[0])))
    if profile[-1][0] > 0: bm.faces.new(rings[-1])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = smooth
    return o

def box(name, size, at, m, bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at); o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel: b = o.modifiers.new('b', 'BEVEL'); b.width = bevel; b.segments = 2; bpy.ops.object.modifier_apply(modifier='b')
    o.data.materials.append(m); return o

def rock(name, r, at, m, seed):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2 if m.name.startswith('Leaf') else 1, radius=r, location=at); o = bpy.context.object; o.name = name
    rnd = random.Random(seed)
    for v in o.data.vertices: v.co *= .75 + rnd.random() * .45; v.co.z *= .7
    o.data.materials.append(m); return o

def shaft(name, r, y0, y1, m, segs=24, jag=None):
    # flutes from a ring that alternates radius; built as a lathe with per-vertex radius via scaling afterwards
    o = lathe(name, [(r, y0), (r * .96, y1)], m, segs, smooth=False, jag=jag)
    for v in o.data.vertices:
        a = math.atan2(v.co.y, v.co.x); i = round(a / (2 * math.pi / segs)) % segs
        if i % 2: v.co.x *= .9; v.co.y *= .9
    return o

def export(name, objs):
    # every part gets a UV map (unused, no textures) so the game can merge parts of one material into one mesh
    for o in objs:
        if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # Blender is Z-up; the glTF exporter turns it into +Y up
    bpy.ops.export_scene.gltf(filepath=str(OUT / f'{name}.glb'), use_selection=True, export_format='GLB', export_apply=True, export_yup=True)
    for o in objs: o.data.calc_loop_triangles()
    tris = sum(len(o.data.loop_triangles) for o in objs)
    print('DECOR', name, 'triangles', tris)

# Lathe profiles are (radius, height) in metres; heights run along Blender Z.
def column(broken=False):
    M = reset(); parts = []
    parts.append(lathe('base', [(.62, 0), (.62, .18), (.55, .2), (.5, .32), (.44, .36)], M['Marble'], 20))
    parts.append(lathe('ring', [(.45, .36), (.47, .4), (.45, .44)], M['Gold'], 20))
    rnd = random.Random(7)
    top = 1.55 if broken else 2.7
    jag = (lambda i, k: (rnd.random() * .35 - .1) if k == 1 else 0) if broken else None
    parts.append(shaft('shaft', .4, .44, top, M['Marble'], 24, jag))
    if broken:
        parts.append(rock('chunk', .32, (.75, .25, .2), M['MarbleShade'], 3))
        parts.append(rock('chunk2', .2, (-.55, .55, .12), M['MarbleShade'], 5))
    else:
        parts.append(lathe('neck', [(.4, 2.7), (.43, 2.74), (.43, 2.8), (.48, 2.86)], M['Gold'], 20))
        parts.append(lathe('echinus', [(.48, 2.86), (.6, 2.98), (.62, 3.02)], M['Marble'], 20))
        parts.append(box('abacus', (1.36, 1.36, .2), (0, 0, 3.12), M['Marble']))
    export('column_broken' if broken else 'column', parts)

def brazier():
    M = reset(); parts = []
    parts.append(lathe('foot', [(.5, 0), (.5, .14), (.32, .2), (.2, .3), (.17, .9), (.24, 1.0)], M['Marble'], 16))
    parts.append(lathe('bowl', [(.22, 1.0), (.5, 1.08), (.7, 1.28), (.74, 1.36), (.66, 1.38), (.44, 1.3), (0, 1.27)], M['Gold'], 20))
    # flame: three soft cones, the game scales them for a flicker
    # flame: an orange tongue with a yellow core and two small side tongues, each a soft teardrop the game scales for a flicker
    for k, (x, y, h, r, m) in enumerate([(0, 0, 1.5, .34, 'Flame'), (0, 0, .9, .2, 'FlameCore'), (.22, .1, .95, .17, 'Flame'), (-.2, -.12, .8, .16, 'Flame')]):
        f = lathe(f'flame{k}', [(0, 0), (r * .85, h * .1), (r, h * .25), (r * .6, h * .55), (r * .18, h * .85), (0, h)], M[m], 10)
        f.location = (x, y, 1.27); f.scale = (1.02, 1.02, 1) if k == 1 else (1, 1, 1); parts.append(f)
    export('brazier', parts)

def vase():
    M = reset()
    body = lathe('vase', [(.18, 0), (.26, .05), (.2, .1), (.32, .3), (.42, .55), (.4, .75), (.24, .95), (.16, 1.05), (.17, 1.12), (.24, 1.18), (.22, 1.22)], M['Marble'], 18)
    band = lathe('band', [(.425, .52), (.43, .56), (.425, .6)], M['Gold'], 18)
    export('vase', [body, band])

def banner():
    M = reset(); parts = []
    parts.append(lathe('pole', [(.07, 0), (.07, 3.6)], M['Gold'], 8, smooth=True))
    parts.append(lathe('knob', [(0, 3.6), (.13, 3.68), (.13, 3.76), (0, 3.86)], M['Gold'], 10))
    bar = lathe('bar', [(.05, -.6), (.05, .6)], M['Gold'], 8); bar.rotation_euler = (0, math.pi / 2, 0); bar.location = (0, .1, 3.45); parts.append(bar)
    # cloth: a subdivided plane with a soft wave and a swallow-tail cut, hanging from the bar
    bm = bmesh.new(); W, H, nx, ny = 1.1, 2.0, 6, 10; grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, v = i / nx, j / ny; x = (u - .5) * W; z = 3.42 - v * H
            if j == ny: z += .35 * (1 - abs(u - .5) * 2)  # the swallow tail
            y = .12 + .06 * math.sin(u * math.pi * 2 + v * 2.2) * v
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(ny):
        for i in range(nx): bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    me = bpy.data.meshes.new('cloth'); bm.to_mesh(me); bm.free(); cloth = link(bpy.data.objects.new('cloth', me)); cloth.data.materials.append(M['TeamCloth'])
    s = cloth.modifiers.new('s', 'SOLIDIFY'); s.thickness = .03
    bpy.context.view_layer.objects.active = cloth; bpy.ops.object.modifier_apply(modifier='s')
    for f in cloth.data.polygons: f.use_smooth = True
    parts.append(cloth)
    # a gold sun disc on the cloth
    disc = lathe('emblem', [(0, 0), (.24, 0), (.24, .03), (0, .03)], M['Gold'], 16); disc.rotation_euler = (math.pi / 2, 0, 0); disc.location = (0, .2, 2.55); parts.append(disc)
    parts.append(lathe('foot', [(.3, 0), (.3, .12), (.12, .2)], M['Marble'], 12))
    export('banner', parts)

def bush():
    M = reset(); parts = []; rnd = random.Random(11)
    for k, (x, y, z, r) in enumerate([(0, 0, .45, .55), (.45, .15, .35, .42), (-.42, .1, .33, .4), (.1, -.38, .3, .38), (-.1, .35, .62, .36)]):
        o = rock(f'leaf{k}', r, (x, y, z), M['Leaf' if k % 2 == 0 else 'LeafDark'], 20 + k)
        for v in o.data.vertices: v.co.z *= 1.25
        parts.append(o)
    export('bush', parts)

def rubble():
    M = reset(); parts = []
    for k, (x, y, r) in enumerate([(0, 0, .34), (.5, .2, .22), (-.38, .3, .2), (.2, -.42, .18), (-.15, -.2, .14)]):
        parts.append(rock(f'r{k}', r, (x, y, r * .55), M['Marble' if k % 2 else 'MarbleShade'], 40 + k))
    parts.append(box('block', (.7, .5, .36), (.05, .75, .18), M['Marble'], .04)); parts[-1].rotation_euler = (0, 0, .5)
    export('rubble', parts)

def plinth():
    """The ledge every prop stands on, outside the arena edge: a marble slab with a gold lip over a rock that tapers down."""
    M = reset(); parts = []
    parts.append(box('slab', (1.8, 1.8, .32), (0, 0, -.16), M['Marble'], .05))
    parts.append(box('lip', (1.86, 1.86, .06), (0, 0, -.34), M['Gold'], .01))
    rock_ = lathe('rock', [(1.0, -.37), (.85, -.9), (.5, -1.6), (.12, -2.2), (0, -2.3)], M['Stone'], 7, smooth=False)
    rnd = random.Random(9)
    for v in rock_.data.vertices: v.co.x *= .85 + rnd.random() * .3; v.co.y *= .85 + rnd.random() * .3
    parts.append(rock_)
    export('plinth', parts)

# Arena size from rules_v01.json: 9 × 11 cells of 2.8 m; the island centre is the origin, Blender +Y = the island's back (game −z for side 0)
HW, HD = 9 * 2.8 / 2, 11 * 2.8 / 2

def cliff():
    """The rock that hangs under the island: a wedge-shaped rim along the edge, hollow in the middle (holes still show the clouds
    and a falling titan drops through), with a moss lip and a ragged bottom of stalactites."""
    M = reset(); bm = bmesh.new(); rnd = random.Random(21); N = 72; R = 2.2
    # perimeter of a rounded rectangle, with its outward normal
    def perim(t):
        L = [2 * (HW - R), 2 * (HD - R)]; total = 2 * (L[0] + L[1]) + 2 * math.pi * R; d = t * total
        segs = [('s', (-(HW - R), -HD), (1, 0), L[0]), ('a', (HW - R, -(HD - R)), -math.pi / 2, math.pi / 2 * R),
                ('s', (HW, -(HD - R)), (0, 1), L[1]), ('a', (HW - R, HD - R), 0, math.pi / 2 * R),
                ('s', (HW - R, HD), (-1, 0), L[0]), ('a', (-(HW - R), HD - R), math.pi / 2, math.pi / 2 * R),
                ('s', (-HW, HD - R), (0, -1), L[1]), ('a', (-(HW - R), -(HD - R)), math.pi, math.pi / 2 * R)]
        for kind, a, b, ln in segs:
            if d <= ln or kind == segs[-1][0] and ln == segs[-1][3] and d - ln < 1e-6:
                if kind == 's': p = Vector((a[0] + b[0] * d, a[1] + b[1] * d)); n = Vector((b[1], -b[0]))
                else: ang = b + d / R; n = Vector((math.cos(ang), math.sin(ang))); p = Vector(a) + n * R
                return p, n
            d -= ln
        return perim(0)
    # cross-section (inward u, height y) as fractions of the local depth D
    prof = [(-.12, -.40, 0), (-.05, -.9, 0), (.25, -.22, 1), (.6, -.48, 1), (1.0, -.78, 1), (1.15, -1.0, 1), (1.6, -.62, 1), (2.0, -.25, 1), (2.1, -.40, 0)]
    rings = []
    for i in range(N):
        t = i / N; p, n = perim(t)
        D = 7 + 2.5 * math.sin(t * math.pi * 6 + 1) + 1.6 * math.sin(t * math.pi * 14) + rnd.random() * 1.8
        ring = []
        for u, y, scale in prof:
            yy = y if scale == 0 else y * D
            if scale == 0 and y == -.9: yy = -.9  # the moss lip stays near the top
            j = (rnd.random() - .5) * .35 * (1 if scale else 0)
            q = p - n * (u + j); ring.append(bm.verts.new((q.x, q.y, yy + (rnd.random() - .5) * .3 * scale)))
        rings.append(ring)
    faces = []
    for i in range(N):
        a, b = rings[i], rings[(i + 1) % N]
        for k in range(len(prof) - 1):
            f = bm.faces.new((a[k], b[k], b[k + 1], a[k + 1])); faces.append((f, k))
    me = bpy.data.meshes.new('cliff'); bm.to_mesh(me); bm.free(); o = link(bpy.data.objects.new('cliff', me))
    for m in (M['Moss'], M['Stone'], M['StoneDark']): o.data.materials.append(m)
    for poly in o.data.polygons:
        k = faces[poly.index][1]; poly.material_index = 0 if k == 0 else (2 if k in (3, 4) else 1); poly.use_smooth = False
    export('cliff', [o])

def waterfall():
    """A ribbon of falling water from the lip down into the clouds; v runs along the fall so the game scrolls it."""
    M = reset(); bm = bmesh.new(); W, n = 2.0, 16; rows = []
    for j in range(n + 1):
        v = j / n; drop = 18 * v; out = .35 + 1.4 * v * v  # pours out over the lip, then falls almost straight
        w = W * (1 + .5 * v)
        rows.append([bm.verts.new((x * w / 2, -out, -.3 - drop)) for x in (-1, -.33, .33, 1)])
    for j in range(n):
        for i in range(3): bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    me = bpy.data.meshes.new('waterfall'); bm.to_mesh(me); bm.free(); o = link(bpy.data.objects.new('waterfall', me)); o.data.materials.append(M['Water'])
    uv = o.data.uv_layers.new(name='UVMap')
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            co = o.data.vertices[o.data.loops[li].vertex_index].co; uv.data[li].uv = ((co.x / (W * 1.5) + .5), (-co.z - .3) / 6)
    export('waterfall', [o])

column(); column(True); brazier(); vase(); banner(); bush(); rubble(); plinth(); cliff(); waterfall()
