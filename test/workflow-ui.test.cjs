const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function deploymentFixture() {
  const requests = [], timers = [], state = { root: '/blog', view: 'deploy' };
  let renders = 0;
  const context = vm.createContext({ state, api: () => new Promise((resolve, reject) => requests.push({resolve, reject})),
    deployPage: () => renders++, render: () => renders++, clearTimeout() {}, setTimeout: fn => timers.push(fn) });
  vm.runInContext(source.slice(source.indexOf('async function loadDeploy()'), source.indexOf('async function cancelCommand(')), context);
  return { state, requests, timers, context, get renders() { return renders; } };
}
test('deployment restores running tasks and logs, then clears busy on completion', async () => {
  const f = deploymentFixture();
  const request = f.context.loadDeploy();
  f.requests[0].resolve({ task: {id:'a', status:'running', log:'building'}, hexoInstalled:true }); await request;
  assert.equal(f.state.busy, true); assert.equal(f.state.commandLog, 'building'); assert.equal(f.timers.length, 1);
  const next = f.context.loadDeploy(); f.requests[1].resolve({task:{id:'a',status:'succeeded',log:'done'}}); await next;
  assert.equal(f.state.busy, false); assert.equal(f.state.commandLog, 'done');
});
test('stale deployment requests cannot overwrite a new project or a live command stream', async () => {
  const f = deploymentFixture();
  const old = f.context.loadDeploy(); f.state.root = '/other';
  f.requests[0].resolve({task:{id:'old',status:'running',log:'old'}}); await old;
  assert.equal(f.state.commandTask, undefined); assert.equal(f.renders, 0);
  const duringStart = f.context.loadDeploy(); f.state.commandStreaming = true;
  f.requests[1].resolve({task:null}); await duringStart;
  assert.equal(f.state.commandTask, undefined); assert.equal(f.renders, 0);
});
test('a restarted service clears stale task logs instead of implying the last job still exists', async () => {
  const f = deploymentFixture(); f.state.commandLog = 'old log'; f.state.busy = true;
  const request = f.context.loadDeploy(); f.requests[0].resolve({task:null}); await request;
  assert.equal(f.state.commandLog, ''); assert.equal(f.state.busy, false); assert.equal(f.state.commandTask, null);
});
test('refresh permits a server-managed build while protecting unsaved edits and pending starts', () => {
  let handler, backups = 0;
  const state = {};
  const context = vm.createContext({state,window:{addEventListener(name, fn) { assert.equal(name, 'beforeunload'); handler = fn; }},saveDraft:()=>backups++});
  const start = source.indexOf("window.addEventListener('beforeunload'");
  vm.runInContext(source.slice(start, source.indexOf('\n',start)), context);
  function blocked() { let prevented=false;handler({preventDefault(){prevented=true;}});return prevented; }
  state.busy=true;assert.equal(blocked(),true);
  state.commandTask={id:'server-managed'};assert.equal(blocked(),false);
  state.editorDirty=true;assert.equal(blocked(),true);assert.equal(backups,1);
  state.editorDirty=false;state.configDirty=true;assert.equal(blocked(),true);
  state.configDirty=false;state.gitBusy=true;assert.equal(blocked(),true);
});
