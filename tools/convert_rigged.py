"""Converts a rigged, skinned glTF/GLB character into the app's body model (format v4).
Each vertex is assigned to its dominant bone; limb and torso bones are split into muscle regions
using height (as a fraction of the figure) and front/back. Scales to 1.76 m, feet on y = 0,
front = +z (detected from the eye meshes). Hair and eyes are left out. Writes UVs for the textures.
Usage: python3 convert_rigged.py <file.gltf|file.glb> [--out DIR]"""
import json, os, struct, array, argparse
import numpy as np
import trimesh

DT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DROP_MATERIALS = ('MI_Hair', 'MI_Eyes')

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
    """Proportions only: fuller chest, broader shoulders and lats, narrower waist, firmer abs.
    Applied after the regions are chosen, so the region borders stay where they were."""
    out = Q.copy()
    f = Q[:, 1] / height
    m = vreg == 'chest'; out[m, 2] += 0.012
    m = vreg == 'abs'; out[m, 2] += 0.006
    m = vreg == 'shoulders'; out[m, 0] *= 1.08
    m = vreg == 'lats'; out[m, 0] *= 1.05
    m = np.isin(vreg, ['obliques', 'abs', 'lower_back']) & (f > 0.42) & (f < 0.66)
    out[m, 0] *= 0.93
    return out

def smooth_labels(labels, idx, n, iters=6):
    """Majority vote over each vertex and its neighbours, so region borders become smooth curves
    instead of following the jagged weight boundaries."""
    import scipy.sparse as sp
    names, lab = np.unique(labels, return_inverse=True)
    R = len(names)
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    A = ((A + A.T) > 0).astype(float).tocsr()
    A = A + sp.identity(n, format='csr') * 1.5          # the vertex itself counts more
    for _ in range(iters):
        onehot = sp.csr_matrix((np.ones(n), (np.arange(n), lab)), shape=(n, R))
        counts = (A @ onehot).toarray()
        lab = counts.argmax(axis=1)
    return names[lab]

def seams_of(Q, idx, tri_reg, nrm, iters=15, lift=0.002):
    """Smooth line segments along edges shared by two triangles of different muscle regions.
    The seam vertices are averaged with their neighbours along the seam (so the lines are smooth
    curves, not triangle zigzags), then lifted slightly off the surface."""
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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('--out', default='/home/claude/app/model')
    ap.add_argument('--height', type=float, default=1.76)
    ap.add_argument('--smooth', type=int, default=6)
    ap.add_argument('--shape', type=int, default=1)
    args = ap.parse_args()
    j, bufs = load(args.src)
    joints = j['skins'][0]['joints']
    bone_names = [j['nodes'][n].get('name', '') for n in joints]

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
            parts.append((P, idx, dom, mat, UV))
    print('primitives', [pp[3] for pp in parts])

    body = [pp for pp in parts if not pp[3].startswith(DROP_MATERIALS)]
    eyes = [pp for pp in parts if 'eye' in pp[3].lower()]
    allP = np.vstack([pp[0] for pp in body])
    flip = False
    if eyes:
        flip = np.vstack([e[0] for e in eyes])[:, 2].mean() < allP[:, 2].mean()
    lo = allP.min(axis=0); hi = allP.max(axis=0)
    s = args.height / (hi[1] - lo[1])
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])

    # centre line in z for each bone, so arm and leg muscles split front from back correctly
    zs_all = {}
    for P, idx, dom, mat, UV in body:
        Q = (P - centre) * s
        if flip: Q[:, 2] *= -1
        for d in np.unique(dom):
            zs_all.setdefault(d, []).append(Q[dom == d, 2])
    ZC = {d: float(np.concatenate(a).mean()) for d, a in zs_all.items()}

    groups = {}
    seam_chunks = []
    for P, idx, dom, mat, UV in body:
        Q = (P - centre) * s
        if flip: Q[:, 0] *= -1; Q[:, 2] *= -1
        vreg = np.array([region_of(bone_names[d], Q[i], args.height, ZC.get(d, 0.0)) for i, d in enumerate(dom)])
        vreg = smooth_labels(vreg, idx, len(Q), iters=args.smooth)
        if args.shape: Q = shape(Q, vreg, args.height)
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
            'upAxis': 'y', 'frontAxis': '+z', 'height': args.height,
            'seamSegments': int(len(seam_pos)),
            'source': 'Universal Base Characters by Quaternius (CC0), converted by convert_rigged.py'}
    json.dump(meta, open(os.path.join(args.out, 'body.json'), 'w'), indent=1)
    print('flip', flip, 'vertices', total, {g['region']: g['vCount'] for g in meta_groups})

if __name__ == '__main__':
    main()
