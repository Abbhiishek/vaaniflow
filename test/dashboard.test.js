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

test('uses Vaani as the product name while retaining the vaaniflow repository identity', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'dashboard', 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'src', 'renderer', 'dashboard', 'dashboard.js'), 'utf8');
  const tray = fs.readFileSync(path.join(root, 'src', 'main', 'tray.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(html, /VaaniFlow|Vaani Flow/);
  assert.doesNotMatch(js, /VaaniFlow/);
  assert.doesNotMatch(tray, /VaaniFlow/);
  assert.equal(pkg.name, 'vaaniflow');
  assert.equal(pkg.productName, 'Vaani');
  assert.equal(pkg.build.productName, 'Vaani');
  assert.equal(pkg.build.win.icon, 'assets/vaani.png');
  assert.equal(fs.existsSync(path.join(root, 'assets', 'vaani.png')), true);
});
