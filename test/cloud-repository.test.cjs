const test=require('node:test');
const assert=require('node:assert/strict');
const {RemoteRepository,safePath}=require('../server/remote-repository.cjs');
const {CloudContent,articlePath,configName}=require('../server/cloud-content.cjs');
const connection={provider:'github',repository:'owner/blog',branch:'main',token:'test-secret',blogPath:'blog'};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});

test('GitHub writes preserve the original tree and use a non-forced ref update; stale files never write',async()=>{
  const calls=[],repo=new RemoteRepository(connection,async(url,options)=>{
    calls.push({url,...options,data:options.body&&JSON.parse(options.body)});
    return json({sha:'new-sha'});
  });
  const snapshot={head:'head-sha',tree:'tree-sha',entries:[{path:'blog/source/_posts/a.md',id:'old-sha'}]};
  await assert.rejects(repo.commit(snapshot,[{path:'blog/source/_posts/a.md',expected:'stale',content:'x'}],'update'),error=>error.status===409);
  assert.equal(calls.length,0);
  await repo.commit(snapshot,[{path:'blog/source/_posts/a.md',expected:'old-sha',content:'new'}],'Update');
  assert.deepEqual(calls[1].data,{base_tree:'tree-sha',tree:[{path:'blog/source/_posts/a.md',mode:'100644',type:'blob',sha:'new-sha'}]});
  assert.deepEqual(calls[2].data.parents,['head-sha']);
  assert.deepEqual(calls[3].data,{sha:'new-sha',force:false});
  assert.equal(calls[0].headers.Authorization,'Bearer test-secret');
  assert.equal(calls[0].redirect,'error');
});

test('GitHub snapshots exclude symlinks and reject incomplete trees',async()=>{
  let truncated=false;
  const repo=new RemoteRepository({...connection,branch:''},async url=>{
    if(url.endsWith('/owner/blog'))return json({default_branch:'main'});
    if(url.includes('/branches/'))return json({commit:{sha:'head'}});
    if(url.includes('/git/commits/'))return json({tree:{sha:'tree'}});
    return json({truncated,tree:[{type:'blob',mode:'100644',path:'blog/_config.yml',sha:'config'},{type:'blob',mode:'120000',path:'secret',sha:'link'},{type:'commit',mode:'160000',path:'submodule',sha:'sub'}]});
  });
  assert.deepEqual((await repo.snapshot()).entries,[{path:'blog/_config.yml',id:'config',size:undefined}]);
  truncated=true;await assert.rejects(repo.snapshot(),/过大/);
});

test('GitLab publishes in a single commit with last_commit_id concurrency checks',async()=>{
  const calls=[],repo=new RemoteRepository({...connection,provider:'gitlab',repository:'group/sub/blog'},async(url,options)=>{
    calls.push({url,...options,data:options.body&&JSON.parse(options.body)});
    return json(options.method==='GET'?{encoding:'base64',content:Buffer.from('draft').toString('base64'),last_commit_id:'file-commit'}:{id:'published'});
  });
  await repo.commit({head:'head',entries:[{path:'blog/source/_drafts/a.md',id:'old'}]},[
    {path:'blog/source/_drafts/a.md',expected:'old',content:null},{path:'blog/source/_posts/a.md',expected:null,content:'published'}
  ],'Publish');
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/projects\/group%2Fsub%2Fblog/);
  assert.equal(calls[0].headers['PRIVATE-TOKEN'],'test-secret');
  assert.deepEqual(calls[1].data.actions[0],{action:'delete',file_path:'blog/source/_drafts/a.md',last_commit_id:'file-commit'});
  assert.equal(calls[1].data.actions[1].action,'create');
});

test('provider errors do not leak tokens or upstream bodies; unsafe paths and destinations are rejected',async()=>{
  for(const provider of ['github','gitlab']){
    const repo=new RemoteRepository({...connection,provider},async()=>json({error:'test-secret'},403));
    await assert.rejects(repo.snapshot(),error=>error.status===502&&!error.message.includes('test-secret'));
  }
  for(const name of ['../secret','/secret','a//b','a/.git/config','a\\b'])assert.throws(()=>safePath(name));
  assert.throws(()=>articlePath('_posts/a.md','page'));
  assert.throws(()=>configName('theme:../secret'));
  assert.throws(()=>new RemoteRepository({...connection,repository:'https://evil.example/owner/blog'}));
});

test('cloud content covers articles, drafts, pages, configs, images and optimistic conflicts',async()=>{
  const paths=new RemoteRepository(connection),files=new Map(),commits=[];
  let version=0;
  const write=(name,content)=>files.set(name,{buffer:Buffer.from(content),modified:String(++version)});
  write('blog/_config.yml','title: Cloud blog\ntheme: landscape\n');
  write('blog/themes/landscape/_config.yml','# theme\n');
  const repo={
    path:name=>paths.path(name),relative:name=>paths.relative(name),
    async snapshot(){return {entries:[...files].map(([path,file])=>({path,id:file.modified,size:file.buffer.length}))};},
    async read(snapshot,name){const file=files.get(name);assert.ok(file,`Missing ${name}`);return {...file};},
    async commit(snapshot,changes,message){
      for(const change of changes)if((files.get(change.path)?.modified??null)!==change.expected)throw Object.assign(new Error('conflict'),{status:409});
      for(const change of changes)if(change.content===null)files.delete(change.path);else write(change.path,change.content);
      commits.push({changes,message});
    }
  };
  const content=new CloudContent(repo);
  assert.deepEqual(await content.site(await repo.snapshot()),{title:'Cloud blog',theme:'landscape'});
  const draft=await content.create({title:'A new draft',kind:'draft'});
  const read=await content.read(await repo.snapshot(),draft.path,'draft');
  await assert.rejects(content.save(draft.path,'draft',{content:'changed',modified:'stale'}),error=>error.status===409);
  const saved=await content.save(draft.path,'draft',{content:read.content+'正文',modified:read.modified,metadata:{tags:['test']}});
  const prepared=require('../server/article-fields.cjs').transform({content:saved.content,changes:[{key:'cover',type:'text',value:'/images/cover.jpg'},{key:'comments',type:'boolean',value:'false'}]});
  const decorated=await content.save(draft.path,'draft',{content:prepared.content,modified:saved.modified});
  assert.match(decorated.content,/cover: \/images\/cover.jpg/);assert.match(decorated.content,/comments: false/);
  const published=await content.publish({path:draft.path,modified:decorated.modified});
  assert.equal(published.kind,'post');assert.ok(published.meta.date);assert.deepEqual(published.meta.tags,['test']);
  assert.equal(commits.at(-1).changes.length,2);
  assert.equal((await content.list('draft')).length,0);
  const page=await content.create({title:'About',kind:'page'});
  assert.equal(page.path,'about/index.md');assert.equal((await content.list('page')).length,1);
  const configs=await content.configs();
  assert.deepEqual(configs.map(x=>x.scope),['site','theme:landscape']);
  assert.equal(configs[0].bytes,Buffer.byteLength('title: Cloud blog\ntheme: landscape\n'));
  const cfg=await content.config();assert.deepEqual(cfg.themes,['landscape']);
  await content.saveConfig({scope:'site',content:'# retained\ntitle: Changed\n',modified:cfg.modified});
  assert.match((await content.config()).content,/# retained/);
  const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
  const image=await content.upload({name:'test.png',data:png.toString('base64')});
  assert.equal((await content.images()).length,1);
  assert.deepEqual((await content.image(image.name)).buffer,png);
  await assert.rejects(content.upload({name:'script.svg',data:Buffer.from('<svg/>').toString('base64')}));
  await content.remove(published.path,'post',published.modified);
  assert.equal((await content.list('post')).length,0);
});

test('AI draft creation includes reviewed prose in a single remote commit and cannot publish it',async()=>{
  const writes=[];
  const repo={path:name=>name,snapshot:async()=>({entries:[]}),commit:async(_snapshot,changes)=>writes.push(changes)};
  const content=new CloudContent(repo);
  const draft=await content.create({title:'Reviewed AI article',kind:'draft',content:'# A reviewed draft'});
  assert.equal(writes.length,1);assert.match(writes[0][0].path,/^source\/_drafts\//);
  assert.match(draft.content,/---\n\n# A reviewed draft/);
  await assert.rejects(content.create({title:'Unreviewed',kind:'post',content:'Never publish automatically'}),/草稿/);
  assert.equal(writes.length,1);
});
