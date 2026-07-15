'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const executable = process.platform === 'win32'
  ? path.join(__dirname, '..', 'dist', 'win-unpacked', 'Vaani.exe')
  : null;

if (!executable || !fs.existsSync(executable)) {
  console.error('Packaged smoke test requires dist/win-unpacked/Vaani.exe');
  process.exit(1);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaani-packaged-smoke-'));
const result = spawnSync(executable, [`--user-data-dir=${userDataDir}`, '--smoke'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000
});
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(`Packaged smoke test failed to run: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0 || !String(result.stdout || '').includes('SMOKE_OK')) {
  console.error('Packaged smoke test did not report SMOKE_OK.');
  process.exit(result.status || 1);
}
