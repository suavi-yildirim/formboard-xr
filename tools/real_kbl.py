"""Real KBL (VDA 4964, versions 2.3/2.4) -> formboard harness and 3D vehicle view.

Formboard: the harness topology (nodes, segments) is a tree in 3D vehicle coordinates. A formboard
drawing keeps every segment at its true length (wires are cut to that length) but may turn the
branches freely. We start from a plane projection (PCA) and relax the layout: segment lengths are
held at the KBL Virtual_length while nodes that are too close push apart. Long segments get
intermediate fork pegs, branch nodes get Y-pegs. Wire paths come from the KBL Routing.

Vehicle view: segment centre lines (B-spline pieces, evaluated as in the KBL graph demo) in vehicle
coordinates, so the formboard harness can be shown in place inside the full vehicle harness.
"""
import math
import xml.etree.ElementTree as ET

import numpy as np

# VW colour abbreviations -> codes used by the app (DIN-like)
COLOURS = {"sw": "BK", "blk": "BK", "ws": "WH", "rt": "RD", "ro": "RD", "bl": "BU", "gn": "GN",
           "ge": "YE", "br": "BN", "gr": "GY", "vi": "VT", "li": "VT", "rs": "PK", "or": "OG"}

# Connector housing colour from the German part description (default: black)
HOUSING_COLOURS = {"SCHWARZ": "BK", "WEISS": "WH", "GRAU": "GY", "BRAUN": "BN", "BLAU": "BU",
                   "GRUEN": "GN", "ROT": "RD", "GELB": "YE", "NATUR": "NT", "VIOLETT": "VT"}

MIN_NODE_GAP_MM = 55     # nodes closer than this on the board push apart
PEG_SPACING_MM = 160     # one fork peg per this much segment length


class Kbl:
    def __init__(self, path):
        self.root = ET.parse(path).getroot()
        self.byid = {e.get("id"): e for e in self.root.iter() if e.get("id")}
        self.h = self.root.find("Harness")

    def point(self, pid):
        return [float(c.text) for c in self.byid[pid].findall("Coordinates")]

    def number(self, el, path):
        v = el.findtext(f"{path}/Value_component") if el is not None else None
        return float(v) if v else None


# --- geometry helpers (B-spline centre lines, as in the KBL graph demo) ---

def de_boor(t, ctrl, p):
    """Point at parameter t (p <= t <= p+1) of a uniform B-spline with knots 0, 1, 2, ..."""
    d = [list(c) for c in ctrl[: p + 1]]
    for r in range(1, p + 1):
        for j in range(p, r - 1, -1):
            a = (t - j) / (j + 1 + p - r - j)
            d[j] = [(1 - a) * d[j - 1][i] + a * d[j][i] for i in range(3)]
    return d[p]


def centre_line(k, segment, samples=6):
    pts = []
    for curve in segment.findall("Center_curve"):
        ctrl = [k.point(pid) for pid in curve.findtext("Control_points").split()]
        p = int(curve.findtext("Degree"))
        piece = [de_boor(p + i / samples, ctrl, p) for i in range(samples + 1)]
        pts += piece if not pts else piece[1:]
    return pts


def segment_line(k, s, tol=5.0):
    """Centre line of a segment, or a straight line when the curve does not end on its nodes."""
    a = k.point(k.byid[s.findtext("Start_node")].findtext("Cartesian_point"))
    b = k.point(k.byid[s.findtext("End_node")].findtext("Cartesian_point"))
    pts = centre_line(k, s)
    if not pts or max(math.dist(pts[0], a), math.dist(pts[-1], b)) > tol:
        return [a, b]
    return pts


# --- formboard harness ---

def colour_of(part):
    base = stripe = None
    for c in part.findall("Cover_colour"):
        code = COLOURS.get((c.findtext("Colour_value") or "").lower())
        if c.findtext("Colour_type") == "Grundfarbe":
            base = code
        elif c.findtext("Colour_type") == "Kennfarbe":
            stripe = code
    return base or "GY", stripe


def flatten(nodes3, edges, lengths, iters=2500, settle=300):
    """Tree layout in the plane: start from PCA projection, keep edge lengths, push nodes apart."""
    ids = list(nodes3)
    idx = {n: i for i, n in enumerate(ids)}
    X = np.array([nodes3[n] for n in ids])
    X = X - X.mean(axis=0)
    _, _, vt = np.linalg.svd(X, full_matrices=False)
    e1, e2 = vt[0], vt[1]
    if np.cross(e1, e2)[2] < 0:  # look from above (vehicle z up), never mirrored
        e2 = -e2
    P = np.stack([X @ e1, X @ e2], axis=1)

    E = [(idx[a], idx[b], lengths[i]) for i, (a, b) in enumerate(edges)]
    adj = {(i, j) for i, j, _ in E} | {(j, i) for i, j, _ in E}
    n = len(ids)
    for it in range(iters + settle):
        settling = it >= iters  # last passes: lengths only, so every segment ends at its true length
        gap = MIN_NODE_GAP_MM * min(1.0, 0.3 + it / (iters * 0.6))
        for i in range(n):
            for j in range(i + 1, n):
                if settling or (i, j) in adj:
                    continue
                d = P[j] - P[i]
                dist = np.hypot(*d)
                if dist < gap:
                    push = (d / dist if dist > 1e-6 else np.array([1.0, 0.0])) * (gap - dist) / 2
                    P[i] -= push
                    P[j] += push
        for i, j, L in E:
            d = P[j] - P[i]
            dist = np.hypot(*d) or 1e-6
            corr = d / dist * (dist - L) / 2
            P[i] += corr
            P[j] -= corr
    return {n: P[idx[n]] for n in ids}


def best_rotation(P):
    """Rotate so the layout fits a landscape board best."""
    pts = np.array(list(P.values()))
    best = None
    for deg in range(0, 180, 3):
        a = math.radians(deg)
        R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        Q = pts @ R.T
        w, h = Q.max(axis=0) - Q.min(axis=0)
        score = max(w / 1.5, h)  # landscape 3:2
        if best is None or score < best[0]:
            best = (score, R)
    return {k: best[1] @ v for k, v in P.items()}


def formboard(path, title, source, keep=None):
    """keep: optional set of connector Ids. Then only the wires between those connectors are used,
    with the segments they run along (a small piece cut out of a larger harness)."""
    k = Kbl(path)
    h = k.h
    # connectors and contact points
    conn_name, cp_owner, cp_cavity, conn_look = {}, {}, {}, {}
    occurrences = [c for c in h.findall("Connector_occurrence") if keep is None or c.findtext("Id") in keep]
    for c in occurrences:
        conn_name[c.get("id")] = (c.findtext("Id"), c.findtext("Description") or "")
        conn_look[c.get("id")] = connector_look(k, c)
        for cp in c.findall("Contact_points"):
            cp_owner[cp.get("id")] = c.get("id")
            cav = k.byid.get(cp.findtext("Contacted_cavity") or "")
            part = k.byid.get(cav.findtext("Part")) if cav is not None else None
            cp_cavity[cp.get("id")] = part.findtext("Cavity_number") if part is not None else "?"

    # nodes in 3D, which connector sits on which node
    # Ring terminals are placed via a special terminal with the same Id (e.g. ground on the engine block).
    conn_by_name = {v[0]: cid for cid, v in conn_name.items()}
    nodes3, node_conn = {}, {}
    for nd in k.root.findall("Node"):
        nodes3[nd.get("id")] = k.point(nd.findtext("Cartesian_point"))
        for ref in (nd.findtext("Referenced_components") or "").split():
            e = k.byid.get(ref)
            if ref in conn_name:
                node_conn[nd.get("id")] = ref
            elif e is not None and e.tag == "Special_terminal_occurrence" and e.findtext("Id") in conn_by_name:
                cid = conn_by_name[e.findtext("Id")]
                node_conn[nd.get("id")] = cid
                if not conn_name[cid][1]:
                    conn_name[cid] = (conn_name[cid][0], e.findtext("Description") or "")
    conn_node = {v: n for n, v in node_conn.items()}

    routing = {r.findtext("Routed_wire"): (r.findtext("Segments") or "").split() for r in k.root.findall("Routing")}
    connections = h.findall("Connection")
    if keep is not None:
        connections = [c for c in connections
                       if all(e.findtext("Contact_point") in cp_owner for e in c.findall("Extremities"))]
        used = {s for c in connections for s in routing.get(c.get("id"), [])}
    segs = [s for s in k.root.findall("Segment") if keep is None or s.get("id") in used]
    if keep is not None:
        on = {n for s in segs for n in (s.findtext("Start_node"), s.findtext("End_node"))}
        nodes3 = {n: p for n, p in nodes3.items() if n in on}
        node_conn = {n: c for n, c in node_conn.items() if n in on}
        conn_node = {v: n for n, v in node_conn.items()}
    edges = [(s.findtext("Start_node"), s.findtext("End_node")) for s in segs]
    lengths = [k.number(s, "Virtual_length") for s in segs]
    P = best_rotation(flatten(nodes3, edges, lengths))

    # length check after flattening
    errs = [abs(np.hypot(*(P[a] - P[b])) - L) / L for (a, b), L in zip(edges, lengths)]

    # board size: grid of 50 mm cells around the layout with a margin
    pitch = 50
    pts = np.array(list(P.values()))
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    # board fitted to the harness (within arm's reach), harness itself stays 1:1
    cols = math.ceil((hi[0] - lo[0] + 100) / pitch)
    rows = math.ceil((hi[1] - lo[1] + 100) / pitch)
    off = np.array([cols * pitch, rows * pitch]) / 2 - (lo + hi) / 2
    xy = {n: P[n] + off for n in P}

    # node ids for people: connector Id, branch points B1.., degree-2 bends as pegs
    degree = {}
    for a, b in edges:
        degree[a] = degree.get(a, 0) + 1
        degree[b] = degree.get(b, 0) + 1
    order = sorted(nodes3, key=lambda n: (xy[n][0], xy[n][1]))
    name, nb, npg = {}, 0, 0
    out_nodes = []
    for n in order:
        if n in node_conn:
            cid, desc = conn_name[node_conn[n]]
            name[n] = cid
            out_nodes.append({"id": cid, "xy": rnd(xy[n]), "kind": "connector", "label": desc or cid, "kbl": n,
                              **conn_look[node_conn[n]]})
        else:
            if degree[n] > 2:
                nb += 1
                name[n] = f"B{nb}"
                kind = "branch"
            else:
                npg += 1
                name[n] = f"P{npg}"
                kind = "peg"
            out_nodes.append({"id": name[n], "xy": rnd(xy[n]), "kind": kind, "kbl": n})

    # split long segments with fork pegs
    out_segments, seg_chain = [], {}
    for s, (a, b), L in zip(segs, edges, lengths):
        k_pegs = int(L // PEG_SPACING_MM)
        chain = [name[a]]
        for i in range(1, k_pegs + 1):
            npg += 1
            pid = f"P{npg}"
            p = xy[a] + (xy[b] - xy[a]) * i / (k_pegs + 1)
            out_nodes.append({"id": pid, "xy": rnd(p), "kind": "peg", "kbl": s.get("id")})
            chain.append(pid)
        chain.append(name[b])
        for u, v in zip(chain, chain[1:]):
            out_segments.append([u, v])
        seg_chain[s.get("id")] = chain

    # wires: routing segments -> ordered node path from the start connector
    wire_occ = {w.get("id"): w for w in h.findall("General_wire_occurrence")}
    seg_by_id = {s.get("id"): (s.findtext("Start_node"), s.findtext("End_node")) for s in segs}
    wires, skipped = [], []
    for c in connections:
        ends = [e.findtext("Contact_point") for e in c.findall("Extremities")]
        a_conn, b_conn = (cp_owner.get(e) for e in ends)
        if a_conn is None or b_conn is None or a_conn == b_conn:
            skipped.append(c.findtext("Id"))
            continue
        # The user inserts the target end into its cavity (the start end is shown seated), so the
        # end with more cavities is the target: that is where a wrong cavity can be chosen.
        if conn_look[a_conn]["cavities"] > conn_look[b_conn]["cavities"]:
            ends, a_conn, b_conn = ends[::-1], b_conn, a_conn
        path = walk(routing.get(c.get("id"), []), seg_by_id, conn_node[a_conn], conn_node[b_conn])
        if path is None:
            skipped.append(c.findtext("Id"))
            continue
        full = [name[path[0]]]
        for u, v in zip(path, path[1:]):
            sid = next(s for s in routing[c.get("id")] if set(seg_by_id[s]) == {u, v})
            chain = seg_chain[sid]
            full += (chain if chain[0] == name[u] else chain[::-1])[1:]
        occ = wire_occ.get(c.findtext("Wire"))
        part = k.byid.get(occ.findtext("Part")) if occ is not None else None
        base, stripe = colour_of(part) if part is not None else ("GY", None)
        wires.append({
            "id": f"W{occ.findtext('Wire_number')}" if occ is not None else c.findtext("Id"),
            "colour": base, "stripe": stripe,
            "cross_section_mm2": k.number(part, "Cross_section_area") if part is not None else 0.5,
            "length_mm": round(k.number(occ.find("Length_information"), "Length_value") or 0),
            "signal": (c.findtext("Signal_name") or "").rstrip("."),
            "from": f"{conn_name[a_conn][0]}:{cp_cavity.get(ends[0], '?')}",
            "to": f"{conn_name[b_conn][0]}:{cp_cavity.get(ends[1], '?')}",
            "from_cavity": cp_cavity.get(ends[0], "?"), "to_cavity": cp_cavity.get(ends[1], "?"),
            "from_node": name[conn_node[a_conn]], "to_node": name[conn_node[b_conn]],
            "path": full,
        })
    # route long wires first, as on the line: the trunk is laid before the short branches
    wires.sort(key=lambda w: (-len(w["path"]), w["id"]))

    at = {n["id"]: n["xy"] for n in out_nodes}
    edge_len = [math.dist(at[u], at[v]) for u, v in out_segments]
    return {
        "id": h.findtext("Part_number"), "description": f"{title}", "source": source,
        "board": {"cols": cols, "rows": rows, "pitch_mm": pitch},
        "min_edge_mm": round(min(edge_len)),
        "nodes": out_nodes, "segments": out_segments,
        "modules": [{"id": "ALL", "label": "Complete harness", "wires": [w["id"] for w in wires]}],
        "wires": wires,
        "flattening": {"segments": len(segs), "max_length_error_pct": round(float(max(errs)) * 100, 2),
                       "mean_length_error_pct": round(float(sum(errs) / len(errs)) * 100, 2)},
        "skipped_connections": skipped,
    }


def connector_look(k, c):
    """How a connector looks on the board: shape, housing colour, number of cavities, part text."""
    part = k.byid.get(c.findtext("Part") or "")
    desc = (part.findtext("Description") if part is not None else "") or ""
    usage = (c.findtext("Usage") or "").lower()
    up = desc.upper()
    if usage == "ring terminal" or "KABELSCHUH" in up:
        shape = "ring"
    elif usage == "splice":
        shape = "splice"
    elif "GLUEHKERZEN" in up or "ZUENDKERZEN" in up:
        shape = "boot"
    else:
        shape = "housing"
    colour = next((code for word, code in HOUSING_COLOURS.items() if word in up), "BK")
    numbers = [cv.findtext("Cavity_number") for cv in part.findall(".//Cavities")] if part is not None else []
    numbers = numbers or ["1"]
    return {"shape": shape, "housing_colour": colour, "cavities": len(numbers), "cavity_numbers": numbers, "part": desc}


def walk(seg_ids, seg_by_id, start, goal):
    """Order a wire's routing segments into a node path from start to goal."""
    if not seg_ids:
        return None
    adj = {}
    for s in seg_ids:
        a, b = seg_by_id[s]
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    path, prev = [start], None
    while path[-1] != goal:
        nxt = [n for n in adj.get(path[-1], []) if n != prev]
        if len(nxt) != 1:
            return None
        prev = path[-1]
        path.append(nxt[0])
    return path if len(path) == len(seg_ids) + 1 else None


def rnd(p):
    return [round(float(p[0]), 1), round(float(p[1]), 1)]


# --- vehicle view ---

def vehicle(full_path, highlight_path, pieces=None):
    """Both harnesses in vehicle coordinates, converted to viewer axes (y up), in metres.
    pieces: {name: set of connector Ids} cut out of the full harness (as formboard(keep=...)), each
    shown as its own highlight."""
    full, hl = Kbl(full_path), Kbl(highlight_path)

    def lines(k, segs=None):
        out = []
        for s in segs if segs is not None else k.root.findall("Segment"):
            area = k.number(s.find("Cross_section_area_information"), "Area") or 3.0
            out.append({"pts": segment_line(k, s), "r": round(max(1.5, math.sqrt(area / math.pi)), 1)})
        return out

    def piece(keep):
        """Segments and connector nodes of the wires between the kept connectors."""
        names = {c.get("id"): c.findtext("Id") for c in full.h.findall("Connector_occurrence")}
        cps = {cp.get("id") for c in full.h.findall("Connector_occurrence") if c.findtext("Id") in keep
               for cp in c.findall("Contact_points")}
        routing = {r.findtext("Routed_wire"): (r.findtext("Segments") or "").split() for r in full.root.findall("Routing")}
        used = {sid for c in full.h.findall("Connection")
                if all(e.findtext("Contact_point") in cps for e in c.findall("Extremities"))
                for sid in routing.get(c.get("id"), [])}
        segs = [s for s in full.root.findall("Segment") if s.get("id") in used]
        on = {n for s in segs for n in (s.findtext("Start_node"), s.findtext("End_node"))}
        conns = [(names[ref], nd) for nd in full.root.findall("Node") if nd.get("id") in on
                 for ref in (nd.findtext("Referenced_components") or "").split() if names.get(ref) in keep]
        return segs, conns

    a, b = lines(full), lines(hl)
    every = [q for s in a + b for q in s["pts"]]
    centre = [(min(q[i] for q in every) + max(q[i] for q in every)) / 2 for i in range(3)]
    zmin = min(q[2] for q in every)

    def view(q):  # vehicle x back, y left, z up -> viewer x right (= back), y up, z towards viewer (= right)
        return [round((q[0] - centre[0]) / 1000, 4), round((q[2] - zmin) / 1000, 4), round(-(q[1] - centre[1]) / 1000, 4)]

    def connectors(k):
        out = []
        for nd in k.root.findall("Node"):
            for ref in (nd.findtext("Referenced_components") or "").split():
                e = k.byid.get(ref)
                if e is not None and e.tag == "Connector_occurrence":
                    out.append({"label": e.findtext("Id"), "desc": e.findtext("Description") or "", "p": view(k.point(nd.findtext("Cartesian_point")))})
        return out

    out_pieces = {}
    for name, keep in (pieces or {}).items():
        segs, conns = piece(keep)
        out_pieces[name] = {
            "highlight": [{"pts": [view(q) for q in s["pts"]], "r": s["r"]} for s in lines(full, segs)],
            "connectors": [{"label": c, "desc": "", "p": view(full.point(nd.findtext("Cartesian_point")))} for c, nd in conns],
            "highlight_id": f"{full.h.findtext('Part_number')} ({', '.join(sorted(keep))})",
        }

    return {
        "full": [{"pts": [view(q) for q in s["pts"]], "r": s["r"]} for s in a],
        "highlight": [{"pts": [view(q) for q in s["pts"]], "r": s["r"]} for s in b],
        "connectors": connectors(hl),
        "full_connectors": len(connectors(full)),
        "full_id": full.h.findtext("Part_number"), "highlight_id": hl.h.findtext("Part_number"),
        "pieces": out_pieces,
    }
