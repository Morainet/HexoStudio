const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

test('Vercel and Netlify entrypoints serve the app in cloud mode without a writable filesystem or listening inside a function',async t=>{
  const environment={HEXOSTUDIO_MODE:'cloud',HEXOSTUDIO_SECRET:'ac'.repeat(32),HEXOSTUDIO_SETUP_KEY:'bootstrap-key-'.repeat(4),CRON_SECRET:'cron-key-'.repeat(8),HEXOSTUDIO_DATABASE_URL:'postgresql://test:test@127.0.0.1:1/test',HEXOSTUDIO_ORIGIN:'https://studio.example'};
  const previous=Object.fromEntries([...Object.keys(environment),'HEXOSTUDIO_PUBLIC_DIR'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,environment);
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const handler=require('../api/entry.js');
  const server=http.createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(url+'/api/health')).json()).mode,'cloud');
  assert.equal((await fetch(url+'/api/cron/database-keepalive')).status,401);
  // The authorized request reaches the actual driver and fails against the deliberately unavailable database.
  const keepalive=await fetch(url+'/api/cron/database-keepalive',{headers:{Authorization:`Bearer ${environment.CRON_SECRET}`}});
  assert.equal(keepalive.status,503);
  assert.deepEqual(await keepalive.json(),{error:'数据库保活检查失败，请检查数据库连接及集群状态'});
  const html=await fetch(url+'/');assert.equal(html.status,200);assert.match(await html.text(),/HexoStudio/);
  const fieldsScript=await fetch(url+'/article-fields.js');assert.equal(fieldsScript.status,200);assert.match(await fieldsScript.text(),/ArticleFields/);
  const aiScript=await fetch(url+'/ai.js');assert.equal(aiScript.status,200);assert.match(aiScript.headers.get('content-type'),/javascript/);
  const mobile=await fetch(url+'/mobile.js');assert.equal(mobile.status,200);assert.match(mobile.headers.get('content-type'),/javascript/);assert.match(await mobile.text(),/navigation-toggle/);
  assert.equal((await fetch(url+'/.env.cloud')).status,404);
  const netlify=await import(pathToFileURL(path.join(__dirname,'../netlify/functions/entry.mjs')).href);
  const response=await netlify.default(new Request('https://studio.example/'));
  assert.equal(response.status,200);assert.match(await response.text(),/HexoStudio/);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const script=await netlify.default(new Request('https://studio.example/app.js'));
  assert.match(script.headers.get('content-type'),/javascript/);
  const mobileScript=await netlify.default(new Request('https://studio.example/mobile.js'));
  assert.equal(mobileScript.status,200);assert.match(await mobileScript.text(),/navigation-toggle/);
  assert.equal((await netlify.default(new Request('https://studio.example/server/cloud.cjs'))).status,404);
  assert.equal((await netlify.default(new Request('https://studio.example/api/cron/database-keepalive'))).status,401);
});
