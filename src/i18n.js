// UI language, English or German. The choice comes from the link (#de / #en), then from the last
// visit (shared with the demo page), then from the browser language.
// t(key, params) fills {name} placeholders; term(text) translates labels that come from the data
// (harness and variant names); connector names from the KBL stay as they are.

const STORE_KEY = 'formboard-demo-lang';

const STRINGS = {
  en: {
    menuKicker: 'FORMBOARD XR · WIRE HARNESS TRAINING',
    wiresN: '{n} wires',
    invalid: 'Harness data is invalid: {p}',
    harness: 'Harness', variant: 'Variant', mode: 'Mode',
    flattened: 'Flattened from 3D KBL: {n} segments at true length (max. deviation {d} %), pegs placed automatically.',
    guided: 'Guided', test: 'Test',
    loading: 'Loading…', start: 'Start', goCar: 'Go to car →',
    prepKicker: 'STEP 1 · BOARD PREP', prepTitle: 'Set the guide pegs',
    prepText: 'Pinch a blue ghost peg on the board with thumb and index finger (or pull the trigger) to insert it. Orange caps are Y-pegs at branch points.',
    pegsN: '{n} / {total} pegs', allPegs: 'Set all pegs', menu: 'Menu',
    routeKicker: 'STEP 2 · WIRE {i} / {n} · {mode}',
    signal: 'Signal {s} · {l} mm', from: 'From', to: 'To',
    pullTo: 'Pull the wire to {p}.',
    pullAlong: 'Pull the wire along its route to the target connector.',
    grabContinue: 'Grab the wire end at {p} to continue.',
    grabStart: 'Grab the glowing end at {a} and pull it through the pegs to {b}.',
    stats: 'Errors {e}    Hints {h}    Time {t}', peg: 'Peg {a} / {b}',
    showMe: 'Show me', undo: 'Undo last wire',
    statusWrongGuided: '✗ {p} is wrong, next is {n}', statusWrongTest: '✗ {p} is not on this route',
    qaKicker: 'STEP 3 · QUALITY CHECK', qaTitle: 'Check the harness',
    qaText: 'Connector ends are highlighted. Confirm each check.',
    qa0: 'All connectors seated and locked', qa1: 'Bundles tight, no loose loops', qa2: 'Wire colours match the drawing',
    backLast: 'Back to last wire',
    doneKicker: 'DONE · HARNESS COMPLETE', total: '{t} total', errorsN: '{n} errors', hintsN: '{n} hints', errShort: '{n} err',
    download: 'Download log', again: 'New run', loadingHarness: 'Loading harness…',
    carKicker: 'VEHICLE VIEW · 1:1', carTitle: 'VW Old Beetle harness',
    carText: 'Orange: the ignition harness from the formboard, in place at the engine. Walk around, or hold a controller’s grip button, aim at the floor and release to teleport.',
    backBoard: '← Back to the formboard',
    sign1: 'VW Old Beetle · full vehicle harness, 1:1',
    sign2: '{n} segments from KBL {id} · {c} connectors',
    sign3: 'Orange: ignition harness {id}, the one you build on the formboard',
    sign4: 'Source: VW VOBES sample, prostep ivip ECAD wiki, CC BY-SA 4.0',
    drawing: 'formboard 1:1',
    colours: { RD: 'red', BN: 'brown', VT: 'violet', BU: 'blue', GY: 'grey', GN: 'green', YE: 'yellow', WH: 'white', OG: 'orange', BK: 'black', PK: 'pink' },
    // help box on the web page
    helpTitle: 'wire harness assembly training', helpDemo: 'demo videos',
    helpQuest: 'On the headset (e.g. Meta Quest 3): press <i>Enter VR</i> for the virtual workshop or <i>Enter MR</i> to put the board on your real table. Pinch the glowing wire end between thumb and index finger and pull it through the pegs. Point at a panel and pinch to press a button. With controllers: hold the grip button, aim at the floor and release to teleport; left stick walks, right stick turns.',
    helpNoVr: 'XR needs a WebXR browser: open this link in the headset’s browser (e.g. Meta Quest 3). Here it runs in desktop mode.',
    rowWork: 'Panel, wires', rowWorkHow: 'left-click, left-drag on the board',
    rowLook: 'Look around', rowLookHow: 'right-drag',
    rowPan: 'Pan', rowPanHow: 'Shift + right-drag, or arrow keys',
    rowZoom: 'Zoom', rowZoomHow: 'scroll',
    backToBoard: '← Back to formboard', hideHelp: 'Hide help', showHelp: 'Show help', language: 'Language',
    enterVR: 'ENTER VR', enterMR: 'ENTER MR',
    placeKicker: 'MIXED REALITY · SETUP 1 / 2', placeTitle: 'Put the board on your table',
    placeText: 'Look at your table: the board follows your view. Pinch (or pull the trigger) to put it down. Later: pinch the cyan bar below the board to carry it, or the orange ring at its corner and move your hand around to turn it.',
    placeNoSurface: 'No table detected (set one up in the Quest’s Space Setup). Using standard table height for now.',
    placeBoard: 'Set up again',
    carPlaceKicker: 'MIXED REALITY · SETUP 2 / 2', carPlaceTitle: 'Place the car',
    carPlaceText: 'Look at the floor where the car should stand (1:1, about 4 × 1.6 m): it follows your view. Pinch (or pull the trigger) to put it down. Later: pinch the cyan knob at the car to carry it, or the orange ring at its far end and walk it around to turn it.',
    carNoSurface: 'No floor scan found (Quest Space Setup): the car stands where your gaze meets the floor.',
  },
  de: {
    menuKicker: 'FORMBOARD XR · KABELBAUM-TRAINING',
    wiresN: '{n} Leitungen',
    invalid: 'Leitungssatzdaten ungültig: {p}',
    harness: 'Leitungssatz', variant: 'Variante', mode: 'Modus',
    flattened: 'Aus der 3D-KBL abgewickelt: {n} Segmente in wahrer Länge (max. Abweichung {d} %), Stifte automatisch platziert.',
    guided: 'Geführt', test: 'Prüfung',
    loading: 'Lädt…', start: 'Start', goCar: 'Zum Fahrzeug →',
    prepKicker: 'SCHRITT 1 · BRETT VORBEREITEN', prepTitle: 'Führungsstifte setzen',
    prepText: 'Einen blauen Geisterstift auf dem Brett mit Daumen und Zeigefinger greifen (oder den Trigger ziehen), um ihn zu setzen. Orange Kappen sind Y-Stifte an Abzweigungen.',
    pegsN: '{n} / {total} Stifte', allPegs: 'Alle Stifte setzen', menu: 'Menü',
    routeKicker: 'SCHRITT 2 · LEITUNG {i} / {n} · {mode}',
    signal: 'Signal {s} · {l} mm', from: 'Von', to: 'Nach',
    pullTo: 'Leitung zu {p} ziehen.',
    pullAlong: 'Leitung entlang ihres Wegs zum Zielstecker ziehen.',
    grabContinue: 'Leitungsende bei {p} greifen und weiterführen.',
    grabStart: 'Das leuchtende Ende bei {a} greifen und durch die Stifte nach {b} ziehen.',
    stats: 'Fehler {e}    Hinweise {h}    Zeit {t}', peg: 'Stift {a} / {b}',
    showMe: 'Zeig mir', undo: 'Letzte Leitung zurück',
    statusWrongGuided: '✗ {p} ist falsch, als Nächstes {n}', statusWrongTest: '✗ {p} liegt nicht auf diesem Weg',
    qaKicker: 'SCHRITT 3 · QUALITÄTSPRÜFUNG', qaTitle: 'Leitungssatz prüfen',
    qaText: 'Die Steckerenden sind markiert. Jede Prüfung bestätigen.',
    qa0: 'Alle Stecker gesteckt und verriegelt', qa1: 'Bündel straff, keine losen Schlaufen', qa2: 'Leitungsfarben stimmen mit der Zeichnung überein',
    backLast: 'Zurück zur letzten Leitung',
    doneKicker: 'FERTIG · LEITUNGSSATZ KOMPLETT', total: '{t} gesamt', errorsN: '{n} Fehler', hintsN: '{n} Hinweise', errShort: '{n} F',
    download: 'Protokoll laden', again: 'Neuer Durchlauf', loadingHarness: 'Leitungssatz wird geladen…',
    carKicker: 'FAHRZEUGANSICHT · 1:1', carTitle: 'Leitungssatz VW Old Beetle',
    carText: 'Orange: der Zündungsleitungssatz vom Formbrett, an seiner Einbaulage am Motor. Herumgehen, oder die Grifftaste eines Controllers halten, auf den Boden zielen und loslassen, um sich zu teleportieren.',
    backBoard: '← Zurück zum Formbrett',
    sign1: 'VW Old Beetle · gesamter Fahrzeug-Leitungssatz, 1:1',
    sign2: '{n} Segmente aus KBL {id} · {c} Stecker',
    sign3: 'Orange: Zündungsleitungssatz {id}, der auf dem Formbrett gebaut wird',
    sign4: 'Quelle: VW-VOBES-Beispiel, prostep ivip ECAD-Wiki, CC BY-SA 4.0',
    drawing: 'Formbrett 1:1',
    colours: { RD: 'rot', BN: 'braun', VT: 'violett', BU: 'blau', GY: 'grau', GN: 'grün', YE: 'gelb', WH: 'weiß', OG: 'orange', BK: 'schwarz', PK: 'rosa' },
    helpTitle: 'Kabelbaummontage-Training', helpDemo: 'Demovideos',
    helpQuest: 'Auf dem Headset (z. B. Meta Quest 3): <i>VR starten</i> für die virtuelle Werkstatt oder <i>MR starten</i>, um das Brett auf Ihren echten Tisch zu stellen. Das leuchtende Leitungsende zwischen Daumen und Zeigefinger greifen und durch die Stifte ziehen. Zum Drücken eines Knopfes auf das Panel zeigen und greifen. Mit Controllern: Grifftaste halten, auf den Boden zielen und loslassen zum Teleportieren; linker Stick zum Gehen, rechter Stick zum Drehen.',
    helpNoVr: 'XR braucht einen WebXR-Browser: diesen Link im Browser des Headsets öffnen (z. B. Meta Quest 3). Hier läuft es im Desktop-Modus.',
    rowWork: 'Panel, Leitungen', rowWorkHow: 'Linksklick, auf dem Brett mit links ziehen',
    rowLook: 'Umsehen', rowLookHow: 'mit rechts ziehen',
    rowPan: 'Verschieben', rowPanHow: 'Umschalt + rechts ziehen, oder Pfeiltasten',
    rowZoom: 'Zoomen', rowZoomHow: 'scrollen',
    backToBoard: '← Zurück zum Formbrett', hideHelp: 'Hilfe ausblenden', showHelp: 'Hilfe einblenden', language: 'Sprache',
    enterVR: 'VR STARTEN', enterMR: 'MR STARTEN',
    placeKicker: 'MIXED REALITY · EINRICHTEN 1 / 2', placeTitle: 'Brett auf den Tisch stellen',
    placeText: 'Schauen Sie auf Ihren Tisch: Das Brett folgt Ihrem Blick. Greifen (oder Trigger ziehen), um es abzulegen. Später: den türkisen Griff unter dem Brett greifen, um es zu tragen, oder den orangen Ring an der Ecke greifen und die Hand herumführen, um es zu drehen.',
    placeNoSurface: 'Kein Tisch erkannt (in der Raumeinrichtung der Quest anlegen). Vorerst wird die Standard-Tischhöhe verwendet.',
    placeBoard: 'Neu einrichten',
    carPlaceKicker: 'MIXED REALITY · EINRICHTEN 2 / 2', carPlaceTitle: 'Fahrzeug platzieren',
    carPlaceText: 'Schauen Sie auf den Boden, wo das Fahrzeug stehen soll (1:1, etwa 4 × 1,6 m): Es folgt Ihrem Blick. Greifen (oder Trigger ziehen), um es abzustellen. Später: den türkisen Knauf am Fahrzeug greifen, um es zu tragen, oder den orangen Ring am anderen Ende greifen und herumführen, um es zu drehen.',
    carNoSurface: 'Keine Raumeinrichtung für den Boden gefunden (Quest Space Setup): Das Fahrzeug steht dort, wo Ihr Blick den Boden trifft.',
  },
};

// Labels from the data files, translated both ways (the door harness data is German).
const TERMS = {
  de: {
    'Engine compartment ignition harness (VW Old Beetle)': 'Zündungsleitungssatz Motorraum (VW Old Beetle)',
    'VW ignition harness': 'VW-Zündungsleitungssatz', 'real KBL': 'echte KBL',
    'Door harness': 'Türleitungssatz', 'fictitious, variants': 'fiktiv, Varianten',
    'Full equipment': 'Vollausstattung', 'Complete harness': 'Kompletter Leitungssatz',
    'Fictitious demo data': 'Fiktive Demodaten',
    'VW VOBES "Old Beetle" sample (prostep ivip ECAD wiki), CC BY-SA 4.0': 'VW-VOBES-Beispiel „Old Beetle“ (prostep ivip ECAD-Wiki), CC BY-SA 4.0',
  },
  en: {
    'Türleitungssatz vorne links': 'Front-left door harness',
    'Basis': 'Base', 'Komfort': 'Comfort', 'Ambientebeleuchtung': 'Ambient lighting',
  },
};

let lang = initialLang();
const listeners = [];

function initialLang() {
  const hash = location.hash.slice(1).toLowerCase();
  if (hash === 'de' || hash === 'en') return hash;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {}
  return (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function getLang() {
  return lang;
}

export function setLang(l) {
  const next = l === 'de' ? 'de' : 'en';
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(STORE_KEY, lang); } catch {}
  history.replaceState(null, '', '#' + lang);
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.push(fn);
}

export function t(key, params = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '') : s;
}

export function colourName(code) {
  return STRINGS[lang].colours[code] ?? code;
}

// Data labels; variant names like "Basis + Komfort" are translated part by part.
export function term(text) {
  if (!text) return text;
  const map = TERMS[lang];
  return map[text] ?? text.split(' + ').map((p) => map[p] ?? p).join(' + ');
}
