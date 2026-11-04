# Per-frame character track: body (dark or white), eyes, for frame ranges.
import sys, glob, json, math
from PIL import Image
import numpy as np
from scipy import ndimage
files = sorted(glob.glob('f30/*.jpg'))

def pca(xs, ys):
    cx, cy = xs.mean(), ys.mean()
    if len(xs) < 3: return cx, cy, 0, 0, 0
    cov = np.cov(np.vstack([xs-cx, ys-cy]))
    ev, evec = np.linalg.eigh(cov)
    L = 4*math.sqrt(max(ev[1],0)); W = 4*math.sqrt(max(ev[0],0))
    ang = math.degrees(math.atan2(evec[1,1], evec[0,1]))
    return cx, cy, L, W, ang

def track(i, mode, prev, roi):
    im = np.asarray(Image.open(files[i]).convert('RGB')).astype(int)
    r,g,b = im[...,0], im[...,1], im[...,2]
    if mode == 'dark':
        body = (r<70)&(g<70)&(b<70)
        eye = lambda: (r>170)&(g>170)&(b>160)
    else:
        body = (r>215)&(g>215)&(b>215)
        eye = lambda: (r<80)&(g<80)&(b<80)
    if roi:
        x0,y0,x1,y1 = roi
        mask = np.zeros_like(body); mask[y0:y1, x0:x1] = True
        body &= mask
    lab, n = ndimage.label(body)
    if n == 0: return None
    best = None
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        sz = (lab[sl]==k).sum()
        if sz < 150: continue
        h, w = sl[0].stop-sl[0].start, sl[1].stop-sl[1].start
        if sl[0].stop >= im.shape[0]-1 and sz > 40000: continue  # phone etc
        fill = sz/(h*w)
        if fill < 0.55: continue  # text glyph clusters are sparse
        if best is None or sz > best[1]: best = (k, sz)
    if not best: return None
    m = ndimage.binary_fill_holes(lab == best[0])
    ys, xs = np.nonzero(m)
    cx, cy, L, W, ang = pca(xs, ys)
    R = math.sqrt(len(xs)/math.pi)
    # circle fit on boundary pixels that touch the background (not headset green)
    edge = m & ~ndimage.binary_erosion(m)
    bg = ~ndimage.binary_dilation(body | ((g>90)&(g-r>40)), iterations=3)
    near_bg = ndimage.binary_dilation(bg, iterations=4)
    ey_, ex_ = np.nonzero(edge & near_bg)
    if len(ex_) > 30:
        A = np.c_[2*ex_, 2*ey_, np.ones(len(ex_))]
        sol, *_ = np.linalg.lstsq(A, ex_**2 + ey_**2, rcond=None)
        fcx, fcy = sol[0], sol[1]; fR = math.sqrt(sol[2] + fcx**2 + fcy**2)
    else:
        fcx, fcy, fR = cx, cy, R
    if L/W < 1.2 and abs(fR-R)/R > 0.015:
        cx, cy, R, L, W, ang = fcx, fcy, fR, 2*fR, 2*fR, 0
    inner = ndimage.binary_erosion(m, iterations=2) & eye()
    lab2, n2 = ndimage.label(inner)
    eyes = []
    for j in range(1, n2+1):
        mm = lab2 == j
        if mm.sum() < 5: continue
        ey, ex = np.nonzero(mm)
        ecx, ecy, eL, eW, ea = pca(ex, ey)
        d = math.hypot(ecx-cx, ecy-cy)/R
        # skip headset gap ring: thin arcs (L much larger than W*4) or far out
        if eL/R > 0.9: continue
        eyes.append([round((ecx-cx)/R,3), round((ecy-cy)/R,3), round(eL/R,3), round(eW/R,3), round(ea % 180,1), int(mm.sum())])
    eyes.sort(key=lambda e: -e[5]); eyes = eyes[:2]
    return dict(i=i, fx=round(fcx,1), fy=round(fcy,1), fR=round(fR,2), x=round(cx,1), y=round(cy,1), R=round(R,2), L=round(L/2,1), W=round(W/2,1), ang=round(ang%180,1), eyes=eyes)

a, b, mode = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
roi = tuple(map(int, sys.argv[5].split(','))) if len(sys.argv) > 5 else None
out = []
prev = None
for i in range(a, b):
    t = track(i, mode, prev, roi)
    if t: out.append(t); prev = t
    print(json.dumps(t))
json.dump(out, open(sys.argv[4], 'w'))
