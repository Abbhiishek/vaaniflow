'use strict';
const fs = require('node:fs');
const path = require('node:path');

const gatewayUrl = String(process.env.VAANI_GATEWAY_URL || '').trim().replace(/\/+$/, '');
const gatewayAccessKey = String(process.env.VAANI_GATEWAY_ACCESS_KEY || '').trim();
if (!gatewayUrl || !gatewayAccessKey) {
  throw new Error('VAANI_GATEWAY_URL and VAANI_GATEWAY_ACCESS_KEY are required to package the built-in provider.');
}

const target = path.join(__dirname, '..', 'src', 'main', 'gateway-config.generated.json');
fs.writeFileSync(target, JSON.stringify({ gatewayUrl, gatewayAccessKey }, null, 2) + '\n', { mode: 0o600 });
console.log(`Generated ${target}`);
