const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'hexostudio_session';
const SESSION_AGE = 12 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function validCredentials(username, password) {
  if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) throw new Error('用户名需为 3–32 位字母、数字、下划线或连字符');
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('密码需为 12–1024 个字符');
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

class AuthManager {
  constructor(loadSettings, saveSettings) {
    this.loadSettings = loadSettings;
    this.saveSettings = saveSettings;
    this.sessions = new Map();
    this.failures = new Map();
    this.setupPending = false;
  }
  configured() { return Boolean(this.loadSettings().admin?.hash); }
  account() { return this.loadSettings().admin; }
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
  status(req) {
    const session = this.session(req);
    return { configured: this.configured(), authenticated: Boolean(session), username: session?.username || null, csrf: session?.csrf || null };
  }
  checkCsrf(req) {
    const session = this.session(req);
    if (!session || typeof req.headers['x-csrf-token'] !== 'string' || !equal(req.headers['x-csrf-token'], session.csrf)) {
      throw Object.assign(new Error('会话验证失败，请重新登录'), { status: 403 });
    }
  }
  async setup(username, password, req, secure = false) {
    let requestedHost = '';
    try { requestedHost = new URL(`http://${req.headers.host}`).hostname; } catch { /* invalid host */ }
    if (!isLoopback(req.socket.remoteAddress) || !['127.0.0.1', 'localhost', '[::1]'].includes(requestedHost)) {
      throw Object.assign(new Error('首次设置只能在本机访问'), { status: 403 });
    }
    if (this.configured() || this.setupPending) throw Object.assign(new Error('管理员账号已创建'), { status: 409 });
    validCredentials(username, password);
    this.setupPending = true;
    try {
      const salt = crypto.randomBytes(32).toString('hex');
      const hash = await hashPassword(password, salt);
      this.saveSettings({ ...this.loadSettings(), admin: { username, salt, hash } });
      return this.createSession(username, secure);
    } finally { this.setupPending = false; }
  }
  async login(username, password, address, secure = false) {
    const now = Date.now();
    const failures = (this.failures.get(address) || []).filter(time => now - time < 15 * 60 * 1000);
    if (failures.length >= 5) throw Object.assign(new Error('尝试次数过多，请 15 分钟后再试'), { status: 429 });
    const admin = this.account();
    const hash = admin?.salt && typeof password === 'string' ? await hashPassword(password, admin.salt) : '';
    if (!admin || username !== admin.username || !equal(hash, admin.hash)) {
      failures.push(now);
      this.failures.set(address, failures);
      throw Object.assign(new Error('用户名或密码错误'), { status: 401 });
    }
    this.failures.delete(address);
    return this.createSession(username, secure);
  }
  async changePassword(req, oldPassword, newPassword) {
    const admin = this.account();
    if (!admin || typeof oldPassword !== 'string' || !equal(await hashPassword(oldPassword, admin.salt), admin.hash)) {
      throw Object.assign(new Error('当前密码错误'), { status: 401 });
    }
    validCredentials(admin.username, newPassword);
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = await hashPassword(newPassword, salt);
    this.saveSettings({ ...this.loadSettings(), admin: { username: admin.username, salt, hash } });
    this.sessions.clear();
  }
}

module.exports = { AuthManager, isLoopback };
