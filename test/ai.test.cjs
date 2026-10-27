const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ai=require('../server/ai.cjs');
const configured=()=>ai.mutation(undefined,{revision:'initial',baseUrl:'https://provider.example/v1',model:'writer-model',apiKey:'test-private-key'});
const input={action:'article',prompt:'A blog about testing',text:'',language:'en'};

test('AI settings keep secrets server-side and never reuse a key for a new endpoint',()=>{
  const config=configured(), publicConfig=ai.record(config);
  assert.equal(publicConfig.hasKey,true);
  assert.equal(JSON.stringify(publicConfig).includes('test-private-key'),false);
  assert.equal(ai.mutation(config,{...publicConfig,apiKey:''}).apiKey,config.apiKey);
  assert.throws(()=>ai.mutation(config,{...publicConfig,baseUrl:'https://other.example/v1'}),/API Key/);
  assert.throws(()=>ai.mutation(config,{...publicConfig,revision:'stale'}),error=>error.status===409);
  assert.equal(ai.record(ai.mutation(config,publicConfig,true)).hasKey,false);
  assert.equal(ai.baseUrl('https://provider.example/v1/chat/completions/'),'https://provider.example/v1');
  for(const url of ['http://provider.example','https://127.1','https://2130706433','https://[::1]','https://[::ffff:127.0.0.1]','https://user:pass@provider.example','https://provider.example?token=x']) assert.throws(()=>ai.baseUrl(url));
});

test('AI request validation sends only explicitly selected content and bounds input',()=>{
  const messages=ai.inputMessages({...input,text:'PRIVATE ARTICLE NOT SELECTED'});
  assert.equal(JSON.stringify(messages).includes('PRIVATE ARTICLE'),false);
  assert.match(ai.inputMessages({...input,action:'polish',text:'Selected paragraph'})[1].content,/Selected paragraph/);
  for(const patch of [{action:'unknown'},{prompt:'x'.repeat(6001)},{action:'polish',text:''},{text:'x'.repeat(16001)}]) assert.throws(()=>ai.inputMessages({...input,...patch}));
});

function transport(data, status=200, inspect=()=>{}) {
  return {lookup:async()=>[{address:'93.184.216.34',family:4}],request:(url,options,callback)=>{
    const req=new EventEmitter();
    req.end=payload=>{inspect(url,options,JSON.parse(payload));queueMicrotask(()=>{
      const res=new EventEmitter();res.statusCode=status;res.destroy=()=>{};
      callback(res);
      if(status===200){res.emit('data',Buffer.from(typeof data==='string'?data:JSON.stringify(data)));res.emit('end');}
    });};return req;
  }};
}
test('AI transport pins DNS, authenticates only the configured endpoint and returns bounded Markdown',async()=>{
  const config=configured();
  const response=await ai.completion(config,ai.inputMessages(input),transport({choices:[{message:{content:'```markdown\n# Draft\n```'},finish_reason:'length'}]},200,(url,options,payload)=>{
    assert.equal(url.href,'https://provider.example/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer test-private-key');
    assert.equal(options.agent,false);
    options.lookup(url.hostname,{},(error,address)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');});
    options.lookup(url.hostname,{all:true},(error,addresses)=>assert.equal(addresses[0].address,'93.184.216.34'));
    assert.equal(payload.max_tokens,4096);assert.equal(payload.stream,false);
  }));
  assert.deepEqual(response,{content:'# Draft',truncated:true});
  await ai.completion({...config,baseUrl:'https://api.openai.com/v1'},[],transport({choices:[{message:{content:'ok'}}]},200,(_u,_o,payload)=>{assert.equal(payload.max_completion_tokens,4096);assert.equal(payload.max_tokens,undefined);}));
  for(const status of [301,302,401,429,500]) await assert.rejects(ai.completion(config,[],transport('secret upstream error',status)),error=>error.status===502&&!error.message.includes('secret'));
  for(const result of ['not json',{choices:[]},{choices:[{message:{content:null}}]}]) await assert.rejects(ai.completion(config,[],transport(result)),/AI/);
});

test('private DNS answers and mapped or reserved addresses are rejected before sending credentials',async()=>{
  for(const address of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.100.100.200','::1','fc00::1','fe80::1','::ffff:8.8.8.8','2002:7f00:1::','2001:db8::1']) assert.equal(ai.publicAddress(address),false,address);
  for(const address of ['8.8.8.8','93.184.216.34','2606:4700:4700::1111']) assert.equal(ai.publicAddress(address),true,address);
  let sent=false;
  await assert.rejects(ai.completion(configured(),[],{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],request:()=>{sent=true;}}),/公网/);
  assert.equal(sent,false);
  await assert.rejects(ai.completion(configured(),[],{lookup:()=>new Promise(()=>{}),timeout:5}),error=>error.status===504);
});

test('generation shares a concurrency lease and rate limit, and releases failures without leaking keys',async()=>{
  const data={ai:configured()};const store={async update(action){return action(data);}};
  const request={...input,revision:data.ai.revision};let release;
  const running=ai.generate(store,request,()=>{},()=>new Promise(resolve=>{release=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(ai.generate(store,request),error=>error.status===429);
  release({content:'draft'});assert.deepEqual(await running,{content:'draft'});
  assert.equal(data.aiUsage.expires,undefined);
  await assert.rejects(ai.generate(store,request,()=>{throw Object.assign(new Error('expired'),{status:401});}),error=>error.status===401);
  await assert.rejects(ai.generate(store,{...request,revision:'stale'}),error=>error.status===409);
  await assert.rejects(ai.generate(store,request,()=>{},async()=>{throw new Error('provider failure');}),/provider failure/);
  assert.equal(data.aiUsage.expires,undefined);
  data.aiUsage.count=10;
  await assert.rejects(ai.generate(store,request),error=>error.status===429);
});

test('generated prose is atomically saved only in drafts, preserving server-created front matter',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hs-ai-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'source','_posts'),{recursive:true});fs.writeFileSync(path.join(root,'_config.yml'),'title: Test');
  const core=require('../server/core.cjs');
  const created=core.createPost(root,'AI example',undefined,'draft','# A reviewed draft\n');
  const saved=core.readPost(root,created.path,'draft');
  assert.equal(saved.meta.title,'AI example');assert.match(saved.content,/---\n\n# A reviewed draft/);
  assert.throws(()=>core.createPost(root,'Never published',undefined,'post','Generated content'),/草稿/);
  assert.deepEqual(fs.readdirSync(path.join(root,'source','_posts')),[]);
});
