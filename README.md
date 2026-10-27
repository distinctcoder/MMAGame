# 2DMMAGame

A 2D MMA game for the browser: striking, grappling, a referee, ring or cage, training mode, story mode and an open park mode for gear and training.

## Art pipeline

Fighters are built from body-part sprites on a skeleton rather than frame-by-frame sprite sheets.

- `art/example-fighter/`: a working sample fighter (parts, rig, animations and a preview page). Run `npx serve art/example-fighter` and open the page.
- `art/example-fighter/grappling.html`: grappling prototype with a 3-phase takedown (level change, grab, finish), guard, side control and mount, ground and pound with blocks, sweeps and a submission mini-game. Run the same server and open `/grappling.html`.
- `art/toon-3d/`: toon-shaded 3D test (Three.js). Cel-shaded fighters that read as 2D from the side-on game camera, with cinematic angles for a rear-naked choke, armbar and triangle. Holds are authored as contact points and solved with two-bone IK (`poses.json`). Run `npx serve art/toon-3d`.
- `art/toon-3d/striking.html`: striking prototype in the same toon 3D style. Seven strikes (jab, cross, both hooks, low, body and head kicks), each matched to a block zone (high guard, left or right side, body, check). Block with Space plus a direction; late blocks parry into a counter. Range, stamina, and head, body and leg damage, with a CPU opponent per style. Strikes, poses and styles live in `strikes.json`.
- `art/toon-3d/toon-rig.js`: the shared rig (IK, cel shading, cage, fighter meshes) used by both toon 3D pages.
- `docs/SPRITE_SPEC.md`: what an artist needs to deliver for each fighter.
