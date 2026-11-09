import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelPress } from '../src/core/press.js';

// One frame of input for a hand: what the frame loop passes in.
const frame = (o) => ({ justPressed: false, pressed: false, nearBoard: false, panelFirst: false, ...o });

test('panel press: the hand that pressed a menu button can grab a wire afterwards', () => {
  let mark = false;
  mark = panelPress(mark, frame({ justPressed: true, pressed: true, panelFirst: true })); // presses Start
  assert.equal(mark, true);
  mark = panelPress(mark, frame({ pressed: true, panelFirst: true })); // still pressing
  assert.equal(mark, true);
  mark = panelPress(mark, frame({})); // lets go
  assert.equal(mark, false);
  mark = panelPress(mark, frame({ justPressed: true, pressed: true, nearBoard: true })); // pinches at the board
  assert.equal(mark, false);
});

test('panel press: a pinch at the board clears the mark even without a release in between', () => {
  // tracking can skip the release frame; the new press still decides afresh
  const mark = panelPress(true, frame({ justPressed: true, pressed: true, nearBoard: true }));
  assert.equal(mark, false);
});

test('panel press: a press at the board is never a panel press, even if a panel is behind it', () => {
  assert.equal(panelPress(false, frame({ justPressed: true, pressed: true, nearBoard: true, panelFirst: true })), false);
});
