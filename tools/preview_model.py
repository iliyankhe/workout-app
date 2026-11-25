"""Shaded 3-angle preview of a body model folder (body.json + body.bin)."""
import json, sys, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
folder, out = sys.argv[1], sys.argv[2]
m = json.load(open(folder + '/body.json')); raw = open(folder + '/body.bin', 'rb').read()
n = m['totalVertices']
P = np.frombuffer(raw[:n*12], dtype=np.float32).reshape(-1, 3).astype(float)
N = np.frombuffer(raw[m['normalsOffset']:m['normalsOffset']+n*12], dtype=np.float32).reshape(-1, 3).astype(float)
C = {'skin': (0.27,0.27,0.35), 'chest': (0.5,0.5,0.6), 'abs': (0.5,0.5,0.6), 'shoulders': (0.5,0.5,0.6),
     'biceps': (0.5,0.5,0.6), 'triceps': (0.5,0.5,0.6), 'quads': (0.5,0.5,0.6), 'hamstrings': (0.5,0.5,0.6),
     'calves': (0.5,0.5,0.6), 'glutes': (0.5,0.5,0.6), 'lats': (0.5,0.5,0.6), 'upper_back': (0.5,0.5,0.6),
     'lower_back': (0.5,0.5,0.6), 'forearms': (0.5,0.5,0.6), 'adductors': (0.5,0.5,0.6), 'neck': (0.4,0.4,0.5)}
L = np.array([0.35, 0.55, 0.75]); L /= np.linalg.norm(L)
fig, axes = plt.subplots(1, 3, figsize=(15, 8), facecolor='#1b1c24')
tris = []; cols = []
for g in m['groups']:
    idx = np.frombuffer(raw[m['indexOffset']+g['iStart']*4:m['indexOffset']+(g['iStart']+g['iCount'])*4], dtype=np.uint32).reshape(-1, 3)
    tris.append(g['vStart'] + idx); cols.append(np.array(C.get(g['region'], (0.5,0.5,0.6))))
for ax, th in zip(axes, [0, 0.6, np.pi/2]):
    c, s = np.cos(th), np.sin(th)
    rot = lambda Q: np.stack([Q[:,0]*c + Q[:,2]*s, Q[:,1], -Q[:,0]*s + Q[:,2]*c], 1)
    Pr, Nr = rot(P), rot(N)
    polys = []; fcols = []
    for T, col in zip(tris, cols):
        fn = Nr[T].mean(1)
        keep = fn[:, 2] > 0
        Tk = T[keep]
        depth = Pr[Tk][:, :, 2].mean(1)
        lam = np.clip(Nr[Tk].mean(1) @ L, 0, 1)
        shade = (0.28 + 0.72*lam)[:, None] * col[None]
        polys.append(Pr[Tk][:, :, :2]); fcols.append((depth, shade))
    depth = np.concatenate([d for d, _ in fcols]); shade = np.vstack([s_ for _, s_ in fcols])
    poly = np.concatenate(polys)
    o = np.argsort(depth)
    ax.add_collection(PolyCollection(poly[o], facecolors=np.clip(shade[o]*1.15, 0, 1), edgecolors='none'))
    ax.set_xlim(-0.45, 0.45); ax.set_ylim(-0.02, 1.85); ax.set_aspect('equal'); ax.axis('off')
plt.tight_layout(); plt.savefig(out, dpi=70, facecolor='#1b1c24'); print('ok')
