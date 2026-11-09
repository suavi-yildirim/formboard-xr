# CLAUDE.md – Formboard VR

WebXR wire-harness assembly trainer for Meta Quest 3 (three.js, no build step), driven by KBL data.
Live: https://suavi-yildirim.github.io/formboard-vr/ · demo: `/demo/` (EN, `#de` German).

## Commands

- `python3 -m http.server` and open http://localhost:8000 (preview server "formboard-vr" on port 8123).
- `npm test`: `node --check` on every module, then `node --test test/*.test.js`. Run it before every push.
- `npm run data`: rebuild `src/data/*.json` from the KBL files (`tools/kbl_to_harness.py`, `tools/real_kbl.py`, needs numpy).
- Video edits: `tools/video/vtool.swift` (AVFoundation; ffmpeg is not installed). See its header.

## Architecture rules

- `src/core/` is pure logic without three.js (grid, harness, router, session, heldwire, rig). New behaviour
  that can be expressed as maths goes there, with a unit test.
- `src/main.js` wires core, scene and input together. All panel texts go through `src/i18n.js`
  (`t(key, params)`, `term()` for data labels, `colourName()`). Add every new string in **both** `en` and `de`.
  - Language comes from `#de` / `#en`, then localStorage key `formboard-demo-lang` (shared with the demo page), then the browser language.
  - The EN | DE switch is on the VR menu panel and in the help box. Changing it redraws the panels, the car sign and the board title.
- One pointer model (`src/input/pointers.js`) for hands, controllers and mouse.
  - In VR, board work happens at the **pinch point** (`p.tip`), not by ray.
  - Rays only serve the panel and teleport.
  - The mouse uses a ray onto the board.
- The debug handle `window.formboard` exposes `H, panel, carPanel, camera, step, load, setView, setMode, placement, station, ui,
  beginSetup, confirmSetup, handles` (`handles.near/start/drag/end` simulate carrying with a fake `{ tip, pulse }` pointer).
- Board and panel live in the `station` group (origin on the table top, +z towards the user). VR keeps it on the
  bench at (0, 0.74, −0.45). MR moves it onto the real table. The work light (`updateLight`) and the 1:1 car
  (`placeVehicle`, 2.5 m to the station's right, on the floor) follow it.

## What the user tested on the Quest and decided (keep these)

- Wires are grabbed exactly at the **drawn** (bundle-offset) wire end, within 3 cm, and only where the pinch
  closes. Measuring from the node centre made grabbing fail.
- Pinch = thumb–index gap < 3 cm (release > 5 cm) **or** the system pinch. Short tracking dropouts (< 150 ms)
  must not drop a wire. Fingers may sink up to 8 cm into the board.
- No ray through the hand while working at the board.
- Teleport only with the controller **grip button**. Pinch-teleport caused accidental jumps. Left stick walks,
  right stick snap-turns 30°.
- The held wire **grows** from the last peg to the fingers. There is no hanging remainder and no visible slack loop.
  Its shape is computed per frame (`heldwire.js`); a Verlet rope folded and stuck on the board.
- Board sized to the harness (harness stays 1:1), tilted like a desk easel on the bench, within reach.
- Errors count only for a wrong branch or a skipped peg. Passing near other pegs in the corridor is fine.
- Per-hand state must not outlive the press that set it. The "this press is on the panel" mark
  (`core/press.js`) once stayed set, so the hand that pressed a menu button (usually the right) could
  never grab a wire again. When one hand fails and the other works, look for such leftover state first.

## Data facts

- VW Old Beetle sample (CC BY-SA 4.0) in `data/vw/`.
  - Formboard harness: `ltgs_movo` (18 wires).
  - Vehicle view: `modulare_ltgs` (183 segments).
- Flattening keeps every KBL `Virtual_length`. The VW KBL wire lengths equal the board paths to the millimetre.
- Ring terminals are placed on nodes via `Special_terminal_occurrence` with the same Id as the connector.
- The fictitious door harness has made-up wire lengths. Its slack is capped at 1.6 × path length.

## Mixed reality (Enter MR)

- `immersive-ar` session with `hit-test`; placement maths in `core/placement.js` (tested), XR part in `input/placement.js`.
  - Gaze hit-test against the Quest's Space Setup. Only surfaces with an upward normal count.
  - Setup (`ui.setup`): `'board'` (any horizontal surface; fallback: gaze meets 0.74 m, 0.3–1.2 m ahead),
    then `'car'` (floor only, below 0.4 m; fallback: gaze meets the floor, 1–6 m ahead), then the menu.
- In MR the car has its own pose (`mrCar`), independent of the board. In VR it follows the station (`CAR_OFFSET`).
- Free moving in MR (the user asked for it):
  - A cyan bar under the board's front edge and a cyan knob on a post at the car's engine end.
  - A fresh pinch within 7 cm grabs; the object follows the fingertip with the grab offset kept.
  - The board turns to face the user while carried; the car stays on the floor and keeps its direction.
  - While carrying, that hand does nothing else.
- The user tried a virtual workbench in MR and dropped it: the board goes on the real table.
- MR hides the workshop decor (`decor` group), background, fog, car panel and board struts. It shows a shadow catcher on the table.
- MR turns off locomotion: no teleport, sticks or jumps, because moving the world would pull the board off the table.
- "Set up again" replaces "Go to car" on the panel.
- The renderer needs `alpha: true`. With a null background, three.js clears to transparent in alpha-blend mode.
- Not yet tested on the Quest (as of the first MR version). Hit-test results, passthrough look and table height need the user's check.
- Raycasts ignore `visible`: skip hidden panels explicitly, or they swallow clicks.

## Testing without a headset

- A hidden preview pane gets **no animation frames**. Drive the app with `window.formboard.step()` after
  dispatching synthetic pointer events. OrbitControls throws harmless `setPointerCapture` errors for them.
- Hand-tracking logic can be checked by instantiating `Pointers` with a fake renderer and fake hand joints.
- Only the user can test feel and frame rate on the Quest. Say so; don't claim it.

## Publishing (GitHub Pages from `main`, root)

- The repo is public. Only fictitious data and the public VW sample go in.
  - No client or institute names.
  - Nothing from the internal deck or papers in the parent folder.
  - `docs/superpowers/` (spec with the critique of the internal plan) stays gitignored.
- Raw headset recordings (`quest3-videos/`, about 1 GB) stay local and gitignored.
  - Before publishing a clip, check its frames for system menus and passthrough views of the real room.
  - Check the audio envelope for voices.
- Commit as Suavi Yildirim `<345443090+suavi-yildirim@users.noreply.github.com>`, without a co-author line.
- Suavi edits this repo on GitHub too (he changed the README once). Run `git fetch` and check
  `git log main..origin/main` before pushing, and keep his wording when merging.
- After pushing, wait for Pages (about 30–60 s) and load the live page.
  - Browsers may cache old files for up to 10 min, so users can briefly see a mix of versions.
- An unescaped apostrophe in a single-quoted JS string once took the site down. `npm test` now syntax-checks everything.

## Demo videos

- Clips are made from the raw recordings with `vtool`:
  - pick calm takes with `motion`
  - check frames with `sheet`
  - join parts with `montage` (0.5 s cross-fades), 1280×720, 3 Mbit/s, with audio
- Each clip ships with a poster JPG (`frame`).
- README previews are GIFs (`gif`, 288 px, 15 fps; the wiring preview is cut to its best 11 s), because GitHub
  does not play repository MP4s in a README. At 8 fps they looked choppy.
- Check GIF frame timing after writing (delay 7/100 s = 14.3 fps).
- Demo page order: wiring by hand, finished formboard, real KBL data from an example car. Each video has a sound
  button (one with sound at a time) and a fullscreen button.
