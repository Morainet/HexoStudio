const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const https = require('node:https');
const { Duplex } = require('node:stream');
const { proxyOptions } = require('./mongo-connection.cjs');
let settings = () => undefined;
function configure(provider) { settings = provider; }
function current() {
  if (process.env.HEXOSTUDIO_PROXY_URL) return { mode: 'socks5', proxyUrl: process.env.HEXOSTUDIO_PROXY_URL, managed: true };
  return settings() || { mode: 'inherit' };
}
function proxyUrl(override) {
  const config = current();
  const url = override || (config.mode === 'socks5' ? config.proxyUrl : '');
  proxyOptions(url); return url;
}
function record(value = current()) {
  const proxy = proxyOptions(value.proxyUrl);
  return { mode: value.mode || 'inherit', hasProxy: Boolean(value.proxyUrl),
    endpoint: proxy.proxyHost ? `${proxy.proxyHost}:${proxy.proxyPort}` : '',
    revision: value.revision || 'initial', managed: Boolean(value.managed) };
}
function mutation(stored, input) {
  if (process.env.HEXOSTUDIO_PROXY_URL) throw Object.assign(new Error('网络由环境变量管理'), { status: 409 });
  if (input?.revision !== record(stored || {}).revision) throw Object.assign(new Error('网络设置已变化，请重新打开'), { status: 409 });
  if (!['inherit', 'direct', 'socks5'].includes(input.mode)) throw new Error('请选择有效的网络模式');
  const url = input.mode === 'socks5' ? input.proxyUrl || stored?.proxyUrl : '';
  if (input.mode === 'socks5' && !url) throw new Error('请填写 SOCKS5 代理地址');
  proxyOptions(url);
  return { mode: input.mode, ...(url ? { proxyUrl: url } : {}), revision: crypto.randomUUID() };
}
async function tunnel(host, port, url, signal) {
  const cancelled = () => Object.assign(new Error('网络请求已取消'), { code: 'ABORT_ERR' });
  if (signal?.aborted) throw cancelled();
  const proxy = proxyOptions(url);
  const raw = new net.Socket();
  const abort = () => raw.destroy(cancelled());
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => raw.destroy(Object.assign(new Error('代理连接超时'), { code: 'ETIMEDOUT' })), 10000);
  // Keep an error listener while ownership moves from TCP to the SOCKS handshake.
  raw.on('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      raw.once('error', reject);
      raw.connect(proxy.proxyPort, proxy.proxyHost, resolve);
      if (signal?.aborted) abort();
    });
    const { socket } = await require('socks').SocksClient.createConnection({ command: 'connect', timeout: 10000,
      existing_socket: raw,
      proxy: { host: proxy.proxyHost, port: proxy.proxyPort, type: 5, userId: proxy.proxyUsername, password: proxy.proxyPassword },
      destination: { host: host.replace(/^\[|\]$/g, ''), port: Number(port) } });
    if (signal?.aborted) { socket.destroy(); throw cancelled(); }
    return socket;
  } catch {
    raw.destroy();
    if (signal?.aborted) throw cancelled();
    throw Object.assign(new Error('SOCKS5 代理连接失败，请检查代理端口、认证和节点 TCP 支持'), { code: 'EPROXY' });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function secureTunnel(host, port, url, { address = host, signal } = {}) {
  const raw = await tunnel(address, port, url, signal);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ socket: raw, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] });
    const abort = () => socket.destroy(new Error('网络请求已取消'));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => socket.destroy(new Error('TLS 连接超时')), 10000);
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    socket.once('secureConnect', () => { clean(); resolve(socket); });
    socket.once('error', error => { clean(); reject(error); });
    if (signal?.aborted) abort();
  });
}
let cached;
function createDispatcher(config, signal) {
  const url = config.mode === 'socks5' ? config.proxyUrl : '';
  proxyOptions(url);
  if (config.mode === 'inherit') return undefined;
  const { Agent } = require('undici');
  return url ? new Agent({ connect(options, callback) {
    const host = options.hostname.replace(/^\[|\]$/g, '');
    const port = Number(options.port) || (options.protocol === 'https:' ? 443 : 80);
    const opening = options.protocol === 'https:' ? secureTunnel(host, port, url, { signal }) : tunnel(host, port, url, signal);
    opening.then(socket => callback(null, socket), error => callback(error, null));
  } }) : new Agent();
}
function dispatcher() {
  const config = current();
  const key = config.mode === 'socks5' ? proxyUrl() : config.mode;
  if (cached?.key === key) return cached.agent;
  cached?.agent?.close().catch(() => {});
  const agent = createDispatcher(config);
  cached = { key, agent }; return agent;
}
function fetchNetwork(url, options) {
  const agent = dispatcher();
  return agent ? require('undici').fetch(url, { ...options, dispatcher: agent }) : globalThis.fetch(url, options);
}
function aiAgent(address, signal) {
  const url = proxyUrl();
  if (!url) return null;
  const agent = new https.Agent({ keepAlive: false });
  // The target remains the IP validated by ai.cjs; the proxy cannot re-resolve it.
  agent.createConnection = (options, callback) => {
    secureTunnel(options.servername || options.host, options.port || 443, url, { address, signal })
      .then(socket => { if (signal?.aborted) socket.destroy(); else callback(null, socket); }, callback);
  };
  return agent;
}

class DatabaseSocket extends Duplex {
  constructor(host, port, url) {
    super(); this.connecting = true; this.controller = new AbortController();
    this.opening = tunnel(host, port, url, this.controller.signal).then(socket => {
      this.socket = socket; this.connecting = false;
      if (this.destroyed) return socket.destroy();
      socket.on('data', data => { if (!this.push(data)) socket.pause(); });
      socket.on('end', () => this.push(null));
      socket.on('error', error => this.destroy(error));
      socket.on('close', () => { if (!this.destroyed) this.destroy(); });
      this.emit('connect'); return socket;
    });
    this.opening.catch(error => this.destroy(error));
  }
  connect() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { this.socket?.ref(); return this; }
  unref() { this.socket?.unref(); return this; }
  _read() { this.socket?.resume(); }
  _write(data, encoding, callback) { this.opening.then(socket => socket ? socket.write(data, encoding, callback) : callback(new Error('连接已关闭')), callback); }
  _final(callback) { this.socket?.end(); callback(); }
  _destroy(error, callback) { this.controller.abort(); this.socket?.destroy(); callback(error); }
}
function databaseStream(config) {
  const url = proxyUrl(config.proxyUrl);
  if (!url) return {};
  const target = new URL(config.url);
  return { stream: () => new DatabaseSocket(target.hostname, target.port || (config.type === 'postgres' ? 5432 : 3306), url) };
}
function gitSettings(env) {
  const config = current(), url = proxyUrl();
  if (config.mode === 'inherit' && !url) return [];
  for (const key of Object.keys(env)) if (/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
  env.NO_PROXY = env.no_proxy = url ? '' : '*';
  // Git uses libcurl's socks5h scheme to resolve the destination at the proxy.
  const value = url ? url.replace(/^socks5:/, 'socks5h:') : '';
  return [['http.proxy', value], ['http.https://github.com/.proxy', value], ['http.https://gitlab.com/.proxy', value]];
}
module.exports = { configure, current, proxyUrl, record, mutation, tunnel, secureTunnel, createDispatcher, fetchNetwork, aiAgent, databaseStream, gitSettings };
