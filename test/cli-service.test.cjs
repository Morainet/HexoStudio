const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const service=require('../server/cli-service.cjs');
const {parseOptions}=require('../server/cli.cjs');
const cli=path.resolve(__dirname,'../bin/hs.cjs');
function environment(){const env={...process.env};for(const key of ['HEXO_ROOT','HEXOSTUDIO_HOST','HEXOSTUDIO_PORT','HEXOSTUDIO_SETTINGS','HEXOSTUDIO_TOKEN','HEXOSTUDIO_MODE','PORT'])delete env[key];return env;}
async function command(args){try{return {...await run(process.execPath,[cli,...args],{env:environment(),timeout:25000}),code:0};}catch(error){if(error.code===undefined)throw error;return {code:error.code,stdout:error.stdout,stderr:error.stderr};}}
function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hs-service-')),settings=path.join(folder,'settings.json');t.after(async()=>{await service.stop(settings).catch(()=>{});fs.rmSync(folder,{recursive:true,force:true});});return {folder,settings};}

test('command help and instance selection reject irrelevant or invalid flags',async()=>{
  assert.equal(parseOptions(['start','-d','--open'],{}).background,true);
  assert.equal(parseOptions(['status','--json'],{}).command,'status');
  for(const args of [['stop','--port','1234'],['restart','--host','127.0.0.1'],['logs','--lines','0'],['logs','--lines','1001'],['logs','--lines','1.5'],['config'],['config','show']])assert.throws(()=>parseOptions(args,{}));
  const result=await command(['help','start']);assert.equal(result.code,0);assert.match(result.stdout,/--background/);
  assert.match((await command(['status','--help'])).stdout,/Exit codes/);
});

test('managed lifecycle survives the launching shell and never prints its control token',async t=>{
  const {folder,settings}=fixture(t),root=path.join(folder,'blog');fs.mkdirSync(path.join(root,'source','_posts'),{recursive:true});fs.writeFileSync(path.join(root,'_config.yml'),'title: CLI test');
  assert.equal((await command(['status','--settings',settings,'--json'])).code,1);
  const start=await command(['start','-d','--port','0','--root',root,'--settings',settings]);assert.equal(start.code,0,start.stderr);assert.match(start.stdout,/Background service started/);
  const record=JSON.parse(fs.readFileSync(service.paths(settings).record,'utf8'));
  if(process.platform!=='win32')assert.equal(fs.statSync(service.paths(settings).record).mode&0o777,0o600);
  const status=await command(['status','--settings',settings,'--json']);assert.equal(status.code,0);const info=JSON.parse(status.stdout);assert.equal(info.pid,record.pid);assert.equal(info.status,'running');assert.doesNotMatch(status.stdout,new RegExp(record.token));
  assert.equal((await fetch(info.url)).status,200);
  assert.equal((await fetch(`http://127.0.0.1:${record.controlPort}/stop`,{method:'POST'})).status,403);
  assert.equal((await fetch(`http://127.0.0.1:${record.controlPort}/stop`,{method:'POST',headers:{Authorization:`Bearer ${record.token}`,Origin:'https://evil.example'}})).status,403);
  assert.equal((await command(['start','-d','--settings',settings])).code,0);
  assert.equal((await service.status(settings)).pid,info.pid);
  const other=path.join(folder,'other.json');assert.equal((await service.status(other)).status,'stopped');await service.stop(other);assert.equal((await service.status(settings)).pid,info.pid);
  const restart=await command(['restart','--settings',settings]);assert.equal(restart.code,0,restart.stderr);
  const next=JSON.parse(fs.readFileSync(service.paths(settings).record,'utf8'));assert.notEqual(next.pid,record.pid);assert.equal(next.options.root,root);assert.equal(next.options.host,'127.0.0.1');
  const logs=await command(['logs','--lines','2','--settings',settings]);assert.equal(logs.code,0);assert.ok(logs.stdout.trim().split('\n').length<=2);assert.doesNotMatch(logs.stdout,new RegExp(next.token));
  assert.equal((await command(['config','path','--settings',settings])).stdout.trim(),settings);
  const stopped=await command(['stop','--settings',settings]);assert.equal(stopped.code,0,stopped.stderr);assert.equal((await service.status(settings)).status,'stopped');
  assert.equal((await command(['stop','--settings',settings])).code,0);
  assert.equal(fs.existsSync(settings),false);
});

test('occupied ports fail without orphaning a record or taking over another service',async t=>{
  const {settings}=fixture(t),server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await command(['start','-d','--port',String(server.address().port),'--settings',settings]);assert.equal(result.code,1);assert.match(result.stderr,/already in use/);assert.equal(fs.existsSync(service.paths(settings).record),false);assert.equal(server.listening,true);
});

test('a forged PID cannot make stop signal an unrelated process',async t=>{
  const {settings}=fixture(t),files=service.paths(settings);fs.mkdirSync(files.directory,{recursive:true,mode:0o700});
  fs.writeFileSync(files.record,JSON.stringify({pid:process.pid,controlPort:1,id:'fake',token:'a'.repeat(64)}),{mode:0o600});
  const result=await command(['stop','--settings',settings]);assert.equal(result.code,1);assert.match(result.stderr,/unidentified process/);assert.equal((await service.status(settings)).status,'unreachable');fs.unlinkSync(files.record);
});

test('concurrent startup is serialized and failed attempts leave the existing instance usable',async t=>{
  const {settings}=fixture(t);
  const results=await Promise.all([command(['start','-d','--port','0','--settings',settings]),command(['start','-d','--port','0','--settings',settings])]);
  assert.ok(results.some(result=>result.code===0));
  for(const result of results)if(result.code!==0)assert.match(result.stderr,/Another hs command/);
  assert.equal((await service.status(settings)).status,'running');
});
