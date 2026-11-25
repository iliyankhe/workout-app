"""Converts a rigged, skinned glTF/GLB character into the app's body model (format v4).
Each vertex is assigned to its dominant bone; limb and torso bones are split into muscle regions
using height (as a fraction of the figure) and front/back. The regions are chosen on the rest pose,
then the figure is posed (arms down by the sides, forearms slightly bent) with linear blend skinning,
scaled to 1.76 m, and set with its feet on y = 0. Front = +z (detected from the eye meshes).
Usage: python3 convert_rigged.py <file.gltf|file.glb> [--out DIR] [--pose 1] [--shape 1]"""
import json, os, struct, array, argparse
import numpy as np
import trimesh

DT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DROP_MATERIALS = ('MI_Hair', 'MI_Eyes')
# How far (metres) each muscle group is pushed out along its surface, so it stands out. Scaled by --bulge.
BULGE = {'chest': 0.018, 'shoulders': 0.014, 'biceps': 0.016, 'triceps': 0.013, 'forearms': 0.006,
         'abs': 0.009, 'obliques': 0.008, 'lats': 0.010, 'upper_back': 0.006, 'lower_back': 0.006,
         'glutes': 0.012, 'quads': 0.017, 'hamstrings': 0.013, 'adductors': 0.008, 'calves': 0.015,
         'neck': 0.0, 'skin': 0.0}

def load(path):
    base = os.path.dirname(path)
    if path.lower().endswith('.glb'):
        b = open(path, 'rb').read()
        jl = struct.unpack('<I', b[12:16])[0]
        j = json.loads(b[20:20 + jl])
        off = 20 + jl
        bl = struct.unpack('<I', b[off:off + 4])[0]
        return j, [b[off + 8: off + 8 + bl]]
    j = json.load(open(path))
    return j, [open(os.path.join(base, bb['uri']), 'rb').read() for bb in j['buffers']]

def accessor(j, bufs, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    nc = NC[a['type']]
    dt = np.dtype(DT[a['componentType']]).newbyteorder('<')
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or nc * dt.itemsize
    buf = bufs[bv['buffer']]
    if stride == nc * dt.itemsize:
        arr = np.frombuffer(buf, dtype=dt, count=a['count'] * nc, offset=start).reshape(a['count'], nc)
    else:
        raw = np.frombuffer(buf, dtype=np.uint8, count=a['count'] * stride + (stride - nc * dt.itemsize), offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], nc * dt.itemsize), strides=(stride, 1))
        arr = np.ascontiguousarray(rows).view(dt).reshape(a['count'], nc)
    return arr.copy()

# ---- Skeleton and pose ----------------------------------------------------------------------

def quat_to_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def node_matrices(j):
    """World matrix of every node in the rest pose, and each node's parent index."""
    nodes = j['nodes']; n = len(nodes)
    local = []
    for nd in nodes:
        if 'matrix' in nd:
            M = np.array(nd['matrix'], dtype=float).reshape(4, 4).T
        else:
            M = np.eye(4)
            M[:3, :3] = quat_to_mat(nd.get('rotation', [0, 0, 0, 1])) @ np.diag(nd.get('scale', [1, 1, 1]))
            M[:3, 3] = nd.get('translation', [0, 0, 0])
        local.append(M)
    parent = [-1] * n
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []): parent[c] = i
    world = [None] * n
    def wm(i):
        if world[i] is None:
            world[i] = local[i] if parent[i] < 0 else wm(parent[i]) @ local[i]
        return world[i]
    return [wm(i) for i in range(n)], parent

def under(parent, node, anc):
    while node >= 0:
        if node == anc: return True
        node = parent[node]
    return False

def rot_between(a, b):
    """3x3 rotation that turns direction a onto direction b."""
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(np.dot(a, b)); s = np.linalg.norm(v)
    if s < 1e-9: return np.eye(3)
    k = v / s
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + s * K + (1 - c) * (K @ K)

def about(R, p):
    """4x4 rotation R around the point p."""
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = p - R @ p
    return M

def arm_pose(world, parent, names, arm_angle=45.0):
    """Posed world matrices: each upper arm turns down to hang beside the body, and each forearm
    drops with a slight forward bend at the elbow. Everything below a bone moves with it."""
    W = list(world)
    for side in ('l', 'r'):
        up, lo, ha = names[f'upperarm_{side}'], names[f'lowerarm_{side}'], names[f'hand_{side}']
        pu, pl, ph = world[up][:3, 3], world[lo][:3, 3], world[ha][:3, 3]
        sx = 1.0 if (pl - pu)[0] >= 0 else -1.0
        a = np.radians(arm_angle)
        D1 = about(rot_between(pl - pu, np.array([sx * np.sin(a), -np.cos(a), 0.0])), pu)
        for i in range(len(W)):
            if under(parent, i, up): W[i] = D1 @ world[i]
        pl2 = (D1 @ np.append(pl, 1))[:3]; ph2 = (D1 @ np.append(ph, 1))[:3]
        D2 = about(rot_between(ph2 - pl2, np.array([sx * np.sin(a), -np.cos(a), 0.0])), pl2)   # forearm in line with the upper arm
        ph2 = (D2 @ np.append(ph2, 1))[:3]   # wrist after the elbow bend
        # Anatomical position: roll the forearm so the thumb points outward, which turns the palm forward.
        k = (ph2 - pl2) / np.linalg.norm(ph2 - pl2)
        # The hand continues the line of the forearm (straight wrist).
        mid = (D2 @ D1 @ np.append(world[names[f'middle_01_{side}']][:3, 3], 1))[:3]
        D4 = about(rot_between(mid - ph2, k), ph2)
        # Roll the forearm so the thumb points outward, which turns the palm forward.
        thumb = (D4 @ D2 @ D1 @ np.append(world[names[f'thumb_01_{side}']][:3, 3], 1))[:3]
        t = thumb - ph2; t = t - np.dot(t, k) * k
        u = np.array([sx, 0.0, 0.0]); u = u - np.dot(u, k) * k
        theta = np.arctan2(np.dot(k, np.cross(t, u)), np.dot(t, u))
        D3 = about(rodrigues(k, theta), pl2)
        for i in range(len(W)):
            if under(parent, i, ha): W[i] = D3 @ D4 @ D2 @ D1 @ world[i]
            elif under(parent, i, lo): W[i] = D3 @ D2 @ D1 @ world[i]
    return W

def rodrigues(k, theta):
    """3x3 rotation by theta about the unit axis k."""
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(theta) * K + (1 - np.cos(theta)) * (K @ K)

def skin_points(P, J, Wt, SM):
    """Linear blend skinning: move rest-pose points with their four bone weights."""
    Ph = np.hstack([P, np.ones((len(P), 1))])
    out = np.zeros((len(P), 3))
    for k in range(4):
        v = np.einsum('nij,nj->ni', SM[J[:, k]], Ph)[:, :3]
        out += Wt[:, k:k + 1] * v
    return out

# ---- Regions ----------------------------------------------------------------------------------

def region_of(bone, p, height, zc=0.0):
    n = bone.lower(); x, y, z = p; f = y / height
    if 'upperarm' in n:
        if abs(x) < 0.28: return 'shoulders'
        return 'biceps' if z > zc else 'triceps'
    if 'clavicle' in n: return 'shoulders'
    if 'lowerarm' in n: return 'forearms'
    if 'hand' in n or 'foot' in n or 'ball' in n or 'head' in n: return 'skin'
    if 'neck' in n: return 'neck'
    if 'thigh' in n:
        if f < 0.3: return 'skin'
        return 'quads' if z > zc else 'hamstrings'
    if 'calf' in n: return 'calves'
    if 'pelvis' in n:
        if z < 0: return 'glutes'
        if f > 0.45: return 'obliques' if abs(x) > 0.1 else 'abs'
        return 'skin'
    if 'spine' in n:
        # Front: pecs above the sternum, abs in the middle, obliques at the sides of the waist.
        if z > 0:
            if f > 0.62: return 'chest'
            if f > 0.5 and abs(x) > 0.085: return 'obliques'
            return 'abs'
        # Back: traps and upper back, lats at the sides, lower back along the spine.
        if abs(x) < 0.1 and f > 0.7: return 'upper_back'
        if abs(x) < 0.08: return 'upper_back' if f > 0.5 else 'lower_back'
        return 'lats' if f > 0.46 else 'lower_back'
    return 'skin'

def shape(Q, vreg, height):
    """Proportions only: fuller chest, broader shoulders and lats, narrower waist, firmer abs."""
    out = Q.copy()
    f = Q[:, 1] / height
    m = vreg == 'chest'; out[m, 2] += 0.012
    m = vreg == 'abs'; out[m, 2] += 0.006
    m = vreg == 'shoulders'; out[m, 0] *= 1.03; out[m, 1] -= 0.01
    m = vreg == 'lats'; out[m, 0] *= 1.05
    m = np.isin(vreg, ['obliques', 'abs', 'lower_back']) & (f > 0.42) & (f < 0.66)
    out[m, 0] *= 0.9
    return out

def smooth_labels(labels, idx, n, iters=6):
    """Majority vote over each vertex and its neighbours, so region borders become smooth curves."""
    import scipy.sparse as sp
    names, lab = np.unique(labels, return_inverse=True)
    R = len(names)
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    A = ((A + A.T) > 0).astype(float).tocsr()
    A = A + sp.identity(n, format='csr') * 1.5
    for _ in range(iters):
        onehot = sp.csr_matrix((np.ones(n), (np.arange(n), lab)), shape=(n, R))
        counts = (A @ onehot).toarray()
        lab = counts.argmax(axis=1)
    return names[lab]

def taubin(Q, idx, n, iters=6, lam=0.5, mu=-0.53):
    """Taubin smoothing: rounds the blocky joins and creases without shrinking the surface."""
    import scipy.sparse as sp
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    A = ((A + A.T) > 0).astype(float).tocsr()
    deg = np.asarray(A.sum(axis=1)).ravel(); deg[deg == 0] = 1
    An = sp.diags(1.0 / deg) @ A
    X = Q.copy()
    for _ in range(iters):
        X = X + lam * (An @ X - X)
        X = X + mu * (An @ X - X)
    return X

def smooth_values(v, idx, n, iters=8):
    """Averages a per-vertex value over neighbours, so a bulge fades out smoothly at region borders."""
    import scipy.sparse as sp
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    A = ((A + A.T) > 0).astype(float).tocsr()
    deg = np.asarray(A.sum(axis=1)).ravel(); deg[deg == 0] = 1
    An = sp.diags(1.0 / deg) @ A
    x = v.astype(float).copy()
    for _ in range(iters):
        x = 0.5 * x + 0.5 * (An @ x)
    return x

def seams_of(Q, idx, tri_reg, nrm, iters=15, lift=0.002):
    """Smooth line segments along edges shared by two triangles of different muscle regions."""
    import scipy.sparse as sp
    N = len(Q)
    a = np.concatenate([idx[:, 0], idx[:, 1], idx[:, 2]])
    b = np.concatenate([idx[:, 1], idx[:, 2], idx[:, 0]])
    reg = np.concatenate([tri_reg, tri_reg, tri_reg])
    lo = np.minimum(a, b); hi = np.maximum(a, b)
    key = lo * N + hi
    order = np.argsort(key, kind='stable')
    k = key[order]
    same = np.where(k[1:] == k[:-1])[0]
    r1 = reg[order][same]; r2 = reg[order][same + 1]
    diff = same[r1 != r2]
    if len(diff) == 0:
        return np.zeros((0, 2, 3))
    e_lo = lo[order][diff]; e_hi = hi[order][diff]
    ids, inv = np.unique(np.concatenate([e_lo, e_hi]), return_inverse=True)
    m = len(ids)
    ea = inv[:len(e_lo)]; eb = inv[len(e_lo):]
    A = sp.coo_matrix((np.ones(2 * len(ea)), (np.concatenate([ea, eb]), np.concatenate([eb, ea]))), shape=(m, m)).tocsr()
    deg = np.asarray(A.sum(axis=1)).ravel(); deg[deg == 0] = 1
    An = sp.diags(1.0 / deg) @ A
    X = Q[ids].copy()
    for _ in range(iters):
        X = 0.5 * X + 0.5 * (An @ X)
    X = X + nrm[ids] * lift
    return np.stack([X[ea], X[eb]], axis=1)

# ---- Build ---------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('--out', default='/home/claude/app/model')
    ap.add_argument('--height', type=float, default=1.76)
    ap.add_argument('--smooth', type=int, default=6)
    ap.add_argument('--shape', type=int, default=1)
    ap.add_argument('--pose', type=int, default=1)
    ap.add_argument('--arm-angle', type=float, default=45.0)
    ap.add_argument('--smooth-surface', type=int, default=6)
    ap.add_argument('--bulge', type=float, default=1.0)
    args = ap.parse_args()
    j, bufs = load(args.src)
    skel = j['skins'][0]
    joints = skel['joints']
    bone_names = [j['nodes'][n].get('name', '') for n in joints]
    names = {nd.get('name', ''): i for i, nd in enumerate(j['nodes'])}
    world, parent = node_matrices(j)
    IBM = accessor(j, bufs, skel['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    rest = np.stack([world[n] @ IBM[k] for k, n in enumerate(joints)])
    print('rest skin deviation from identity', round(float(np.abs(rest - np.eye(4)).max()), 6))
    posed_world = arm_pose(world, parent, names, args.arm_angle) if args.pose else world
    SM = np.stack([posed_world[n] @ IBM[k] for k, n in enumerate(joints)])

    parts = []
    for m in j['meshes']:
        for p in m['primitives']:
            if p.get('mode', 4) != 4 or 'POSITION' not in p['attributes']: continue
            mat = j['materials'][p['material']].get('name', '') if 'material' in p else ''
            P = accessor(j, bufs, p['attributes']['POSITION']).astype(np.float64)
            idx = accessor(j, bufs, p['indices']).astype(np.int64).reshape(-1, 3)
            J = accessor(j, bufs, p['attributes']['JOINTS_0']).astype(np.int64)
            W = accessor(j, bufs, p['attributes']['WEIGHTS_0']).astype(np.float64)
            UV = accessor(j, bufs, p['attributes']['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in p['attributes'] else np.zeros((len(P), 2))
            dom = J[np.arange(len(J)), np.argmax(W, axis=1)]
            parts.append((P, idx, dom, mat, UV, J, W))
    print('primitives', [pp[3] for pp in parts])

    body = [pp for pp in parts if not pp[3].startswith(DROP_MATERIALS)]
    eyes = [pp for pp in parts if 'eye' in pp[3].lower()]
    posed = [skin_points(pp[0], pp[5], pp[6], SM) if args.pose else pp[0] for pp in body]
    allP = np.vstack([pp[0] for pp in body])   # bounds from the rest pose, so region thresholds do not move with the arms
    flip = False
    if eyes:
        flip = np.vstack([e[0] for e in eyes])[:, 2].mean() < np.vstack([pp[0] for pp in body])[:, 2].mean()
    lo = allP.min(axis=0); hi = allP.max(axis=0)
    s = args.height / (hi[1] - lo[1])
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])

    # Centre line in z for each bone, from the rest pose, so arm and leg muscles split front from back.
    zs_all = {}
    for P, idx, dom, mat, UV, J, W in body:
        Q = (P - centre) * s
        if flip: Q[:, 2] *= -1
        for d in np.unique(dom):
            zs_all.setdefault(d, []).append(Q[dom == d, 2])
    ZC = {d: float(np.concatenate(a).mean()) for d, a in zs_all.items()}

    groups = {}
    seam_chunks = []
    for (P, idx, dom, mat, UV, J, W), Pp in zip(body, posed):
        Qr = (P - centre) * s          # rest pose: used to choose regions
        Qg = (Pp - centre) * s         # posed: used for the geometry
        if flip:
            Qr[:, 0] *= -1; Qr[:, 2] *= -1
            Qg[:, 0] *= -1; Qg[:, 2] *= -1
        vreg = np.array([region_of(bone_names[d], Qr[i], args.height, ZC.get(d, 0.0)) for i, d in enumerate(dom)])
        vreg = smooth_labels(vreg, idx, len(Qg), iters=args.smooth)
        Qs = taubin(Qg, idx, len(Qg), iters=args.smooth_surface) if args.smooth_surface else Qg
        if args.bulge:
            nb = np.asarray(trimesh.Trimesh(vertices=Qs, faces=idx, process=False).vertex_normals)
            amt = smooth_values(np.array([BULGE.get(r, 0.0) for r in vreg]), idx, len(Qs), iters=40)
            Qs = taubin(Qs + nb * (amt[:, None] * args.bulge), idx, len(Qs), iters=8)
        Q = shape(Qs, vreg, args.height) if args.shape else Qs
        tri = vreg[idx]
        tri_reg = np.where(tri[:, 1] == tri[:, 2], tri[:, 1], tri[:, 0])
        nrm = np.asarray(trimesh.Trimesh(vertices=Q, faces=idx, process=False).vertex_normals)
        seam_chunks.append(seams_of(Q, idx, tri_reg, nrm))
        for r in set(tri_reg):
            groups.setdefault(r, []).append((Q, nrm, UV, idx[tri_reg == r]))
    seam_pos = np.vstack(seam_chunks) if seam_chunks else np.zeros((0, 2, 3))

    pos = array.array('f'); nor = array.array('f'); shd = array.array('f'); uvs = array.array('f')
    ind = array.array('I'); meta_groups = []; total = 0
    for r in sorted(groups):
        Ps, Ns, Us, Is = [], [], [], []; offset = 0
        for Q, nrm, UV, T in groups[r]:
            used, inv = np.unique(T.ravel(), return_inverse=True)
            Ps.append(Q[used]); Ns.append(nrm[used]); Us.append(UV[used]); Is.append(inv.reshape(-1, 3) + offset)
            offset += len(used)
        Pc = np.vstack(Ps); Nc = np.vstack(Ns); Uc = np.vstack(Us); Ic = np.vstack(Is)
        pos.extend(Pc.astype(np.float32).ravel().tolist()); nor.extend(Nc.astype(np.float32).ravel().tolist())
        shd.extend([1.0] * len(Pc)); uvs.extend(Uc.astype(np.float32).ravel().tolist())
        meta_groups.append({'region': str(r), 'vStart': total, 'vCount': len(Pc), 'iStart': len(ind), 'iCount': Ic.size})
        ind.extend(Ic.astype(np.uint32).ravel().tolist())
        total += len(Pc)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, 'body.bin'), 'wb') as f:
        for chunk in (pos, nor, shd, uvs, ind):
            f.write(chunk.tobytes())
    with open(os.path.join(args.out, 'seams.bin'), 'wb') as f:
        f.write(seam_pos.astype(np.float32).ravel().tobytes())
    meta = {'format': 'v4', 'totalVertices': total, 'normalsOffset': total * 12, 'shadeOffset': total * 24,
            'uvOffset': total * 28, 'indexOffset': total * 36, 'groups': meta_groups, 'units': 'meters',
            'upAxis': 'y', 'frontAxis': '+z', 'height': args.height, 'pose': 'arms out, elbows bent, forearms forward' if args.pose else 'rest',
            'seamSegments': int(len(seam_pos)),
            'source': 'Universal Base Characters by Quaternius (CC0), converted by convert_rigged.py'}
    json.dump(meta, open(os.path.join(args.out, 'body.json'), 'w'), indent=1)
    print('flip', flip, 'vertices', total, {g['region']: g['vCount'] for g in meta_groups})

if __name__ == '__main__':
    main()
