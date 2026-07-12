'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  OVERLAY_POSITIONS,
  nearestOverlayPosition,
  normalizeOverlayPosition,
  overlayTargetPoints,
  overlayWindowBounds
} = require('../src/main/overlay-position');

test('positions the overlay at all eight screen snap points', () => {
  const workArea = { x: 100, y: 50, width: 1000, height: 800 };
  const size = { width: 420, height: 170 };
  assert.deepEqual(overlayWindowBounds(workArea, size, 'top-left'), { x: 104, y: 54, width: 420, height: 170 });
  assert.deepEqual(overlayWindowBounds(workArea, size, 'top-center'), { x: 390, y: 54, width: 420, height: 170 });
  assert.deepEqual(overlayWindowBounds(workArea, size, 'top-right'), { x: 676, y: 54, width: 420, height: 170 });
  assert.deepEqual(overlayWindowBounds(workArea, size, 'left-center'), { x: 104, y: 365, width: 420, height: 170 });
  assert.deepEqual(overlayWindowBounds(workArea, size, 'right-center'), { x: 676, y: 365, width: 420, height: 170 });
  assert.deepEqual(overlayWindowBounds(workArea, size, 'bottom-left'), { x: 104, y: 676, width: 420, height: 170 });
  assert.deepEqual(overlayWindowBounds(workArea, size, 'bottom-center'), { x: 390, y: 676, width: 420, height: 170 });
  assert.deepEqual(overlayWindowBounds(workArea, size, 'bottom-right'), { x: 676, y: 676, width: 420, height: 170 });
});

test('chooses the closest predefined target and rejects unknown positions', () => {
  const workArea = { x: -1920, y: 0, width: 1920, height: 1080 };
  const targets = overlayTargetPoints(workArea);
  for (const position of OVERLAY_POSITIONS) {
    assert.equal(nearestOverlayPosition(workArea, targets[position]), position);
  }
  assert.equal(normalizeOverlayPosition('somewhere-else'), 'bottom-center');
});

test('overlay UI uses the app accent and exposes all drag targets', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer');
  const overlayJs = fs.readFileSync(path.join(root, 'overlay', 'overlay.js'), 'utf8');
  const guideHtml = fs.readFileSync(path.join(root, 'overlay-guide', 'guide.html'), 'utf8');
  const positions = [...guideHtml.matchAll(/data-position="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(positions.sort(), [...OVERLAY_POSITIONS].sort());
  assert.match(overlayJs, /result\.settings\.accentColor/);
  assert.match(overlayJs, /rgba\(\$\{waveRgb\.r\}, \$\{waveRgb\.g\}, \$\{waveRgb\.b\}/);
  assert.match(overlayJs, /beginOverlayDrag/);
  assert.match(overlayJs, /endOverlayDrag/);
});
