"""Flat-style preview of the body model: region fills, dark seam lines between muscle groups."""
import json, sys, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection, LineCollection
folder, out = sys.argv[1], sys.argv[2]
m = json.load(open(folder + '/body.json')); raw = open(folder + '/body.bin', 'rb').read()
seams = np.frombuffer(open(folder + '/seams.bin', 'rb').read(), dtype=np.float32).reshape(-1, 2, 3).astype(float)
n = m['totalVertices']
P = np.frombuffer(raw[:n*12], dtype=np.float32).reshape(-1, 3).astype(float)
N = np.frombuffer(raw[m['normalsOffset']:m['normalsOffset']+n*12], dtype=np.float32).reshape(-1, 3).astype(float)
MUSCLE = np.array([0x7d, 0x7d, 0x95]) / 255; SKIN = np.array([0x46, 0x46, 0x58]) / 255; LINE = '#3a3a4c'
L = np.array([0.35, 0.55, 0.75]); L /= np.linalg.norm(L)
fig, axes = plt.subplots(1, 3, figsize=(15, 8), facecolor='#1b1c24')
groups = [(g['region'], np.frombuffer(raw[m['indexOffset']+g['iStart']*4:m['indexOffset']+(g['iStart']+g['iCount'])*4], dtype=np.uint32).reshape(-1, 3) + g['vStart']) for g in m['groups']]
for ax, th in zip(axes, [0, 0.6, np.pi/2]):
    c, s = np.cos(th), np.sin(th)
    rot = lambda Q: np.stack([Q[..., 0]*c + Q[..., 2]*s, Q[..., 1], -Q[..., 0]*s + Q[..., 2]*c], -1)
    Pr, Nr = rot(P), rot(N)
    polys = []; cols = []; depth = []
    for region, T in groups:
        base = SKIN if region == 'skin' else MUSCLE
        fn = Nr[T].mean(1); Tk = T[fn[:, 2] > 0]
        if len(Tk) == 0: continue
        lam = np.clip(Nr[Tk].mean(1) @ L, 0, 1)
        shade = 0.55 + 0.45 * lam
        polys.append(Pr[Tk][:, :, :2]); cols.append(np.clip(base[None] * shade[:, None] * 1.1, 0, 1)); depth.append(Pr[Tk][:, :, 2].mean(1))
    poly = np.concatenate(polys); col = np.vstack(cols); dep = np.concatenate(depth); o = np.argsort(dep)
    ax.add_collection(PolyCollection(poly[o], facecolors=col[o], edgecolors='none'))
    S = rot(seams); keep = S[:, :, 2].mean(1) > -0.02
    ax.add_collection(LineCollection(S[keep][:, :, :2], colors=LINE, linewidths=0.8))
    ax.set_xlim(-0.45, 0.45); ax.set_ylim(-0.02, 1.85); ax.set_aspect('equal'); ax.axis('off')
plt.tight_layout(); plt.savefig(out, dpi=75, facecolor='#1b1c24'); print('ok', len(seams))
