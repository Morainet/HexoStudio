// Convert the existing logo into platform icon containers (macOS tools required).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'docs/brand/hexostudio-icon-black.png');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-icons-'));
const desktop = path.join(root, 'desktop/icons');
const web = path.join(root, 'public');
function png(size, destination) {
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', destination], { stdio: 'pipe' });
}
function ico(sizes, destination) {
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  const images = sizes.map((size, index) => {
    const file = path.join(temporary, `${size}.png`);
    png(size, file);
    const data = fs.readFileSync(file), entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
    return data;
  });
  fs.writeFileSync(destination, Buffer.concat([header, ...images]));
}
try {
  fs.mkdirSync(desktop, { recursive: true });
  png(32, path.join(web, 'favicon-32.png'));
  png(192, path.join(web, 'icon-192.png'));
  png(180, path.join(web, 'apple-touch-icon.png'));
  const embedded = fs.readFileSync(path.join(web, 'icon-192.png')).toString('base64');
  fs.writeFileSync(path.join(web, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><style>@media(prefers-color-scheme:dark){image{filter:brightness(0) invert(1)}}</style><image width="192" height="192" href="data:image/png;base64,${embedded}"/></svg>\n`);
  png(1024, path.join(desktop, 'icon.png'));
  ico([16, 32, 48], path.join(web, 'favicon.ico'));
  ico([16, 24, 32, 48, 64, 128, 256], path.join(desktop, 'icon.ico'));
  const iconset = path.join(temporary, 'icon.iconset');
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    png(size, path.join(iconset, `icon_${size}x${size}.png`));
    png(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(desktop, 'icon.icns')]);
  console.log('Website, macOS and Windows icons generated from the existing logo.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
