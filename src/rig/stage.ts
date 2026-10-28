// Cel-shaded scene: renderer, lights, octagon cage and fighter meshes built from simple shapes with ink outlines.
import * as THREE from 'three';
import { V, add, clamp, joints, qEuler, type Joints, type RigState, type Vector3 } from './math';

const OUT = 1.1; // ink outline thickness

export interface Palette {
  skin: string; shorts: string; trim: string; glove: string; cuff: string; hair: string;
  shirt?: string; pants?: string; shoe?: string;
}
export const PALETTES: Record<'red' | 'blue' | 'ref', Palette> = {
  ref:  { skin: '#e6b48f', shorts: '#2a2d34', trim: '#2a2d34', glove: '#e6b48f', cuff: '#e6b48f', hair: '#9aa0a8', shirt: '#1d1f24', pants: '#2a2d34', shoe: '#111216' },
  red:  { skin: '#e0a57c', shorts: '#c8232c', trim: '#f2f2f2', glove: '#23252b', cuff: '#c8232c', hair: '#241a14' },
  blue: { skin: '#8d5b3d', shorts: '#2457b5', trim: '#f2f2f2', glove: '#23252b', cuff: '#2457b5', hair: '#0e0a08' }
};

export interface FighterMesh {
  update(st: RigState): void;
  /** Recolor the outfit (gear) without rebuilding the mesh. Shirt, pants and shoes are fixed at creation. */
  setPalette(pal: Palette): void;
  root: THREE.Group;
}
export type Venue = 'arena' | 'park' | 'court';
export interface CagePanel { g: THREE.Group; normal: Vector3 }
export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  panels: CagePanel[];
  outlines: THREE.Mesh[];
  /** The cage. The park world adds its own groups. */
  arena: THREE.Group;
  readColors(): void;
  /** Run after the theme colors are read (light or dark), e.g. to recolor the park. */
  onColors(fn: () => void): void;
  makeFighter(pal: Palette): FighterMesh;
  toon(color: string): THREE.MeshToonMaterial;
  ink: THREE.MeshBasicMaterial;
  setVenue(v: Venue): void;
  venue: Venue;
}

/** Build the renderer, lights, cage and materials on a canvas. Throws if WebGL is unavailable. */
export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(17.5, 16 / 9, 10, 5000);
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(160, 320, 240);
  scene.add(sun);

  const grad = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: grad });
  const inkMat = new THREE.MeshBasicMaterial({ color: '#1a120d', side: THREE.BackSide });
  const outlines: THREE.Mesh[] = [];

  const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const sceneMats = {
    mat: toon('#e4e7ec'), ring: new THREE.MeshBasicMaterial({ color: '#c8232c' }), post: toon('#2c313b'), pad: toon('#2c313b'),
    fence: new THREE.LineBasicMaterial({ color: '#6b7385', transparent: true, opacity: 0.45 })
  };
  const colorFns: (() => void)[] = [];
  let venue: Venue = 'arena';
  const arena = new THREE.Group();
  scene.add(arena);
  const fog = new THREE.Fog('#ffffff', 1700, 3600);
  function readColors() {
    const bg = venue === 'arena' ? cssVar('--wall') || '#d9dee6' : cssVar('--sky') || '#bcd6ee';
    scene.background = new THREE.Color(bg);
    fog.color.set(bg);
    scene.fog = venue === 'arena' ? null : fog;
    sceneMats.mat.color.set(cssVar('--mat') || '#e4e7ec');
    sceneMats.ring.color.set(cssVar('--mat-line') || '#c8232c');
    sceneMats.post.color.set(cssVar('--post') || '#2c313b');
    sceneMats.pad.color.set(cssVar('--post') || '#2c313b');
    sceneMats.fence.color.set(cssVar('--fence') || '#6b7385');
    for (const fn of colorFns) fn();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Octagon: mat, logo ring, posts, padding and chain-link panels. Panels between the camera and the fighters hide.
  const R = 330, panels: CagePanel[] = [];
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 8, Math.PI / 8), sceneMats.mat);
  floor.rotation.x = -Math.PI / 2;
  arena.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(92, 97, 64), sceneMats.ring);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
  arena.add(ring);
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
    const pts: number[] = [];
    for (let s = -160; s < len + 160; s += 14) {
      for (const dirn of [1, -1]) {
        const u0 = s, u1 = s + dirn * 140, v0 = 16, v1 = 156;
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
    arena.add(g);
    panels.push({ g, normal: V(mid.x, 0, mid.z).normalize() });
  }

  const unitSphere = new THREE.SphereGeometry(1, 22, 16);
  const capSphere = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const Y = V(0, 1, 0);
  type J = Required<Joints>;
  type Piece = (j: J, st: RigState) => void;

  function makeFighter(pal: Palette): FighterMesh {
    const skin = toon(pal.skin);
    const m = {
      skin, shorts: toon(pal.shorts), trim: toon(pal.trim), glove: toon(pal.glove), cuff: toon(pal.cuff), hair: toon(pal.hair),
      eye: new THREE.MeshBasicMaterial({ color: '#16100c' }),
      // Optional outfit (the referee): a shirt over the torso and upper arms, long pants and shoes.
      shirt: pal.shirt ? toon(pal.shirt) : skin, pants: pal.pants ? toon(pal.pants) : skin, shoe: pal.shoe ? toon(pal.shoe) : skin
    };
    const pieces: Piece[] = [];
    const root = new THREE.Group();
    scene.add(root);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, outlineGeo: THREE.BufferGeometry | null): [THREE.Mesh, THREE.Mesh | null] => {
      const a = new THREE.Mesh(geo, mat); root.add(a);
      let o: THREE.Mesh | null = null;
      if (outlineGeo) { o = new THREE.Mesh(outlineGeo, inkMat); root.add(o); outlines.push(o); }
      return [a, o];
    };
    const seg = (a: keyof J, b: keyof J, r1: number, r2: number, mat: THREE.Material, frac = 1) => {
      const [x, o] = mesh(new THREE.CylinderGeometry(r2, r1, 1, 16, 1, true), mat, new THREE.CylinderGeometry(r2 + OUT, r1 + OUT, 1, 16, 1, true));
      pieces.push(j => {
        const p0 = j[a], p1 = j[a].clone().lerp(j[b], frac), dir = p1.clone().sub(p0), len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize());
        for (const n of [x, o]) if (n) { n.position.copy(p0).lerp(p1, 0.5); n.quaternion.copy(q); n.scale.set(1, len, 1); }
      });
    };
    const ball = (at: keyof J, r: number, mat: THREE.Material) => {
      const [x, o] = mesh(unitSphere, mat, unitSphere);
      x.scale.setScalar(r); o!.scale.setScalar(r + OUT);
      pieces.push(j => { x.position.copy(j[at]); o!.position.copy(j[at]); });
    };
    // An ellipsoid placed by a function of the joints and frames.
    const ell = (s: [number, number, number], mat: THREE.Material, place: (j: J, st: RigState) => [Vector3, THREE.Quaternion], geo: THREE.BufferGeometry = unitSphere, outline = true) => {
      const [x, o] = mesh(geo, mat, outline ? geo : null);
      x.scale.set(...s);
      if (o) o.scale.set(s[0] + OUT, s[1] + OUT, s[2] + OUT);
      pieces.push((j, st) => { const [c, q] = place(j, st); for (const n of [x, o]) if (n) { n.position.copy(c); n.quaternion.copy(q); } });
    };

    // Torso
    ell([15.5, 11.5, 11.5], m.shorts, (j, st) => [add(j.pelvis, st.Qp, [0, 1, 0]), st.Qp]);
    ell([15.9, 2.4, 11.9], m.trim, (j, st) => [add(j.pelvis, st.Qp, [0, 9.5, 0]), st.Qp], unitSphere, false);
    ell([13.6, 13, 10.2], m.shirt, (j, st) => { const q = st.Qp.clone().slerp(st.Qc, 0.5); return [add(j.abd, q, [0, -2, 0]), q]; });
    ell([18.5, 16, 11.5], m.shirt, (j, st) => [add(j.abd, st.Qc, [0, 17, 0.5]), st.Qc]);
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
    for (const s of ['l', 'r'] as const) {
      const sh = `${s}sh` as const, el = `${s}el` as const, wr = `${s}wr` as const;
      ball(sh, 6.6, m.shirt);
      seg(sh, el, 6, 5, m.skin);
      if (pal.shirt) seg(sh, el, 7, 6.4, m.shirt, 0.5);
      ball(el, 5, m.skin);
      seg(el, wr, 5, 4.2, m.skin);
      const gloveAt = (j: J): [Vector3, THREE.Quaternion] => {
        const d = j[wr].clone().sub(j[el]).normalize();
        return [j[wr].clone().add(d.clone().multiplyScalar(5.5)), new THREE.Quaternion().setFromUnitVectors(Y, d)];
      };
      ell([5.8, 7, 5.8], m.glove, gloveAt);
      ell([4.8, 2.2, 4.8], m.cuff, j => { const [c, q] = gloveAt(j); return [c.clone().add(V(0, -5.2, 0).applyQuaternion(q)), q]; }, unitSphere, false);
    }
    // Legs
    for (const s of ['l', 'r'] as const) {
      const hip = `${s}hip` as const, kn = `${s}kn` as const, an = `${s}an` as const;
      seg(hip, kn, 8.8, 6.6, m.pants);
      if (!pal.pants) seg(hip, kn, 10.4, 9.6, m.shorts, 0.45);
      ball(kn, 6.6, m.pants);
      seg(kn, an, 6.4, 4.4, m.pants);
      ball(an, 4.5, m.pants);
      ell([4.6, 3.4, 11], m.shoe, (j, st) => {
        const up = j[kn].clone().sub(j[an]).normalize();
        const fd = st.fd.clone().sub(up.clone().multiplyScalar(st.fd.dot(up)));
        if (fd.lengthSq() < 1e-4) fd.set(1, 0, 0);
        fd.normalize();
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(fd, V(), up));
        return [j[an].clone().add(fd.multiplyScalar(6.5)).add(up.multiplyScalar(-1.5)), q];
      });
    }
    return {
      root,
      update(st) { const j = joints(st); for (const p of pieces) p(j, st); },
      setPalette(p) { for (const k of ['skin', 'shorts', 'trim', 'glove', 'cuff', 'hair'] as const) m[k].color.set(p[k]); }
    };
  }

  return {
    renderer, scene, camera, panels, outlines, arena, readColors, makeFighter, toon, ink: inkMat,
    onColors(fn) { colorFns.push(fn); fn(); },
    get venue() { return venue; },
    setVenue(v) { venue = v; arena.visible = v !== 'park'; readColors(); }
  };
}
