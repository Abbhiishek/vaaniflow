'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const mode = process.argv[2] || 'source';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifySource() {
  const expectedTag = `v${pkg.version}`;
  const tag = process.env.GITHUB_REF_NAME || '';
  if (tag) assert(tag === expectedTag, `Git tag ${tag} must match package version ${expectedTag}`);

  assert(lock.version === pkg.version, 'package-lock.json version must match package.json');
  assert(lock.packages?.['']?.version === pkg.version, 'package-lock root package version must match package.json');
  assert(pkg.build?.appId === 'com.vaani.flow', 'Windows appId must remain stable for in-place updates');
  assert(pkg.build?.nsis?.guid === '8429a095-bee6-5aa8-8eb3-4fefd8b092a1', 'NSIS GUID must remain stable for in-place updates');
  assert(pkg.build?.artifactName === 'Vaani-Setup-${version}.${ext}', 'Release artifact naming must remain updater-safe');
  assert(pkg.build?.publish?.provider === 'github', 'Updater publish provider must remain GitHub');
  assert(pkg.build?.publish?.owner === 'Abbhiishek' && pkg.build?.publish?.repo === 'vaaniflow', 'GitHub release repository is misconfigured');
  assert(pkg.scripts?.dist?.includes('--publish never'), 'The build command must not publish outside the controlled release step');

  const iconPath = path.join(root, pkg.build?.win?.icon || '');
  assert(fs.existsSync(iconPath), `Windows icon is missing: ${iconPath}`);
  const icon = fs.readFileSync(iconPath);
  assert(icon.length >= 24 && icon.toString('hex', 0, 8) === '89504e470d0a1a0a', 'Windows icon source must be a PNG');
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  assert(width === height && width >= 256, `Windows icon must be square and at least 256px (found ${width}x${height})`);

  console.log(`Release source verified for ${expectedTag}`);
}

function verifyArtifacts() {
  const dist = path.join(root, 'dist');
  const installerName = `Vaani-Setup-${pkg.version}.exe`;
  const required = [installerName, `${installerName}.blockmap`, 'latest.yml'];
  for (const name of required) assert(fs.existsSync(path.join(dist, name)), `Missing release artifact: dist/${name}`);

  const latest = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
  const escapedVersion = pkg.version.replace(/\./g, '\\.');
  assert(new RegExp(`^version:\\s*${escapedVersion}$`, 'm').test(latest), 'latest.yml version does not match package.json');
  assert(latest.includes(`url: ${installerName}`), `latest.yml must reference ${installerName}`);
  assert(latest.includes(`path: ${installerName}`), `latest.yml path must reference ${installerName}`);

  console.log(`Release artifacts verified for v${pkg.version}`);
}

try {
  if (mode === 'source') verifySource();
  else if (mode === 'artifacts') verifyArtifacts();
  else throw new Error(`Unknown verification mode: ${mode}`);
} catch (err) {
  console.error(`Release verification failed: ${err.message}`);
  process.exitCode = 1;
}
