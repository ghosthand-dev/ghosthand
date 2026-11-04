# Fit rig pose (yaw, pitch, roll) per frame from tracked eyes.
import json, math, sys
import numpy as np
from scipy.optimize import least_squares

EYE_W, EYE_H = 0.25, 0.54
EYE = [(-0.30, -0.10), (0.30, -0.10)]
def local_eye(k):
    x, y = EYE[k]; return np.array([x, y, math.sqrt(1 - x*x - y*y)])
def rot(yaw, pitch, roll):
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    Ry = np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
    Rx = np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]])
    Rz = np.array([[cr,-sr,0],[sr,cr,0],[0,0,1]])
    return Rz @ Rx @ Ry
def tangent_up(k):
    # local "up" tangent at the eye (projection of -y onto tangent plane)
    n = local_eye(k); u = np.array([0,-1,0]) - n*np.dot(n,[0,-1,0]); return u/np.linalg.norm(u)

def fit_one(r, prev):
    eyes = [e for e in r['eyes'] if e[5] > 30]
    pts = [np.array(e[:2]) for e in eyes]
    Rp = rot(*prev)
    proj = [(Rp @ local_eye(k))[:2] for k in range(2)]
    if len(pts) == 2:
        d0 = np.linalg.norm(pts[0]-proj[0]) + np.linalg.norm(pts[1]-proj[1])
        d1 = np.linalg.norm(pts[0]-proj[1]) + np.linalg.norm(pts[1]-proj[0])
        assign = [(0, eyes[0]), (1, eyes[1])] if d0 <= d1 else [(1, eyes[0]), (0, eyes[1])]
    elif len(pts) == 1:
        k = 0 if np.linalg.norm(pts[0]-proj[0]) < np.linalg.norm(pts[0]-proj[1]) else 1
        assign = [(k, eyes[0])]
    else:
        return None, None
    def res(p):
        R = rot(*p); o = []
        for k, e in assign: o += list((R @ local_eye(k))[:2] - np.array(e[:2]))
        o += list(0.12 * (p - prev))
        return o
    best = None
    for g in [prev, prev+[0.35,0,0], prev-[0.35,0,0], prev+[0,0.35,0], prev-[0,0.35,0], prev+[0,0,0.4], prev-[0,0,0.4]]:
        s = least_squares(res, g)
        if best is None or s.cost < best.cost: best = s
    p = best.x
    R = rot(*p)
    hs = []
    for k, e in assign:
        up2 = (R @ tangent_up(k))[:2]
        pred_h = EYE_H * np.linalg.norm(up2)
        # measured extent along predicted up direction
        ang = math.radians(e[4]); axis = np.array([math.cos(ang), math.sin(ang)])
        upn = up2/ (np.linalg.norm(up2)+1e-9)
        c = abs(np.dot(axis, upn))
        meas = e[2]*c + e[3]*math.sqrt(max(0,1-c*c))  # rough extent along up
        hs.append(meas / max(pred_h, 1e-3))
    return p, min(1.0, float(np.mean(hs)))

rows = {r['i']: r for r in json.load(open(sys.argv[1]))}
a, b, anchor = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
init = np.array([float(v) for v in sys.argv[6].split(',')]) if len(sys.argv) > 6 else np.zeros(3)
res = {}
for order in (range(anchor, b), range(anchor-1, a-1, -1)):
    prev = init.copy() if order.start == anchor else res[anchor]['p_np']
    for i in order:
        if i not in rows: continue
        p, blink = fit_one(rows[i], prev)
        r = rows[i]
        o = dict(i=i, x=r['x'], y=r['y'], R=r['R'], L=r['L'], W=r['W'], ang=r['ang'])
        if p is not None:
            prev = p
            o.update(p=[round(float(v),4) for v in p], blink=round(blink,3))
        else:
            o.update(p=None, blink=0.05)
        o['p_np'] = prev.copy()
        res[i] = o
out = [res[i] for i in sorted(res)]
for o in out: o.pop('p_np')
for o in out[::3]: print(o['i'], o['p'], o['blink'])
json.dump(out, open(sys.argv[5], 'w'))
