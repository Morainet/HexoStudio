const { readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');
function checkDirectory(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory() && file !== join('public', 'vendor')) checkDirectory(file);
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}

for (const directory of ['bin', 'public', 'server', 'desktop', 'scripts', 'test', 'api', 'netlify']) checkDirectory(directory);
console.log('JavaScript syntax checks passed.');
