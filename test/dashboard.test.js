'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dashboard JavaScript only references IDs present in the HTML', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer', 'dashboard');
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const references = [...js.matchAll(/\$\('#([^']+)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(references.filter((id) => !ids.has(id)))];
  assert.deepEqual(missing, []);
});
