function proxyOptions(value) {
  if (!value) return {};
  let url;
  try { url = new URL(value); } catch { throw new Error('SOCKS5 代理地址无效'); }
  if (typeof value !== 'string' || value.length > 2048 || url.protocol !== 'socks5:' || !url.hostname || !Number(url.port) || url.pathname && url.pathname !== '/' || url.search || url.hash) throw new Error('请输入 socks5://主机:端口 格式的代理地址');
  let username, password;
  try { username = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { throw new Error('SOCKS5 代理认证信息格式无效'); }
  if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) throw new Error('SOCKS5 代理认证信息过长');
  return { proxyHost: url.hostname.replace(/^\[|\]$/g, ''), proxyPort: Number(url.port), ...(username ? { proxyUsername: username } : {}), ...(password ? { proxyPassword: password } : {}) };
}

function mongoOptions(config) {
  return { serverSelectionTimeoutMS: 20000, connectTimeoutMS: 10000, socketTimeoutMS: 15000, ...proxyOptions(require('./network.cjs').proxyUrl(config.proxyUrl)) };
}

// Inspect nested driver errors but return only fixed text: raw errors may contain credentials.
function mongoError(error) {
  const queue = [error], seen = new Set(), errors = [];
  while (queue.length && errors.length < 30) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item); errors.push(item);
    queue.push(item.cause, item.reason, item.error);
    if (item.servers instanceof Map) for (const server of item.servers.values()) queue.push(server.error);
  }
  const has = fn => errors.some(fn);
  let message;
  if (has(e => e.code === 18 || e.codeName === 'AuthenticationFailed')) message = 'MongoDB 认证失败，请检查数据库用户名、密码和 authSource；Atlas 登录账号不能作为数据库账号。';
  else if (has(e => e.code === 13 || e.codeName === 'Unauthorized')) message = 'MongoDB 权限不足，请为数据库用户授予目标数据库的读写权限。';
  else if (has(e => /querySrv|queryTxt/.test(e.syscall || '') || ['ENOTFOUND', 'ENODATA', 'EAI_AGAIN', 'ESERVFAIL', 'ETIMEOUT'].includes(e.code))) message = 'MongoDB DNS 解析失败，请检查系统 DNS；SOCKS5 不代理 mongodb+srv 的 SRV/TXT 查询，可使用 Atlas 提供的标准连接地址。';
  else if (has(e => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(String(e.code || '')) || /certificate|TLS handshake/i.test(e.message || ''))) message = 'MongoDB TLS 校验或握手失败，请检查系统时间、证书和代理规则，不要关闭证书校验。';
  else if (has(e => e.name === 'SocksClientError' || /socks|proxy connection/i.test(e.message || ''))) message = 'MongoDB SOCKS5 代理连接失败，请检查代理端口、认证信息和节点是否支持数据库 TCP 连接。';
  else if (has(e => e.name === 'MongoParseError' || e.name === 'MongoInvalidArgumentError')) message = 'MongoDB 连接参数无效，请检查连接地址、密码转义和代理配置。';
  else if (has(e => ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(e.code) || ['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError'].includes(e.name))) message = 'MongoDB 网络连接失败或超时，请检查 Atlas IP 访问列表与实际出口 IP、节点 TCP 端口和代理设置；仅开启系统 HTTP 代理不会自动代理数据库连接。';
  else message = 'MongoDB 连接或操作失败，请检查连接配置和数据库权限。';
  return Object.assign(new Error(message), { status: 503 });
}

module.exports = { proxyOptions, mongoOptions, mongoError };
