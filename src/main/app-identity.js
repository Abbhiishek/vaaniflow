'use strict';

const PRODUCT_NAME = 'Vaani';
const PACKAGED_APP_USER_MODEL_ID = 'com.vaani.flow';
const DEVELOPMENT_APP_USER_MODEL_ID = `${PACKAGED_APP_USER_MODEL_ID}.dev`;

function appUserModelId(isPackaged) {
  return isPackaged ? PACKAGED_APP_USER_MODEL_ID : DEVELOPMENT_APP_USER_MODEL_ID;
}

function shouldManageLoginItem(isPackaged, isSmoke) {
  return isPackaged && !isSmoke;
}

module.exports = {
  PRODUCT_NAME,
  PACKAGED_APP_USER_MODEL_ID,
  DEVELOPMENT_APP_USER_MODEL_ID,
  appUserModelId,
  shouldManageLoginItem
};
