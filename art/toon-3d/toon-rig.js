// Shared toon rig: joint math, two-bone IK, cel-shaded scene (octagon cage) and fighter meshes.
// Pages import this and supply their own poses, camera and game logic.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export const D = Math.PI / 180;
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = u => u * u * (3 - 2 * u);
export const DIM = { hipX: 10, hipY: -3, abd: 20, chest: 30, shX: 18, shY: -5, neck: 17, throat: 7, ua: 30, fa: 27, th: 44, sh: 44 };
export const OUT = 1.1;

export const PALETTES = {
  red:  { skin: '#e0a57c', shorts: '#c8232c', trim: '#f2f2f2', glove: '#23252b', cuff: '#c8232c', hair: '#241a14' },
  blue: { skin: '#8d5b3d', shorts: '#2457b5', trim: '#f2f2f2', glove: '#23252b', cuff: '#2457b5', hair: '#0e0a08' }
};

// ---------- Rig math ----------
export const qEuler = a => new THREE.Quaternion().setFromEuler(new THREE.Euler((a?.[0] || 0) * D, (a?.[1] || 0) * D, (a?.[2] || 0) * D, 'YXZ'));
export const rot = (q, arr) => V(...arr).applyQuaternion(q);
export const add = (p, q, arr) => p.clone().add(rot(q, arr));
export const LIMBS = [
  { k: 'lh', root: 'lsh', mid: 'lel', end: 'lwr', l1: DIM.ua, l2: DIM.fa, arm: true, side: 1 },
  { k: 'rh', root: 'rsh', mid: 'rel', end: 'rwr', l1: DIM.ua, l2: DIM.fa, arm: true, side: -1 },
  { k: 'lf', root: 'lhip', mid: 'lkn', end: 'lan', l1: DIM.th, l2: DIM.sh, arm: false, side: 1 },
  { k: 'rf', root: 'rhip', mid: 'rkn', end: 'ran', l1: DIM.th, l2: DIM.sh, arm: false, side: -1 }
];

export function bodyJoints(st) {
  const j = { pelvis: st.P.clone() };
  j.abd = add(st.P, st.Qp, [0, DIM.abd, 0]);
  j.chest = add(j.abd, st.Qc, [0, DIM.chest, 0]);
  j.head = add(j.chest, st.Qh, [0, DIM.neck, 0]);
  j.neck = add(j.chest, st.Qc, [0, DIM.throat, 0]);
  j.lsh = add(j.chest, st.Qc, [DIM.shX, DIM.shY, 0]);
  j.rsh = add(j.chest, st.Qc, [-DIM.shX, DIM.shY, 0]);
  j.lhip = add(st.P, st.Qp, [DIM.hipX, DIM.hipY, 0]);
  j.rhip = add(st.P, st.Qp, [-DIM.hipX, DIM.hipY, 0]);
  return j;
}
// Two-bone IK: place the elbow or knee so the hand or foot reaches the target, bending toward the pole.
export function ik(root, target, l1, l2, pole) {
  const span = target.clone().sub(root);
  const dir = span.lengthSq() > 1e-6 ? span.clone().normalize() : V(0, -1, 0);
  const d = clamp(span.length(), Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.3);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (p.lengthSq() < 1e-6) p.set(0, 1, 0).sub(dir.clone().multiplyScalar(dir.y));
  p.normalize();
  return [root.clone().add(dir.clone().multiplyScalar(a)).add(p.multiplyScalar(h)), root.clone().add(dir.multiplyScalar(d))];
}
export function solveLimbs(st, j) {
  for (const L of LIMBS) [j[L.mid], j[L.end]] = ik(j[L.root], st.t[L.k], L.l1, L.l2, st.p[L.k]);
}
export function joints(st) { const j = bodyJoints(st); solveLimbs(st, j); return j; }

export function blendState(a, b, u) {
  const out = { P: a.P.clone().lerp(b.P, u), Qp: a.Qp.clone().slerp(b.Qp, u), Qc: a.Qc.clone().slerp(b.Qc, u),
    Qh: a.Qh.clone().slerp(b.Qh, u), Qy: a.Qy.clone().slerp(b.Qy, u), fd: a.fd.clone().lerp(b.fd, u).normalize(), t: {}, p: {} };
  for (const L of LIMBS) {
    out.t[L.k] = a.t[L.k].clone().lerp(b.t[L.k], u);
    out.p[L.k] = a.p[L.k].clone().lerp(b.p[L.k], u).normalize();
  }
  return out;
}

// Build the renderer, lights, cage and materials on a canvas. Throws if WebGL is unavailable.
export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(16, 16 / 9, 10, 5000);
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(160, 320, 240);
  scene.add(sun);

  const grad = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  const toon = color => new THREE.MeshToonMaterial({ color, gradientMap: grad });
  const inkMat = new THREE.MeshBasicMaterial({ color: '#1a120d', side: THREE.BackSide });
  const outlines = [];

  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const sceneMats = { mat: toon('#e4e7ec'), ring: new THREE.MeshBasicMaterial({ color: '#c8232c' }), post: toon('#2c313b'),
    pad: toon('#2c313b'), fence: new THREE.LineBasicMaterial({ color: '#6b7385', transparent: true, opacity: 0.45 }) };
  function readColors() {
    scene.background = new THREE.Color(cssVar('--wall'));
    sceneMats.mat.color.set(cssVar('--mat'));
    sceneMats.ring.color.set(cssVar('--mat-line'));
    sceneMats.post.color.set(cssVar('--post'));
    sceneMats.pad.color.set(cssVar('--post'));
    sceneMats.fence.color.set(cssVar('--fence'));
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Octagon: mat, logo ring, posts, padding and chain-link panels. Panels between the camera and the fighters hide.
  const R = 330, panels = [];
  {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 8, Math.PI / 8), sceneMats.mat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(92, 97, 64), sceneMats.ring);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
    scene.add(ring);
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI / 8 + i * Math.PI / 4, a1 = a0 + Math.PI / 4;
      const p0 = V(Math.cos(a0) * R, 0, Math.sin(a0) * R), p1 = V(Math.cos(a1) * R, 0, Math.sin(a1) * R);
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 160, 10), sceneMats.post);
      post.position.set(p0.x, 80, p0.z);
      g.add(post);
      const len = p0.distanceTo(p1), mid = p0.clone().lerp(p1, 0.5), ang = Math.atan2(p1.z - p0.z, p1.x - p0.x);
      for (const [y, h] of [[8, 16], [158, 5]]) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(len, h, 5), sceneMats.pad);
        pad.position.set(mid.x, y, mid.z); pad.rotation.y = -ang;
        g.add(pad);
      }
      const pts = [];
      for (let s = -160; s < len + 160; s += 14) {
        for (const dirn of [1, -1]) {
          let u0 = s, u1 = s + dirn * 140;
          const v0 = 16, v1 = 156;
          const t0 = clamp((0 - u0) / (u1 - u0), 0, 1), t1 = clamp((len - u0) / (u1 - u0), 0, 1);
          const ta = Math.min(t0, t1), tb = Math.max(t0, t1);
          if (tb - ta < 0.01) continue;
          for (const t of [ta, tb]) {
            const u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
            const p = p0.clone().lerp(p1, u / len);
            pts.push(p.x, v, p.z);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(geo, sceneMats.fence));
      scene.add(g);
      panels.push({ g, normal: V(mid.x, 0, mid.z).normalize() });
    }
  }

  const unitSphere = new THREE.SphereGeometry(1, 22, 16);
  const capSphere = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const Y = V(0, 1, 0);
  function makeFighter(pal) {
    const m = { skin: toon(pal.skin), shorts: toon(pal.shorts), trim: toon(pal.trim), glove: toon(pal.glove), cuff: toon(pal.cuff), hair: toon(pal.hair), eye: new THREE.MeshBasicMaterial({ color: '#16100c' }) };
    const pieces = [];
    const mesh = (geo, mat, outlineGeo) => {
      const a = new THREE.Mesh(geo, mat); scene.add(a);
      let o = null;
      if (outlineGeo) { o = new THREE.Mesh(outlineGeo, inkMat); scene.add(o); outlines.push(o); }
      return [a, o];
    };
    const seg = (a, b, r1, r2, mat, frac = 1) => {
      const [x, o] = mesh(new THREE.CylinderGeometry(r2, r1, 1, 16, 1, true), mat, new THREE.CylinderGeometry(r2 + OUT, r1 + OUT, 1, 16, 1, true));
      pieces.push(j => {
        const p0 = j[a], p1 = j[a].clone().lerp(j[b], frac), dir = p1.clone().sub(p0), len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize());
        for (const n of [x, o]) if (n) { n.position.copy(p0).lerp(p1, 0.5); n.quaternion.copy(q); n.scale.set(1, len, 1); }
      });
    };
    const ball = (at, r, mat) => {
      const [x, o] = mesh(unitSphere, mat, unitSphere);
      x.scale.setScalar(r); o.scale.setScalar(r + OUT);
      pieces.push(j => { x.position.copy(j[at]); o.position.copy(j[at]); });
    };
    // An ellipsoid placed by a function of the joints and frames: place(j, st) -> [center, quaternion].
    const ell = (s, mat, place, geo = unitSphere, outline = true) => {
      const [x, o] = mesh(geo, mat, outline ? geo : null);
      x.scale.set(...s);
      if (o) o.scale.set(s[0] + OUT, s[1] + OUT, s[2] + OUT);
      pieces.push((j, st) => { const [c, q] = place(j, st); for (const n of [x, o]) if (n) { n.position.copy(c); n.quaternion.copy(q); } });
    };

    // Torso
    ell([15.5, 11.5, 11.5], m.shorts, (j, st) => [add(j.pelvis, st.Qp, [0, 1, 0]), st.Qp]);
    ell([15.9, 2.4, 11.9], m.trim, (j, st) => [add(j.pelvis, st.Qp, [0, 9.5, 0]), st.Qp], unitSphere, false);
    ell([13.6, 13, 10.2], m.skin, (j, st) => { const q = st.Qp.clone().slerp(st.Qc, 0.5); return [add(j.abd, q, [0, -2, 0]), q]; });
    ell([18.5, 16, 11.5], m.skin, (j, st) => [add(j.abd, st.Qc, [0, 17, 0.5]), st.Qc]);
    seg('chest', 'head', 5.6, 5.2, m.skin, 0.75);
    // Head
    ell([10, 11.5, 10.5], m.skin, (j, st) => [j.head, st.Qh]);
    ell([10.8, 12, 11.3], m.hair, (j, st) => [add(j.head, st.Qh, [0, 1.2, -1.4]), st.Qh.clone().multiply(qEuler([-18, 0, 0]))], capSphere, false);
    for (const sx of [1, -1]) {
      ell([1.3, 1.5, 0.8], m.eye, (j, st) => [add(j.head, st.Qh, [3.9 * sx, 1.6, 9.6]), st.Qh], unitSphere, false);
      ell([2.2, 3, 1.6], m.skin, (j, st) => [add(j.head, st.Qh, [10 * sx, 0, -0.5]), st.Qh], unitSphere, false);
    }
    ell([2.1, 2.6, 2.2], m.skin, (j, st) => [add(j.head, st.Qh, [0, -1.8, 10.3]), st.Qh], unitSphere, false);
    // Arms
    for (const s of ['l', 'r']) {
      ball(s + 'sh', 6.6, m.skin);
      seg(s + 'sh', s + 'el', 6, 5, m.skin);
      ball(s + 'el', 5, m.skin);
      seg(s + 'el', s + 'wr', 5, 4.2, m.skin);
      const gloveAt = j => { const d = j[s + 'wr'].clone().sub(j[s + 'el']).normalize(); return [j[s + 'wr'].clone().add(d.clone().multiplyScalar(5.5)), new THREE.Quaternion().setFromUnitVectors(Y, d)]; };
      ell([5.8, 7, 5.8], m.glove, gloveAt);
      ell([4.8, 2.2, 4.8], m.cuff, j => { const [c, q] = gloveAt(j); return [c.clone().add(V(0, -5.2, 0).applyQuaternion(q)), q]; }, unitSphere, false);
    }
    // Legs
    for (const s of ['l', 'r']) {
      seg(s + 'hip', s + 'kn', 8.8, 6.6, m.skin);
      seg(s + 'hip', s + 'kn', 10.4, 9.6, m.shorts, 0.45);
      ball(s + 'kn', 6.6, m.skin);
      seg(s + 'kn', s + 'an', 6.4, 4.4, m.skin);
      ball(s + 'an', 4.5, m.skin);
      ell([4.6, 3.4, 11], m.skin, (j, st) => {
        const up = j[s + 'kn'].clone().sub(j[s + 'an']).normalize();
        const fd = st.fd.clone().sub(up.clone().multiplyScalar(st.fd.dot(up)));
        if (fd.lengthSq() < 1e-4) fd.set(1, 0, 0);
        fd.normalize();
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(fd, V(), up));
        return [j[s + 'an'].clone().add(fd.multiplyScalar(6.5)).add(up.multiplyScalar(-1.5)), q];
      });
    }
    return { update(st) { const j = joints(st); for (const p of pieces) p(j, st); } };
  }

  return { renderer, scene, camera, panels, outlines, readColors, makeFighter };
}
