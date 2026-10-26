const fs = require('node:fs');
const path = require('node:path');
const { defaults, validateBranding } = require('../server/branding.cjs');
function prepareOem(file, output = path.resolve(__dirname, '../dist/oem')) {
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const branding = { ...defaults, ...validateBranding(input.branding) };
  const desktop = input.desktop || {};
  const productName = desktop.productName || branding.name;
  if (!/^[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*){2,}$/.test(desktop.appId || '')) throw new Error('desktop.appId must be a unique reverse-DNS identifier.');
  if (typeof productName !== 'string' || !productName.trim() || productName.length > 48 || /[\\/:*?"<>|\x00-\x1f]/.test(productName)) throw new Error('Invalid desktop.productName.');
  const base = structuredClone(require('../package.json').build);
  const config = { ...base, appId: desktop.appId, productName, extraMetadata: { ...base.extraMetadata, productName }, directories: { output: 'dist/oem-build' }, extraResources: [{ from: path.join(output, 'oem-branding.json'), to: 'oem-branding.json' }] };
  if (desktop.icons) {
    const icons = {};
    for (const [key, extension] of [['mac','.icns'],['win','.ico'],['png','.png']]) {
      if (typeof desktop.icons[key] !== 'string') throw new Error('Provide all three desktop.icons: mac, win, png.');
      const icon = path.resolve(path.dirname(file), desktop.icons[key]);
      if (path.extname(icon).toLowerCase() !== extension || !fs.statSync(icon).isFile()) throw new Error(`Invalid ${key} icon.`);
      icons[key] = icon;
    }
    config.mac = { ...base.mac, icon: icons.mac }; config.win = { ...base.win, icon: icons.win };
    config.nsis = { ...base.nsis, installerIcon: icons.win, uninstallerIcon: icons.win };
    config.extraResources.push({ from: icons.png, to: 'oem-icon.png' });
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'oem-branding.json'), JSON.stringify(branding, null, 2));
  const configPath = path.join(output, 'electron-builder.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}
if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error('Usage: npm run oem:prepare -- ./oem.json');
    console.log(`OEM build config: ${prepareOem(path.resolve(process.argv[2]))}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareOem };
