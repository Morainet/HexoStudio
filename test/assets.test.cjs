const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveImage, readImage, listImages } = require('../server/assets.cjs');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-assets-'));
  fs.mkdirSync(path.join(root, 'source'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('uploads images with collision-safe names', t => {
  const root = fixture(t);
  const first = saveImage(root, 'cover.png', png);
  const second = saveImage(root, 'cover.png', png);
  assert.equal(first.url, '/images/hexostudio/cover.png');
  assert.equal(second.url, '/images/hexostudio/cover-2.png');
  assert.equal(readImage(root, first.name).mime, 'image/png');
  assert.deepEqual(listImages(root).map(item => item.name).sort(), ['cover-2.png', 'cover.png']);
});

test('rejects non-images and paths outside asset directory', t => {
  const root = fixture(t);
  assert.throws(() => saveImage(root, 'bad.png', Buffer.from('<script>').toString('base64')), /不匹配/);
  assert.throws(() => saveImage(root, 'bad.svg', png), /仅支持/);
  assert.throws(() => readImage(root, '../cover.png'), /路径无效/);
});
