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

test('settings uses standalone routed category pages including appearance', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer', 'dashboard');
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  const categories = ['general', 'system', 'appearance', 'provider', 'account'];
  for (const category of categories) {
    assert.match(html, new RegExp(`data-settings-category="${category}"`));
    assert.match(html, new RegExp(`data-settings-page="${category}"`));
  }
  assert.match(js, /`\/settings\/\$\{category\}`/);
  assert.match(html, /id="set-windowTransparency"/);
  assert.match(html, /id="set-accentColor"/);
});

test('provider settings are form based and unbranded', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'dashboard', 'dashboard.html'), 'utf8');
  const provider = html.match(/<div class="settings-page" data-settings-page="provider"[\s\S]*?<div class="settings-page" data-settings-page="account"/i)?.[0] || '';
  assert.match(provider, /id="provider-base-url"/);
  assert.match(provider, /id="provider-api-key"/);
  assert.match(provider, /id="provider-whisper"/);
  assert.match(provider, /id="provider-llm"/);
  assert.doesNotMatch(provider, /Azure/i);
});

test('general settings support custom shortcuts and refreshing all microphones', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer', 'dashboard');
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  assert.match(html, /id="shortcut-record"/);
  assert.match(js, /custom:\$\{\[\.\.\.modifiers, event\.code\]\.join\('\+'\)\}/);
  assert.match(html, /id="mic-refresh"/);
  assert.match(js, /navigator\.mediaDevices\.addEventListener\('devicechange'/);
  assert.doesNotMatch(js, /deviceId !== 'default'/);
});

test('dashboard shows the stored shortcut and live recording state below the greeting', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer', 'dashboard');
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  assert.match(html, /id="greeting"[\s\S]*id="home-session"[\s\S]*id="home-shortcut"/);
  assert.match(js, /function syncHomeShortcut\(/);
  assert.match(js, /window\.vaani\.onSession\(updateHomeSession\)/);
  assert.match(js, /label\.textContent = homeSessionMode === 'handsfree' \? 'Recording hands-free' : 'Recording'/);
});

test('appearance color presets use CSP-safe classes and provider listens for file changes', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer', 'dashboard');
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  assert.match(html, /class="swatch-pearl"/);
  assert.doesNotMatch(html, /style="--swatch:/);
  assert.match(js, /onConfigChanged/);
  assert.doesNotMatch(html, /<div class="provider-meta">/);
});

test('settings shell inherits the app theme and uses full-range transparency', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer', 'dashboard');
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
  const settingsCss = css.match(/\/\* ---------------- settings shell ---------------- \*\/[\s\S]*?\/\* ---------------- legacy settings controls ---------------- \*\//)?.[0] || '';
  assert.match(html, /id="set-windowTransparency"[^>]*max="100"/);
  assert.match(css, /\.settings-main\s*\{[^}]*background:\s*var\(--bg\)/s);
  assert.match(css, /\.settings-sidebar\s*\{[^}]*background:\s*var\(--bg-raised\)/s);
  assert.match(css, /\.settings-card\s*\{[^}]*background:\s*var\(--bg-raised\)/s);
  assert.doesNotMatch(settingsCss, /#101112|#111214|#18191b/);
});

test('settings sidebar header contains only the Settings label', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'dashboard', 'dashboard.html'), 'utf8');
  const brand = html.match(/<div class="settings-brand">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(brand, /^\s*<strong>Settings<\/strong>\s*$/);
  assert.doesNotMatch(brand, /<svg|control room|microphone/i);
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
