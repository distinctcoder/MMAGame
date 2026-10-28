// The park as a toon-shaded street seen from the side: a gym, a gear shop and a fenced pickup court,
// with a skyline behind that also shows over the cage during pickup fights.
import * as THREE from 'three';
import type { Stage } from '../rig/stage';

export type PlaceId = 'gym' | 'shop' | 'court';
export interface Place { id: PlaceId; name: string; x: number; reach: number }

/** The street runs along x; you walk the line z = 0. */
export const BOUNDS: [number, number] = [-980, 1010];
export const PLACES: Place[] = [
  { id: 'gym', name: 'Iron Gym', x: -620, reach: 70 },
  { id: 'shop', name: 'Corner Fight Shop', x: -150, reach: 70 },
  { id: 'court', name: 'The Court', x: 360, reach: 70 }
];
/** Where the court's waiting fighters stand. */
export const COURT_SPOTS: { x: number; z: number }[] = [{ x: 520, z: -60 }, { x: 640, z: -90 }, { x: 760, z: -60 }, { x: 880, z: -90 }];

export interface ParkWorld { street: THREE.Group; skyline: THREE.Group }

const COLORS = {
  sky: ['--sky', '#bcd6ee'], pave: ['--pave', '#d8d4cc'], road: ['--road', '#55575e'], curb: ['--curb', '#b9b4aa'],
  court: ['--court', '#3d7a6a'], line: ['--court-line', '#f2f2f2'], brick: ['--brick', '#a4553f'], brick2: ['--brick2', '#7d6a5a'],
  shop: ['--shopfront', '#3b4a63'], glass: ['--glass', '#9fc4e0'], door: ['--door', '#2a2d34'], skyline: ['--skyline', '#a9bdd2'],
  leaf: ['--leaf', '#4f8a4a'], trunk: ['--trunk', '#6a4a33'], metal: ['--metal', '#3a3f4a'], lamp: ['--lamp', '#fff1b8'],
  apart: ['--apart', '#c9b79c']
} as const;
type ColorKey = keyof typeof COLORS;

/** A sign: text drawn on a canvas, shown on a flat board. */
function signTexture(text: string, sub: string, bg: string, fg: string) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = c.getContext('2d')!;
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${sub ? 66 : 80}px "Big Shoulders Display", Impact, sans-serif`;
    g.fillText(text.toUpperCase(), 256, sub ? 52 : 66, 480);
    if (sub) { g.font = '500 22px "IBM Plex Mono", monospace'; g.fillText(sub.toUpperCase(), 256, 104, 480); }
    tex.needsUpdate = true;
  };
  draw();
  // Redraw once the display font arrives.
  document.fonts?.load('800 66px "Big Shoulders Display"').then(draw).catch(() => {});
  return tex;
}

export function buildPark(stage: Stage): ParkWorld {
  const mats = {} as Record<ColorKey, THREE.MeshToonMaterial>;
  for (const k of Object.keys(COLORS) as ColorKey[]) mats[k] = stage.toon(COLORS[k][1]);
  const lampGlow = new THREE.MeshBasicMaterial({ color: COLORS.lamp[1] });
  const fenceMat = new THREE.LineBasicMaterial({ color: '#6b7385', transparent: true, opacity: 0.55 });
  stage.onColors(() => {
    const css = getComputedStyle(document.documentElement);
    for (const k of Object.keys(COLORS) as ColorKey[]) mats[k].color.set(css.getPropertyValue(COLORS[k][0]).trim() || COLORS[k][1]);
    lampGlow.color.set(css.getPropertyValue('--lamp').trim() || COLORS.lamp[1]);
    fenceMat.color.set(css.getPropertyValue('--fence').trim() || '#6b7385');
  });

  const street = new THREE.Group(), skyline = new THREE.Group();
  stage.scene.add(street, skyline);

  const OUT = 1.6;
  const box = (parent: THREE.Group, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, outline = true) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    if (outline) {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w + OUT * 2, h + OUT * 2, d + OUT * 2), stage.ink);
      o.position.copy(m.position);
      parent.add(o);
    }
    return m;
  };
  const plane = (parent: THREE.Group, w: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const sign = (text: string, sub: string, bg: string, fg: string, w: number, x: number, y: number, z: number) => {
    const h = w / 4;
    box(street, w + 8, h + 8, 4, mats.metal, x, y, z - 2.5);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTexture(text, sub, bg, fg) }));
    m.position.set(x, y, z + 0.2);
    street.add(m);
  };
  const windows = (x0: number, x1: number, y0: number, y1: number, z: number, cols: number, rows: number) => {
    const w = (x1 - x0) / cols, h = (y1 - y0) / rows;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      box(street, w * 0.62, h * 0.6, 3, mats.glass, x0 + w * (c + 0.5), y0 + h * (r + 0.5), z, false);
    }
  };

  // Ground: sidewalk, curb, road with a center line.
  plane(street, BOUNDS[1] - BOUNDS[0] + 1400, 260, mats.pave, (BOUNDS[0] + BOUNDS[1]) / 2, 0, -10);
  box(street, BOUNDS[1] - BOUNDS[0] + 1400, 8, 12, mats.curb, (BOUNDS[0] + BOUNDS[1]) / 2, 2, 124, false);
  plane(street, BOUNDS[1] - BOUNDS[0] + 1400, 700, mats.road, (BOUNDS[0] + BOUNDS[1]) / 2, -0.5, 480);
  for (let x = BOUNDS[0] - 600; x < BOUNDS[1] + 600; x += 160) plane(street, 70, 6, mats.line, x, 0.2, 330);

  // Iron Gym: brick, big windows, a red sign.
  const gx = PLACES[0].x;
  box(street, 400, 300, 160, mats.brick, gx, 150, -220);
  windows(gx - 190, gx - 50, 30, 200, -138, 2, 2);
  windows(gx + 50, gx + 190, 30, 200, -138, 2, 2);
  box(street, 76, 126, 6, mats.door, gx, 63, -138);
  sign('Iron Gym', 'Boxing · Muay Thai · MMA', '#c8232c', '#ffffff', 240, gx, 252, -136);

  // Corner Fight Shop: a dark shopfront with an awning.
  const sx = PLACES[1].x;
  box(street, 300, 250, 150, mats.shop, sx, 125, -215);
  box(street, 220, 110, 4, mats.glass, sx - 30, 95, -138, false);
  box(street, 62, 120, 6, mats.door, sx + 112, 60, -138);
  const awning = box(street, 300, 8, 60, mats.brick, sx, 170, -112);
  awning.rotation.x = 0.35;
  sign('Fight Shop', 'Gloves · Shorts · Wraps', '#f0c419', '#16181d', 200, sx, 214, -138);

  // Filler buildings so the street reads as a block.
  box(street, 260, 440, 170, mats.apart, -1000, 220, -240); windows(-1110, -890, 40, 420, -153, 3, 5);
  box(street, 160, 360, 160, mats.brick2, -340, 180, -240); windows(-400, -280, 120, 340, -158, 2, 3);
  box(street, 160, 470, 170, mats.apart, 120, 235, -250); windows(60, 180, 60, 450, -163, 2, 5);
  box(street, 300, 520, 170, mats.brick2, 1150, 260, -250); windows(1020, 1280, 60, 500, -163, 3, 5);

  // The Court: an outdoor fenced pad with a painted circle.
  const c0 = 260, c1 = 980, cz0 = -190, cz1 = 60;
  plane(street, c1 - c0, cz1 - cz0, mats.court, (c0 + c1) / 2, 0.4, (cz0 + cz1) / 2);
  const ring = new THREE.Mesh(new THREE.RingGeometry(150, 156, 48), mats.line);
  ring.rotation.x = -Math.PI / 2; ring.position.set(700, 0.6, -60); ring.scale.set(1.3, 0.55, 1);
  street.add(ring);
  const pts: number[] = [];
  const H = 230;
  for (let x = c0; x <= c1; x += 14) { pts.push(x, 0, cz0, Math.min(c1, x + H), H, cz0); pts.push(x, 0, cz0, Math.max(c0, x - H), H, cz0); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  street.add(new THREE.LineSegments(geo, fenceMat));
  for (let x = c0; x <= c1; x += 120) box(street, 6, H, 6, mats.metal, x, H / 2, cz0);
  box(street, c1 - c0, 6, 6, mats.metal, (c0 + c1) / 2, H, cz0);
  sign('The Court', 'Pickup fights · All styles', '#16181d', '#f0c419', 210, PLACES[2].x, 170, cz0 + 6);
  // Benches along the fence.
  for (const x of [470, 830]) { box(street, 110, 8, 30, mats.trunk, x, 34, -160); box(street, 8, 34, 26, mats.metal, x - 46, 17, -160); box(street, 8, 34, 26, mats.metal, x + 46, 17, -160); }

  // Street lamps on the curb, thin enough not to hide anyone.
  for (const x of [-860, -380, 60, 560, 940]) {
    box(street, 6, 260, 6, mats.metal, x, 130, 104);
    box(street, 46, 6, 8, mats.metal, x - 18, 258, 104);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), lampGlow);
    glow.position.set(x - 38, 250, 104); street.add(glow);
  }
  // Trees stand back by the buildings so they never hide your fighter.
  for (const x of [-800, -400, 210, 1060]) {
    box(street, 12, 150, 12, mats.trunk, x, 75, -95);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(52, 14, 10), mats.leaf);
    crown.position.set(x, 196, -95); crown.scale.set(1, 0.85, 1); street.add(crown);
    const ink = new THREE.Mesh(new THREE.SphereGeometry(54, 14, 10), stage.ink);
    ink.position.copy(crown.position); ink.scale.copy(crown.scale); street.add(ink);
  }

  // Skyline: flat, hazy blocks far behind; fog fades them.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let x = -2600; x < 2600; x += 110 + rnd() * 90) {
    const w = 90 + rnd() * 140, h = 260 + rnd() * 700;
    box(skyline, w, h, 60, mats.skyline, x, h / 2, -1200 - rnd() * 300, false);
  }
  street.visible = skyline.visible = false;
  return { street, skyline };
}
