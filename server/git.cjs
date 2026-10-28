const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const core = require('./core.cjs');

function remoteInput(data) {
  const provider = data.provider;
  if (!['github', 'gitlab'].includes(provider)) throw new Error('请选择 GitHub 或 GitLab');
  const host = provider === 'github' ? 'github.com' : 'gitlab.com';
  let repo = String(data.repository || '').trim().replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  if (repo.startsWith('https://')) {
    const url = new URL(repo);
    if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash) throw new Error('仓库地址必须是所选服务商的 HTTPS 地址');
    repo = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  }
  const segments = repo.split('/');
  if (segments.length < 2 || (provider === 'github' && segments.length !== 2) || segments.some(segment => !/^[\w.-]+$/.test(segment) || segment === '.' || segment === '..' || segment.endsWith('.lock'))) throw new Error('仓库格式应为 username/repo');
  const branch = String(data.branch || '').trim();
  if (branch && (!/^[\w./-]+$/.test(branch) || branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.includes('..') || branch.includes('//') || branch.split('/').some(item => item.startsWith('.') || item.endsWith('.lock')))) throw new Error('项目分支格式无效');
  const blogPath = String(data.blogPath || '').trim().replace(/^\.\/$/, '');
  const parts = blogPath ? blogPath.split('/') : [];
  if (parts.some(item => !item || item === '.' || item === '..') || blogPath.includes('\\') || blogPath.startsWith('/') || blogPath.includes('\0')) throw new Error('博客路径必须是仓库内的相对目录');
  const token = String(data.token || '').trim();
  if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('请填写有效的访问 Token');
  return { provider, repository: repo, branch, blogPath, token, url: `https://${host}/${repo}.git` };
}

function gitEnv(connection) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const pairs = [];
  if (connection?.token) {
    const host = connection.provider === 'github' ? 'github.com' : 'gitlab.com';
    const username = connection.provider === 'github' ? 'x-access-token' : 'oauth2';
    const auth = Buffer.from(`${username}:${connection.token}`).toString('base64');
    pairs.push([`http.https://${host}/.extraheader`, `Authorization: Basic ${auth}`], ['credential.helper', '']);
  }
  pairs.push(...require('./network.cjs').gitSettings(env));
  if (pairs.length) {
    env.GIT_CONFIG_COUNT = String(pairs.length);
    pairs.forEach(([key, value], index) => { env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = value; });
  }
  return env;
}

function runGit(cwd, args, connection, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const env = gitEnv(connection);
    const child = spawn('git', args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Git 操作超时')); }, timeout);
    child.stdout.on('data', data => { output += data; if (output.length > 2_000_000) child.kill(); });
    child.stderr.on('data', data => { error += data; if (error.length > 2_000_000) child.kill(); });
    child.on('error', err => { clearTimeout(timer); reject(new Error(err.code === 'ENOENT' ? '未找到 Git，请先安装 Git' : err.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(args.includes('-z') ? output : output.trim());
      else {
        let message = (error || output || `Git 退出码 ${code}`).trim().slice(0, 1200);
        for (const secret of [connection?.token, env.GIT_CONFIG_VALUE_0?.replace(/^Authorization: Basic /, '')]) {
          if (secret) message = message.replaceAll(secret, '[已隐藏]');
        }
        for (let index = 0; index < Number(env.GIT_CONFIG_COUNT || 0); index++) {
          if (!env[`GIT_CONFIG_KEY_${index}`]?.endsWith('.proxy')) continue;
          const value = env[`GIT_CONFIG_VALUE_${index}`];
          if (!value) continue;
          message = message.replaceAll(value, '[已隐藏代理]');
          try {
            const proxy = new URL(value);
            for (const secret of [proxy.username, proxy.password, decodeURIComponent(proxy.username), decodeURIComponent(proxy.password)]) if (secret) message = message.replaceAll(secret, '[已隐藏]');
          } catch { /* Proxy configuration was validated before spawning Git. */ }
        }
        reject(new Error(message));
      }
    });
  });
}

function repositoryDirectory(settingsFile, connection) {
  const id = crypto.createHash('sha256').update(`${connection.url}\n${connection.branch}`).digest('hex').slice(0, 16);
  return path.join(path.dirname(settingsFile), '.hexostudio', 'repositories', id);
}

async function connectRemote(settingsFile, connection) {
  const repoDir = repositoryDirectory(settingsFile, connection);
  const parent = path.dirname(repoDir);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(repoDir)) {
    const temporary = fs.mkdtempSync(path.join(parent, '.clone-'));
    try {
      const args = ['clone', '--', connection.url, temporary];
      if (connection.branch) args.splice(1, 0, '--branch', connection.branch);
      await runGit(parent, args, connection, 300000);
      const candidate = path.resolve(temporary, connection.blogPath || '.');
      const root = core.validateProject(candidate);
      if (root !== fs.realpathSync(temporary) && !root.startsWith(fs.realpathSync(temporary) + path.sep)) throw new Error('博客路径超出仓库目录');
      fs.renameSync(temporary, repoDir);
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  const current = await runGit(repoDir, ['remote', 'get-url', 'origin']);
  if (current !== connection.url) throw new Error('本机缓存目录对应的远端仓库不一致');
  const root = core.validateProject(path.join(repoDir, connection.blogPath || '.'));
  if (root !== fs.realpathSync(repoDir) && !root.startsWith(fs.realpathSync(repoDir) + path.sep)) throw new Error('博客路径超出仓库目录');
  return { root, repoDir: fs.realpathSync(repoDir) };
}

async function repositoryRoot(root) {
  try { return await runGit(root, ['rev-parse', '--show-toplevel'], null, 10000); }
  catch { return null; }
}

function parseStatus(raw) {
  const parts = raw.split('\0');
  const changes = [];
  for (let i = 0; i < parts.length && parts[i]; i++) {
    const item = parts[i];
    const index = item.slice(0, 2);
    const file = item.slice(3);
    if (index.includes('R') || index.includes('C')) i++;
    changes.push({ path: file, index, staged: index[0] !== ' ' && index[0] !== '?', unstaged: index[1] !== ' ' });
  }
  return changes;
}

function literalPath(file) { return `:(literal)${file}`; }

function displayRemote(remote) {
  try {
    const url = new URL(remote);
    if (!['http:', 'https:', 'ssh:'].includes(url.protocol)) return remote;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return remote; }
}

async function status(root, connection) {
  const repoDir = await repositoryRoot(root);
  if (!repoDir) return { isRepository: false };
  const [branch, raw, remote] = await Promise.all([
    runGit(repoDir, ['branch', '--show-current']),
    runGit(repoDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    runGit(repoDir, ['remote', 'get-url', 'origin']).catch(() => '')
  ]);
  let ahead = 0; let behind = 0;
  try {
    const counts = await runGit(repoDir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    [ahead, behind] = counts.split(/\s+/).map(Number);
  } catch { /* branch has no upstream */ }
  return { isRepository: true, branch, changes: parseStatus(raw), ahead, behind, remote: displayRemote(remote), managed: Boolean(connection?.type === 'remote') };
}

async function stage(root, paths, connection) {
  const repoDir = await repositoryRoot(root);
  if (!repoDir) throw new Error('当前项目不在 Git 仓库中');
  const current = parseStatus(await runGit(repoDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  const available = new Set(current.filter(item => item.unstaged).map(item => item.path));
  if (!Array.isArray(paths) || !paths.length || paths.length > 1000 || paths.some(item => typeof item !== 'string' || !available.has(item))) throw new Error('请选择有效的变更文件');
  await runGit(repoDir, ['add', '-A', '--', ...paths.map(literalPath)]);
  return status(root, connection);
}

async function unstage(root, file, connection) {
  const repoDir = await repositoryRoot(root);
  if (!repoDir) throw new Error('当前项目不在 Git 仓库中');
  const current = parseStatus(await runGit(repoDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  if (typeof file !== 'string' || !current.some(item => item.path === file && item.staged)) throw new Error('请选择已暂存的文件');
  await runGit(repoDir, ['restore', '--staged', '--', literalPath(file)]);
  return status(root, connection);
}

async function diff(root, file, area) {
  const repoDir = await repositoryRoot(root);
  if (!repoDir) throw new Error('当前项目不在 Git 仓库中');
  const current = parseStatus(await runGit(repoDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  const change = current.find(item => item.path === file);
  if (!change || !['staged', 'working'].includes(area) || !(area === 'staged' ? change.staged : change.unstaged)) throw new Error('文件变更已更新，请刷新列表');
  let content;
  if (area === 'working' && change.index === '??') {
    const target = path.join(repoDir, file);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.size > 128_000) return { path: file, area, content: '该文件不是可预览的小型文本文件。', truncated: false };
    const data = fs.readFileSync(target);
    content = data.includes(0) ? '二进制文件无法预览。' : `新增文件：${file}\n${data.toString('utf8').split('\n').map(line => `+${line}`).join('\n')}`;
  } else {
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3'];
    if (area === 'staged') args.push('--cached');
    args.push('--', literalPath(file));
    content = await runGit(repoDir, args);
  }
  return { path: file, area, content: content.slice(0, 120_000) || '没有可显示的文本差异。', truncated: content.length > 120_000 };
}

async function commit(root, message, connection) {
  const repoDir = await repositoryRoot(root);
  if (!repoDir) throw new Error('当前项目不在 Git 仓库中');
  if (typeof message !== 'string' || !message.trim() || message.length > 300 || /[\r\n]/.test(message)) throw new Error('请填写一行提交说明（最多 300 字）');
  const staged = await runGit(repoDir, ['diff', '--cached', '--name-only']);
  if (!staged) throw new Error('没有已暂存的变更');
  await runGit(repoDir, ['commit', '-m', message.trim()]);
  return status(root, connection);
}

async function sync(root, connection, action) {
  const repoDir = await repositoryRoot(root);
  if (!repoDir) throw new Error('当前项目不在 Git 仓库中');
  if (connection?.type === 'remote') {
    const current = await runGit(repoDir, ['remote', 'get-url', 'origin']);
    if (current !== connection.url || repoDir !== connection.repoDir) throw new Error('当前仓库与连接配置不一致');
  }
  if (action === 'fetch') {
    await runGit(repoDir, ['fetch', 'origin'], connection);
  } else if (action === 'pull') {
    const changes = parseStatus(await runGit(repoDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    if (changes.length) throw new Error('工作区有未提交的变更，请先提交后再拉取');
    await runGit(repoDir, ['pull', '--ff-only'], connection);
  } else if (action === 'push') {
    await runGit(repoDir, ['push'], connection);
  } else throw new Error('不支持的 Git 操作');
  return status(root, connection);
}

module.exports = { remoteInput, gitEnv, runGit, repositoryDirectory, connectRemote, repositoryRoot, parseStatus, status, stage, unstage, diff, commit, sync, displayRemote };
