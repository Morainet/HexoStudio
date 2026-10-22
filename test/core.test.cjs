const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../server/core.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-test-'));
  fs.mkdirSync(path.join(root, 'source', '_posts'), { recursive: true });
  fs.writeFileSync(path.join(root, '_config.yml'), 'title: Test Blog\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('creates, lists, reads, edits and deletes Hexo posts', t => {
  const root = fixture(t);
  assert.equal(core.validateProject(root), fs.realpathSync(root));
  assert.deepEqual(core.siteInfo(root), { title: 'Test Blog', theme: '' });
  const created = core.createPost(root, 'Hello Hexo');
  assert.equal(created.path, 'hello-hexo.md');
  assert.equal(core.listPosts(root)[0].title, 'Hello Hexo');
  const original = core.readPost(root, created.path);
  const updated = core.savePost(root, created.path, original.content + '正文', original.modified);
  assert.match(updated.content, /正文/);
  const changedMeta = core.savePost(root, created.path, updated.content, updated.modified, { title: 'Updated', tags: ['Note'] });
  assert.equal(changedMeta.meta.title, 'Updated');
  assert.deepEqual(changedMeta.meta.tags, ['Note']);
  assert.throws(() => core.savePost(root, created.path, 'overwrite', 'old timestamp'), /其他程序修改/);
  core.deletePost(root, created.path);
  assert.equal(core.listPosts(root).length, 0);
});

test('rejects paths outside the posts directory and symbolic links', t => {
  const root = fixture(t);
  assert.throws(() => core.safePostPath(root, '../secret.md', true), /越界/);
  assert.throws(() => core.safePostPath(root, '/tmp/secret.md', true), /无效/);
  const external = path.join(root, 'external.md');
  fs.writeFileSync(external, 'private');
  fs.symlinkSync(external, path.join(root, 'source', '_posts', 'link.md'));
  assert.throws(() => core.readPost(root, 'link.md'), /符号链接/);
});

test('reads common multiline Hexo tag lists', () => {
  const post = core.parsePost('---\ntitle: Example\ntags:\n  - Hexo\n  - Writing\ncategories: [Notes]\n---\n\n正文', 'example.md');
  assert.deepEqual(post.tags, ['Hexo', 'Writing']);
  assert.deepEqual(post.categories, ['Notes']);
  assert.equal(post.excerpt, '正文');
});

test('creates, edits and publishes drafts without overwriting an existing post', t => {
  const root = fixture(t);
  core.createPost(root, 'Same Title');
  assert.deepEqual(core.listPosts(root, 'draft'), []);
  const created = core.createPost(root, 'Same Title', undefined, 'draft');
  assert.equal(created.kind, 'draft');
  assert.equal(core.listPosts(root, 'draft').length, 1);
  const original = core.readPost(root, created.path, 'draft');
  assert.equal(original.meta.date, '');
  const edited = core.savePost(root, created.path, original.content + '草稿正文', original.modified, { tags: ['Writing'] }, 'draft');
  assert.match(edited.content, /草稿正文/);
  assert.throws(() => core.publishDraft(root, created.path, 'old'), /其他程序修改/);
  const published = core.publishDraft(root, created.path, edited.modified, '2026-10-22 20:00:00');
  assert.equal(published.kind, 'post');
  assert.equal(published.path, 'same-title-2.md');
  assert.equal(published.meta.date, '2026-10-22 20:00:00');
  assert.deepEqual(published.meta.tags, ['Writing']);
  assert.equal(core.listPosts(root, 'draft').length, 0);
  assert.equal(core.listPosts(root).length, 2);
});

test('draft paths stay inside _drafts', t => {
  const root = fixture(t);
  core.createPost(root, 'Draft', undefined, 'draft');
  assert.throws(() => core.readPost(root, '../_posts/post.md', 'draft'), /越界/);
  assert.throws(() => core.listPosts(root, 'invalid'), /无效的文章类型/);
});
