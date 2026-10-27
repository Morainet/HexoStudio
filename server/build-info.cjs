const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');
const assets = ['index.html', 'app.js', 'style.css', 'i18n.js', 'preferences.js', 'branding.js', 'mobile.js', 'ai.js', 'article-fields.js'];
let cached;

function buildInfo() {
  if (!cached) {
    const directory = process.env.HEXOSTUDIO_PUBLIC_DIR || path.join(__dirname, '../public');
    const hash = createHash('sha256').update(version);
    for (const name of assets) hash.update(name).update(fs.readFileSync(path.join(directory, name)));
    cached = Object.freeze({ version, buildId: hash.digest('hex') });
  }
  return cached;
}

module.exports = { buildInfo };
