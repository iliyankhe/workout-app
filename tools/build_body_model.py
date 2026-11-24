"""Original stylised male figure, v4. Tapered, rounded muscle forms blended smoothly, a smoothed
surface, and per-vertex shading that darkens where two muscle forms meet (the seam lines).
Output: model/body.bin (format v3 layout) + model/body.json. Metres, feet on y=0, front = +z."""
import json, os, array
import numpy as np
from skimage import measure
import trimesh

H = 0.006
K_ENV = 0.02          # blend between skin and bone shapes
K_MUS = 0.010         # blend inside a muscle
SEAM_W = 0.0065       # seam half-width (m)
SKIN_D = 0.009        # surface farther than this from any muscle = skin
OUT = '/home/claude/app/model'

def sph(c, r):
    c = np.array(c, float)
    return lambda P: np.linalg.norm(P - c, axis=-1) - r

def ell(c, r):
    c = np.array(c, float); r = np.array(r, float)
    def f(P):
        q = (P - c) / r
        return (np.linalg.norm(q, axis=-1) - 1.0) * r.min()
    return f

def smin(fs, k):
    d = None
    for f in fs:
        v = f
        if d is None:
            d = v; continue
        h = np.clip(0.5 + 0.5 * (v - d) / k, 0.0, 1.0)
        d = v * (1 - h) + d * h - k * h * (1 - h)
    return d

MUSCLE_SCALE = 1.14

def taper(a, b, ra, rb, n=None):
    """Rounded cone from point a (radius ra) to point b (radius rb): a smooth limb segment."""
    a = np.array(a, float); b = np.array(b, float)
    ra = ra * MUSCLE_SCALE; rb = rb * MUSCLE_SCALE
    ba = b - a; l2 = ba @ ba; rr = ra - rb; a2 = l2 - rr * rr; il2 = 1.0 / l2
    def f(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        xv = pa * l2 - ba * y[..., None]
        x2 = np.sum(xv * xv, axis=-1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d1 = np.sqrt(x2 + z2) * il2 - rb
        d2 = np.sqrt(x2 + y2) * il2 - ra
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - ra
        return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))
    return f

def blend(*fs):
    return lambda P: smin([f(P) for f in fs], K_MUS)

BONES = []           # skin envelope
MUS = []             # (name, region, sdf)
def bone(f): BONES.append(f)
def mus(name, region, f): MUS.append((name, region, f))

# ---------- skin envelope (torso, head, neck, limbs, hands, feet)
bone(ell((0, 1.665, 0.01), (0.08, 0.10, 0.095)))            # head
bone(ell((0, 1.60, 0.025), (0.066, 0.05, 0.075)))           # jaw
bone(taper((0, 1.47, 0), (0, 1.60, 0), 0.07, 0.058))         # neck
bone(ell((0, 1.33, 0.0), (0.18, 0.13, 0.115)))              # chest
bone(ell((0, 1.31, -0.03), (0.15, 0.12, 0.10)))             # back
bone(ell((0, 1.05, 0.0), (0.14, 0.10, 0.095)))              # waist
bone(ell((0, 0.92, 0.0), (0.165, 0.08, 0.11)))              # hips
for s in (-1, 1):
    bone(sph((s*0.2, 1.37, 0), 0.085))                       # shoulder
    bone(taper((s*0.20, 1.34, 0), (s*0.24, 1.04, 0), 0.05, 0.035))   # upper arm
    bone(sph((s*0.25, 1.03, 0), 0.034))                      # elbow
    bone(taper((s*0.25, 1.00, 0), (s*0.29, 0.72, 0.0), 0.04, 0.024)) # forearm
    bone(ell((s*0.30, 0.67, 0.01), (0.03, 0.068, 0.022)))    # hand
    bone(taper((s*0.10, 0.90, 0), (s*0.09, 0.50, 0), 0.085, 0.05))   # thigh
    bone(sph((s*0.092, 0.47, 0.02), 0.05))                   # knee
    bone(taper((s*0.093, 0.44, -0.005), (s*0.085, 0.10, 0.0), 0.05, 0.032))  # shin
    bone(sph((s*0.09, 0.08, 0.0), 0.03))                     # ankle
    bone(ell((s*0.095, 0.05, 0.05), (0.05, 0.04, 0.12)))     # foot

# ---------- muscles (each has a region name used by the app)
mus('trap_c', 'upper_back', ell((0, 1.45, -0.06), (0.11, 0.07, 0.06)))
mus('lowback', 'lower_back', ell((0, 1.03, -0.08), (0.09, 0.06, 0.04)))
for s in (-1, 1):
    t = 'L' if s > 0 else 'R'
    mus('trap'+t, 'upper_back', taper((s*0.03, 1.46, -0.04), (s*0.2, 1.38, -0.05), 0.05, 0.045))
    mus('sterno'+t, 'neck', taper((s*0.045, 1.50, 0.035), (s*0.07, 1.59, 0.025), 0.018, 0.014))
    mus('pecU'+t, 'chest', ell((s*0.088, 1.36, 0.085), (0.09, 0.06, 0.06)))
    mus('pecL'+t, 'chest', ell((s*0.08, 1.30, 0.085), (0.075, 0.04, 0.05)))
    mus('delt'+t, 'shoulders', blend(ell((s*0.20, 1.38, 0.0), (0.09, 0.095, 0.085)),
                                     taper((s*0.19, 1.40, 0), (s*0.25, 1.22, 0.0), 0.075, 0.05)))
    mus('rdelt'+t, 'shoulders', ell((s*0.19, 1.37, -0.05), (0.06, 0.07, 0.05)))
    mus('biceps'+t, 'biceps', taper((s*0.21, 1.32, 0.035), (s*0.235, 1.10, 0.035), 0.058, 0.04))
    mus('triceps'+t, 'triceps', taper((s*0.21, 1.32, -0.035), (s*0.235, 1.08, -0.04), 0.06, 0.038))
    mus('fflex'+t, 'forearms', taper((s*0.25, 1.00, 0.02), (s*0.29, 0.74, 0.01), 0.05, 0.03))
    mus('fext'+t, 'forearms', taper((s*0.25, 1.00, -0.02), (s*0.29, 0.76, -0.01), 0.04, 0.024))
    mus('obl'+t, 'abs', ell((s*0.13, 1.12, 0.05), (0.045, 0.10, 0.045)))
    mus('lat'+t, 'lats', blend(ell((s*0.15, 1.19, -0.02), (0.06, 0.13, 0.07)),
                               taper((s*0.13, 1.30, -0.05), (s*0.12, 1.02, -0.05), 0.04, 0.03)))
    mus('erect'+t, 'lower_back', taper((s*0.05, 1.38, -0.09), (s*0.045, 0.98, -0.09), 0.035, 0.03))
    mus('glute'+t, 'glutes', ell((s*0.10, 0.91, -0.085), (0.10, 0.085, 0.10)))
    mus('quadL'+t, 'quads', taper((s*0.14, 0.90, 0.02), (s*0.115, 0.52, 0.02), 0.07, 0.048))
    mus('quadR'+t, 'quads', taper((s*0.095, 0.90, 0.05), (s*0.095, 0.52, 0.045), 0.058, 0.04))
    mus('quadM'+t, 'quads', taper((s*0.06, 0.86, 0.04), (s*0.075, 0.56, 0.04), 0.045, 0.03))
    mus('addu'+t, 'adductors', taper((s*0.035, 0.88, 0.035), (s*0.05, 0.56, 0.035), 0.035, 0.025))
    mus('ham'+t, 'hamstrings', taper((s*0.10, 0.88, -0.06), (s*0.09, 0.52, -0.06), 0.06, 0.04))
    mus('gastM'+t, 'calves', taper((s*0.07, 0.44, -0.05), (s*0.075, 0.20, -0.03), 0.07, 0.04))
    mus('gastL'+t, 'calves', taper((s*0.12, 0.44, -0.04), (s*0.10, 0.22, -0.02), 0.06, 0.036))
    mus('tib'+t, 'calves', taper((s*0.085, 0.44, 0.045), (s*0.08, 0.14, 0.04), 0.03, 0.02))
    for row, y in enumerate((1.23, 1.14, 1.05)):
        mus(f'abs{row}'+t, 'abs', ell((s*0.045, y, 0.095), (0.045, 0.042, 0.03)))

ALL = BONES + [f for _, _, f in MUS]

def env(P):
    return smin([f(P) for f in ALL], K_ENV)

xs = np.arange(-0.36, 0.36, H); ys = np.arange(-0.02, 1.81, H); zs = np.arange(-0.2, 0.22, H)
field = np.empty((len(xs), len(ys), len(zs)), dtype=np.float64)
for i, x in enumerate(xs):
    X, Y, Z = np.meshgrid([x], ys, zs, indexing='ij')
    field[i] = env(np.stack([X, Y, Z], -1))[0]
print('grid', field.shape, flush=True)
verts, faces, _, _ = measure.marching_cubes(field, level=0.0, spacing=(H, H, H))
verts = verts + np.array([xs[0], ys[0], zs[0]])
mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
e_ = np.stack([np.linalg.norm(mesh.vertices[mesh.faces[:, i]] - mesh.vertices[mesh.faces[:, (i + 1) % 3]], axis=1) for i in range(3)], 1)
print('before taubin: max edge', round(float(e_.max()), 4), 'long faces', int((e_.max(1) > 0.012).sum()), flush=True)
mesh.update_faces(e_.max(1) <= 0.012)
mesh.remove_unreferenced_vertices()
print('after filter faces', len(mesh.faces), 'watertight', mesh.is_watertight, flush=True)
mesh = trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=int(os.environ.get('TAUBIN', '4')))
verts = np.asarray(mesh.vertices); faces = np.asarray(mesh.faces)
normals = np.asarray(mesh.vertex_normals)
N = len(verts)
print('verts', N, 'faces', len(faces), flush=True)

names = [m[0] for m in MUS]
regions = sorted(set(m[1] for m in MUS)) + ['skin']
rid = {r: i for i, r in enumerate(regions)}
D = np.stack([f(verts) for _, _, f in MUS])
i1 = np.argmin(D, axis=0)
ar = np.arange(N)
d1 = D[i1, ar]
D2 = D.copy(); D2[i1, ar] = np.inf
d2 = D2.min(axis=0)
gap = np.clip((d2 - d1) / SEAM_W, 0, 1)
shade = 0.36 + 0.64 * gap * gap * (3 - 2 * gap)
vreg = np.array([rid[MUS[i][1]] for i in i1])
skin = d1 > SKIN_D
vreg[skin] = rid['skin']
shade[skin] = 1.0
print({r: int((vreg == rid[r]).sum()) for r in regions}, flush=True)

a, b, c = faces[:, 0], faces[:, 1], faces[:, 2]
ra, rb, rc = vreg[a], vreg[b], vreg[c]
tri_reg = np.where(rb == rc, rb, ra)

pos = array.array('f'); nor = array.array('f'); shd = array.array('f'); idx = array.array('I'); groups = []
total = 0; per = []
for r in regions:
    T = faces[tri_reg == rid[r]]
    if len(T) == 0:
        continue
    used, inv = np.unique(T.ravel(), return_inverse=True)
    per.append((r, used, inv.reshape(-1, 3)))
for r, used, inv in per:
    pos.extend(verts[used].astype(np.float32).ravel().tolist())
    nor.extend(normals[used].astype(np.float32).ravel().tolist())
    shd.extend(shade[used].astype(np.float32).tolist())
    groups.append({'region': r, 'vStart': total, 'vCount': len(used), 'iStart': len(idx), 'iCount': inv.size})
    idx.extend(inv.astype(np.uint32).ravel().tolist())
    total += len(used)

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'body.bin'), 'wb') as f:
    f.write(pos.tobytes()); f.write(nor.tobytes()); f.write(shd.tobytes()); f.write(idx.tobytes())
meta = {'format': 'v3', 'totalVertices': total, 'normalsOffset': total * 12, 'shadeOffset': total * 24,
        'indexOffset': total * 28, 'groups': groups, 'units': 'meters', 'upAxis': 'y', 'frontAxis': '+z',
        'height': round(float(verts[:, 1].max()), 3),
        'source': 'Original procedural figure (built in code, no third-party assets).'}
json.dump(meta, open(os.path.join(OUT, 'body.json'), 'w'), indent=1)
np.savez('/home/claude/body/v4/preview.npz', verts=verts, faces=faces, normals=normals, shade=shade, vreg=vreg)
json.dump({'regions': regions}, open('/home/claude/body/v4/regions.json', 'w'))
print('total', total, 'bytes', os.path.getsize(os.path.join(OUT, 'body.bin')), flush=True)
