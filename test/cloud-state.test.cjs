const test = require('node:test');
const assert = require('node:assert/strict');
const { cloudConfig, codec, versionedStore } = require('../server/cloud-store.cjs');
const { CloudAuth } = require('../server/cloud-auth.cjs');
const config = {secret:'ab'.repeat(32),setupKey:'setup-'.repeat(8),origin:'https://studio.example'};

// This models atomic database CAS, with asynchronous reads to force contention.
function sharedStores() {
  const cipher = codec(config.secret);
  let record = {revision:0,payload:cipher.seal({})};
  const driver = {
    async read() { return {...record}; },
    async cas(revision,payload) {
      if (record.revision !== revision) return false;
      record = {revision:revision+1,payload}; return true;
    }
  };
  return [versionedStore(fn=>fn(driver),cipher),versionedStore(fn=>fn(driver),cipher)];
}
const request = result => ({headers:{cookie:result.cookie.split(';')[0],'x-csrf-token':result.csrf}});

test('cloud configuration requires remote database, HTTPS origin and independent bootstrap secrets', () => {
  const env={HEXOSTUDIO_SECRET:config.secret,HEXOSTUDIO_SETUP_KEY:config.setupKey,HEXOSTUDIO_ORIGIN:config.origin,HEXOSTUDIO_DATABASE_URL:'postgresql://user:password@db.example/studio'};
  for(const [url,type] of [['postgresql://db.example/studio','postgres'],['mysql://db.example/studio','mysql'],['mongodb+srv://db.example/studio','mongodb']]) {
    assert.equal(cloudConfig({...env,HEXOSTUDIO_DATABASE_URL:url}).storage.type,type);
  }
  for(const values of [{HEXOSTUDIO_SECRET:''},{HEXOSTUDIO_SETUP_KEY:''},{HEXOSTUDIO_SETUP_KEY:config.secret},{HEXOSTUDIO_ORIGIN:'http://public.example'},{HEXOSTUDIO_ORIGIN:'https://example.com/subpath'},{HEXOSTUDIO_DATABASE_URL:'sqlite:///tmp/state.db'}]) assert.throws(()=>cloudConfig({...env,...values}));
  assert.equal(cloudConfig({...env,HEXOSTUDIO_ORIGIN:'http://127.0.0.1:4545'}).origin,'http://127.0.0.1:4545');
});

test('Atlas integration URI is supported without overriding an explicit database', () => {
  const env={HEXOSTUDIO_SECRET:config.secret,HEXOSTUDIO_SETUP_KEY:config.setupKey,HEXOSTUDIO_ORIGIN:config.origin,MONGODB_URI:'mongodb+srv://user:password@cluster.example/?retryWrites=true&w=majority',HEXOSTUDIO_DATABASE_NAME:'hexostudio'};
  assert.deepEqual(cloudConfig(env).storage,{type:'mongodb',url:env.MONGODB_URI,database:'hexostudio'});
  assert.equal(cloudConfig({...env,HEXOSTUDIO_DATABASE_NAME:'',MONGODB_URI:'mongodb+srv://cluster.example/studio'}).storage.database,'studio');
  assert.throws(()=>cloudConfig({...env,HEXOSTUDIO_DATABASE_NAME:''}),/MongoDB/);
  assert.throws(()=>cloudConfig({...env,MONGODB_URI:'postgresql://db.example/studio'}),/MONGODB_URI/);
  const explicit='postgresql://db.example/studio';
  assert.deepEqual(cloudConfig({...env,HEXOSTUDIO_DATABASE_URL:explicit}).storage,{type:'postgres',url:explicit});
  assert.throws(()=>cloudConfig({...env,HEXOSTUDIO_DATABASE_URL:'invalid'}));
});

test('database payload is authenticated encryption; wrong keys and tampering fail closed', () => {
  const cipher=codec(config.secret), state={token:'github-secret',sessions:{session:{csrf:'sensitive'}}};
  const first=cipher.seal(state),second=cipher.seal(state);
  assert.notEqual(first,second); assert.ok(!first.includes(state.token));
  assert.deepEqual(cipher.open(first),state);
  assert.throws(()=>codec('cd'.repeat(32)).open(first),error=>error.status===503);
  const bytes=Buffer.from(first,'base64');bytes[28]^=1;
  assert.throws(()=>cipher.open(bytes.toString('base64')),error=>error.status===503);
});

test('CAS retries preserve simultaneous changes from multiple cloud instances',async()=>{
  const stores=sharedStores();
  await Promise.all(Array.from({length:10},(_,i)=>stores[i%2].update(state=>{state.count=(state.count||0)+1;})));
  assert.equal((await stores[0].read()).count,10);
  await assert.rejects(stores[0].update(async()=>{}),/synchronous/);
});

test('bootstrap race creates exactly one administrator and sessions work across instances',async()=>{
  const stores=sharedStores(),a=new CloudAuth(stores[0],config),b=new CloudAuth(stores[1],config);
  await assert.rejects(a.setup({username:'admin',password:'secure-password-123',setupKey:'incorrect'}),error=>error.status===403);
  const input={username:'admin',password:'secure-password-123',setupKey:config.setupKey};
  const outcomes=await Promise.allSettled([a.setup(input),b.setup(input)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.find(x=>x.status==='rejected').reason.status,409);
  const session=outcomes.find(x=>x.status==='fulfilled').value,req=request(session);
  assert.match(session.cookie,/HttpOnly; SameSite=Strict.*Secure/);
  assert.equal(b.require(await stores[1].read(),req,true).username,'admin');
  assert.notEqual((await stores[0].read()).admin.hash,input.password);
  assert.throws(()=>b.require({sessions:{}} ,req,true),error=>error.status===401);
  const state=await stores[0].read();
  assert.throws(()=>b.require(state,{headers:{cookie:req.headers.cookie}},true),error=>error.status===403);
  await b.logout(req);
  assert.equal(a.session(await stores[0].read(),req),null);
});

test('password changes revoke every session; shared rate limits survive fresh instances',async()=>{
  const [store,other]=sharedStores(),a=new CloudAuth(store,config),b=new CloudAuth(other,config);
  const input={username:'admin',password:'secure-password-123',setupKey:config.setupKey};
  const first=await a.setup(input),second=await b.login(input);
  await b.password(request(first),{oldPassword:input.password,newPassword:'new-secure-password-123'});
  assert.equal(a.session(await store.read(),request(first)),null);
  assert.equal(a.session(await store.read(),request(second)),null);
  const fresh=await a.login({...input,password:'new-secure-password-123'});
  assert.ok(b.session(await other.read(),request(fresh)));
  for(let i=0;i<5;i++) await assert.rejects(new CloudAuth(i%2?store:other,config).login(input),error=>error.status===401);
  await assert.rejects(b.login({...input,password:'new-secure-password-123'}),error=>error.status===429);
});
