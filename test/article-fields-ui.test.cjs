const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function fixture() {
  const state={root:'/blog',view:'editor',current:{path:'post.md',kind:'post'},metadataValues:{title:'Title'}},editor={value:'Body'};
  const ctx=vm.createContext({state,$:()=>editor,metadataEdits:()=>({}),document:{addEventListener(){}},URL,location:{origin:'http://127.0.0.1:4545'}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/article-fields.js'),'utf8')+'\nthis.fields=ArticleFields;',ctx);
  return {state,editor,fields:ctx.fields};
}
test('custom fields diff preserves false, zero, empty text and untouched complex YAML',()=>{
  const {fields}=fixture();
  const original=new Map([['comments',{type:'boolean',value:'true'}],['cover',{type:'text',value:'/old.jpg'}],['custom',{type:'yaml',value:'a: 1'}]]);
  const working=new Map([...original].map(([key,value])=>[key,{...value}]));
  working.get('comments').value='false';working.get('cover').deleted=true;
  working.set('sticky',{type:'number',value:'0'});working.set('description',{type:'text',value:''});
  const changes=fields.changesFor(original,working);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)),[{key:'comments',type:'boolean',value:'false'},{key:'cover',remove:true},{key:'sticky',type:'number',value:'0'},{key:'description',type:'text',value:''}]);
});
test('late field changes cannot overwrite another document or newer editor metadata',()=>{
  const f=fixture(),saved=f.fields.snapshot();assert.equal(f.fields.current(saved),true);
  f.editor.value='New body';assert.equal(f.fields.current(saved),false);f.editor.value='Body';
  f.state.metadataValues.title='Changed';assert.equal(f.fields.current(saved),false);f.state.metadataValues.title='Title';
  f.state.current.path='other.md';assert.equal(f.fields.current(saved),false);f.state.current.path='post.md';
  f.state.root='/other';assert.equal(f.fields.current(saved),false);
});
test('cover preview excludes script, data, credential and insecure external URLs',()=>{
  const {fields}=fixture();
  for(const value of ['javascript:alert(1)','data:image/svg+xml,<svg/>','https://user:pass@site.test/a.png','http://site.test/a.png','\\\\site.test/a.png'])assert.equal(fields.imageUrl(value),null);
  assert.equal(fields.imageUrl('/images/hexostudio/example.png'),'http://127.0.0.1:4545/images/hexostudio/example.png');
  assert.equal(fields.imageUrl('https://images.example/cover.png'),'https://images.example/cover.png');
});
