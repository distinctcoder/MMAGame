# Fighter sprite spec

Fighters are not drawn frame by frame. Each fighter is a set of body-part drawings attached to a skeleton, and the game moves the skeleton. The same drawings cover every strike, takedown, ground position and submission, and gear swaps in by replacing one part.

The working example is in [`art/example-fighter/`](../art/example-fighter). Run it with any static server, for example `npx serve art/example-fighter`, then open the page shown.

## What an artist delivers per fighter

Nine base parts, each drawn once:

| Part | Size (px, 1x) | Pivot (x, y) | Pivot is at | Notes |
|---|---|---|---|---|
| `head` | 50 × 60 | 21, 56 | base of neck | Includes the neck. Faces right. |
| `torso` | 66 × 112 | 30, 108 | center of hips | Chest toward +x. Shoulder at (32, 20), neck at (34, 8). |
| `pelvis` | 60 × 46 | 30, 8 | center of hips | Usually shorts. Hip joints at (27, 20) and (33, 20). |
| `upper_arm` | 26 × 66 | 13, 9 | shoulder | Elbow 54px below the pivot. |
| `forearm` | 22 × 56 | 11, 6 | elbow | Wrist 46px below the pivot. |
| `hand` | 36 × 44 | 16, 5 | wrist | Glove or hand. Knuckles point down (+y). |
| `thigh` | 38 × 84 | 19, 10 | hip | Knee 70px below the pivot. |
| `shin` | 28 × 76 | 14, 6 | knee | Ankle 66px below the pivot. Calf on the left (back). |
| `foot` | 46 × 22 | 10, 5 | ankle | Heel left, toes right, sole flat. |

The tables in [`rig.json`](../art/example-fighter/rig.json) are the source of truth if this doc and the file ever disagree.

## Drawing rules

1. **Facing right, near side only.** Draw the arm and leg closest to the viewer. The far arm and leg reuse the same drawings; the engine shades them and draws them behind the body.
2. **Limbs hang straight down.** Draw every limb vertical, with its pivot at the top. The engine rotates it from there.
3. **Overlap the joints.** Round the ends of each limb and run them a few pixels past the joint, so elbows and knees never open a gap when they bend.
4. **Keep the canvas and pivot fixed across variants.** Every glove, pair of shorts or body-type version of a part uses the base part's canvas size and pivot. That is what lets gear swap without touching animations.
5. **Scale.** The fighter stands about 290px tall at 1x. Deliver SVG, or PNG at 2x with a transparent background.
6. **Style.** Flat color, one shadow tone, a dark outline about 2.5px wide at 1x.

## File naming

```
parts/<part>.svg               base part, e.g. parts/shin.svg
parts/<part>_<variant>.svg     gear or body variant, e.g. parts/glove_mt_red.svg, parts/thigh_mma.svg
```

## What the full game will need beyond this sample

**Hands for grappling.** Gloves cover striking. Grappling needs hand poses that swap in for the open-finger MMA glove: `hand_open` (frames, posts), `hand_grip` (collar, wrist and underhook grips) and `hand_fist` (MMA glove, closed).

**Faces.** Three or four head variants with the same pivot: neutral, effort (gritted teeth), hurt, and knocked out.

**Body types.** Light, middle and heavy builds. Each is a full set of the nine parts. Bone lengths can also change per fighter in `rig.json` for reach and height.

**Skin tones.** Each skin part will be split into a skin layer and an outline/detail layer, so tone becomes a palette swap instead of redrawing.

**Gear for park mode.** Each item replaces one or two parts on the same canvas and pivot:
- Gloves: Muay Thai, boxing, MMA 4oz, BJJ (bare hands with tape)
- Shorts: Muay Thai satin, MMA board shorts, wrestling singlet (pelvis + thigh + torso)
- Tops: rash guard, gi top (torso + upper arm + forearm)
- Extras: shin guards (shin), ankle wraps (foot), headgear (head), mouthguard (head variant)

**Style gear sets** (defaults per discipline):

| Style | Hands | Lower body | Upper body |
|---|---|---|---|
| MMA | MMA 4oz | board shorts | bare or rash guard |
| Muay Thai | Muay Thai gloves | satin shorts | bare, mongkol (head) |
| Boxing | boxing gloves | boxing trunks | bare |
| Karate | open hand | gi pants | gi top with belt |
| Judo | open/grip hand | gi pants | heavy gi top with belt |
| BJJ | open/grip hand | gi pants or spats | gi or rash guard |
| Wrestling | open/grip hand | singlet | singlet |

## How animation works (for reference)

- `rig.json` lists the parts, the bones, where each bone attaches to its parent, and the draw order.
- `animations.json` lists poses (an angle per bone, in degrees, relative to the parent bone) and animations (timed lists of poses). The engine blends between poses, keeps the lowest foot on the mat, and fires events such as `impact` at set times.
- Grappling uses the same parts with **paired poses**: one keyframe holds both fighters' skeletons plus their offset from each other, so a double-leg takedown or a mount transition is authored as one animation for two bodies.
