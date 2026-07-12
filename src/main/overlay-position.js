'use strict';

const DEFAULT_OVERLAY_POSITION = 'bottom-center';
const OVERLAY_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right'
];

const POSITION_PARTS = {
  'top-left': { horizontal: 'left', vertical: 'top' },
  'top-center': { horizontal: 'center', vertical: 'top' },
  'top-right': { horizontal: 'right', vertical: 'top' },
  'left-center': { horizontal: 'left', vertical: 'center' },
  'right-center': { horizontal: 'right', vertical: 'center' },
  'bottom-left': { horizontal: 'left', vertical: 'bottom' },
  'bottom-center': { horizontal: 'center', vertical: 'bottom' },
  'bottom-right': { horizontal: 'right', vertical: 'bottom' }
};

function normalizeOverlayPosition(value) {
  return OVERLAY_POSITIONS.includes(value) ? value : DEFAULT_OVERLAY_POSITION;
}

function overlayWindowBounds(workArea, size, value, gap = 4) {
  const position = normalizeOverlayPosition(value);
  const { horizontal, vertical } = POSITION_PARTS[position];
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const left = workArea.x + Math.min(gap, Math.max(0, workArea.width - width));
  const right = workArea.x + workArea.width - width - Math.min(gap, Math.max(0, workArea.width - width));
  const top = workArea.y + Math.min(gap, Math.max(0, workArea.height - height));
  const bottom = workArea.y + workArea.height - height - Math.min(gap, Math.max(0, workArea.height - height));

  const x = horizontal === 'left'
    ? left
    : horizontal === 'right'
      ? right
      : workArea.x + (workArea.width - width) / 2;
  const y = vertical === 'top'
    ? top
    : vertical === 'bottom'
      ? bottom
      : workArea.y + (workArea.height - height) / 2;

  return { x: Math.round(x), y: Math.round(y), width, height };
}

function overlayTargetPoints(workArea, edgeInset = 34) {
  const x = {
    left: workArea.x + edgeInset,
    center: workArea.x + workArea.width / 2,
    right: workArea.x + workArea.width - edgeInset
  };
  const y = {
    top: workArea.y + edgeInset,
    center: workArea.y + workArea.height / 2,
    bottom: workArea.y + workArea.height - edgeInset
  };

  return Object.fromEntries(OVERLAY_POSITIONS.map((position) => {
    const parts = POSITION_PARTS[position];
    return [position, { x: x[parts.horizontal], y: y[parts.vertical] }];
  }));
}

function nearestOverlayPosition(workArea, point) {
  const targets = overlayTargetPoints(workArea);
  const scaleX = Math.max(1, workArea.width);
  const scaleY = Math.max(1, workArea.height);
  let nearest = DEFAULT_OVERLAY_POSITION;
  let nearestDistance = Infinity;

  for (const position of OVERLAY_POSITIONS) {
    const target = targets[position];
    const dx = (point.x - target.x) / scaleX;
    const dy = (point.y - target.y) / scaleY;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = position;
      nearestDistance = distance;
    }
  }
  return nearest;
}

module.exports = {
  DEFAULT_OVERLAY_POSITION,
  OVERLAY_POSITIONS,
  nearestOverlayPosition,
  normalizeOverlayPosition,
  overlayTargetPoints,
  overlayWindowBounds
};
