// Whether a pointer's current press belongs to a panel button. A press that starts on the panel
// must not also grab a wire, but the mark lasts for that one press only: it is cleared when the
// press ends, and a new press decides afresh. (A mark that outlived its press once blocked the hand
// that had pressed a menu button from ever picking up a wire again.)
export function panelPress(prev, { justPressed, pressed, nearBoard, panelFirst }) {
  if (justPressed) return !nearBoard && panelFirst;
  if (!pressed) return false;
  return prev;
}
