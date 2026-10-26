const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const HexoI18n = require('../public/i18n.js');
function include(ctx, start, end) {
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), ctx);
}
function fixture() {
  const nodes = new Map(), document = {activeElement:null};
  function element() {
    const classes = new Set(), attributes = new Map();
    return {
      value:'', textContent:'', innerHTML:'', dataset:{}, disabled:false, isConnected:true, inert:false,
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},
      setAttribute:(name,value)=>attributes.set(name,value), removeAttribute:name=>attributes.delete(name), getAttribute:name=>attributes.get(name),
      focus(){document.activeElement=this;}, querySelector:()=>null, querySelectorAll:()=>[]
    };
  }
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const input=$('#new-title'), submit=$('#create-post'), cancel=$('#cancel-modal'), preserved=$('#existing-disabled');
  input.value='A new article'; submit.textContent='创建并编辑'; preserved.disabled=true;
  $('#modal-content').querySelector=()=>input;
  $('#modal-content').querySelectorAll=()=>[input,submit,cancel,preserved];
  $('#modal').classList.add('hidden');
  const opener=element(); opener.focus();
  const state={newKind:'post',view:'posts',posts:[],drafts:[],pages:[]}, requests=[], notices=[], opened=[];
  const ctx=vm.createContext({$,state,document,t:HexoI18n.t,escapeHTML:value=>value,
    api:(name,options)=>new Promise((resolve,reject)=>requests.push({name,options,resolve,reject})),
    toast:(...args)=>notices.push(args),refreshPosts:async()=>{},localDateTime:()=> '2026-10-25 12:00:00',
    openPost:async(...args)=>opened.push(args),render:()=>{},clearDraft:()=>{}
  });
  include(ctx,'const icon =', 'const endpoint =');
  include(ctx,'function modal(content)', 'function viewError(');
  ctx.modal('<h2>Temporary form</h2>');
  return {ctx,$,state,requests,notices,opened,input,submit,cancel,preserved,opener,document,element};
}
test('pending modal actions lock controls, prevent duplicate writes and keep the background inert', async () => {
  const f=fixture(); let complete, calls=0;
  const pending=f.ctx.modalAction(f.submit,()=>{calls++;return new Promise(resolve=>{complete=resolve;});},'正在创建…');
  assert.equal(f.state.modalBusy,true);
  assert.equal(f.$('#app').inert,true); assert.equal(f.$('#setup-blog-screen').inert,true);
  for (const control of [f.submit,f.input,f.cancel,f.$('#modal-close')]) assert.equal(control.disabled,true);
  assert.equal(f.$('#modal-content').getAttribute('aria-busy'),'true');
  f.ctx.closeModal({type:'click'}); // An event argument must not bypass the lock.
  f.ctx.closeModal();
  assert.equal(f.$('#modal').classList.contains('hidden'),false);
  assert.equal((await f.ctx.modalAction(f.submit,()=>{calls++;})).ok,false);
  assert.equal(f.ctx.modal('<h2>Replacement</h2>'),false);
  complete('created'); assert.equal((await pending).value,'created'); assert.equal(calls,1);
  assert.equal(f.state.modalBusy,false); assert.equal(f.input.disabled,false); assert.equal(f.preserved.disabled,true);
  assert.equal(f.submit.textContent,'创建并编辑'); assert.equal(f.document.activeElement,f.submit);
  f.ctx.closeModal();
  assert.equal(f.$('#app').inert,false); assert.equal(f.document.activeElement,f.opener);
});
test('failed operations retain input and render errors as text, then allow a retry', async () => {
  const f=fixture();
  const result=await f.ctx.modalAction(f.submit,async()=>{throw new Error('<img src=x onerror=alert(1)>');});
  assert.equal(result.ok,false); assert.equal(f.input.value,'A new article');
  assert.equal(f.$('#modal-feedback').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(f.$('#modal-feedback').innerHTML,''); assert.equal(f.$('#modal-feedback').getAttribute('role'),'alert');
  assert.equal(f.$('#modal-feedback').dataset.tone,'error'); assert.equal(f.cancel.disabled,false);
  const retry=await f.ctx.modalAction(f.submit,async()=>42);
  assert.equal(retry.value,42); assert.equal(f.$('#modal-feedback').classList.contains('hidden'),true);
});
test('session expiry can dismiss a pending modal without a late error appearing over login', async () => {
  const f=fixture(); let reject;
  const pending=f.ctx.modalAction(f.submit,()=>new Promise((_,fail)=>{reject=fail;}));
  f.ctx.closeModal(true);
  assert.equal(f.$('#app').inert,false);
  reject(new Error('session expired')); assert.equal((await pending).ok,false);
  assert.equal(f.$('#modal-feedback').classList.contains('hidden'),true);
  assert.equal(f.state.modalBusy,false); assert.equal(f.$('#modal-close').disabled,false);
});
test('creating content waits for completion, submits once and opens the returned file', async () => {
  const f=fixture(); include(f.ctx,'async function createPost()', 'async function refreshPosts()');
  const pending=f.ctx.createPost(); await f.ctx.createPost();
  assert.equal(f.requests.length,1); assert.equal(f.$('#modal').classList.contains('hidden'),false);
  f.requests[0].resolve({path:'new.md'}); await pending;
  assert.equal(f.$('#modal').classList.contains('hidden'),true);
  assert.deepEqual(f.opened,[['new.md','post',true]]);
});
test('failed creation preserves the title and never opens an editor', async () => {
  const f=fixture(); include(f.ctx,'async function createPost()', 'async function refreshPosts()');
  const pending=f.ctx.createPost(); f.requests[0].reject(new Error('permission denied')); await pending;
  assert.equal(f.input.value,'A new article'); assert.equal(f.opened.length,0);
  assert.equal(f.$('#modal').classList.contains('hidden'),false); assert.equal(f.submit.disabled,false);
});
test('publishing is single-submit and failed publication keeps the draft for retry', async () => {
  const f=fixture(); include(f.ctx,'async function requestPublish(', 'function updateConfigStatus()');
  f.state.drafts=[{path:'draft.md',title:'Draft',modified:'v1'}];
  await f.ctx.requestPublish('draft.md');
  const pending=f.$('#confirm-publish').onclick(); await f.$('#confirm-publish').onclick();
  assert.equal(f.requests.length,1); assert.equal(f.requests[0].options.data.modified,'v1');
  f.requests[0].reject(new Error('conflict')); await pending;
  assert.equal(f.state.drafts.length,1); assert.equal(f.$('#modal').classList.contains('hidden'),false);
  const retry=f.$('#confirm-publish').onclick(); f.requests[1].resolve({path:'published.md'}); await retry;
  assert.equal(f.state.drafts.length,0); assert.equal(f.state.view,'posts');
  assert.equal(f.$('#modal').classList.contains('hidden'),true);
});
test('failed deletion retains the list and successful retry removes only the selected item', async () => {
  const f=fixture(); include(f.ctx,'async function requestPublish(', 'function updateConfigStatus()');
  f.state.posts=[{path:'a.md'},{path:'b.md'}]; f.ctx.confirmDelete('a.md');
  const pending=f.$('#confirm-delete').onclick(); await f.$('#confirm-delete').onclick();
  assert.equal(f.requests.length,1);
  f.requests[0].reject(new Error('permission denied')); await pending;
  assert.equal(f.state.posts.length,2);
  const retry=f.$('#confirm-delete').onclick(); f.requests[1].resolve({}); await retry;
  assert.deepEqual(Array.from(f.state.posts,post=>post.path),['b.md']);
});
test('late Git diff responses cannot overwrite a different file dialog', async () => {
  const f=fixture(); include(f.ctx,'async function showGitDiff(', 'async function gitCommit()');
  const first=f.element(), second=f.element();
  let current=first;
  const original=f.ctx.$; f.ctx.$=selector=>selector==='#git-diff-content'?current:original(selector);
  const old=f.ctx.showGitDiff('old.md','working'); current=second;
  const latest=f.ctx.showGitDiff('new.md','working');
  f.requests[1].resolve({content:'+new'}); await latest;
  f.requests[0].resolve({content:'+old'}); await old;
  assert.match(second.innerHTML,/new/); assert.doesNotMatch(second.innerHTML,/old/);
});

test('password submissions are serialized and a failed request keeps the form for retry', async () => {
  const f=fixture();
  Object.assign(f.ctx,{canLeaveEditor:()=>true,canLeaveConfig:()=>true,showAuth:()=>{},storageFields:()=>{},storageValue:()=>({})});
  include(f.ctx,"$('#account-settings').onclick", "$('#top-new').onclick");
  f.$('#account-settings').onclick();
  f.$('#old-password').value='old test password';
  f.$('#new-password').value=f.$('#confirm-password').value='new test password';
  const event={preventDefault(){}};
  const pending=f.$('#password-form').onsubmit(event); await f.$('#password-form').onsubmit(event);
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].options.data.newPassword,'new test password');
  f.requests[0].reject(new Error('incorrect current password')); await pending;
  assert.equal(f.$('#new-password').value,'new test password');
  assert.equal(f.$('#modal-feedback').textContent,'incorrect current password');
  assert.equal(f.$('#modal').classList.contains('hidden'),false);
});
test('database connection testing blocks migration until the probe finishes', async () => {
  const f=fixture();
  Object.assign(f.ctx,{canLeaveEditor:()=>true,canLeaveConfig:()=>true,showAuth:()=>{},storageFields:()=>{},storageValue:()=>({type:'postgres',url:'test database'})});
  include(f.ctx,"$('#account-settings').onclick", "$('#top-new').onclick");
  const opening=f.$('#account-storage').onclick(); f.requests[0].resolve({storage:{type:'postgres',label:'database'}}); await opening;
  const probe=f.$('#move-test').onclick();
  await f.$('#storage-form').onsubmit({preventDefault(){}});
  assert.deepEqual(f.requests.map(request=>request.name),['auth/storage','auth/storage/test']);
  f.requests[1].resolve({}); await probe;
  const migration=f.$('#storage-form').onsubmit({preventDefault(){}});
  assert.equal(f.requests[2].name,'auth/storage/migrate');
  f.requests[2].reject(new Error('database unavailable')); await migration;
  assert.equal(f.$('#modal-feedback').textContent,'database unavailable');
  assert.equal(f.$('#move-submit').disabled,false);
});

test('file permission failures show localized recovery guidance without raw paths', () => {
  try {
    HexoI18n.setLanguage('zh-CN');
    assert.equal(HexoI18n.error("EACCES: permission denied, open '/private/blog/article.md'"),'没有文件读写权限，请检查博客目录权限后重试');
    HexoI18n.setLanguage('en');
    assert.equal(HexoI18n.error("EPERM: operation not permitted, open '/private/blog'"),'File access denied. Check your blog folder permissions and try again.');
    assert.match(HexoI18n.error("EROFS: read-only file system, open '/private/blog'"),/writable folder/);
    assert.equal(HexoI18n.error('unrelated error'),'unrelated error');
  } finally { HexoI18n.setLanguage('zh-CN'); }
});

test('closing account storage while it loads prevents a late response reopening the dialog', async () => {
  const f=fixture();
  include(f.ctx,"$('#account-settings').onclick", "$('#top-new').onclick");
  const pending=f.$('#account-storage').onclick();
  f.ctx.closeModal();
  const version=f.state.dialogVersion;
  f.requests[0].resolve({storage:{type:'postgres',label:'database'}}); await pending;
  assert.equal(f.$('#modal').classList.contains('hidden'),true);
  assert.equal(f.state.dialogVersion,version);
});
