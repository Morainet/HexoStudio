const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const core = require('./core.cjs');

function stopProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    killer.on('error', () => child.kill());
    killer.on('close', code => { if (code !== 0) child.kill(); });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}
function createRunner({ run = core.runHexo, stop = stopProcess, timeoutMs = 15 * 60_000 } = {}) {
  const tasks = new Map();
  let active;
  const snapshot = task => task ? { id: task.id, action: task.action, step: task.step, status: task.status, startedAt: task.startedAt, finishedAt: task.finishedAt, code: task.code, log: task.log } : null;
  const emit = (task, item) => { for (const listener of task.listeners) { try { listener(item); } catch { task.listeners.delete(listener); } } };
  function append(task, type, text) {
    task.log = (task.log + text).slice(-200_000);
    emit(task, { type, text });
  }
  function finish(task, status, code) {
    if (task.status !== 'running') return;
    clearTimeout(task.timer); task.status = status; task.code = code; task.finishedAt = Date.now();
    if (active === task) active = null;
    emit(task, { type: 'exit', code, status });
    task.listeners.clear();
  }
  function execute(task, steps, i) {
    task.step = steps[i];
    append(task, 'stdout', `$ hexo ${task.step}\n`);
    emit(task, { type: 'step', step: task.step });
    try {
      const child = task.child = run(task.root, task.step, (type, text) => { if (task.status === 'running') append(task, type, text); });
      child.once('error', error => {
        if (task.status !== 'running') return;
        append(task, 'stderr', `${error.message}\n`); finish(task, 'failed', -1);
      });
      child.once('close', code => {
        if (task.status !== 'running') return;
        if (task.cancelling) return finish(task, task.timedOut ? 'failed' : 'cancelled', -1);
        if (code !== 0) return finish(task, 'failed', code ?? -1);
        if (i + 1 < steps.length) execute(task, steps, i + 1);
        else finish(task, 'succeeded', 0);
      });
    } catch (error) { append(task, 'stderr', `${error.message}\n`); finish(task, 'failed', -1); }
  }
  function start(root, action, listener) {
    if (!['clean', 'generate', 'deploy', 'generate-deploy'].includes(action)) throw new Error('不支持的命令');
    if (active) throw Object.assign(new Error('已有命令正在运行'), { status: 409 });
    const task = { id: crypto.randomUUID(), root, action, step: '', status: 'running', startedAt: Date.now(), finishedAt: null, code: null, log: '', listeners: new Set(listener ? [listener] : []) };
    tasks.delete(root); tasks.set(root, task);
    while (tasks.size > 5) tasks.delete(tasks.keys().next().value);
    active = task;
    emit(task, { type: 'task', task: snapshot(task) });
    task.timer = setTimeout(() => {
      if (task.status !== 'running') return;
      task.cancelling = true; task.timedOut = true;
      append(task, 'stderr', '任务运行超时，正在停止\n'); stop(task.child);
    }, timeoutMs); task.timer.unref?.();
    execute(task, action === 'generate-deploy' ? ['generate', 'deploy'] : [action], 0);
    return { task: snapshot(task), unsubscribe: () => task.listeners.delete(listener) };
  }
  function cancel(root, id) {
    const task = tasks.get(root);
    if (!task || task.id !== id) throw Object.assign(new Error('任务已变化，请刷新后重试'), { status: 409 });
    if (task.status === 'running' && !task.cancelling) {
      task.cancelling = true;
      append(task, 'stderr', '正在停止任务…\n');
      stop(task.child);
      // Keep the lock until the process has actually closed.
    }
    return snapshot(task);
  }
  return { start, cancel, current: root => snapshot(tasks.get(root)), running: () => Boolean(active), shutdown() { if (active) { active.cancelling = true; stop(active.child); } } };
}
function inspect(root) {
  let deployTypes = [];
  try {
    const config = require('yaml').parse(fs.readFileSync(core.configPath(root, 'site'), 'utf8'));
    const configs = Array.isArray(config?.deploy) ? config.deploy : [config?.deploy];
    deployTypes = [...new Set(configs.map(value => value?.type).filter(type => typeof type === 'string' && /^[\w-]{1,40}$/.test(type)))].slice(0, 8);
  } catch { /* Commands report invalid configuration in their own logs. */ }
  return { hexoInstalled: fs.existsSync(path.join(root, 'node_modules', 'hexo', 'bin', 'hexo')), deployTypes };
}
module.exports = { createRunner, inspect };
