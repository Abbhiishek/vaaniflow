'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const varsPath = path.join(root, 'server', '.dev.vars');

if (!fs.existsSync(varsPath)) {
  throw new Error(`Missing ${varsPath}. Create it from server/.dev.vars.example first.`);
}

const values = {};
for (const line of fs.readFileSync(varsPath, 'utf8').split(/\r?\n/)) {
  if (!line || line.trimStart().startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator <= 0) continue;
  values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
}

if (!values.DESKTOP_HMAC_SECRET) {
  throw new Error('DESKTOP_HMAC_SECRET is missing or empty in server/.dev.vars.');
}

const electronPath = require('electron');
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    VAANI_GATEWAY_URL: 'https://vanni-server.kabootr.com',
    VAANI_GATEWAY_ACCESS_KEY: values.DESKTOP_HMAC_SECRET
  }
});

child.on('error', (error) => {
  console.error(`Could not start Vaani: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
