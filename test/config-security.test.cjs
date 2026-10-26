const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../server/core.cjs');

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-config-security-'));
  const root = path.join(temporary, 'blog');
  const external = path.join(temporary, 'external');
  fs.mkdirSync(path.join(root, 'source', '_posts'), { recursive: true });
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(root, '_config.yml'), 'title: Blog\n');
  fs.writeFileSync(path.join(external, '_config.yml'), 'secret: untouched\n');
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return { root, external };
}

test('site config links are rejected at project validation, metadata and config access', t => {
  const { root, external } = fixture(t);
  fs.unlinkSync(path.join(root, '_config.yml'));
  fs.symlinkSync(path.join(external, '_config.yml'), path.join(root, '_config.yml'));
  for (const access of [() => core.validateProject(root), () => core.siteInfo(root), () => core.configPath(root, 'site')]) {
    assert.throws(access, /符号链接/);
  }
  assert.equal(fs.readFileSync(path.join(external, '_config.yml'), 'utf8'), 'secret: untouched\n');
});

test('theme configuration rejects symlinks in every path component', async t => {
  for (const component of ['themes', 'theme', 'file']) {
    await t.test(component, t => {
      const { root, external } = fixture(t);
      const themes = path.join(root, 'themes');
      if (component === 'themes') {
        fs.mkdirSync(path.join(external, 'demo'));
        fs.copyFileSync(path.join(external, '_config.yml'), path.join(external, 'demo', '_config.yml'));
        fs.symlinkSync(external, themes, 'dir');
      } else {
        fs.mkdirSync(themes);
        if (component === 'theme') fs.symlinkSync(external, path.join(themes, 'demo'), 'dir');
        else {
          fs.mkdirSync(path.join(themes, 'demo'));
          fs.symlinkSync(path.join(external, '_config.yml'), path.join(themes, 'demo', '_config.yml'));
        }
      }
      assert.throws(() => core.configPath(root, 'theme:demo'), /符号链接/);
      assert.deepEqual(core.listThemes(root), []);
    });
  }
});

test('regular config files remain editable; broken links and directories are rejected', t => {
  const { root, external } = fixture(t);
  fs.mkdirSync(path.join(root, 'themes', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'themes', 'demo', '_config.yml'), 'menu: {}\n');
  fs.writeFileSync(path.join(root, '_config.demo.yml'), 'override: true\n');
  for (const scope of ['site', 'theme:demo', 'override:_config.demo.yml']) {
    const target = core.configPath(root, scope);
    fs.appendFileSync(target, 'test: saved\n');
    assert.match(fs.readFileSync(target, 'utf8'), /test: saved/);
  }
  assert.deepEqual(core.listThemes(root), ['demo']);
  fs.symlinkSync(path.join(external, 'missing.yml'), path.join(root, '_config.broken.yml'));
  assert.throws(() => core.configPath(root, 'override:_config.broken.yml'), /符号链接/);
  fs.unlinkSync(path.join(root, '_config.yml'));
  fs.mkdirSync(path.join(root, '_config.yml'));
  assert.throws(() => core.configPath(root, 'site'), /配置文件/);
});


test('configuration listing exposes only editable files and reports byte sizes', t => {
  const {root,external}=fixture(t);
  fs.mkdirSync(path.join(root,'themes','demo'),{recursive:true});
  fs.writeFileSync(path.join(root,'themes','demo','_config.yml'),'menu: {}\n');
  fs.writeFileSync(path.join(root,'_config.demo.yml'),'title: 中文\n');
  fs.writeFileSync(path.join(root,'credentials.json'),'secret');
  fs.symlinkSync(path.join(external,'_config.yml'),path.join(root,'_config.link.yml'));
  const files=core.listConfigs(root);
  assert.deepEqual(files.map(x=>x.scope),['site','override:_config.demo.yml','theme:demo']);
  assert.deepEqual(files.map(x=>x.path),['_config.yml','_config.demo.yml','themes/demo/_config.yml']);
  assert.equal(files[1].bytes,Buffer.byteLength('title: 中文\n'));
  for(const file of files)assert.ok(core.configPath(root,file.scope));
});
