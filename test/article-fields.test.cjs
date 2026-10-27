const test=require('node:test');
const assert=require('node:assert/strict');
const YAML=require('yaml');
const {inspect,patch,transform}=require('../server/article-fields.cjs');
const header=content=>YAML.parse(content.replace(/^\uFEFF/,'').split(/\r?\n---(?:\r?\n|$)/)[0].replace(/^---\r?\n/,''));

test('cover and custom values keep YAML types, comments, unrelated fields and article text',()=>{
  const source='---\ntitle: Test\ncover: /old.png # cover comment\n# exact untouched block\ncustom:\n  text: "keep quotes"\n  list: [a, b]\ncomments: true\n---\n\n## Body\n---\nkeep this';
  const result=patch(source,[{key:'cover',type:'text',value:'/images/new.png'},{key:'comments',type:'boolean',value:'false'},{key:'featured',type:'boolean',value:'true'},{key:'sticky',type:'number',value:'3'},{key:'description',type:'text',value:'false'},{key:'toc',type:'yaml',value:'enable: true\nlevels: [2, 3]'}]);
  const data=header(result);
  assert.equal(data.cover,'/images/new.png');assert.equal(data.comments,false);assert.equal(data.featured,true);assert.equal(data.sticky,3);assert.equal(data.description,'false');assert.deepEqual(data.toc,{enable:true,levels:[2,3]});
  assert.ok(result.includes('# exact untouched block\ncustom:\n  text: "keep quotes"\n  list: [a, b]\n'));
  assert.ok(result.includes('# cover comment'));assert.ok(result.endsWith('\n\n## Body\n---\nkeep this'));
  assert.equal(patch(source,[]),source);
});

test('field removals consume complete block values and preserve following comments and CRLF/BOM',()=>{
  const source='\uFEFF---\r\ntitle: Test\r\ncustom:\r\n- a\r\n- b\r\n# next field\r\ncomments: false\r\n---\r\nBody';
  const result=patch(source,[{key:'custom',remove:true}]);
  assert.equal(result,'\uFEFF---\r\ntitle: Test\r\n# next field\r\ncomments: false\r\n---\r\nBody');
  assert.deepEqual(header(patch('Body',[{key:'cover',type:'text',value:'/a.jpg'}])),{cover:'/a.jpg'});
  assert.equal(inspect('---\ntitle: Test\ncover: false\n...\nBody')[0].type,'boolean');
  assert.match(transform({content:'---\ntitle: Old\n...\nBody',metadata:{title:'New'},changes:[{key:'cover',type:'text',value:'/a.jpg'}]}).content,/title: "New"/);
});

test('inspection exposes typed custom fields and locks references without expanding aliases',()=>{
  const source='---\ntitle: Test\ndefaults: &d {a: 1}\ncustom: {use: *d}\ncover: /x.jpg\ncomments: false\nnumber: 3\nempty: null\n---\nBody';
  const fields=inspect(source);
  assert.equal(fields.some(field=>field.key==='title'),false);
  assert.equal(fields[0].editable,false);assert.equal(fields[1].editable,false);assert.match(fields[1].value,/\*d/);
  assert.equal(fields.find(field=>field.key==='cover').type,'text');assert.equal(fields.find(field=>field.key==='number').type,'number');
  assert.equal(fields.find(field=>field.key==='empty').type,'yaml');
  assert.throws(()=>patch(source,[{key:'defaults',remove:true}]),/锚点/);
  assert.ok(patch(source,[{key:'cover',type:'text',value:'/next.jpg'}]).includes('custom: {use: *d}'));
});

test('malformed YAML, duplicate keys, unsafe keys and unbounded fields are rejected without rewriting content',()=>{
  for(const content of ['---\ncover: [broken\n---\nBody','---\ncover: 1\ncover: 2\n---\nBody','---\ncover: x','"title":"JSON"\n;;;\nBody','---\n{cover: /a}\n---\nBody'])assert.throws(()=>inspect(content));
  for(const key of ['title','date','__proto__','constructor','bad\nkey','x'.repeat(65)])assert.throws(()=>patch('Body',[{key,type:'text',value:'x'}]));
  for(const change of [{key:'x',type:'number',value:'NaN'},{key:'x',type:'boolean',value:'yes'},{key:'x',type:'yaml',value:'*missing'},{key:'x',type:'yaml',value:'!!js/function >\n  bad'},{key:'x',type:'text',value:'x'.repeat(32001)}])assert.throws(()=>patch('Body',[change]));
  assert.throws(()=>patch('Body',[{key:'x',remove:true},{key:'x',remove:true}]),/重复/);
  assert.throws(()=>inspect('---\n'+Array.from({length:201},(_,i)=>`field${i}: true`).join('\n')+'\n---\nBody'),/200/);
});

test('local saves persist reviewed custom metadata through the existing conflict-protected path',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),core=require('../server/core.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hs-fields-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'source','_posts'),{recursive:true});fs.writeFileSync(path.join(root,'_config.yml'),'title: Test');
  const created=core.createPost(root,'Fields',undefined,'draft'),post=core.readPost(root,created.path,'draft');
  const prepared=transform({content:post.content,metadata:{title:'Edited title'},changes:[{key:'cover',type:'text',value:'/images/cover.jpg'},{key:'top_img',type:'boolean',value:'false'}]});
  assert.equal(core.readPost(root,post.path,'draft').content,post.content);
  const saved=core.savePost(root,post.path,prepared.content,post.modified,{},'draft');
  assert.equal(header(saved.content).cover,'/images/cover.jpg');assert.equal(header(saved.content).top_img,false);assert.equal(saved.meta.title,'Edited title');
});
