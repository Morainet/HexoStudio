const fs = require('node:fs');
const path = require('node:path');

const MAX_IMAGE_BYTES = 8_000_000;
const types = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp'
};

function imageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function imageDirectory(root) {
  const source = path.join(root, 'source');
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error('资源目录不能是符号链接');
  const images = path.join(source, 'images');
  const studio = path.join(images, 'hexostudio');
  for (const dir of [images, studio]) {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('资源目录不能是符号链接');
  }
  return studio;
}

function safeImageName(name) {
  if (typeof name !== 'string') throw new Error('图片文件名无效');
  const base = path.basename(name);
  const ext = path.extname(base).toLowerCase();
  if (!types[ext]) throw new Error('仅支持 PNG、JPEG、GIF 和 WebP 图片');
  const stem = base.slice(0, -ext.length).normalize('NFKC').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'image';
  return { stem, ext, mime: types[ext] };
}

function saveImage(root, name, encoded) {
  const { stem, ext, mime } = safeImageName(name);
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('图片数据无效或超过 8 MB');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES || imageType(buffer) !== mime) throw new Error('图片格式与扩展名不匹配');
  const dir = imageDirectory(root);
  fs.mkdirSync(dir, { recursive: true });
  let file = `${stem}${ext}`;
  let index = 2;
  while (fs.existsSync(path.join(dir, file))) file = `${stem}-${index++}${ext}`;
  fs.writeFileSync(path.join(dir, file), buffer, { flag: 'wx' });
  return { name: file, url: `/images/hexostudio/${encodeURIComponent(file)}`, bytes: buffer.length };
}

function readImage(root, name) {
  const { ext } = safeImageName(name);
  if (name.includes('/') || name.includes('\\') || name !== path.basename(name)) throw new Error('图片路径无效');
  const file = path.join(imageDirectory(root), name);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) throw Object.assign(new Error('图片不存在'), { status: 404 });
  return { file, mime: types[ext] };
}

function listImages(root) {
  const dir = imageDirectory(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && types[path.extname(entry.name).toLowerCase()])
    .map(entry => {
      const stat = fs.statSync(path.join(dir, entry.name));
      return { name: entry.name, url: `/images/hexostudio/${encodeURIComponent(entry.name)}`, bytes: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

module.exports = { saveImage, readImage, listImages, imageType };
