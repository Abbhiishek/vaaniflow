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
