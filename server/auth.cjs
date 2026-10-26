const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { createStore, normalizeStorage, describeStorage } = require('./auth-store.cjs');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'hexostudio_session';
const SESSION_AGE = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_CLIENTS = 10000;
const MAX_PENDING_LOGINS = 8;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function validCredentials(username, password) {
  if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) throw new Error('用户名需为 3–32 位字母、数字、下划线或连字符');
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new Error('密码需为 8–1024 个字符');
}
async function hashPassword(password, salt) {
  const hash = await scrypt(password, Buffer.from(salt, 'hex'), 64, SCRYPT_OPTIONS);
  return hash.toString('hex');
}
function equal(a, b) {
  const left = Buffer.from(a || '', 'hex');
  const right = Buffer.from(b || '', 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function isLoopback(address) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address); }
function remoteStorage(input) {
  if (!['postgres', 'mysql', 'mongodb'].includes(input?.type)) {
    throw Object.assign(new Error('请选择 PostgreSQL、MySQL 或 MongoDB 数据库'), { status: 400 });
  }
  return normalizeStorage(input);
}

class AuthManager {
  constructor(loadSettings, saveSettings, storeFactory = createStore) {
    this.loadSettings = loadSettings;
    this.saveSettings = saveSettings;
    this.createStore = config => storeFactory(config, this.loadSettings, this.saveSettings);
    this.sessions = new Map();
    this.failures = new Map();
    this.pendingLogins = 0;
    this.lastLoginSweep = 0;
    this.setupPending = false;
  }
  storage() { return normalizeStorage(this.loadSettings().authStorage); }
  store() { return this.createStore(this.storage()); }
  async configured() { return Boolean((await this.account())?.hash); }
  async account() { return this.store().read(); }
  storageInfo() { return describeStorage(this.storage()); }
  session(req) {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
    if (!cookie) return null;
    const token = cookie.slice(COOKIE.length + 1);
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expires <= Date.now()) { this.sessions.delete(token); return null; }
    return { token, ...session };
  }
  createSession(username, secure = false) {
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { username, csrf, expires: Date.now() + SESSION_AGE });
    return { csrf, cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE / 1000}${secure ? '; Secure' : ''}` };
  }
  clearSession(req, secure = false) {
    const session = this.session(req);
    if (session) this.sessions.delete(session.token);
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
  }
  async status(req) {
    const session = this.session(req);
    return { configured: await this.configured(), authenticated: Boolean(session), username: session?.username || null, csrf: session?.csrf || null, storage: session ? this.storageInfo() : undefined };
  }
  checkCsrf(req) {
    const session = this.session(req);
    if (!session || typeof req.headers['x-csrf-token'] !== 'string' || !equal(req.headers['x-csrf-token'], session.csrf)) {
      throw Object.assign(new Error('会话验证失败，请重新登录'), { status: 403 });
    }
  }
  assertLocal(req) {
    let requestedHost = '';
    try { requestedHost = new URL(`http://${req.headers.host}`).hostname; } catch { /* invalid host */ }
    if (!isLoopback(req.socket.remoteAddress) || !['127.0.0.1', 'localhost', '[::1]'].includes(requestedHost)) {
      throw Object.assign(new Error('首次设置只能在本机访问'), { status: 403 });
    }
  }
  async testStorage(req, input) {
    if (!this.session(req)) {
      this.assertLocal(req);
      if (await this.configured()) throw Object.assign(new Error('请先登录'), { status: 401 });
    }
    const config = remoteStorage(input);
    await this.createStore(config).probe();
    return describeStorage(config);
  }
  async setup(username, password, req, secure = false, input) {
    this.assertLocal(req);
    if (await this.configured() || this.setupPending) throw Object.assign(new Error('管理员账号已创建'), { status: 409 });
    validCredentials(username, password);
    const config = remoteStorage(input);
    this.setupPending = true;
    try {
      const salt = crypto.randomBytes(32).toString('hex');
      const hash = await hashPassword(password, salt);
      await this.createStore(config).create({ username, salt, hash });
      const settings = { ...this.loadSettings(), authStorage: config };
      if (config.type !== 'file') delete settings.admin;
      this.saveSettings(settings);
      return this.createSession(username, secure);
    } finally { this.setupPending = false; }
  }
  async login(username, password, address, secure = false) {
    const now = Date.now();
    if (now - this.lastLoginSweep >= 60_000) {
      for (const [client, attempts] of this.failures) {
        const recent = attempts.filter(attempt => now - attempt.time < LOGIN_WINDOW);
        if (recent.length) this.failures.set(client, recent);
        else this.failures.delete(client);
      }
      this.lastLoginSweep = now;
    }
    const failures = (this.failures.get(address) || []).filter(attempt => now - attempt.time < LOGIN_WINDOW);
    if (failures.length >= 5) throw Object.assign(new Error('尝试次数过多，请 15 分钟后再试'), { status: 429 });
    if (this.pendingLogins >= MAX_PENDING_LOGINS || (!this.failures.has(address) && this.failures.size >= MAX_LOGIN_CLIENTS)) {
      throw Object.assign(new Error('登录请求过多，请稍后重试'), { status: 429 });
    }
    // Reserve before any await so in-flight requests count toward the limit.
    const attempt = { time: now };
    failures.push(attempt);
    this.failures.set(address, failures);
    if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,32}$/u.test(username) ||
        typeof password !== 'string' || !password.length || password.length > 1024) {
      throw Object.assign(new Error('用户名或密码错误'), { status: 401 });
    }
    this.pendingLogins++;
    try {
      const admin = await this.account();
      const hash = admin?.salt ? await hashPassword(password, admin.salt) : '';
      if (!admin || username !== admin.username || !equal(hash, admin.hash)) {
        throw Object.assign(new Error('用户名或密码错误'), { status: 401 });
      }
      // Remove only this success; concurrent failures must remain counted.
      const remaining = (this.failures.get(address) || []).filter(item => item !== attempt);
      if (remaining.length) this.failures.set(address, remaining);
      else this.failures.delete(address);
      return this.createSession(username, secure);
    } finally { this.pendingLogins--; }
  }
  async changePassword(req, oldPassword, newPassword) {
    const admin = await this.account();
    if (!admin || typeof oldPassword !== 'string' || !equal(await hashPassword(oldPassword, admin.salt), admin.hash)) {
      throw Object.assign(new Error('当前密码错误'), { status: 401 });
    }
    validCredentials(admin.username, newPassword);
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = await hashPassword(newPassword, salt);
    await this.store().replace({ username: admin.username, salt, hash });
    this.sessions.clear();
  }
  async moveStorage(req, password, input) {
    const admin = await this.account();
    if (!admin || typeof password !== 'string' || !equal(await hashPassword(password, admin.salt), admin.hash)) {
      throw Object.assign(new Error('当前密码错误'), { status: 401 });
    }
    const target = remoteStorage(input);
    if (JSON.stringify(target) === JSON.stringify(this.storage())) throw Object.assign(new Error('请选择不同的目标存储'), { status: 400 });
    const store = this.createStore(target);
    await store.probe();
    if (await store.read()) throw Object.assign(new Error('目标存储已有管理员账号'), { status: 409 });
    await store.create(admin);
    const copied = await store.read();
    if (!copied || copied.hash !== admin.hash || copied.salt !== admin.salt) throw Object.assign(new Error('目标存储验证失败'), { status: 503 });
    const settings = { ...this.loadSettings(), authStorage: target };
    if (target.type !== 'file') delete settings.admin;
    this.saveSettings(settings);
    this.sessions.clear();
    return describeStorage(target);
  }
}

module.exports = { AuthManager, isLoopback };
