'use strict';
const fs = require('fs');
const path = require('path');

function loadGeneratedDefaults() {
  const generatedPath = path.join(__dirname, 'gateway-config.generated.json');
  try {
    return JSON.parse(fs.readFileSync(generatedPath, 'utf8'));
  } catch {
    return {};
  }
}

function gatewayDefaults() {
  const generated = loadGeneratedDefaults();
  return {
    gatewayUrl: String(process.env.VAANI_GATEWAY_URL || generated.gatewayUrl || '').trim().replace(/\/+$/, ''),
    gatewayAccessKey: String(process.env.VAANI_GATEWAY_ACCESS_KEY || generated.gatewayAccessKey || '').trim()
  };
}

module.exports = { gatewayDefaults };
