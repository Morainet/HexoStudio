const network = require('./network.cjs');
const TARGET = 'https://api.github.com/rate_limit';
function reason(error) {
  const errors = [], seen = new Set();
  for (let item = error; item && !seen.has(item) && errors.length < 12; item = item.cause) { seen.add(item); errors.push(item); }
  const has = predicate => errors.some(predicate);
  if (has(e => ['ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT'].includes(e.code) || ['AbortError', 'TimeoutError'].includes(e.name))) return 'timeout';
  if (has(e => e.code === 'EPROXY')) return 'proxy';
  if (has(e => ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(e.code))) return 'dns';
  if (has(e => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(e.code || ''))) return 'tls';
  return 'network';
}
function createChecker({ fetchImpl, timeout = 8000, cooldown = 5000, now = Date.now, readOnly = false } = {}) {
  let pending = false, next = 0;
  return async input => {
    const config = network.current();
    const candidate = config.managed || readOnly ? config : network.mutation(config, input);
    if (pending || now() < next) throw Object.assign(new Error('请稍后再测试连接'), { status: 429 });
    pending = true;
    const started = now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let agent;
    try {
      agent = network.createDispatcher(candidate, controller.signal);
      const fetcher = fetchImpl || (agent ? require('undici').fetch : globalThis.fetch);
      const response = await fetcher(TARGET, { dispatcher: agent, signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'HexoStudio-network-check' } });
      await response.body?.cancel();
      return { ok: response.ok, reason: response.ok ? null : 'http', elapsedMs: Math.max(0, now() - started), mode: candidate.mode };
    } catch (error) {
      return { ok: false, reason: controller.signal.aborted ? 'timeout' : reason(error), elapsedMs: Math.max(0, now() - started), mode: candidate.mode };
    } finally {
      clearTimeout(timer); controller.abort();
      agent?.destroy().catch(() => {});
      pending = false; next = now() + cooldown;
    }
  };
}
module.exports = { createChecker, check: createChecker(), checkSaved: createChecker({ readOnly: true }), reason };
