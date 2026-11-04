const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const source = fs.readFileSync(require.resolve('../public/save-conflicts.js'), 'utf8');
function fixture() {
  const nodes = new Map(), notices = [], applied = [];
  const document = { activeElement: null };
  function $(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { value: '', textContent: '', innerHTML: '', checked: false, disabled: id === '#conflict-apply', dataset: {}, isConnected: true,
        classList: {add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
        focus(){document.activeElement=this;},setAttribute(){},removeAttribute(){},
        querySelector:()=>null,querySelectorAll:()=>[...nodes.values()] });
    }
    return nodes.get(id);
  }
  $('#modal').classList.add('hidden');
  const state = {}, context = vm.createContext({ $,state,document, t: x=>x, toast: (...args)=>notices.push(args),module:{exports:{}} });
  vm.runInContext(app.slice(app.indexOf('function modal(content)'),app.indexOf('async function withButton(')),context);
  vm.runInContext(source, context);
  let active = true, read = async()=>({content:'latest',modified:'v2'}), prepare = async content=>({content});
  const options = {label:'<script>.md',base:'base',mine:async()=>'<img src=x onerror=alert(1)>',current:()=>active,
    read:()=>read(),prepare:value=>prepare(value),apply:(...args)=>applied.push(args)};
  return { $, state, context, options, applied, notices,
    open:()=>context.module.exports.open(options), read(fn){read=fn;}, prepare(fn){prepare=fn;}, active(value){active=value;} };
}
test('review uses text fields, applies only with acknowledgement and does not save',async()=>{
  const f=fixture();await f.open();
  assert.equal(f.$('#conflict-file').textContent,'<script>.md');
  assert.equal(f.$('#conflict-merged').value,'<img src=x onerror=alert(1)>');
  assert.equal(f.$('#conflict-apply').disabled,true);
  f.$('#conflict-merged').value='merged';f.$('#conflict-merged').oninput();
  f.$('#conflict-reviewed').checked=true;f.$('#conflict-reviewed').onchange();
  await f.$('#conflict-apply').onclick();
  assert.equal(f.applied.length,1);assert.equal(f.applied[0][0].modified,'v2');assert.equal(f.applied[0][1].content,'merged');
  assert.equal(f.$('#modal').classList.contains('hidden'),true);
});
test('closing an edited merge requires explicit discard and leaves the original editor intact',async()=>{
  const f=fixture();await f.open();f.$('#conflict-merged').value='unsaved merge';
  f.context.closeModal();assert.equal(f.$('#modal').classList.contains('hidden'),false);
  assert.equal(f.$('#conflict-discard').classList.contains('hidden'),false);
  f.$('#conflict-keep').onclick();assert.equal(f.$('#conflict-merged').value,'unsaved merge');
  f.context.closeModal();f.$('#conflict-discard-confirm').onclick();
  assert.equal(f.applied.length,0);assert.equal(f.$('#modal').classList.contains('hidden'),true);
});
test('comparison refresh preserves merged text and requires acknowledgement again',async()=>{
  const f=fixture();await f.open();f.$('#conflict-merged').value='my merge';f.$('#conflict-reviewed').checked=true;
  f.read(async()=>({content:'newer',modified:'v3'}));await f.$('#conflict-refresh').onclick();
  assert.equal(f.$('#conflict-merged').value,'my merge');assert.equal(f.$('#conflict-latest').value,'newer');
  assert.equal(f.$('#conflict-reviewed').checked,false);assert.equal(f.$('#conflict-apply').disabled,true);
  f.$('#conflict-reviewed').checked=true;f.$('#conflict-reviewed').onchange();await f.$('#conflict-apply').onclick();
  assert.equal(f.applied[0][0].modified,'v3');
});
test('failed reads and preparation retain edits and allow retries without applying',async()=>{
  const f=fixture();await f.open();f.$('#conflict-merged').value='keep me';
  f.read(async()=>{throw new Error('offline');});await f.$('#conflict-refresh').onclick();
  assert.equal(f.$('#conflict-merged').value,'keep me');assert.equal(f.$('#modal-feedback').textContent,'offline');
  f.$('#conflict-reviewed').checked=true;f.$('#conflict-reviewed').onchange();
  f.prepare(async()=>{throw new Error('invalid');});await f.$('#conflict-apply').onclick();
  assert.equal(f.$('#conflict-merged').value,'keep me');assert.equal(f.applied.length,0);
});
test('late or stale comparison responses never apply to another document',async()=>{
  const f=fixture();let resolve;f.read(()=>new Promise(r=>resolve=r));const pending=f.open();
  f.context.closeModal();resolve({content:'late',modified:'v2'});await pending;
  assert.equal(f.$('#modal').classList.contains('hidden'),true);
  const g=fixture();await g.open();g.active(false);g.$('#conflict-reviewed').checked=true;g.$('#conflict-reviewed').onchange();
  await g.$('#conflict-apply').onclick();assert.equal(g.applied.length,0);
  assert.match(g.notices.at(-1)[0],/编辑内容已变化/);
});

test('initial read failure shows a recoverable error without losing the source snapshot',async()=>{
  const f=fixture();f.read(async()=>{throw new Error('<bad response>');});await f.open();
  assert.equal(f.$('#conflict-load-error').textContent,'<bad response>');assert.equal(f.applied.length,0);
  f.read(async()=>({content:'restored',modified:'v3'}));await f.$('#conflict-load-retry').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.$('#conflict-latest').value,'restored');assert.match(f.$('#conflict-merged').value,/onerror/);
});

test('article adapter incorporates sidebar edits and resets metadata to the reviewed merge',async()=>{
  let options, backups=0;const calls=[];
  const post={path:'post.md',kind:'post',content:'---\ntitle: Old\n---\nBase',modified:'v1',meta:{title:'Old'}};
  const state={root:'/blog',view:'editor',current:post,metadataValues:{title:'Sidebar title',date:'',tags:'',categories:''}};
  const nodes=new Map(),$=key=>{if(!nodes.has(key))nodes.set(key,{value:''});return nodes.get(key);};$('#editor').value=post.content+'\nMy edit';
  const context=vm.createContext({state,$,SaveConflicts:{open:value=>{options=value;}},
    metadataEdits:()=>({title:'Sidebar title'}),metadataValues:meta=>({title:meta.title||'',date:meta.date||'',tags:'',categories:''}),
    api:async(name,data)=>{calls.push({name,data});return require('../server/article-fields.cjs').transform(data.data);},
    editorPage(){},saveDraft(){backups++;},clearDraft(){}});
  vm.runInContext(app.slice(app.indexOf('function reviewSaveConflict('),app.indexOf('async function savePost()')),context);
  context.reviewSaveConflict('post');assert.equal(options.current(),true);
  assert.match(await options.mine(),/title: "Sidebar title"/);
  const merged=await options.prepare('---\ntitle: Merged title\n---\nBoth edits');
  options.apply({...post,content:'Latest',modified:'v2'},merged);
  assert.equal(state.editorBaseModified,'v2');assert.equal(state.editorBuffer,merged.content);
  assert.equal(state.metadataValues.title,'Merged title');assert.equal(JSON.stringify(state.metadataValues),JSON.stringify(state.metadataBase));
  assert.equal(state.editorDirty,true);assert.equal(backups,1);assert.equal(calls.some(x=>x.data.method==='PUT'),false);
  assert.equal(options.current(),false);
});
test('configuration adapter updates the comparison version but leaves saving explicit',async()=>{
  let options;const config={scope:'site',content:'base',modified:'v1'};
  const state={root:'/blog',view:'config',config};const context=vm.createContext({state,$:()=>({value:'mine'}),SaveConflicts:{open:value=>{options=value;}},configPage(){}});
  vm.runInContext(app.slice(app.indexOf('function reviewSaveConflict('),app.indexOf('async function savePost()')),context);
  context.reviewSaveConflict('config');assert.equal(await options.mine(),'mine');
  options.apply({scope:'site',content:'latest',modified:'v2'},await options.prepare('manual merge'));
  assert.equal(state.config.modified,'v2');assert.equal(state.config.content,'latest');assert.equal(state.configBuffer,'manual merge');assert.equal(state.configDirty,true);
});
