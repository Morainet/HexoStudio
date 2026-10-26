const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { updateFrontmatter } = require('./frontmatter.cjs');

const postExtension = /\.(md|markdown)$/i;

function validateProject(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请输入 Hexo 项目目录');
  const root = fs.realpathSync(path.resolve(input.trim()));
  if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, '_config.yml')) ||
      !fs.existsSync(path.join(root, 'source', '_posts'))) {
    throw new Error('这不是有效的 Hexo 项目：需要 _config.yml 和 source/_posts 目录');
  }
  configPath(root, 'site');
  return root;
}

function articleDir(root, kind = 'post', create = false) {
  if (!['post', 'draft', 'page'].includes(kind)) throw new Error('无效的文章类型');
  const source = path.join(root, 'source');
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error('内容目录不能是符号链接');
  if (kind === 'page') return source;
  const dir = path.join(source, kind === 'draft' ? '_drafts' : '_posts');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('文章目录不能是符号链接');
  if (create && kind === 'draft') fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function siteInfo(root) {
  const config = fs.readFileSync(configPath(root, 'site'), 'utf8');
  const field = name => {
    const line = config.split(/\r?\n/).find(row => new RegExp(`^${name}:\\s*`, 'i').test(row));
    return line ? line.replace(/^[^:]+:\s*/, '').trim().replace(/^['"]|['"]$/g, '') : '';
  };
  return { title: field('title'), theme: field('theme') };
}

function safeArticlePath(root, name, kind = 'post', allowMissing = false) {
  if (typeof name !== 'string' || !name || !postExtension.test(name) || path.isAbsolute(name)) {
    throw new Error('无效的文章路径');
  }
  const base = fs.realpathSync(articleDir(root, kind));
  const target = path.resolve(base, name);
  if (target === base || !target.startsWith(base + path.sep)) throw new Error('文章路径越界');
  if (kind === 'page' && path.relative(base, target).split(path.sep).some(part => part.startsWith('_') || part.startsWith('.'))) throw new Error('不能访问 Hexo 内部目录');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('不允许访问符号链接');
  }
  if (!allowMissing && !fs.existsSync(target)) throw new Error('文章不存在');
  return target;
}
function safePostPath(root, name, allowMissing = false) { return safeArticlePath(root, name, 'post', allowMissing); }

function parsePost(content, filename) {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const front = match ? match[1] : '';
  const lines = front.split(/\r?\n/);
  const field = key => {
    const line = lines.find(row => new RegExp(`^${key}:\\s*`, 'i').test(row));
    return line ? line.replace(/^[^:]+:\s*/, '').trim().replace(/^['"]|['"]$/g, '') : '';
  };
  const array = key => {
    const value = field(key);
    if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (value) return [value];
    const start = lines.findIndex(row => new RegExp(`^${key}:\\s*$`, 'i').test(row));
    if (start < 0) return [];
    const items = [];
    for (const row of lines.slice(start + 1)) {
      if (/^\S/.test(row)) break;
      const item = row.match(/^\s+-\s+(.+)$/);
      if (item) items.push(item[1].trim().replace(/^['"]|['"]$/g, ''));
    }
    return items;
  };
  const body = match ? content.slice(match[0].length) : content;
  return {
    title: field('title') || path.basename(filename, path.extname(filename)),
    date: field('date'),
    tags: array('tags'),
    categories: array('categories'),
    excerpt: body.replace(/[#*_`>\[\]!]/g, '').trim().slice(0, 150),
    words: body.trim() ? body.trim().split(/\s+|(?=[\u4e00-\u9fff])|(?<=[\u4e00-\u9fff])/).filter(Boolean).length : 0
  };
}

function listPosts(root, kind = 'post') {
  const base = articleDir(root, kind);
  if (!fs.existsSync(base)) return [];
  const result = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (kind === 'page' && (entry.name.startsWith('_') || entry.name.startsWith('.'))) continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && postExtension.test(entry.name)) {
        const relativePath = path.relative(base, file).split(path.sep).join('/');
        const content = fs.readFileSync(file, 'utf8');
        result.push({ path: relativePath, kind, ...parsePost(content, relativePath), modified: fs.statSync(file).mtime.toISOString() });
      }
    }
  }
  visit(base);
  return result.sort((a, b) => (b.date || b.modified).localeCompare(a.date || a.modified));
}

function slugify(value) {
  const slug = String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return slug || `post-${Date.now()}`;
}

function createPost(root, title, localDate, kind = 'post') {
  if (typeof title !== 'string' || !title.trim()) throw new Error('请输入文章标题');
  articleDir(root, kind, true);
  const base = slugify(title);
  if (kind === 'page') {
    const source = articleDir(root, kind);
    let folder = base;
    let index = 2;
    while (fs.existsSync(path.join(source, folder))) folder = `${base}-${index++}`;
    const date = typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(localDate)
      ? localDate : new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.mkdirSync(path.join(source, folder));
    const name = `${folder}/index.md`;
    try { fs.writeFileSync(safeArticlePath(root, name, kind, true), `---\ntitle: ${JSON.stringify(title.trim())}\ndate: ${date}\n---\n\n`, { flag: 'wx' }); }
    catch (error) { fs.rmdirSync(path.join(source, folder)); throw error; }
    return { path: name, kind, content: fs.readFileSync(path.join(source, name), 'utf8') };
  }
  let name = `${base}.md`;
  let index = 2;
  while (fs.existsSync(safeArticlePath(root, name, kind, true))) name = `${base}-${index++}.md`;
  const date = typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(localDate)
    ? localDate : new Date().toISOString().replace('T', ' ').slice(0, 19);
  const content = `---\ntitle: ${JSON.stringify(title.trim())}\n${kind === 'post' ? `date: ${date}\n` : ''}tags: []\ncategories: []\n---\n\n`;
  fs.writeFileSync(safeArticlePath(root, name, kind, true), content, { flag: 'wx' });
  return { path: name, kind, content };
}

function readPost(root, name, kind = 'post') {
  const target = safeArticlePath(root, name, kind);
  const content = fs.readFileSync(target, 'utf8');
  return { path: name, kind, content, meta: parsePost(content, name), modified: fs.statSync(target).mtime.toISOString() };
}

function savePost(root, name, content, expectedModified, metadata = {}, kind = 'post') {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 5_000_000) throw new Error('文章内容无效或超过 5 MB');
  const target = safeArticlePath(root, name, kind);
  const modified = fs.statSync(target).mtime.toISOString();
  if (expectedModified && expectedModified !== modified) throw Object.assign(new Error('文章已被其他程序修改，请重新加载后再保存'), { status: 409 });
  content = updateFrontmatter(content, metadata);
  if (Buffer.byteLength(content) > 5_000_000) throw new Error('文章内容超过 5 MB');
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return readPost(root, name, kind);
}

function deletePost(root, name, kind = 'post') {
  const target = safeArticlePath(root, name, kind);
  fs.unlinkSync(target);
  if (kind === 'page') {
    const source = articleDir(root, kind);
    let directory = path.dirname(target);
    while (directory !== source && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    }
  }
}

function publishDraft(root, name, expectedModified, localDate) {
  const source = safeArticlePath(root, name, 'draft');
  const modified = fs.statSync(source).mtime.toISOString();
  if (expectedModified && expectedModified !== modified) throw Object.assign(new Error('草稿已被其他程序修改，请重新加载后再发布'), { status: 409 });
  let content = fs.readFileSync(source, 'utf8');
  if (!parsePost(content, name).date) {
    const date = typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(localDate)
      ? localDate : new Date().toISOString().replace('T', ' ').slice(0, 19);
    content = updateFrontmatter(content, { date });
  }
  const extension = path.extname(name);
  const stem = name.slice(0, -extension.length);
  let targetName = name;
  let index = 2;
  while (fs.existsSync(safeArticlePath(root, targetName, 'post', true))) targetName = `${stem}-${index++}${extension}`;
  const target = safeArticlePath(root, targetName, 'post', true);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { flag: 'wx' });
  try { fs.unlinkSync(source); }
  catch (error) { fs.unlinkSync(target); throw error; }
  return readPost(root, targetName, 'post');
}

function checkedConfigPath(root, parts) {
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    if (!stat || stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw Object.assign(new Error('配置文件不存在或路径包含符号链接'), { code: 'UNSAFE_CONFIG' });
    }
  }
  return current;
}

function configPath(root, scope) {
  if (scope === 'site') return checkedConfigPath(root, ['_config.yml']);
  if (typeof scope === 'string' && scope.startsWith('override:')) {
    const filename = scope.slice('override:'.length);
    if (!/^_config\.[a-z0-9_-]+\.(yml|yaml|json)$/i.test(filename)) throw new Error('无效的配置文件名');
    return checkedConfigPath(root, [filename]);
  }
  if (typeof scope === 'string' && scope.startsWith('theme:')) {
    const theme = scope.slice(6);
    if (!/^[a-z0-9_-]+$/i.test(theme)) throw new Error('无效的主题名称');
    return checkedConfigPath(root, ['themes', theme, '_config.yml']);
  }
  throw new Error('配置文件不存在');
}

function listThemeOverrides(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^_config\.[a-z0-9_-]+\.(yml|yaml|json)$/i.test(entry.name))
    .map(entry => entry.name).sort();
}

function listThemes(root) {
  const themes = path.join(root, 'themes');
  if (!fs.existsSync(themes) || !fs.lstatSync(themes).isDirectory()) return [];
  return fs.readdirSync(themes, { withFileTypes: true })
    .filter(x => {
      if (!x.isDirectory() || !/^[a-z0-9_-]+$/i.test(x.name)) return false;
      try { configPath(root, `theme:${x.name}`); return true; }
      catch (error) { if (error.code === 'UNSAFE_CONFIG') return false; throw error; }
    })
    .map(x => x.name);
}

function listConfigs(root) {
  const scopes = ['site', ...listThemeOverrides(root).sort().map(name => `override:${name}`), ...listThemes(root).sort().map(name => `theme:${name}`)];
  return scopes.map(scope => {
    const file = configPath(root, scope);
    return { scope, path: path.relative(root, file).split(path.sep).join('/'), bytes: fs.statSync(file).size,
      kind: scope === 'site' ? 'site' : scope.startsWith('override:') ? 'override' : 'theme' };
  });
}

function runHexo(root, action, onData) {
  if (!['clean', 'generate', 'deploy'].includes(action)) throw new Error('不支持的命令');
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'hexo.cmd' : 'hexo');
  if (!fs.existsSync(bin)) throw new Error('项目中未找到 Hexo，请先在博客目录执行 npm install');
  const child = spawn(bin, [action], { cwd: root, env: process.env, shell: process.platform === 'win32' });
  child.stdout.on('data', chunk => onData('stdout', chunk.toString()));
  child.stderr.on('data', chunk => onData('stderr', chunk.toString()));
  return child;
}

module.exports = { validateProject, siteInfo, safePostPath, safeArticlePath, parsePost, listPosts, createPost, readPost, savePost, deletePost, publishDraft, configPath, listThemes, listThemeOverrides, listConfigs, runHexo };
