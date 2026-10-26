const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createCloudStore,cloudConfig}=require('../server/cloud-store.cjs');
const {CloudAuth}=require('../server/cloud-auth.cjs');

// Only point these test variables at disposable databases. CI provisions them.
for(const type of ['POSTGRES','MYSQL','MONGODB']) {
  const url=process.env[`HEXOSTUDIO_TEST_${type}_URL`];
  test(`real ${type} driver: encrypted shared state, CAS and session persistence`,{skip:!url},async()=>{
    const config=cloudConfig({HEXOSTUDIO_DATABASE_URL:url,HEXOSTUDIO_SECRET:'ce'.repeat(32),HEXOSTUDIO_SETUP_KEY:'test-bootstrap-'.repeat(4),HEXOSTUDIO_ORIGIN:'https://test.example'});
    const a=createCloudStore(config),b=createCloudStore(config),key=crypto.randomBytes(12).toString('hex');
    await a.update(state=>{state[key]=0;});
    try {
      await Promise.all(Array.from({length:6},(_,i)=>(i%2?a:b).update(state=>{state[key]++;})));
      assert.equal((await b.read())[key],6);
      const first=new CloudAuth(a,config),second=new CloudAuth(b,config);
      const session=await a.update(state=>first.newSession(state,'driver-test'));
      const req={headers:{cookie:session.cookie.split(';')[0],'x-csrf-token':session.csrf}};
      assert.equal(second.require(await b.read(),req,true).username,'driver-test');
      await second.logout(req);assert.equal(first.session(await a.read(),req),null);
      const wrong=createCloudStore({...config,secret:'de'.repeat(32)});
      await assert.rejects(wrong.read(),error=>error.status===503&&/解密/.test(error.message));
    }finally{await a.update(state=>{delete state[key];});}
  });
}
