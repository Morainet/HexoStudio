const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('./core.cjs');
const { normalizeStorage } = require('./auth-store.cjs');
const { version } = require('../package.json');

function readSettings(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('Settings path must point to a file.');
    if (stat.size > 1_000_000) throw new Error('Settings file exceeds 1 MB.');
    let settings;
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error('Settings file is not valid JSON. Restore a backup or use --settings with another file.');
      throw error;
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Settings file must contain a JSON object.');
    return { exists: true, settings };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, settings: {} };
    if (error.code) throw new Error('Cannot read settings file. Check its path and permissions.');
    throw error;
  }
}

function diagnose(options, runGit = () => spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true })) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  add('node', 'pass', `Node.js ${process.versions.node}`);
  const git = runGit();
  // Do not print subprocess output; user configuration must not leak into reports.
  add('git', git.status === 0 ? 'pass' : 'warn', git.status === 0 ? 'Git is available.' : 'Git is unavailable. Install Git to use remote repositories.');
  let loaded;
  try {
    loaded = readSettings(options.settings);
    add('settings', loaded.exists ? 'pass' : 'warn', loaded.exists ? 'Settings file is readable and valid JSON.' : 'No settings file yet. Start hs and complete setup in the browser.');
  } catch (error) { add('settings', 'fail', error.message); }
  if (loaded) {
    if (!loaded.settings.authStorage) add('database', 'warn', 'No database configuration. Complete setup in the browser.');
    else {
      try {
        const storage = normalizeStorage(loaded.settings.authStorage);
        add('database', ['postgres', 'mysql', 'mongodb'].includes(storage.type) ? 'pass' : 'warn',
          ['postgres', 'mysql', 'mongodb'].includes(storage.type) ? 'Database configuration format is valid; connectivity was not tested.' : 'Legacy account storage detected. Migrate it in account settings.');
      } catch { add('database', 'fail', 'Invalid database configuration. Check the storage type and connection format.'); }
    }
  }
  const root = options.root || loaded?.settings.root;
  if (!root) add('project', 'warn', 'No blog selected. Connect one in the browser or use --root.');
  else {
    try {
      core.validateProject(root);
      for (const directory of [path.join(root, 'source'), path.join(root, 'source', '_posts')]) {
        if (!fs.lstatSync(directory).isDirectory()) throw new Error('Invalid content directory');
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.X_OK);
      }
      add('project', 'pass', 'Hexo source directory is valid and the posts directory is accessible.');
      const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'hexo.cmd' : 'hexo');
      add('hexo', fs.existsSync(bin) ? 'pass' : 'warn', fs.existsSync(bin) ? 'Local Hexo command is installed.' : 'Hexo dependencies are missing. Install them in the blog directory before building.');
    } catch { add('project', 'fail', 'Cannot read the Hexo project. Check _config.yml, source/_posts, permissions and symbolic links.'); }
  }
  return { version, ok: !checks.some(check => check.status === 'fail'), checks };
}

module.exports = { readSettings, diagnose };
