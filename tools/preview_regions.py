"""Colour-by-region preview of the body model: front, side and back views, to check the pose and the muscle split."""
import json, sys, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
folder, out = sys.argv[1], sys.argv[2]
m = json.load(open(folder + '/body.json')); raw = open(folder + '/body.bin', 'rb').read()
n = m['totalVertices']
P = np.frombuffer(raw[:n*12], dtype=np.float32).reshape(-1, 3).astype(float)
PAL = {'chest': '#e4572e', 'abs': '#f3a712', 'obliques': '#a8c686', 'lats': '#669bbc', 'upper_back': '#3d5a80',
       'lower_back': '#98c1d9', 'shoulders': '#c77dff', 'biceps': '#ff9770', 'triceps': '#ffd6a5', 'forearms': '#ffc6ff',
       'quads': '#2ec4b6', 'hamstrings': '#1b998b', 'glutes': '#e71d36', 'calves': '#cbf3f0', 'neck': '#ffffff', 'skin': '#46465a'}
# (horizontal axis, depth axis, keep faces facing the viewer)
VIEWS = [('front', 0, 2, 1), ('side', 2, 0, 1), ('back', 0, 2, -1)]
fig, axes = plt.subplots(1, 3, figsize=(12, 7), facecolor='#1b1c24')
for ax, (title, hx, dz, facing) in zip(axes, VIEWS):
    polys, cols, depth = [], [], []
    for g in m['groups']:
        T = np.frombuffer(raw[m['indexOffset']+g['iStart']*4:m['indexOffset']+(g['iStart']+g['iCount'])*4], dtype=np.uint32).reshape(-1, 3) + g['vStart']
        polys.append(P[T][:, :, [hx, 1]]); depth.append(P[T][:, :, dz].mean(1) * facing); cols += [PAL.get(g['region'], '#888')] * len(T)
    poly = np.concatenate(polys); dep = np.concatenate(depth); order = np.argsort(dep)   # far first, near last
    ax.add_collection(PolyCollection(poly[order], facecolors=[cols[i] for i in order], edgecolors='none'))
    ax.set_xlim(-0.5, 0.5); ax.set_ylim(-0.02, 1.85); ax.set_aspect('equal'); ax.axis('off'); ax.set_title(title, color='w')
plt.tight_layout(); plt.savefig(out, dpi=80, facecolor='#1b1c24'); print('ok')
