// Keep the static publish directory empty so every request passes through the
// server's static whitelist and security headers, including on serverless hosts.
const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, '..', 'dist', 'cloud');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, '.gitkeep'), '');
console.log('Cloud entrypoints ready. Configure database, origin and secrets on your host.');
