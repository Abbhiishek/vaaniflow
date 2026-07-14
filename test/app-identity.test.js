'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRODUCT_NAME,
  PACKAGED_APP_USER_MODEL_ID,
  DEVELOPMENT_APP_USER_MODEL_ID,
  appUserModelId,
  shouldManageLoginItem
} = require('../src/main/app-identity');

test('uses the Vaani production identity only for packaged builds', () => {
  assert.equal(PRODUCT_NAME, 'Vaani');
  assert.equal(PACKAGED_APP_USER_MODEL_ID, 'com.vaani.flow');
  assert.equal(DEVELOPMENT_APP_USER_MODEL_ID, 'com.vaani.flow.dev');
  assert.equal(appUserModelId(true), PACKAGED_APP_USER_MODEL_ID);
  assert.equal(appUserModelId(false), DEVELOPMENT_APP_USER_MODEL_ID);
});

test('development and smoke runs never replace the installed login item', () => {
  assert.equal(shouldManageLoginItem(true, false), true);
  assert.equal(shouldManageLoginItem(false, false), false);
  assert.equal(shouldManageLoginItem(true, true), false);
});

test('desktop builds do not provision Vaani gateway credentials', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

  assert.equal(pkg.scripts.start, 'electron .');
  assert.equal(pkg.scripts.predist, undefined);
  assert.equal(pkg.scripts['gateway:config'], undefined);
  assert.doesNotMatch(workflow, /VAANI_GATEWAY_(?:URL|ACCESS_KEY)/);
});
