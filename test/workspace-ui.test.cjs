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
  vm.runInContext(source.slice(source.indexOf('const icon ='), source.indexOf('const endpoint =')), context);
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
  const ctx = load('function updateConfigStatus()', 'function appendCommandLog(', {
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
  assert.equal(state.configBuffer, 'new');
  assert.equal(state.configDirty, true); // Confirmation alone must not discard the buffer.
  assert.equal($('#config-status').textContent, '保存失败，修改仍保留');
  assert.equal($('#reload-config').disabled, false);
});
test('successful configuration save updates the conflict version and clears dirty state', async () => {
  const $ = ui(); const state = {config:{scope:'site',content:'old',modified:'before'},configDirty:true};
  $('#config-editor').value = 'new';
  const ctx = load('function updateConfigStatus()', 'function appendCommandLog(', {$,state,toast:()=>{},api:async()=>({modified:'after'})});
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

function contentFixture(extra = {}) {
  const $ = ui(), requests = [], notices = [], renders = [];
  const state = {root:'/blog',view:'posts',metadataValues:{}, ...extra};
  const ctx = load('async function openPost(', 'async function savePost(', {
    $, state, toast:(...args)=>notices.push(args), render:()=>renders.push(state.view),
    api:(name,options)=>new Promise((resolve,reject)=>requests.push({name,options,resolve,reject})),
    canLeaveEditor:()=>true, metadataValues:meta=>meta || {}, readDraft:()=>null,
    window:{confirm:()=>true}, updateShell:()=>{}, pageHead:()=>'', viewError:()=>{},
  });
  for (const [start,end] of [
    ['function updateConfigStatus()', 'function appendCommandLog('],
    ['async function navigate(', "document.addEventListener('click'"]
  ]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),ctx);
  const post = path => ({path,kind:'post',content:path,modified:'v1',meta:{}});
  return {ctx,state,$,requests,notices,renders,post};
}
test('only the latest article request can open an editor', async () => {
  const {ctx,state,requests,post} = contentFixture();
  const first = ctx.openPost('first.md'), second = ctx.openPost('second.md');
  requests[1].resolve(post('second.md')); await second;
  requests[0].resolve(post('first.md')); await first;
  assert.equal(state.current.path, 'second.md');
  assert.equal(state.editorBuffer, 'second.md');
  assert.equal(state.contentRequest, null);
});
test('leaving and returning to the same list cancels pending article loads', async () => {
  const {ctx,state,requests,post} = contentFixture();
  const pending = ctx.openPost('first.md');
  await ctx.navigate('pages'); await ctx.navigate('posts');
  requests[0].resolve(post('first.md')); await pending;
  assert.equal(state.view, 'posts'); assert.equal(state.current, undefined);
});
test('clicking the current navigation item cancels a pending content request', async () => {
  const {ctx,state,requests,post} = contentFixture();
  const pending = ctx.openPost('first.md');
  await ctx.navigate('posts');
  requests[0].resolve(post('first.md')); await pending;
  assert.equal(state.view, 'posts'); assert.equal(state.current, undefined);
});
test('edits made while another article loads are not overwritten', async () => {
  for (const change of [state=>state.editorBuffer='new text',state=>state.metadataValues.title='new title']) {
    const {ctx,state,requests,notices,post} = contentFixture({view:'editor',current:{path:'editing.md'},editorBuffer:'original'});
    const pending = ctx.openPost('next.md');
    change(state); state.editorDirty=true;
    requests[0].resolve(post('next.md')); await pending;
    assert.equal(state.current.path, 'editing.md'); assert.equal(state.editorDirty, true);
    assert.match(notices[0][0], /编辑内容已变化/);
  }
});
test('project changes and stale errors cannot replace the current content', async () => {
  const {ctx,state,requests,notices,post} = contentFixture();
  const pending = ctx.openPost('old.md'); state.root='/another-blog';
  requests[0].resolve(post('old.md')); await pending;
  assert.equal(state.current, undefined);
  const older = ctx.openPost('missing.md'), newer = ctx.openPost('current.md');
  requests[2].resolve(post('current.md')); await newer;
  requests[1].reject(new Error('old error')); await older;
  assert.equal(state.current.path, 'current.md'); assert.equal(notices.length, 0);
});
test('failed configuration reload preserves unsaved buffer and conflict version', async () => {
  const config = {scope:'site',content:'disk',modified:'v1'};
  const {ctx,state,requests,renders,$} = contentFixture({view:'config',config,configBuffer:'my edits',configDirty:true});
  const pending = ctx.loadConfig('theme:demo');
  requests[0].reject(new Error('offline')); assert.equal(await pending, false);
  assert.equal(state.config, config); assert.equal(state.config.modified, 'v1');
  assert.equal(state.configBuffer, 'my edits'); assert.equal(state.configDirty, true);
  assert.equal(renders.at(-1), 'config');
  $('#config-editor').value = state.configBuffer;
  const saving = ctx.saveConfig();
  assert.equal(requests[1].options.data.modified, 'v1');
  assert.equal(requests[1].options.data.content, 'my edits');
  requests[1].resolve({modified:'v2'}); await saving;
  assert.equal(state.configDirty, false);
});
test('canceling configuration reload keeps input without issuing a request', async () => {
  const {ctx,state,requests} = contentFixture({view:'config',config:{scope:'site',content:'disk'},configBuffer:'my edits',configDirty:true});
  ctx.window.confirm=()=>false;
  assert.equal(await ctx.loadConfig(), false);
  assert.equal(requests.length, 0); assert.equal(state.configBuffer, 'my edits');
});
test('configuration loads cannot win over a newer article or navigation', async () => {
  const {ctx,state,requests,post} = contentFixture();
  const config = ctx.loadConfig();
  const article = ctx.openPost('article.md');
  requests[1].resolve(post('article.md')); await article;
  requests[0].resolve({scope:'site',content:'old'}); assert.equal(await config, false);
  assert.equal(state.view, 'editor'); assert.equal(state.config, undefined);
  const next = ctx.loadConfig();
  await ctx.navigate('posts'); const navigation = ctx.navigate('config');
  requests[2].reject(new Error('stale error')); assert.equal(await next, false);
  requests[3].resolve({scope:'site',content:'latest'}); await navigation;
  assert.equal(state.config.content, 'latest');
});

test('account changes do not submit when unsaved configuration departure is canceled', async () => {
  const $ = ui(), requests = [];
  const ctx = load("$('#account-settings').onclick", "$('#top-new').onclick", {
    $, state:{}, modal:()=>{}, closeModal:()=>{}, canLeaveEditor:()=>true, canLeaveConfig:()=>false,
    storageFields:()=>{}, storageValue:()=>({}), toast:()=>{},
    api:async(name)=>{requests.push(name); return {storage:{type:'postgres',label:'database'}};}
  });
  ctx.$('#account-settings').onclick();
  await ctx.$('#password-form').onsubmit({preventDefault(){}});
  assert.equal(requests.length, 0);
  await ctx.$('#account-storage').onclick();
  await ctx.$('#storage-form').onsubmit({preventDefault(){}});
  assert.deepEqual(requests, ['auth/storage']);
  assert.equal(ctx.$('#move-submit').disabled, false);
});
