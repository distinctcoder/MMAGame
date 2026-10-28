// Side-on game camera that follows the fighters, drops lower for ground work, swings in for submissions and knockouts.
import type * as THREE from 'three';
import type { Fight } from '../fight/fight';
import { V } from '../rig/math';
import type { CagePanel } from '../rig/stage';

export class GameCamera {
  private pos = V(70, 128, 820);
  private look = V(0, 102, 0);

  constructor(private camera: THREE.PerspectiveCamera, private panels: CagePanel[]) {}

  update(fight: Fight, rdt: number) {
    const mid = (fight.red.shown!.P.x + fight.blue.shown!.P.x) / 2;
    const low = fight.mode === 'ground' || (fight.mode === 'grapple' && (fight.pairName === 'drive' || fight.pairName === 'side'));
    let tPos, tLook, fov;
    if (fight.koCam) {
      const k = fight.koCam;
      tPos = V(k.x - k.dir * 170, 150, 300); tLook = V(k.x - k.dir * 30, 45, 0); fov = 26;
    } else if (fight.camOverride) ({ pos: tPos, look: tLook, fov } = fight.camOverride);
    else if (low) { tPos = V(mid + 60, 110, 760); tLook = V(mid, 48, 0); fov = 17; }
    else { tPos = V(mid + 70, 128, 820); tLook = V(mid, 102, 0); fov = 17.5; }

    this.follow(tPos, tLook, fov, rdt);
    if (fight.shake > 0.2) {
      this.camera.position.add(V(Math.random() * 2 - 1, Math.random() * 2 - 1, 0).multiplyScalar(fight.shake));
      this.camera.lookAt(this.look);
      fight.shake *= 0.86;
    }
    // Hide cage panels between the camera and the fighters.
    const view = V(this.pos.x - this.look.x, 0, this.pos.z - this.look.z).normalize();
    for (const p of this.panels) p.g.visible = p.normal.dot(view) < 0.35;
  }

  /** Ease toward a camera position, look-at point and field of view. */
  follow(tPos: THREE.Vector3, tLook: THREE.Vector3, fov: number, rdt: number) {
    const k = 1 - Math.pow(0.004, rdt / 1000);
    this.pos.lerp(tPos, k); this.look.lerp(tLook, k);
    const cam = this.camera;
    cam.fov += (fov - cam.fov) * k;
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    cam.updateProjectionMatrix();
  }

  /** Jump straight to a view, e.g. when switching screens. */
  snap(pos: THREE.Vector3, look: THREE.Vector3, fov: number) {
    this.pos.copy(pos); this.look.copy(look); this.camera.fov = fov;
    this.follow(pos, look, fov, 0);
  }
}
