// Generates app + tray icons programmatically (no image deps).
// Writes assets/icon.png (256x256) and assets/tray.png (32x32).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Signed-distance helpers (return coverage 0..1 with ~1px feather)
function roundRectCov(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  const d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - r;
  return clamp01(0.5 - d);
}

function ringCov(x, y, cx, cy, rInner, rOuter) {
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return clamp01(0.5 - (rInner - d)) * clamp01(0.5 - (d - rOuter));
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 256; // design coordinates are in 256-space
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px / s;
      const y = py / s;
      let r = 0, g = 0, b = 0, a = 0;

      // Rounded-square badge, quiet charcoal gradient (#2a2b2f -> #17181a)
      const badge = roundRectCov(x, y, 128, 128, 128, 128, 58);
      if (badge > 0) {
        const t = y / 256;
        r = Math.round(0x2a + (0x17 - 0x2a) * t);
        g = Math.round(0x2b + (0x18 - 0x2b) * t);
        b = Math.round(0x2f + (0x1a - 0x2f) * t);
        a = Math.round(255 * badge);
      }

      // White microphone glyph
      let glyph = 0;
      glyph = Math.max(glyph, roundRectCov(x, y, 128, 100, 24, 44, 24)); // capsule
      // stand: lower half of a ring around (128,124)
      if (y >= 124) glyph = Math.max(glyph, ringCov(x, y, 128, 124, 40, 50));
      glyph = Math.max(glyph, roundRectCov(x, y, 128, 186, 5, 14, 5)); // stem
      glyph = Math.max(glyph, roundRectCov(x, y, 128, 202, 28, 6, 6)); // base

      if (glyph > 0 && badge > 0) {
        const ga = glyph;
        r = Math.round(r * (1 - ga) + 255 * ga);
        g = Math.round(g * (1 - ga) + 255 * ga);
        b = Math.round(b * (1 - ga) + 255 * ga);
      }

      const i = (py * size + px) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return encodePNG(size, size, rgba);
}

try {
  const assets = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'icon.png'), drawIcon(256));
  fs.writeFileSync(path.join(assets, 'tray.png'), drawIcon(32));
  console.log('icons written to assets/');
} catch (err) {
  console.error('icon generation failed (non-fatal):', err.message);
}
