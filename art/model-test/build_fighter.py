# Builds the Fight Night test fighter in Blender (5.x): the skeleton from docs/MODEL_SPEC.md, a body made of
# muscle-mass primitives voxel-remeshed into closed smooth shells, gear meshes with the spec's material names,
# and computed skin weights. Run it in an empty scene, then export glTF (+Y up) to get fighter_test.glb.
#
# Blender is Z-up and the fighter faces -Y, which the glTF exporter turns into +Y up, +Z forward.
# Joint positions are the spec's, in metres.
import bpy, bmesh
from mathutils import Vector as V, Matrix

scene = bpy.context.scene

# Start clean so the script can be re-run.
for ob in list(bpy.data.objects): bpy.data.objects.remove(ob)
for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
    for item in list(coll): coll.remove(item)

J = {'pelvis': V((0, 0, 0.98)), 'abd': V((0, 0, 1.18)), 'spine_mid': V((0, 0, 1.33)), 'chest': V((0, 0, 1.48)),
     'head': V((0, 0, 1.65)), 'top': V((0, 0, 1.78))}
for s, sx in (('l', 1), ('r', -1)):
    J['sh_' + s] = V((0.18 * sx, 0, 1.43))
    J['el_' + s] = V((0.392 * sx, 0, 1.218))
    J['wr_' + s] = V((0.583 * sx, 0, 1.027))
    J['gl_' + s] = J['wr_' + s] + (J['wr_' + s] - J['el_' + s]).normalized() * 0.055
    J['hip_' + s] = V((0.10 * sx, 0, 0.95))
    J['kn_' + s] = V((0.10 * sx, 0, 0.51))
    J['an_' + s] = V((0.10 * sx, 0, 0.07))
    J['ball_' + s] = V((0.10 * sx, -0.15, 0.02))

# ---------- Skeleton ----------
FWD = V((0, -1, 0))
BONES = [  # name, head, tail, parent, connected, where the bone's Z axis points
    ('root', V((0, 0, 0)), V((0, 0, 0.1)), None, False, FWD),
    ('pelvis', J['pelvis'], J['abd'], 'root', False, FWD),
    ('spine', J['abd'], J['spine_mid'], 'pelvis', True, FWD),
    ('chest', J['spine_mid'], J['chest'], 'spine', True, FWD),
    ('neck', J['chest'], J['head'], 'chest', True, FWD),
    ('head', J['head'], J['top'], 'neck', True, FWD),
]
for s in ('l', 'r'):
    BONES += [
        ('clavicle_' + s, J['chest'], J['sh_' + s], 'chest', False, FWD),
        ('upperarm_' + s, J['sh_' + s], J['el_' + s], 'clavicle_' + s, True, FWD),
        ('forearm_' + s, J['el_' + s], J['wr_' + s], 'upperarm_' + s, True, FWD),
        ('hand_' + s, J['wr_' + s], J['gl_' + s], 'forearm_' + s, True, FWD),
        ('thigh_' + s, J['hip_' + s], J['kn_' + s], 'pelvis', False, FWD),
        ('shin_' + s, J['kn_' + s], J['an_' + s], 'thigh_' + s, True, FWD),
        ('foot_' + s, J['an_' + s], J['ball_' + s], 'shin_' + s, True, V((0, 0, 1))),
    ]
arm_data = bpy.data.armatures.new('rig')
arm = bpy.data.objects.new('rig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
with bpy.context.temp_override(active_object=arm, object=arm, selected_objects=[arm]):
    bpy.ops.object.mode_set(mode='EDIT')
    for name, h, t, parent, conn, zhint in BONES:
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = h, t
        b.align_roll(zhint)
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = conn
        b.use_deform = name != 'root'
    bpy.ops.object.mode_set(mode='OBJECT')

# ---------- Materials: names are what the game recolors ----------
def material(name, hexcolor):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    lin = tuple((int(hexcolor[i:i + 2], 16) / 255) ** 2.2 for i in (1, 3, 5)) + (1,)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = lin
    bsdf.inputs['Roughness'].default_value = 0.9
    m.diffuse_color = lin
    return m
MATS = {k: material(k, c) for k, c in {
    'skin': '#e0a57c', 'hair': '#241a14', 'eye': '#16100c', 'shorts': '#c8232c', 'trim': '#f2f2f2', 'glove': '#23252b', 'cuff': '#c8232c'}.items()}

# ---------- Shapes ----------
def align_z(d):
    return V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
def ell(bm, c, half, rot=None, segs=(24, 16)):
    m = Matrix.Translation(c) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((half[0], half[1], half[2], 1))
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1, matrix=m)
def capsule(bm, a, b, r1, r2):
    d = b - a
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=r1, radius2=r2, depth=d.length,
                          matrix=Matrix.Translation((a + b) / 2) @ align_z(d))
    ell(bm, a, (r1, r1, r1)); ell(bm, b, (r2, r2, r2))

def build(name, fill, material_name, voxel=None, smooth=0, tris=0):
    """Make a mesh from primitives; with voxel set, fuse it into one closed shell, smooth it and reduce it to about `tris`."""
    bm = bmesh.new()
    fill(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    def bake():
        new = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        ob.modifiers.clear(); ob.data = new
    if voxel:
        r = ob.modifiers.new('remesh', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = voxel; r.adaptivity = 0
        if smooth:
            sm = ob.modifiers.new('smooth', 'SMOOTH'); sm.factor = 0.5; sm.iterations = smooth
        bake()
        cur = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if tris and cur > tris:
            ob.modifiers.new('decimate', 'DECIMATE').ratio = tris / cur
            bake()
    ob.data.name = name
    ob.data.materials.append(MATS[material_name])
    ob.data.shade_smooth()
    return ob

def body_fill(bm):
    ell(bm, V((0, 0.005, 0.99)), (0.14, 0.10, 0.10))
    ell(bm, V((0, 0.0, 1.13)), (0.128, 0.092, 0.12))
    ell(bm, V((0, 0.005, 1.31)), (0.155, 0.10, 0.14))
    ell(bm, V((0, 0.015, 1.455)), (0.165, 0.078, 0.048))
    capsule(bm, V((0, 0.005, 1.44)), V((0, 0.005, 1.63)), 0.064, 0.056)
    for sx in (1, -1):
        s = 'l' if sx > 0 else 'r'
        ell(bm, V((0.07 * sx, -0.055, 1.37)), (0.078, 0.042, 0.058))      # pecs
        ell(bm, V((0.10 * sx, 0.02, 1.30)), (0.072, 0.07, 0.11))          # lats
        ell(bm, V((0.062 * sx, 0.052, 0.94)), (0.07, 0.058, 0.078))       # glutes
        ell(bm, J['sh_' + s] + V((0.022 * sx, 0, -0.005)), (0.072, 0.066, 0.078))  # deltoid
        capsule(bm, J['sh_' + s], J['el_' + s], 0.056, 0.044)
        mid = (J['sh_' + s] + J['el_' + s]) / 2 + V((0, -0.02, 0))
        ell(bm, mid, (0.046, 0.046, 0.09), align_z(J['el_' + s] - J['sh_' + s]))  # biceps
        capsule(bm, J['el_' + s], J['wr_' + s], 0.048, 0.036)
        capsule(bm, J['hip_' + s], J['kn_' + s], 0.078, 0.054)
        ell(bm, V((0.10 * sx, -0.022, 0.75)), (0.066, 0.068, 0.17))       # quads
        capsule(bm, J['kn_' + s], J['an_' + s], 0.05, 0.035)
        ell(bm, V((0.10 * sx, 0.03, 0.36)), (0.05, 0.056, 0.11))          # calves
        ell(bm, V((0.10 * sx, -0.055, 0.035)), (0.045, 0.115, 0.035))     # foot

def head_fill(bm):
    ell(bm, V((0, 0.005, 1.65)), (0.10, 0.108, 0.115))   # skull
    ell(bm, V((0, -0.035, 1.595)), (0.075, 0.075, 0.06)) # jaw
    ell(bm, V((0, -0.108, 1.637)), (0.02, 0.026, 0.026)) # nose
    ell(bm, V((0, -0.088, 1.69)), (0.075, 0.03, 0.02))   # brow
    for sx in (1, -1): ell(bm, V((0.10 * sx, 0.005, 1.65)), (0.022, 0.016, 0.03))  # ears

def shorts_fill(bm):
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=32, radius1=1, radius2=1, depth=0.17,
                          matrix=Matrix.Translation(V((0, 0.008, 0.985))) @ Matrix.Diagonal((0.162, 0.122, 1, 1)))
    ell(bm, V((0, 0.012, 0.92)), (0.155, 0.118, 0.06))
    for sx in (1, -1):  # legs stay apart so the shorts don't fuse at the crotch
        capsule(bm, V((0.115 * sx, 0, 0.93)), V((0.118 * sx, -0.006, 0.72)), 0.098, 0.093)

body = build('body', body_fill, 'skin', voxel=0.012, smooth=4, tris=4600)
head = build('head_mesh', head_fill, 'skin', voxel=0.008, smooth=3, tris=1200)
shorts = build('shorts', shorts_fill, 'shorts', voxel=0.012, smooth=3, tris=900)
trim = build('trim', lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=28, radius1=1, radius2=1, depth=0.032,
             matrix=Matrix.Translation(V((0, 0.008, 1.072))) @ Matrix.Diagonal((0.167, 0.127, 1, 1))), 'trim')
hair = build('hair', lambda bm: ell(bm, V((0, 0.02, 1.70)), (0.106, 0.112, 0.095), segs=(20, 12)), 'hair')
eyes = build('eyes', lambda bm: [ell(bm, V((0.039 * sx, -0.097, 1.666)), (0.013, 0.008, 0.015), segs=(8, 6)) for sx in (1, -1)], 'eye')
def along_forearm(s): return (J['wr_' + s] - J['el_' + s]).normalized()
gloves = build('gloves', lambda bm: [ell(bm, J['gl_' + s], (0.06, 0.06, 0.072), align_z(along_forearm(s)), segs=(14, 10)) for s in 'lr'], 'glove')
cuffs = build('cuffs', lambda bm: [ell(bm, J['gl_' + s] - along_forearm(s) * 0.054, (0.05, 0.05, 0.022), align_z(along_forearm(s)), segs=(14, 6)) for s in 'lr'], 'cuff')

# ---------- Skin weights ----------
# Distance to each bone, divided by that bone's thickness, so the ribcage never follows an arm.
# Left and right never mix, so one thigh never pulls the other.
SEG = {name: (h, t) for name, h, t, *_ in BONES}
RADIUS = {'pelvis': 0.16, 'spine': 0.14, 'chest': 0.16, 'neck': 0.065, 'clavicle': 0.045, 'upperarm': 0.062,
          'forearm': 0.05, 'thigh': 0.085, 'shin': 0.055, 'foot': 0.05}
def side(n): return 1 if n.endswith('_l') else -1 if n.endswith('_r') else 0
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length
def attach(ob):
    ob.parent = arm
    ob.modifiers.new('rig', 'ARMATURE').object = arm
def skin(ob, allowed, top=3):
    groups = {n: ob.vertex_groups.new(name=n) for n in allowed}
    for v in ob.data.vertices:
        p, cands = v.co, []
        for n in allowed:
            sd = side(n)
            if sd and abs(p.x) > 0.012 and (p.x > 0) != (sd > 0): continue
            dn = seg_dist(p, *SEG[n]) / RADIUS[n[:-2] if sd else n]
            cands.append((1 / max(dn, 0.05) ** 4, n))
        cands = sorted(cands, reverse=True)[:top]
        tot = sum(w for w, _ in cands)
        keep = [(w / tot, n) for w, n in cands if w / tot > 0.03]
        tot = sum(w for w, _ in keep)
        for w, n in keep: groups[n].add([v.index], w / tot, 'REPLACE')
    attach(ob)
def rigid(ob, left, right=None):
    gl = ob.vertex_groups.new(name=left)
    gr = ob.vertex_groups.new(name=right) if right else gl
    for v in ob.data.vertices: (gl if v.co.x > 0 or not right else gr).add([v.index], 1.0, 'REPLACE')
    attach(ob)

LR = lambda b: [b + '_l', b + '_r']
skin(body, ['pelvis', 'spine', 'chest', 'neck'] + LR('clavicle') + LR('upperarm') + LR('forearm') + LR('thigh') + LR('shin') + LR('foot'))
skin(shorts, ['pelvis', 'spine'] + LR('thigh'))
skin(trim, ['pelvis', 'spine'])
for ob in (head, hair, eyes): rigid(ob, 'head')
for ob in (gloves, cuffs): rigid(ob, 'hand_l', 'hand_r')

MESHES = [body, head, shorts, trim, hair, eyes, gloves, cuffs]
def tri_count(ob): return sum(len(p.vertices) - 2 for p in ob.data.polygons)
summary = {
    'bones': len(arm_data.bones),
    'tris': {o.name: tri_count(o) for o in MESHES},
    'total_tris': sum(tri_count(o) for o in MESHES),
    'top_of_head': round(max(v.co.z for v in head.data.vertices), 3),
}
