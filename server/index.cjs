const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const core = require('./core.cjs');
const { renderPreview } = require('./preview.cjs');
const assets = require('./assets.cjs');
const git = require('./git.cjs');
const { AuthManager } = require('./auth.cjs');

const publicDir = path.join(__dirname, '..', 'public');
const settingsFile = process.env.HEXOSTUDIO_SETTINGS || path.join(os.homedir(), '.hexostudio.json');
const host = process.env.HEXOSTUDIO_HOST || '127.0.0.1';
const token = process.env.HEXOSTUDIO_TOKEN || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !token) {
  throw new Error('监听非本机地址时必须设置 HEXOSTUDIO_TOKEN');
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch { return {}; }
}
function saveSettings(value) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(value, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(settingsFile, 0o600);
}
const auth = new AuthManager(loadSettings, saveSettings);
function getRoot() {
  const stored = process.env.HEXO_ROOT || loadSettings().root;
  return stored ? core.validateProject(stored) : null;
}
function send(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 12_000_000) { reject(Object.assign(new Error('请求内容过大'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON 格式无效')); } });
    req.on('error', reject);
  });
}
function authorized(req) {
  if (auth.session(req)) return true;
  if (!token) return false;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function tokenAuthorized(req) {
  if (!token) return false;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function secureCookie(req) { return Boolean(req.socket.encrypted || process.env.HEXOSTUDIO_COOKIE_SECURE === '1'); }
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function staticFile(req, res, pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.js', 'style.css'].includes(name)) return send(res, 404, { error: '未找到页面' });
  const types = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' };
  res.writeHead(200, {
    'Content-Type': `${types[name]}; charset=utf-8`,
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  fs.createReadStream(path.join(publicDir, name)).pipe(res);
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname.startsWith('/images/hexostudio/')) {
      if (!authorized(req)) return send(res, 401, { error: '请先登录' });
      const root = getRoot();
      if (!root) return send(res, 400, { error: '请先连接 Hexo 项目' });
      const image = assets.readImage(root, decodeURIComponent(url.pathname.slice('/images/hexostudio/'.length)));
      res.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(image.file).pipe(res);
      return;
    }
    if (!url.pathname.startsWith('/api/')) return staticFile(req, res, url.pathname);
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: '跨站请求被拒绝' });
    if (req.method === 'GET' && url.pathname === '/api/auth/status') return send(res, 200, auth.status(req));
    if (req.method === 'POST' && url.pathname === '/api/auth/setup') {
      const data = await body(req);
      const session = await auth.setup(data.username, data.password, req, secureCookie(req));
      return send(res, 200, { authenticated: true, username: data.username, csrf: session.csrf }, { 'Set-Cookie': session.cookie });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const data = await body(req);
      const session = await auth.login(data.username, data.password, req.socket.remoteAddress, secureCookie(req));
      return send(res, 200, { authenticated: true, username: data.username, csrf: session.csrf }, { 'Set-Cookie': session.cookie });
    }
    if (!authorized(req)) return send(res, 401, { error: '请先登录' });
    if (req.method !== 'GET' && !tokenAuthorized(req)) auth.checkCsrf(req);
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearSession(req, secureCookie(req)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/password') {
      const data = await body(req);
      await auth.changePassword(req, data.oldPassword, data.newPassword);
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearSession(req, secureCookie(req)) });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      let root = null;
      try { root = getRoot(); } catch { /* project may have moved */ }
      const connection = loadSettings().connection;
      return send(res, 200, { root, configured: Boolean(root), site: root ? core.siteInfo(root) : null, connection: connection?.type === 'remote' && root ? { type: 'remote', provider: connection.provider, repository: connection.repository, branch: connection.branch, blogPath: connection.blogPath, hasToken: Boolean(connection.token) } : { type: 'local' }, mode: process.env.HEXOSTUDIO_DESKTOP ? 'desktop' : 'web' });
    }
    if (req.method === 'POST' && url.pathname === '/api/project') {
      if (process.env.HEXO_ROOT) throw new Error('项目目录由 HEXO_ROOT 环境变量指定');
      const data = await body(req);
      const root = core.validateProject(data.path);
      saveSettings({ ...loadSettings(), root, connection: { type: 'local' } });
      return send(res, 200, { root, site: core.siteInfo(root) });
    }
    if (req.method === 'POST' && url.pathname === '/api/remote/connect') {
      if (process.env.HEXO_ROOT) throw new Error('项目目录由 HEXO_ROOT 环境变量指定');
      const connection = git.remoteInput(await body(req));
      const { root, repoDir } = await git.connectRemote(settingsFile, connection);
      saveSettings({ ...loadSettings(), root, connection: { ...connection, type: 'remote', repoDir } });
      return send(res, 200, { root, site: core.siteInfo(root), connection: { type: 'remote', provider: connection.provider, repository: connection.repository, branch: connection.branch, blogPath: connection.blogPath } });
    }
    const root = getRoot();
    if (!root) return send(res, 400, { error: '请先连接 Hexo 项目' });
    if (req.method === 'GET' && url.pathname === '/api/git/status') return send(res, 200, await git.status(root, loadSettings().connection));
    if (req.method === 'GET' && url.pathname === '/api/git/diff') return send(res, 200, await git.diff(root, url.searchParams.get('path'), url.searchParams.get('area')));
    if (req.method === 'POST' && url.pathname === '/api/git/stage') {
      const data = await body(req);
      return send(res, 200, await git.stage(root, data.paths, loadSettings().connection));
    }
    if (req.method === 'POST' && url.pathname === '/api/git/unstage') {
      const data = await body(req);
      return send(res, 200, await git.unstage(root, data.path, loadSettings().connection));
    }
    if (req.method === 'POST' && url.pathname === '/api/git/commit') {
      const data = await body(req);
      return send(res, 200, await git.commit(root, data.message, loadSettings().connection));
    }
    if (req.method === 'POST' && ['/api/git/fetch', '/api/git/pull', '/api/git/push'].includes(url.pathname)) {
      return send(res, 200, await git.sync(root, loadSettings().connection, url.pathname.split('/').pop()));
    }
    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const data = await body(req);
      return send(res, 200, { html: renderPreview(data.content) });
    }
    if (req.method === 'POST' && url.pathname === '/api/assets') {
      const data = await body(req);
      return send(res, 201, assets.saveImage(root, data.name, data.data));
    }
    if (req.method === 'GET' && url.pathname === '/api/assets') return send(res, 200, { images: assets.listImages(root) });
    if (req.method === 'GET' && url.pathname === '/api/posts') return send(res, 200, { posts: core.listPosts(root, url.searchParams.get('kind') || 'post') });
    if (req.method === 'POST' && url.pathname === '/api/posts') {
      const data = await body(req);
      return send(res, 201, core.createPost(root, data.title, data.localDate, data.kind || 'post'));
    }
    if (url.pathname === '/api/post') {
      const name = url.searchParams.get('path');
      const kind = url.searchParams.get('kind') || 'post';
      if (req.method === 'GET') return send(res, 200, core.readPost(root, name, kind));
      if (req.method === 'PUT') {
        const data = await body(req);
        return send(res, 200, core.savePost(root, name, data.content, data.modified, data.metadata || {}, kind));
      }
      if (req.method === 'DELETE') { core.deletePost(root, name, kind); return send(res, 200, { ok: true }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const data = await body(req);
      return send(res, 200, core.publishDraft(root, data.path, data.modified, data.localDate));
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const scope = url.searchParams.get('scope') || 'site';
      const file = core.configPath(root, scope);
      return send(res, 200, { scope, content: fs.readFileSync(file, 'utf8'), modified: fs.statSync(file).mtime.toISOString(), themes: core.listThemes(root) });
    }
    if (req.method === 'PUT' && url.pathname === '/api/config') {
      const data = await body(req);
      if (typeof data.content !== 'string' || Buffer.byteLength(data.content) > 1_000_000) throw new Error('配置内容无效或超过 1 MB');
      const file = core.configPath(root, data.scope);
      if (data.modified && data.modified !== fs.statSync(file).mtime.toISOString()) throw Object.assign(new Error('配置文件已被其他程序修改，请重新加载'), { status: 409 });
      fs.writeFileSync(file, data.content);
      return send(res, 200, { modified: fs.statSync(file).mtime.toISOString() });
    }
    if (req.method === 'POST' && url.pathname === '/api/command') {
      const data = await body(req);
      if (!['clean', 'generate', 'deploy'].includes(data.action)) throw new Error('不支持的命令');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const child = core.runHexo(root, data.action, (type, chunk) => res.write(JSON.stringify({ type, text: chunk }) + '\n'));
      child.on('error', error => { res.write(JSON.stringify({ type: 'stderr', text: error.message }) + '\n'); res.end(); });
      child.on('close', code => { res.write(JSON.stringify({ type: 'exit', code }) + '\n'); res.end(); });
      res.on('close', () => { if (!res.writableEnded) child.kill(); });
      return;
    }
    return send(res, 404, { error: '接口不存在' });
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 400);
    if (!res.headersSent) send(res, status, { error: error.message });
    else { res.write(JSON.stringify({ type: 'stderr', text: error.message }) + '\n'); res.end(); }
  }
}

function startServer(port = Number(process.env.HEXOSTUDIO_PORT || 4545), bind = host) {
  const server = http.createServer(handle);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bind, () => resolve({ server, url: `http://${bind}:${server.address().port}` }));
  });
}

if (require.main === module) startServer().then(({ url }) => console.log(`HexoStudio: ${url}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { startServer, handle };
