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

def build(name, segs, kbps, cards=(), chapters=None, stamps=()):
    """chapters: {caption key: (step number, 'Name')} for step chips and a progress bar (creative cut).
    stamps: [(raw time, text, 'ok' | 'err')] pop up at that moment of the recording."""
    ranges = ','.join(f'{s}-{e}' + (f'@{c}' if c else '') for s, e, c, _ in segs)
    os.makedirs(WORK, exist_ok=True)
    raw = f'{WORK}/{name}_raw.mp4'
    subprocess.run([VT, 'montage', IN, raw, ranges, str(FADE), '1280', '720', '9000'], check=True)
    caps, t = [], 0.0
    extra, chap_at = [], []
    for i, (s, e, c, key) in enumerate(segs):
        d = e - s
        for rt, text, col in stamps:
            if s + 0.2 <= rt <= e - 0.2:  # the chime comes just before the cut: the pop-up may run over the fade
                if extra and extra[-1]['e'] > t + rt - s: extra[-1]['e'] = t + rt - s - 0.05
                extra.append({'s': t + rt - s, 'e': t + rt - s + 1.4, 't': text, 'style': 'stamp', 'colour': col})
        if chapters and key in chapters:
            n, label = chapters[key]
            if not chap_at or chap_at[-1][0] != n: chap_at.append([n, label, t + (0.15 if i else 0.3), 0])
            chap_at[-1][3] = t + d - FADE - 0.05
        start, end = t + (0.15 if i else 0.3), t + d - FADE - 0.05
        # German on top (large), English below
        if key and (not caps or caps[-1]['t'] != CAP[key][1]):
            caps.append({'s': start, 'e': end, 't': CAP[key][1], 'd': CAP[key][0]})
        elif key:
            caps[-1]['e'] = end  # same caption over consecutive segments
        t += d - FADE
    total = t + FADE
    for c in cards:
        # a 5th field False: a normal caption box instead of a darkened title card
        caps.append({'s': c[0] if c[0] >= 0 else total + c[0], 'e': c[1] if c[1] > 0 else total + c[1], 't': c[2], 'd': c[3],
                     'card': c[4] if len(c) > 4 else True, 'fixed': True})
    # keep normal captions out of title cards
    for c in caps:
        if c.get('fixed'): continue
        for k in caps:
            if k.get('fixed') and c['s'] < k['e'] and c['e'] > k['s']:
                if k['s'] <= c['s']: c['s'] = k['e'] + 0.2
                else: c['e'] = k['s'] - 0.2
    caps = [c for c in caps if c['e'] - c['s'] > 1.0]
    if chapters:
        steps = max(n for n, _ in chapters.values())
        card_end = max([k['e'] for k in caps if k.get('fixed') and k['s'] < 1] + [0])
        card_start = min([k['s'] for k in caps if k.get('fixed') and k['s'] > 1] + [total])
        for n, label, a, b in chap_at:
            a, b = max(a, card_end + 0.2), min(b, card_start - 0.2)
            if b - a > 1: extra.append({'s': a, 'e': b, 't': f'{n} / {steps}  ·  {label}', 'style': 'chip'})
        extra.append({'s': 0.0, 'e': total, 't': '', 'style': 'bar', 'marks': [a / total for _, _, a, _ in chap_at[1:]]})
    caps += extra
    # over a darkened title card the dark blue FAU logo needs a white plate
    logo_s = 3.3 if chapters else LOGO_S  # creative cut: logos leave with the title card, the step chip follows
    caps += [{'s': 0.0, 'e': logo_s, 't': '', **l, 'badge': bool(cards) and l['pos'] == 'tl'} for l in LOGOS]
    if cards:  # the end card shows the logos again
        caps += [{'s': total - 3.6, 'e': total - 0.05, 't': '', **l, 'badge': l['pos'] == 'tl'} for l in LOGOS]
    jf = f'{WORK}/{name}.json'
    json.dump(caps, open(jf, 'w'), ensure_ascii=False, indent=1)
    out = f"{OUTDIR['full'] if name.startswith('formboard-xr') else ROOT + '/demo/media'}/{name}.mp4"
    subprocess.run([VT, 'caption', raw, out, jf, str(kbps)], check=True)
    print(name, round(total, 1), 's')

which = sys.argv[1:] or ['pegs', 'wiring', 'finish', 'full']
if 'pegs' in which: build('mr-pegs', SETUP[2:] + PEGS, 3000)
if 'wiring' in which: build('mr-wiring', WIRING, 3000)
if 'finish' in which: build('mr-finished', FINISH, 3000)
# Full edits: teaser, harness choice, pegs, wiring, finish; the car view starts with the turn from the board
# and the video ends on the sign above the car (2:55), under the end card (from about 1:11 to 1:15).
FULL = TEASER + SETUP[2:] + PEGS + WIRING + FINISH[:-1] + [(162.9, 175.0, None, 'incar')]
CARDS = [
    (0.0, 3.3, 'Formboard XR · Mixed Reality', 'Kabelbaumtraining aus VW-KBL-Daten · wire harness training from VW KBL data'),
    (-3.6, -0.05, 'Läuft im Browser des Headsets, ohne Installation', 'Runs in the headset’s browser · suavi-yildirim.github.io/formboard-xr'),
]
if 'full' in which:
    build('formboard-xr-mr-full', FULL, 4000, cards=CARDS)
if 'creative' in which:
    # Same story with more on screen: step chips (1-5), a progress bar with chapter marks, a pop-up at every
    # finished wire and at the wrong peg, and a closer crop on the wrong-peg wire.
    CAP['pegs'] = ('22 guide pegs, placed where the KBL branches', '22 Führungsstifte, gesetzt nach den KBL-Abzweigen')
    CAP['route'] = ('18 wires, each at its true KBL length', '18 Leitungen, jede in ihrer echten KBL-Länge')
    CAP['done'] = ('Flattened 1:1 from 3D: 30 segments, 0 % length error', '1:1 aus 3D abgewickelt: 30 Segmente, 0 % Längenfehler')
    CAP['incar'] = ('Same KBL file: the harness in the car, 1:1', 'Dieselbe KBL-Datei: der Leitungssatz im Fahrzeug, 1:1')
    segs = [(116.9, 120.3, '620:100:1000', k) if (a, b) == (116.9, 120.3) else (a, b, c, k) for a, b, c, k in FULL]
    chapters = {'menu': (1, 'Wählen'), 'pegs': (2, 'Stifte setzen'),
                'route': (3, 'Verlegen'), 'snap': (3, 'Verlegen'), 'grow': (3, 'Verlegen'), 'wrong': (3, 'Verlegen'),
                'dense': (3, 'Verlegen'), 'bundle': (3, 'Verlegen'), 'last': (3, 'Verlegen'),
                'done': (4, 'Prüfen'), 'qa': (4, 'Prüfen'), 'incar': (5, 'Im Fahrzeug')}
    ok = lambda n: f'✓ Leitung {n}'
    stamps = [(54.8, ok(1), 'ok'), (61.4, ok(2), 'ok'), (69.4, ok(3), 'ok'), (119.2, '✗ Falscher Stift · Fehler gezählt', 'err'),
              (83.0, ok(5), 'ok'), (98.7, ok(6), 'ok'), (152.8, ok(14), 'ok'), (154.8, ok(15), 'ok'), (156.8, ok(16), 'ok'),
              (158.7, ok(17), 'ok'), (160.0, '✓ 18 / 18 · komplett', 'ok'),
              (187.9, '☑ Stecker', 'ok'), (188.9, '☑ Bündel', 'ok'), (191.6, '☑ Farben', 'ok')]
    build('formboard-xr-mr-creative', segs, 4000, cards=CARDS, chapters=chapters, stamps=stamps)
