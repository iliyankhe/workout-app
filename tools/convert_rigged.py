"""Converts a rigged, skinned glTF/GLB character into the app's body model (format v3).
Each vertex is assigned to its dominant bone; limb and torso bones are split into muscle regions
using height (as a fraction of the figure) and front/back (z). Scales to 1.76 m, feet on y=0,
front = +z (detected from the eye meshes when present).
Usage: python3 convert_rigged.py <file.gltf|file.glb> [--out DIR]"""
import json, os, sys, struct, array, argparse
import numpy as np
import trimesh

DT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def load(path):
    base = os.path.dirname(path)
    if path.lower().endswith('.glb'):
        b = open(path, 'rb').read()
        jl = struct.unpack('<I', b[12:16])[0]
        j = json.loads(b[20:20 + jl])
        off = 20 + jl
        bl = struct.unpack('<I', b[off:off + 4])[0]
        bufs = [b[off + 8: off + 8 + bl]]
    else:
        j = json.load(open(path))
        bufs = [open(os.path.join(base, bb['uri']), 'rb').read() for bb in j['buffers']]
    return j, bufs

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
    """p = position (metres, feet at 0). Returns a body region name."""
    n = bone.lower(); x, y, z = p; f = y / height
    if 'upperarm' in n:
        if abs(x) < 0.28: return 'shoulders'
        return 'biceps' if z > zc else 'triceps'
    if 'clavicle' in n: return 'shoulders'
    if 'lowerarm' in n: return 'forearms'
    if 'hand' in n or 'foot' in n or 'ball' in n or 'head' in n or 'eye' in n or 'hair' in n: return 'skin'
    if 'neck' in n: return 'neck'
    if 'thigh' in n:
        if f < 0.3: return 'skin'
        return 'quads' if z > 0 else 'hamstrings'
    if 'calf' in n: return 'calves'
    if 'pelvis' in n:
        if z < 0: return 'glutes'
        return 'abs' if f > 0.5 else 'skin'
    if 'spine' in n:
        if z > 0: return 'chest' if f > 0.6 else 'abs'
        return 'upper_back' if f > 0.6 else 'lower_back'
    return 'skin'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('--out', default='/home/claude/app/model')
    ap.add_argument('--height', type=float, default=1.76)
    args = ap.parse_args()
    j, bufs = load(args.src)
    joints = j['skins'][0]['joints']
    bone_names = [j['nodes'][n].get('name', '') for n in joints]

    parts = []   # (P, idx, dom-bone-per-vertex, is_eye)
    for m in j['meshes']:
        for p in m['primitives']:
            if p.get('mode', 4) != 4 or 'POSITION' not in p['attributes']: continue
            mat = j['materials'][p['material']].get('name', '') if 'material' in p else ''
            P = accessor(j, bufs, p['attributes']['POSITION']).astype(np.float64)
            idx = accessor(j, bufs, p['indices']).astype(np.int64).reshape(-1, 3)
            J = accessor(j, bufs, p['attributes']['JOINTS_0']).astype(np.int64)
            W = accessor(j, bufs, p['attributes']['WEIGHTS_0']).astype(np.float64)
            dom = J[np.arange(len(J)), np.argmax(W, axis=1)]
            parts.append((P, idx, dom, mat))
    print('primitives', len(parts), [pp[3] for pp in parts])

    # Front detection from eye meshes (eyes sit in front of the head centre)
    allP = np.vstack([pp[0] for pp in parts])
    flip = False
    eyes = [pp for pp in parts if 'eye' in pp[3].lower()]
    if eyes:
        ez = np.vstack([e[0] for e in eyes])[:, 2].mean()
        flip = ez < allP[:, 2].mean()
    lo = allP.min(axis=0); hi = allP.max(axis=0)
    s = args.height / (hi[1] - lo[1])
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])

    # per-bone centre line in z (for splitting arm muscles front/back)
    ZC = {}
    zs_all = {}
    for P, idx, dom, mat in parts:
        Q = (P - centre) * s
        if flip:
            Q[:, 2] *= -1
        for d in np.unique(dom):
            zs_all.setdefault(d, []).append(Q[dom == d, 2])
    for d, arrs in zs_all.items():
        ZC[d] = float(np.concatenate(arrs).mean())
    groups = {}
    for P, idx, dom, mat in parts:
        Q = (P - centre) * s
        if flip:
            Q[:, 0] *= -1; Q[:, 2] *= -1
        reg = [region_of(bone_names[d], Q[i], args.height, ZC.get(d, 0.0)) for i, d in enumerate(dom)]
        vreg = np.array(reg)
        tri = vreg[idx]
        tri_reg = np.where(tri[:, 1] == tri[:, 2], tri[:, 1], tri[:, 0])
        mesh = trimesh.Trimesh(vertices=Q, faces=idx, process=False)
        nrm = np.asarray(mesh.vertex_normals)
        for r in set(tri_reg):
            T = idx[tri_reg == r]
            groups.setdefault(r, []).append((Q, nrm, T))
    pos = array.array('f'); nor = array.array('f'); shd = array.array('f'); ind = array.array('I'); meta_groups = []; total = 0
    for r in sorted(groups):
        Ps, Ns, Is = [], [], []; offset = 0
        for Q, nrm, T in groups[r]:
            used, inv = np.unique(T.ravel(), return_inverse=True)
            Ps.append(Q[used]); Ns.append(nrm[used]); Is.append(inv.reshape(-1, 3) + offset); offset += len(used)
        Pc = np.vstack(Ps); Nc = np.vstack(Ns); Ic = np.vstack(Is)
        pos.extend(Pc.astype(np.float32).ravel().tolist()); nor.extend(Nc.astype(np.float32).ravel().tolist())
        shd.extend([1.0] * len(Pc))
        meta_groups.append({'region': r, 'vStart': total, 'vCount': len(Pc), 'iStart': len(ind), 'iCount': Ic.size})
        ind.extend(Ic.astype(np.uint32).ravel().tolist())
        total += len(Pc)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, 'body.bin'), 'wb') as f:
        f.write(pos.tobytes()); f.write(nor.tobytes()); f.write(shd.tobytes()); f.write(ind.tobytes())
    meta = {'format': 'v3', 'totalVertices': total, 'normalsOffset': total * 12, 'shadeOffset': total * 24,
            'indexOffset': total * 28, 'groups': meta_groups, 'units': 'meters', 'upAxis': 'y', 'frontAxis': '+z',
            'height': args.height, 'source': 'Universal Base Characters by Quaternius (CC0), converted by convert_rigged.py'}
    json.dump(meta, open(os.path.join(args.out, 'body.json'), 'w'), indent=1)
    print('flip', flip, 'scale', round(s, 4), 'vertices', total, 'regions', {g['region']: g['vCount'] for g in meta_groups})

if __name__ == '__main__':
    main()
