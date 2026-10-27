# 2DMMAGame

A 2D MMA game for the browser: striking, grappling, a referee, ring or cage, training mode, story mode and an open park mode for gear and training.

## Art pipeline

Fighters are built from body-part sprites on a skeleton rather than frame-by-frame sprite sheets.

- `art/example-fighter/`: a working sample fighter (parts, rig, animations and a preview page). Run `npx serve art/example-fighter` and open the page.
- `art/example-fighter/grappling.html`: grappling prototype with a 3-phase takedown (level change, grab, finish), guard, side control and mount, ground and pound with blocks, sweeps and a submission mini-game. Run the same server and open `/grappling.html`.
- `docs/SPRITE_SPEC.md`: what an artist needs to deliver for each fighter.
