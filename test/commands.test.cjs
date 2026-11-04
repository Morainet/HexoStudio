const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRunner, inspect } = require('../server/commands.cjs');
function fixture(options = {}) {
  const calls = [], stopped = [];
  const runner = createRunner({ run(root, action, write) { const child = new EventEmitter(); calls.push({ root, action, write, child }); return child; }, stop(child) { stopped.push(child); }, ...options });
  return { runner, calls, stopped };
}
test('generate and deploy run in order and a failed build never deploys', () => {
  const f = fixture(); const events = [];
  f.runner.start('/blog', 'generate-deploy', event => events.push(event));
  assert.equal(f.calls[0].action, 'generate');
  assert.throws(() => f.runner.start('/blog', 'clean'), /已有命令/);
  f.calls[0].child.emit('close', 1);
  assert.equal(f.calls.length, 1); assert.equal(f.runner.current('/blog').status, 'failed');
  f.runner.start('/blog', 'generate-deploy'); f.calls[1].child.emit('close', 0);
  assert.equal(f.calls[2].action, 'deploy'); f.calls[2].child.emit('close', 0);
  assert.equal(f.runner.current('/blog').status, 'succeeded');
  assert.equal(f.runner.current('/blog').code, 0); assert.equal(f.runner.running(), false);
});
test('disconnecting a log subscriber preserves the job and logs for recovery', () => {
  const f = fixture(); const events = [];
  const subscription = f.runner.start('/a', 'generate', event => events.push(event));
  subscription.unsubscribe(); const count = events.length;
  f.calls[0].write('stdout', '构建中\n'); f.calls[0].child.emit('close', 0);
  assert.equal(events.length, count);
  assert.match(f.runner.current('/a').log, /构建中/);
  assert.equal(f.runner.current('/a').status, 'succeeded'); assert.equal(f.runner.current('/b'), null);
});
test('cancel waits for process closure, refuses stale task ids, and never starts deploy', () => {
  const f = fixture(); const { task } = f.runner.start('/a', 'generate-deploy');
  assert.throws(() => f.runner.cancel('/a', 'old-id'), /任务已变化/);
  f.runner.cancel('/a', task.id); f.runner.cancel('/a', task.id);
  assert.equal(f.stopped.length, 1); assert.equal(f.runner.running(), true);
  assert.throws(() => f.runner.start('/b', 'generate'), /已有命令/);
  f.calls[0].child.emit('close', null);
  assert.equal(f.runner.current('/a').status, 'cancelled'); assert.equal(f.calls.length, 1);
});
test('timeout stops the process and releases the lock only when it closes', async () => {
  const f = fixture({ timeoutMs: 5 }); f.runner.start('/a', 'generate-deploy');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.stopped.length, 1); assert.equal(f.runner.running(), true);
  f.calls[0].child.emit('close', null);
  assert.equal(f.runner.current('/a').status, 'failed'); assert.match(f.runner.current('/a').log, /超时/);
});
test('a process startup error finishes once and logs remain bounded', () => {
  const f = fixture(); f.runner.start('/a', 'generate');
  f.calls[0].write('stdout', 'x'.repeat(250000)); assert.equal(f.runner.current('/a').log.length, 200000);
  f.calls[0].child.emit('error', new Error('start failed')); f.calls[0].child.emit('close', null);
  assert.equal(f.runner.current('/a').status, 'failed'); assert.equal(f.runner.running(), false);
});
test('project inspection exposes deployment type but never deploy credentials', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-inspect-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '_config.yml'), 'deploy:\n  type: git\n  token: TOP-SECRET\n');
  assert.deepEqual(inspect(root), { hexoInstalled: false, deployTypes: ['git'] });
});
test('Hexo entry runs from paths with spaces and shell characters and decodes split UTF-8', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs path & chars-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, 'node_modules', 'hexo', 'bin', 'hexo'); fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "const b=Buffer.from('构建中');process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.stdout.write(process.argv[2]);},20);");
  let output = ''; const child = require('../server/core.cjs').runHexo(root, 'generate', (type, text) => { output += text; });
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  assert.equal(code, 0); assert.equal(output, '构建中generate');
});
