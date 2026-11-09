#!/usr/bin/env python3
"""Builds the mixed-reality demo clips from the raw headset recording (not in git):
montage (crops, cross-fades) at a high bitrate, then bilingual captions burned in (vtool caption).

  swiftc -O tools/video/vtool.swift -o /tmp/vtool
  python3 tools/video/mr_clips.py [pegs] [wiring] [finish] [full]

Page clips go to demo/media/mr-*.mp4; the full edit (about 64 s) goes to quest3-videos/ (local only).
The first 30 s of the recording (setup) are not used. Times are seconds in the raw recording.
"""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VT = os.environ.get('VTOOL', '/tmp/vtool')
IN = f'{ROOT}/quest3-videos/mr-session-raw.mp4'
WORK = f'{ROOT}/quest3-videos/mr-work'
OUTDIR = {'full': f'{ROOT}/quest3-videos'}
FADE = 0.4
CROP = '600:150:1320'  # right part: keeps the board, drops the wall and the poster on the left

# segment: (start, end, crop or None, caption key or None)
CAP = {
  'table': ('Mixed reality: the formboard placed in the real room', 'Mixed Reality: das Formbrett im echten Raum platziert'),
  'car':   ('The VW vehicle harness at 1:1 in the room', 'Der VW-Fahrzeugleitungssatz 1:1 im Raum'),
  'menu':  ('Choose a real KBL harness', 'Einen echten KBL-Leitungssatz wählen'),
  'pegs':  ('Pinch the guide pegs into place', 'Führungsstifte mit den Fingern setzen'),
  'route': ('Route each wire by hand, peg by peg', 'Jede Leitung von Hand verlegen, Stift für Stift'),
  'snap':  ('Correct peg: green snap, click and haptic tick', 'Richtiger Stift: grünes Einrasten, Klick, Vibration'),
  'grow':  ('The wire grows to your fingertips, at its KBL length', 'Die Leitung wächst bis zu den Fingern, in KBL-Länge'),
  'wrong': ('Wrong branch: red flash, counted as an error', 'Falscher Abzweig: rotes Blinken, zählt als Fehler'),
  'dense': ('Dense branch areas: the next peg glows', 'Dichte Abzweige: der nächste Stift leuchtet'),
  'bundle': ('Bundles build up wire by wire, as on a real formboard', 'Bündel entstehen Leitung für Leitung, wie am echten Formbrett'),
  'last':  ('The last wires: the harness is complete', 'Die letzten Leitungen: der Leitungssatz ist komplett'),
  'done':  ('Finished: every wire routed and checked', 'Fertig: alle Leitungen verlegt und geprüft'),
  'qa':    ('Quality check, then a log of time and errors', 'Qualitätsprüfung, dann ein Protokoll mit Zeit und Fehlern'),
  'incar': ('Orange: the harness you built, in place in the car', 'Orange: der gebaute Leitungssatz, an seiner Einbaulage'),
}
# Every part is one whole action: it starts about 0.7 s before the grab sound and ends about 0.8 s after the
# "wire done" chime (found with `vtool levels <raw> 0.05`). 2:20-2:23 (a failed grab) is left out.
TEASER = [(177.2, 181.0, None, None)]         # the finished board, as a sneak peek under the title card
SETUP = [(2.9, 4.6, None, 'table'),            # the board placed in the room
         (17.2, 21.0, None, 'car'),            # the vehicle harness at 1:1 on the floor
         (26.0, 31.3, None, 'menu')]           # choosing the harness (clicks 28.8, 30.7)
PEGS = [(39.6, 44.4, CROP, 'pegs'),            # guide pegs set one by one
        (48.2, 55.6, CROP, 'route'),           # wire 1: grab 48.9, done 54.8
        (55.9, 62.2, CROP, 'snap')]            # wire 2: grab 56.6, done 61.4
WIRING = [(64.2, 69.8, CROP, 'grow'),          # wire 3: grab 64.9, done 69.4 (the hand hovers and shakes after it)
          (116.9, 120.3, CROP, 'wrong'),       # a later wire: grab 117.6, wrong peg 119.2, done 119.7 (calm)
          (78.2, 83.8, CROP, 'dense'),         # wire 5: grab 78.9, done 83.0
          (94.5, 99.5, CROP, 'bundle')]        # wire 6: grab 95.2, done 98.7
FINISH = [(150.8, 160.8, CROP, 'last'),        # the last five wires, grab 151.5 ... done 160.0
          (177.0, 181.5, None, 'done'),
          (186.5, 192.3, None, 'qa'),          # the three checks, ticked 187.9 ... 191.6
          (167.0, 176.0, None, 'incar')]

LOGOS = [  # FAU (dark blue PNG, transparent) top left, FAPS (green) top right, during the first seconds
    {'img': f'{WORK}/fau.png', 'pos': 'tl', 'h': 84},
    {'img': f'{WORK}/faps.jpg', 'pos': 'tr', 'h': 126},
]
LOGO_S = 4.5

def build(name, segs, kbps, cards=()):
    ranges = ','.join(f'{s}-{e}' + (f'@{c}' if c else '') for s, e, c, _ in segs)
    os.makedirs(WORK, exist_ok=True)
    raw = f'{WORK}/{name}_raw.mp4'
    subprocess.run([VT, 'montage', IN, raw, ranges, str(FADE), '1280', '720', '9000'], check=True)
    caps, t = [], 0.0
    for i, (s, e, c, key) in enumerate(segs):
        d = e - s
        start, end = t + (0.15 if i else 0.3), t + d - FADE - 0.05
        # German on top (large), English below
        if key and (not caps or caps[-1]['t'] != CAP[key][1]):
            caps.append({'s': start, 'e': end, 't': CAP[key][1], 'd': CAP[key][0]})
        elif key:
            caps[-1]['e'] = end  # same caption over consecutive segments
        t += d - FADE
    total = t + FADE
    for c in cards:
        caps.append({'s': c[0] if c[0] >= 0 else total + c[0], 'e': c[1] if c[1] > 0 else total + c[1], 't': c[2], 'd': c[3], 'card': True})
    # keep normal captions out of title cards
    for c in caps:
        if c.get('card'): continue
        for k in caps:
            if k.get('card') and c['s'] < k['e'] and c['e'] > k['s']:
                if k['s'] <= c['s']: c['s'] = k['e'] + 0.2
                else: c['e'] = k['s'] - 0.2
    caps = [c for c in caps if c['e'] - c['s'] > 1.0]
    # over a darkened title card the dark blue FAU logo needs a white plate
    caps += [{'s': 0.0, 'e': LOGO_S, 't': '', **l, 'badge': bool(cards) and l['pos'] == 'tl'} for l in LOGOS]
    if cards:  # the end card shows the logos again
        # on the darkened end card the dark blue FAU logo needs a white plate
        caps += [{'s': total - 3.2, 'e': total - 0.05, 't': '', **l, 'badge': l['pos'] == 'tl'} for l in LOGOS]
    jf = f'{WORK}/{name}.json'
    json.dump(caps, open(jf, 'w'), ensure_ascii=False, indent=1)
    out = f"{OUTDIR['full'] if name.endswith('full') else ROOT + '/demo/media'}/{name}.mp4"
    subprocess.run([VT, 'caption', raw, out, jf, str(kbps)], check=True)
    print(name, round(total, 1), 's')

which = sys.argv[1:] or ['pegs', 'wiring', 'finish', 'full']
if 'pegs' in which: build('mr-pegs', SETUP[2:] + PEGS, 3000)
if 'wiring' in which: build('mr-wiring', WIRING, 3000)
if 'finish' in which: build('mr-finished', FINISH, 3000)
if 'full' in which:
    build('formboard-xr-mr-full', TEASER + SETUP[2:] + PEGS + WIRING + FINISH, 4000, cards=[
        (0.0, 3.3, 'Formboard XR · Mixed Reality', 'Kabelbaumtraining aus VW-KBL-Daten · wire harness training from VW KBL data'),
        (-3.2, -0.05, 'Läuft im Browser des Headsets, ohne Installation', 'Runs in the headset’s browser · suavi-yildirim.github.io/formboard-xr'),
    ])
