// Cavities on a connector face. KBL lists a housing's cavity numbers but not how they are arranged
// on the face (that is in the supplier's drawing), so the layout here is schematic: up to 4
// cavities in one row, more in two rows, numbered left to right, top row first. The same layout is
// used for the 1:1 housing on the board and the magnified face view, so both match.

export const CAVITY_PITCH_MM = 5; // 2.8 mm flat terminals sit about 5 mm apart

// Face millimetres, centred on the face, y up: { cavities: [{ n, x, y }], w, h }.
export function cavityLayout(numbers, pitch = CAVITY_PITCH_MM) {
  const rows = numbers.length > 4 ? 2 : 1;
  const perRow = Math.ceil(numbers.length / rows);
  const cavities = numbers.map((n, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const inRow = row === rows - 1 ? numbers.length - row * perRow : perRow;
    return { n: String(n), x: (col - (inRow - 1) / 2) * pitch, y: ((rows - 1) / 2 - row) * pitch };
  });
  return { cavities, w: (perRow + 1) * pitch, h: (rows + 1) * pitch };
}

// Where a wire is inserted: its target connector and cavity, or null when the connector has a single
// cavity (splices, ring terminals, spark-plug boots: no wrong cavity to choose).
export function insertTarget(harness, wire) {
  const node = harness.nodes.find((n) => n.id === wire.to_node);
  const numbers = node?.cavity_numbers ?? [];
  if (numbers.length < 2 || wire.to_cavity == null) return null;
  return { node: node.id, cavity: String(wire.to_cavity), numbers: numbers.map(String) };
}
