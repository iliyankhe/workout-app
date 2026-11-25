"""Colour-by-region preview of the body model (front and back), to check the muscle split."""
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
fig, axes = plt.subplots(1, 2, figsize=(8, 7), facecolor='#1b1c24')
for ax, flip in zip(axes, [1, -1]):
    polys, cols = [], []
    for g in m['groups']:
        T = np.frombuffer(raw[m['indexOffset']+g['iStart']*4:m['indexOffset']+(g['iStart']+g['iCount'])*4], dtype=np.uint32).reshape(-1, 3) + g['vStart']
        keep = P[T][:, :, 2].mean(1) * flip > 0
        polys.append(P[T[keep]][:, :, :2]); cols += [PAL.get(g['region'], '#888')] * int(keep.sum())
    ax.add_collection(PolyCollection(np.concatenate(polys), facecolors=cols, edgecolors='none'))
    ax.set_xlim(-0.4, 0.4); ax.set_ylim(-0.02, 1.85); ax.set_aspect('equal'); ax.axis('off'); ax.set_title('front' if flip > 0 else 'back', color='w')
plt.tight_layout(); plt.savefig(out, dpi=80, facecolor='#1b1c24'); print('ok')
