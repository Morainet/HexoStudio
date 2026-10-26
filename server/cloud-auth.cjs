const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const OPTIONS={N:32768,r:8,p:3,maxmem:64*1024*1024}, AGE=12*60*60*1000, WINDOW=15*60*1000;
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=value=>crypto.createHash('sha256').update(String(value || '')).digest('hex');
const equal=(a,b)=>crypto.timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
async function hash(password,salt){return (await scrypt(password,Buffer.from(salt,'hex'),64,OPTIONS)).toString('hex');}
function credentials(username,password){
  if(typeof username!=='string'|| !/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) throw failure('用户名需为 3–32 位字母、数字、下划线或连字符');
  if(typeof password!=='string'||password.length<8||password.length>1024) throw failure('密码需为 8–1024 个字符');
}
class CloudAuth {
  constructor(store,config){this.store=store;this.config=config;}
  token(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hexostudio_session='))?.slice(19)||'';}
  session(data,req){const key=digest(this.token(req)), session=data.sessions?.[key];return session?.expires>Date.now()?{...session,key}:null;}
  cookie(token,clear=false){return `hexostudio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:AGE/1000}${this.config.origin.startsWith('https:')?'; Secure':''}`;}
  newSession(data,username){
    const now=Date.now(), token=crypto.randomBytes(32).toString('hex'), csrf=crypto.randomBytes(32).toString('hex');
    data.sessions=Object.fromEntries(Object.entries(data.sessions||{}).filter(([,v])=>v.expires>now).slice(-99));
    data.sessions[digest(token)]={username,csrf,expires:now+AGE};
    return {csrf,cookie:this.cookie(token)};
  }
  async setup(data){
    if(!equal(data.setupKey,this.config.setupKey)) throw failure('初始化密钥无效',403);
    credentials(data.username,data.password);
    const salt=crypto.randomBytes(16).toString('hex'), passwordHash=await hash(data.password,salt);
    return this.store.update(state=>{
      if(state.admin) throw failure('管理员账号已创建',409);
      state.admin={username:data.username,salt,hash:passwordHash};
      return this.newSession(state,data.username);
    });
  }
  async reserve(){
    const id=crypto.randomBytes(16).toString('hex');
    await this.store.update(state=>{
      const now=Date.now(); state.attempts=(state.attempts||[]).filter(v=>v.time>now-WINDOW);
      if(state.attempts.length>=5) throw failure('登录尝试过多，请 15 分钟后重试',429);
      state.attempts.push({id,time:now});
    });return id;
  }
  async login(data){
    credentials(data.username,data.password);
    const id=await this.reserve(), initial=await this.store.read(), admin=initial.admin;
    if(!admin || !equal(await hash(data.password,admin.salt),admin.hash) || data.username!==admin.username) throw failure('用户名或密码错误',401);
    return this.store.update(state=>{
      if(state.admin?.hash!==admin.hash) throw failure('账号已更新，请重新登录',401);
      state.attempts=(state.attempts||[]).filter(v=>v.id!==id);
      return this.newSession(state,admin.username);
    });
  }
  require(data,req,write=false){
    const session=this.session(data,req); if(!session) throw failure('请先登录',401);
    if(write && !equal(req.headers['x-csrf-token'],session.csrf)) throw failure('会话验证失败，请重新登录',403);
    return session;
  }
  async logout(req){await this.store.update(data=>{const session=this.require(data,req,true);delete data.sessions[session.key];});return this.cookie('',true);}
  async password(req,input){
    const id=await this.reserve(), initial=await this.store.read(); this.require(initial,req,true);
    credentials(initial.admin.username,input.newPassword);
    if(typeof input.oldPassword!=='string'||input.oldPassword.length>1024||!equal(await hash(input.oldPassword,initial.admin.salt),initial.admin.hash)) throw failure('当前密码错误',403);
    const salt=crypto.randomBytes(16).toString('hex'), passwordHash=await hash(input.newPassword,salt);
    await this.store.update(data=>{
      this.require(data,req,true); if(data.admin.hash!==initial.admin.hash) throw failure('账号已更新，请重新登录',401);
      data.admin={...data.admin,salt,hash:passwordHash};data.sessions={};data.attempts=(data.attempts||[]).filter(v=>v.id!==id);
    });return this.cookie('',true);
  }
}
module.exports={CloudAuth,failure,equal};
