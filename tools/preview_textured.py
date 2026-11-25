"""Preview of body model v4 with the body texture sampled at each vertex's UV (flipY as glTF)."""
import json, sys, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from PIL import Image
folder, out = sys.argv[1], sys.argv[2]
m = json.load(open(folder + '/body.json')); raw = open(folder + '/body.bin', 'rb').read()
n = m['totalVertices']
P = np.frombuffer(raw[:n*12], dtype=np.float32).reshape(-1, 3).astype(float)
N = np.frombuffer(raw[m['normalsOffset']:m['normalsOffset']+n*12], dtype=np.float32).reshape(-1, 3).astype(float)
UV = np.frombuffer(raw[m['uvOffset']:m['uvOffset']+n*8], dtype=np.float32).reshape(-1, 2).astype(float)
tex = np.asarray(Image.open(folder + '/body_color.jpg').convert('RGB')).astype(float) / 255
h, w = tex.shape[:2]
px = np.clip((UV[:, 0] * (w - 1)).astype(int), 0, w - 1); py = np.clip(((1 - UV[:, 1]) * (h - 1)).astype(int), 0, h - 1)
VC = tex[py, px]
L = np.array([0.35, 0.55, 0.75]); L /= np.linalg.norm(L)
fig, axes = plt.subplots(1, 3, figsize=(15, 8), facecolor='#1b1c24')
groups = [(np.frombuffer(raw[m['indexOffset']+g['iStart']*4:m['indexOffset']+(g['iStart']+g['iCount'])*4], dtype=np.uint32).reshape(-1, 3) + g['vStart']) for g in m['groups']]
T = np.vstack(groups)
for ax, th in zip(axes, [0, 0.6, np.pi/2]):
    c, s = np.cos(th), np.sin(th)
    rot = lambda Q: np.stack([Q[:, 0]*c + Q[:, 2]*s, Q[:, 1], -Q[:, 0]*s + Q[:, 2]*c], 1)
    Pr, Nr = rot(P), rot(N)
    fn = Nr[T].mean(1); Tk = T[fn[:, 2] > 0]
    depth = Pr[Tk][:, :, 2].mean(1); o = np.argsort(depth); Tk = Tk[o]
    lam = np.clip(Nr[Tk].mean(1) @ L, 0, 1)
    col = np.clip(VC[Tk].mean(1) * (0.35 + 0.65 * lam)[:, None] * 1.1, 0, 1)
    ax.add_collection(PolyCollection(Pr[Tk][:, :, :2], facecolors=col, edgecolors='none'))
    ax.set_xlim(-0.45, 0.45); ax.set_ylim(-0.02, 1.85); ax.set_aspect('equal'); ax.axis('off')
plt.tight_layout(); plt.savefig(out, dpi=70, facecolor='#1b1c24'); print('ok')
