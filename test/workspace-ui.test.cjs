const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function load(start, end, globals) {
  const HexoI18n = require('../public/i18n.js');
  HexoI18n.setLanguage('zh-CN');
  const context = vm.createContext({ t: HexoI18n.t, HexoI18n, ...globals });
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), context);
  return context;
}
function ui() {
  const elements = new Map();
  return selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', textContent: '', disabled: false, readOnly: false, isConnected: true });
    return elements.get(selector);
  };
}
test('pagination clamps after deletion and keeps each content type independent', () => {
  const state = {};
  const ctx = load('function listPreferences(', 'function listFooter(', { state });
  const posts = ctx.listPreferences('post');
  const pages = ctx.listPreferences('page');
  posts.query = '文章'; posts.page = 3;
  assert.equal(pages.query, ''); assert.equal(pages.page, 1);
  const items = Array.from({length: 41}, (_, i) => ({title: String(i).padStart(2, '0'), date: '2026-10-01'}));
  assert.equal(ctx.listPage(items, posts).items.length, 1);
  assert.equal(ctx.listPage(items.slice(0, 40), posts).items.length, 20);
  assert.equal(posts.page, 2);
  const empty = ctx.listPage([], posts);
  assert.equal(empty.pages, 1); assert.equal(posts.page, 1);
  posts.sort = 'title';
  assert.equal(ctx.listPage([...items].reverse(), posts).items[0].title, '00');
  assert.equal(items[0].title, '00');
});
test('configuration save prevents departure and preserves edited text on failure', async () => {
  const $ = ui(); const state = { config: {scope:'site',content:'old',modified:'before'}, configBuffer:'new',configDirty:true };
  $('#config-editor').value = 'new';
  let fail;
  const ctx = load('function canLeaveConfig()', 'function appendCommandLog(', {
    $, state, window:{confirm:()=>true}, toast:()=>{}, api:()=>new Promise((_,reject)=>{fail=reject;})
  });
  const pending = ctx.saveConfig();
  assert.equal($('#config-editor').readOnly, true);
  assert.equal(ctx.canLeaveConfig(), false);
  fail(new Error('文件冲突')); await pending;
  assert.equal(state.configDirty, true);
  assert.equal(state.configBuffer, 'new');
  assert.equal($('#config-editor').value, 'new');
  assert.equal($('#config-editor').readOnly, false);
  assert.equal(ctx.canLeaveConfig(), true);
  assert.equal(state.configBuffer, 'old');
  assert.equal(state.configDirty, false);
});
test('successful configuration save updates the conflict version and clears dirty state', async () => {
  const $ = ui(); const state = {config:{scope:'site',content:'old',modified:'before'},configDirty:true};
  $('#config-editor').value = 'new';
  const ctx = load('function canLeaveConfig()', 'function appendCommandLog(', {$,state,toast:()=>{},api:async()=>({modified:'after'})});
  await ctx.saveConfig();
  assert.equal(state.config.content, 'new'); assert.equal(state.config.modified, 'after');
  assert.equal(state.configBuffer, 'new'); assert.equal(state.configDirty, false);
  assert.equal($('#scope').disabled, false);
});
test('command stream handles split UTF-8 and final record without newline', async () => {
  const $ = ui(); const state = {view:'deploy'}; const notices=[];
  const bytes=Buffer.from('{"type":"stdout","text":"构建中"}\n{"type":"exit","code":0}');
  const chunks=[bytes.subarray(0,28),bytes.subarray(28,30),bytes.subarray(30)];
  const ctx=load('function appendCommandLog(', 'async function navigate(', {
    $,state,TextDecoder,toast:(...args)=>notices.push(args),deployPage:()=>{},
    fetch:async()=>({ok:true,body:{getReader:()=>({read:async()=>chunks.length?{value:chunks.shift(),done:false}:{done:true}})}})
  });
  await ctx.runCommand('generate');
  assert.match(state.commandLog,/构建中/); assert.match(state.commandLog,/退出码 0/);
  assert.equal(state.busy,false); assert.equal(notices.at(-1)[1],'success');
});
test('lost command stream reports uncertainty instead of a successful build', async () => {
  const $ = ui(); const state={view:'deploy'}; const notices=[];
  const ctx=load('function appendCommandLog(', 'async function navigate(', {
    $,state,TextDecoder,toast:(...args)=>notices.push(args),deployPage:()=>{},
    fetch:async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:true})})}})
  });
  await ctx.runCommand('generate');
  assert.match(state.commandLog,/未收到命令完成结果/); assert.equal(notices.at(-1)[1],'error');
});
