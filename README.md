# 2DMMAGame

A browser MMA game with toon-shaded 3D fighters that read as 2D art, with a fight mode, a training mode and a park hub: striking with zone blocks and head movement, the clinch, three-phase takedowns, a ground game with sweeps and submissions, a referee, and three-round fights. Plays with keyboard, touch, or a PS5 DualSense.

## Getting started

Requires Node 20 or newer.

```bash
npm install          # .npmrc sets legacy-peer-deps, which avoids an npm bug with Vitest's optional peers
npm run dev          # dev server with hot reload, usually http://localhost:5173
npm test             # fight-rule and data tests
npm run typecheck    # TypeScript only
npm run build        # production build into dist/
npm run build:artifact   # build, then write dist/artifact.html for publishing as a claude.ai artifact
```

## Project layout

```
index.html              app shell: main menu and fight screen
src/main.ts             boot, menu, profile, screen switching, the frame loop
src/styles.css          design tokens (light and dark) and layout
src/data/               strikes.json, fight.json and their TypeScript types
src/rig/math.ts         joints, frames and two-bone IK
src/rig/stage.ts        renderer, cel shading, octagon cage, fighter meshes
src/rig/poses.ts        turns pose specs into world-space poses (standing and paired)
src/fight/rules.ts      pure fight rules: blocks, dodges, damage, timing, contests, judging
src/fight/fight.ts      the fight state machine: standing, clinch, takedowns, ground, rounds, referee
src/fight/cpu.ts        CPU opponent
src/input/input.ts      keyboard and gamepad mapped to fight commands, rumble, control labels
src/ui/hud.ts           HUD, prompts, contextual buttons, controls and defense charts
src/ui/camera.ts        game camera
src/training/            training mode: drills.ts (drill and partner definitions), session.ts (pure scoring),
                        controller.ts (runs drills, drill HUD, results, best scores)
src/park/                the park hub: data.ts (gear, classes, the pickup ladder, what drills train), progress.ts (pure
                        cash, rep, XP and gear rules), world.ts (the street scene), walk.ts (walk cycle), controller.ts (the screen)
src/profile/profile.ts  your fighter (name, styles, record, best drill scores, park progress), saved in the browser
tests/                  rules.test.ts (fight rules), data.test.ts (data integrity), training.test.ts (drill scoring and placement), park.test.ts (progression)
```

The fight logic never touches the DOM. It reports what happened through the `FightEvents` interface (pops, banners, log lines, rumble), which the HUD and input modules implement. That keeps the rules testable and lets new screens, such as training mode, drive the same fight.

## The park

Walk the street (arrows or A/D, Shift to jog, or the on-screen buttons) and step into a place with ↑, W or E (✕ on a controller):

- **Iron Gym**: the training drills, which now also earn XP for the stats they work, and paid classes for what the drills don't cover (cardio, power, chin, kicks and clinch, wrestling, jiu-jitsu). Each training level adds 2 to a stat, up to level 10.
- **Fight Shop**: gloves, shorts, wraps and mouthguards. Each piece changes your fighter's colors and most add stat points. Some need rep before the shop sells them.
- **The Court**: one-round pickup fights against a ladder of eight park fighters, from Dex up to The King. Wins pay the purse and rep, a first win over someone pays half again, and losses still pay a little. Fighters ask for more rep as you climb.

Training and gear only count in park fights; quick fights and training drills use the plain styles.

## Tuning the game

Most tuning is data, not code:

- **`src/data/strikes.json`**: strikes (windup, damage, range, stamina cost, which block or head movement beats them), standing poses, and styles (stats and strike mix for the CPU).
- **`src/data/fight.json`**: paired poses for the clinch, takedowns, ground positions and submissions.
- **`src/fight/rules.ts`**: the formulas and constants (block table, counter windows, damage scaling, contest math, judging).
- **`src/park/data.ts`**: park prices, gear bonuses, class XP, level costs, the pickup ladder (rep needed, purse, stat boosts) and payouts.
- **`src/training/drills.ts`**: training drills (length, partner, partner behavior, points per outcome), sparring partner behaviors and the combo list.

`npm test` checks that every strike, pose, zone and style the data refers to exists and that every pose solves, so typos fail fast.

## Prototypes

`art/` holds the earlier single-page prototypes, kept as reference. They are not part of the build.

- `art/example-fighter/`: the 2D sprite-rig sample and the 2D grappling lab, plus the sprite spec in `docs/SPRITE_SPEC.md`.
- `art/toon-3d/`: the toon 3D test, the striking lab and the original single-file fight.
