#!/usr/bin/env python3
"""Build the app data: KBL harnesses -> formboard harness JSON, plus the 3D vehicle view.

Door harness: simplified, fictitious KBL plus a hand-made formboard layout.

KBL describes wiring (connectors, wires, connections, modules) but in this demo carries no
formboard geometry. The layout file places connectors, pegs and branch points on the board grid
and lists the bundle segments. Each wire's routing path is the shortest path through that
topology between its two connectors.

VW Old Beetle: real KBL, flattened by real_kbl.py.

Usage:
  python3 tools/kbl_to_harness.py            # writes src/data/*.json
  python3 tools/kbl_to_harness.py --check    # validate only, non-zero exit on problems
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path

from real_kbl import formboard, vehicle

ROOT = Path(__file__).resolve().parent.parent
KBL = ROOT / "data" / "door_harness_kbl.xml"
LAYOUT = ROOT / "data" / "board_layout.json"
VW = ROOT / "data" / "vw"
VW_MOVO = VW / "kblxml_2.3sr-1_000971619_ltgs_movo_170718.kbl"
VW_FULL = VW / "kblxml_2.4sr-1_tab016120_modulare_ltgs._160718.kbl"
OUT = ROOT / "src" / "data"
# A short piece of the full vehicle harness with real multi-pole connectors, for cavity training:
# 5-pole XA.V.1 and 8-pole XA.E.1, a ground point and a splice. Terminal 53 (DIN 72552) is the wiper
# motor, so the piece is named after it; the KBL does not name the part.
WIPER_KEEP = {"XA.V.1", "XA.E.1", "278", "B174"}
VW_SOURCE = "VW VOBES \"Old Beetle\" sample (prostep ivip ECAD wiki), CC BY-SA 4.0"


def read_kbl(path):
    h = ET.parse(path).getroot().find("Harness")
    connectors = {c.get("id"): c.get("description") for c in h.findall("Connector_occurrence")}
    cavities = {c.get("id"): len(c.findall("Contact_point")) for c in h.findall("Connector_occurrence")}
    wires = {w.get("id"): w.attrib for w in h.findall("Wire_occurrence")}
    connections = []
    for c in h.findall("Connection"):
        ends = [e.get("contact_point") for e in c.findall("Extremity")]
        connections.append({"wire": c.get("wire"), "signal": c.get("signal_name"), "ends": ends})
    modules = [
        {"id": m.get("id"), "label": m.get("description"),
         "wires": [r.get("ref") for r in m.findall("Controlled_component")]}
        for m in h.findall("Module")
    ]
    return {"id": h.get("id"), "description": h.get("description"),
            "connectors": connectors, "cavities": cavities, "wires": wires, "connections": connections, "modules": modules}


def shortest_path(adj, start, goal):
    prev = {start: None}
    queue = deque([start])
    while queue:
        n = queue.popleft()
        if n == goal:
            break
        for m in adj.get(n, ()):
            if m not in prev:
                prev[m] = n
                queue.append(m)
    if goal not in prev:
        return None
    path, n = [], goal
    while n is not None:
        path.append(n)
        n = prev[n]
    return path[::-1]


def build(kbl, layout):
    problems = []
    node_ids = {n["id"] for n in layout["nodes"]}
    adj = {}
    for a, b in layout["segments"]:
        for n in (a, b):
            if n not in node_ids:
                problems.append(f"segment uses unknown node {n}")
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    nodes = []
    for n in layout["nodes"]:
        node = dict(n)
        if n["kind"] == "connector":
            if n["id"] not in kbl["connectors"]:
                problems.append(f"layout connector {n['id']} not in KBL")
            node["label"] = kbl["connectors"].get(n["id"], n["id"])
            count = kbl["cavities"].get(n["id"], 2)
            node.update(shape="housing", housing_colour="BK", cavities=count,
                        cavity_numbers=[str(i) for i in range(1, count + 1)])
        nodes.append(node)

    wires = []
    for c in kbl["connections"]:
        w = kbl["wires"].get(c["wire"])
        if w is None:
            problems.append(f"connection uses unknown wire {c['wire']}")
            continue
        ends = c["ends"]
        a, b = (e.split(".")[0] for e in ends)
        # the end with more cavities is the one the user inserts (see real_kbl.formboard)
        if kbl["cavities"].get(a, 1) > kbl["cavities"].get(b, 1):
            ends, a, b = ends[::-1], b, a
        path = shortest_path(adj, a, b)
        if path is None:
            problems.append(f"no board path for {c['wire']} ({a} -> {b})")
            continue
        wires.append({
            "id": c["wire"], "colour": w["colour"],
            "cross_section_mm2": float(w["cross_section_mm2"]), "length_mm": int(w["length_mm"]),
            "signal": c["signal"], "from": ends[0], "to": ends[1],
            "from_cavity": ends[0].split(".")[1], "to_cavity": ends[1].split(".")[1],
            "from_node": path[0], "to_node": path[-1], "path": path,
        })

    harness = {
        "id": kbl["id"], "description": kbl["description"], "source": "Fictitious demo data",
        "board": layout["board"],
        "nodes": nodes, "segments": layout["segments"], "modules": kbl["modules"], "wires": wires,
    }
    return harness, problems


def cavity_problems(h):
    """Every wire end into a connector with 2+ cavities needs a cavity of that connector."""
    out = []
    nodes = {n["id"]: n for n in h["nodes"]}
    for w in h["wires"]:
        for node, cav in ((w["from_node"], w["from_cavity"]), (w["to_node"], w["to_cavity"])):
            n = nodes[node]
            if n.get("cavities", 1) >= 2 and cav not in n.get("cavity_numbers", []):
                out.append(f"{h['id']}: wire {w['id']} ends in cavity {cav!r}, not one of {node} {n.get('cavity_numbers')}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    door, problems = build(read_kbl(KBL), json.loads(LAYOUT.read_text(encoding="utf-8")))
    movo = formboard(VW_MOVO, "Engine compartment ignition harness (VW Old Beetle)", VW_SOURCE)
    wiper = formboard(VW_FULL, "Wiper harness, short example piece (VW Old Beetle)", VW_SOURCE, keep=WIPER_KEEP)
    for name, h in (("VW", movo), ("VW wiper", wiper)):
        if h["skipped_connections"]:
            problems.append(f"{name}: connections without a board path: {h['skipped_connections']}")
    for h in (door, movo, wiper):
        problems += cavity_problems(h)
    for p in problems:
        print("problem:", p, file=sys.stderr)
    if problems:
        sys.exit(1)
    outputs = {"door.json": door, "vw_movo.json": movo, "vw_wiper.json": wiper,
               "vw_vehicle.json": vehicle(VW_FULL, VW_MOVO, {"vw_wiper.json": WIPER_KEEP})}
    index = [{"file": "vw_wiper.json", "label": "VW wiper harness", "note": "real KBL, short, cavities"},
             {"file": "vw_movo.json", "label": "VW ignition harness", "note": "real KBL"},
             {"file": "door.json", "label": "Door harness", "note": "fictitious, variants"}]
    if args.check:
        print(f"ok: door {len(door['wires'])} wires, VW {len(movo['wires'])} wires, flattening {movo['flattening']}")
        print(f"ok: VW wiper {len(wiper['wires'])} wires, flattening {wiper['flattening']}")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in outputs.items():
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"wrote src/data/{name}")
    (OUT / "harnesses.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    old = OUT / "harness.json"
    if old.exists():
        old.unlink()


if __name__ == "__main__":
    main()
