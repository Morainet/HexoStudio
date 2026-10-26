const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaults, validateBranding, brandingRecord, brandingMutation } = require('../server/branding.cjs');
const { prepareOem } = require('../scripts/prepare-oem.cjs');

test('branding accepts bounded text and safe assets, rejects injection and unknown fields', () => {
  assert.equal(validateBranding({ name: '<script>alert(1)</script>' }).name, '<script>alert(1)</script>'); // Rendered as text, never HTML.
  for (const input of [{ name: '' }, { name: 'a'.repeat(49) }, { token: 'secret' }, { accentLight: 'red; background:url(x)' }, { helpUrl: 'javascript:alert(1)' }, { helpUrl: 'https://user:pass@example.com' }, { logo: 'file:///etc/passwd' }, { favicon: 'data:image/svg+xml;base64,PHN2Zz4=' }, { logo: 'data:image/png;base64,YmFk' }, { releaseRepository: 'owner/../../other' }, { releaseRepository: 'owner/..' }]) assert.throws(() => validateBranding(input));
  const png = fs.readFileSync(path.join(__dirname, '../public/favicon-32.png')).toString('base64');
  assert.ok(validateBranding({ logo: `data:image/png;base64,${png}`, helpUrl: 'https://example.com/help', releaseRepository: '' }));
  assert.throws(() => validateBranding({ logo: `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(256 * 1024)]).toString('base64')}` }));
});
test('saved overrides and reset respect deployment defaults, revisions reject stale writes', () => {
  const previous = process.env.HEXOSTUDIO_BRANDING;
  process.env.HEXOSTUDIO_BRANDING = JSON.stringify({ name: 'Deployment', releaseRepository: '' });
  try {
    const a = brandingRecord(); assert.equal(a.branding.name, 'Deployment');
    const saved = brandingMutation(undefined, { revision: a.revision, branding: { name: 'Saved' } });
    const b = brandingRecord(saved); assert.equal(b.branding.name, 'Saved'); assert.equal(b.branding.releaseRepository, '');
    assert.throws(() => brandingMutation(saved, { revision: a.revision, branding: {} }), { status: 409 });
    assert.equal(brandingRecord(brandingMutation(saved, { revision: b.revision }, true)).branding.name, 'Deployment');
    process.env.HEXOSTUDIO_BRANDING = '{"secret":"bad"}'; assert.throws(() => brandingRecord(), { status: 503 });
  } finally { if (previous === undefined) delete process.env.HEXOSTUDIO_BRANDING; else process.env.HEXOSTUDIO_BRANDING = previous; }
});
test('OEM packaging keeps entrypoint and build targets, includes brand resources and independent identity', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-oem-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'oem.json');
  fs.writeFileSync(file, JSON.stringify({ branding: { name: 'Acme Studio', releaseRepository: '' }, desktop: { appId: 'com.acme.studio' } }));
  const configPath = prepareOem(file, path.join(dir, 'output'));
  const config = JSON.parse(fs.readFileSync(configPath));
  assert.equal(config.appId, 'com.acme.studio'); assert.equal(config.extraMetadata.main, 'desktop/main.cjs');
  assert.equal(config.productName, 'Acme Studio'); assert.deepEqual(config.win.target, ['nsis', 'portable']);
  assert.ok(config.files.includes('server/**/*')); assert.ok(config.files.includes('public/**/*'));
  assert.equal(JSON.parse(fs.readFileSync(config.extraResources[0].from)).releaseRepository, '');
  const { getConfig } = require('app-builder-lib/out/util/config/config.js');
  const effective = await getConfig(path.resolve(__dirname, '..'), configPath);
  assert.equal(effective.extraMetadata.main, 'desktop/main.cjs'); assert.equal(effective.productName, 'Acme Studio');
  fs.writeFileSync(file, JSON.stringify({ branding: defaults, desktop: { appId: 'invalid' } }));
  assert.throws(() => prepareOem(file));
});
test('OEM update checks use the configured public repository or are disabled', async () => {
  const { createUpdateChecker, checkBrandUpdates } = require('../server/updates.cjs');
  assert.equal((await checkBrandUpdates({ releaseRepository: '' })).status, 'disabled');
  const check = createUpdateChecker({ repository: 'acme/studio', fetchImpl: async url => {
    assert.equal(url, 'https://api.github.com/repos/acme/studio/releases/latest');
    return { ok: true, json: async () => ({ tag_name: 'v99.0.0' }) };
  } });
  const result = await check(); assert.equal(result.releasesUrl, 'https://github.com/acme/studio/releases');
  assert.equal(result.releaseUrl, 'https://github.com/acme/studio/releases/tag/v99.0.0');
});
