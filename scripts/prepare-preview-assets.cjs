const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = {}, versions = {};
function copy(source, target, type) {
  const output = path.join(root, 'public', target);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(source, output); files[target] = type;
}
for (const name of ['mermaid', 'katex']) {
  const directory = path.dirname(require.resolve(`${name}/package.json`));
  versions[name] = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).version;
  copy(path.join(directory, 'LICENSE'), `vendor/${name}/LICENSE.txt`, 'text/plain');
  if (name === 'mermaid') copy(path.join(directory, 'dist/mermaid.min.js'), 'vendor/mermaid/mermaid.min.js', 'text/javascript');
  else {
    copy(path.join(directory, 'dist/katex.min.css'), 'vendor/katex/katex.min.css', 'text/css');
    for (const font of fs.readdirSync(path.join(directory, 'dist/fonts'))) {
      const extension = path.extname(font);
      const type = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' }[extension];
      if (type) copy(path.join(directory, 'dist/fonts', font), `vendor/katex/fonts/${font}`, type);
    }
  }
}
fs.writeFileSync(path.join(root, 'public/preview-assets.json'), JSON.stringify({ versions, files }, null, 2) + '\n');
console.log('Offline preview assets prepared:', versions);
