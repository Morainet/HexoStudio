const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const git = require('../server/git.cjs');

function command(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }

test('validates provider, repository, branch, blog path and token without embedding credentials in URL', () => {
  const connection = git.remoteInput({ provider: 'github', repository: 'https://github.com/example/blog.git', branch: 'main', blogPath: 'site', token: 'private-token' });
  assert.equal(connection.url, 'https://github.com/example/blog.git');
  assert.equal(connection.blogPath, 'site');
  assert.ok(!connection.url.includes(connection.token));
  assert.equal(git.remoteInput({ provider: 'gitlab', repository: 'group/subgroup/blog', token: 'secret' }).url, 'https://gitlab.com/group/subgroup/blog.git');
  for (const input of [
    { repository: 'https://evil.example/blog' },
    { repository: 'https://name:token@github.com/example/blog' },
    { repository: '../blog' },
    { repository: 'example/blog', branch: '--upload-pack=evil' },
    { repository: 'example/blog', blogPath: '../outside' },
    { repository: 'example/blog', token: '' }
  ]) assert.throws(() => git.remoteInput({ provider: 'github', token: 'secret', ...input }));
  const env = git.gitEnv(connection);
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.ok(env.GIT_CONFIG_VALUE_0.startsWith('Authorization: Basic '));
  assert.ok(!env.GIT_CONFIG_VALUE_0.includes('private-token'));
  assert.equal(git.displayRemote('https://user:secret@github.com/example/blog.git?token=secret#x'), 'https://github.com/example/blog.git');
});

test('clones a Hexo subdirectory and completes stage, commit, push and fast-forward pull', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-git-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const bare = path.join(folder, 'remote.git');
  const seed = path.join(folder, 'seed');
  fs.mkdirSync(seed);
  command(folder, 'init', '--bare', bare);
  command(seed, 'init', '-b', 'main');
  command(seed, 'config', 'user.name', 'Test User');
  command(seed, 'config', 'user.email', 'test@example.invalid');
  fs.mkdirSync(path.join(seed, 'blog', 'source', '_posts'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'blog', '_config.yml'), 'title: Remote Test\n');
  fs.writeFileSync(path.join(seed, 'blog', 'source', '_posts', 'first.md'), '---\ntitle: First\n---\n');
  command(seed, 'add', '-A');
  command(seed, 'commit', '-m', 'Initial');
  command(seed, 'remote', 'add', 'origin', bare);
  command(seed, 'push', '-u', 'origin', 'main');
  command(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const settings = path.join(folder, 'settings.json');
  const connection = { provider: 'github', repository: 'example/blog', branch: 'main', blogPath: 'blog', token: '', url: bare, type: 'remote' };
  const { root, repoDir } = await git.connectRemote(settings, connection);
  connection.repoDir = repoDir;
  command(repoDir, 'config', 'user.name', 'Test User');
  command(repoDir, 'config', 'user.email', 'test@example.invalid');
  assert.equal(root, fs.realpathSync(path.join(repoDir, 'blog')));
  assert.equal((await git.status(root, connection)).branch, 'main');
  fs.appendFileSync(path.join(root, 'source', '_posts', 'first.md'), 'Working edit\n');
  let tracked = await git.status(root, connection);
  assert.equal(tracked.changes[0].path, 'blog/source/_posts/first.md');
  assert.equal(tracked.changes[0].staged, false);
  assert.equal(tracked.changes[0].unstaged, true);
  assert.match((await git.diff(root, tracked.changes[0].path, 'working')).content, /Working edit/);
  fs.writeFileSync(path.join(root, 'source', '_posts', 'first.md'), '---\ntitle: First\n---\n');
  fs.writeFileSync(path.join(root, 'source', '_posts', 'second.md'), '---\ntitle: Second\n---\n');
  let status = await git.status(root, connection);
  assert.equal(status.changes[0].path, 'blog/source/_posts/second.md');
  assert.match((await git.diff(root, status.changes[0].path, 'working')).content, /Second/);
  await assert.rejects(git.diff(root, '../../outside', 'working'), /文件变更已更新/);
  status = await git.stage(root, [status.changes[0].path]);
  assert.equal(status.changes[0].staged, true);
  assert.equal(status.changes[0].unstaged, false);
  assert.match((await git.diff(root, status.changes[0].path, 'staged')).content, /Second/);
  fs.appendFileSync(path.join(root, 'source', '_posts', 'second.md'), 'Edited after staging\n');
  status = await git.status(root, connection);
  assert.equal(status.changes[0].staged, true);
  assert.equal(status.changes[0].unstaged, true);
  assert.match((await git.diff(root, status.changes[0].path, 'working')).content, /Edited after staging/);
  status = await git.unstage(root, status.changes[0].path, connection);
  assert.equal(status.changes[0].staged, false);
  assert.equal(status.changes[0].unstaged, true);
  status = await git.stage(root, [status.changes[0].path], connection);
  status = await git.commit(root, 'Add second post');
  assert.equal(status.ahead, 1);
  await git.sync(root, connection, 'push');
  assert.equal(command(bare, 'rev-parse', 'refs/heads/main'), command(repoDir, 'rev-parse', 'HEAD'));
  command(seed, 'pull', '--ff-only');
  fs.writeFileSync(path.join(seed, 'blog', 'source', '_posts', 'third.md'), '---\ntitle: Third\n---\n');
  command(seed, 'add', '-A');
  command(seed, 'commit', '-m', 'Add third post');
  command(seed, 'push');
  status = await git.sync(root, connection, 'fetch');
  assert.equal(status.behind, 1);
  assert.equal(fs.existsSync(path.join(root, 'source', '_posts', 'third.md')), false);
  await git.sync(root, connection, 'pull');
  assert.ok(fs.existsSync(path.join(root, 'source', '_posts', 'third.md')));
  fs.writeFileSync(path.join(root, 'uncommitted.txt'), 'dirty');
  await assert.rejects(git.sync(root, connection, 'pull'), /未提交的变更/);
});

test('staging uses literal Git paths for filenames with pattern characters', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-literal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  command(root, 'init', '-b', 'main');
  fs.mkdirSync(path.join(root, 'source', '_posts'), { recursive: true });
  fs.writeFileSync(path.join(root, '_config.yml'), 'title: Literal Test\n');
  fs.writeFileSync(path.join(root, 'source', '_posts', '[post].md'), 'Bracket filename\n');
  fs.writeFileSync(path.join(root, 'source', '_posts', 'p.md'), 'Another filename\n');
  const result = await git.stage(root, ['source/_posts/[post].md']);
  assert.equal(result.changes.find(item => item.path === 'source/_posts/[post].md').staged, true);
  assert.equal(result.changes.find(item => item.path === 'source/_posts/p.md').staged, false);
  assert.match((await git.diff(root, 'source/_posts/[post].md', 'staged')).content, /Bracket filename/);
});
