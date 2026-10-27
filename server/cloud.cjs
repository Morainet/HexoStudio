const { brandingRecord, brandingMutation } = require('./branding.cjs');
const {cloudConfig,createCloudStore}=require('./cloud-store.cjs');
const {CloudAuth,failure}=require('./cloud-auth.cjs');
const {RemoteRepository}=require('./remote-repository.cjs');
const {CloudContent}=require('./cloud-content.cjs');
const {renderPreview}=require('./preview.cjs');
const ai=require('./ai.cjs');
function createCloudHandler({config=cloudConfig(),store=createCloudStore(config),repository=connection=>new RemoteRepository(connection),checkUpdates=require('./updates.cjs').checkBrandUpdates,aiTransport=ai.completion}={}){
  const auth=new CloudAuth(store,config);
  const allowedOrigins=new Set(config.origins || [config.origin]);
  const send=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
  async function body(req){
    if(req.body!==undefined){const value=Buffer.isBuffer(req.body)?JSON.parse(req.body.toString('utf8')):typeof req.body==='string'?JSON.parse(req.body):req.body;if(Buffer.byteLength(JSON.stringify(value))>4_300_000)throw failure('请求内容超过云端限制',413);return value||{};}
    let size=0;const chunks=[];for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>4_300_000)throw failure('请求内容超过云端限制',413);chunks.push(Buffer.from(chunk));}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw failure('JSON 格式无效');}
  }
  return async function handle(req,res,staticFile){
    try{
      const url=new URL(req.url,config.origin), route=url.pathname;
      if(route==='/api/health'&&req.method==='GET')return send(res,200,{ok:true,mode:'cloud'});
      if(!route.startsWith('/api/')&&!route.startsWith('/images/hexostudio/')){if(req.method!=='GET'&&req.method!=='HEAD')throw failure('不支持的请求方法',405);return staticFile(req,res,route);}
      if(req.method!=='GET' && !allowedOrigins.has(req.headers.origin))throw failure('跨站请求被拒绝',403);
      const data=await store.read();const session=auth.session(data,req);
      if(route==='/api/branding'&&req.method==='GET')return send(res,200,brandingRecord(data.branding));
      if(route==='/api/auth/status'&&req.method==='GET')return send(res,200,{cloud:true,configured:Boolean(data.admin),authenticated:Boolean(session),username:session?.username||null,csrf:session?.csrf||null});
      if(route==='/api/auth/setup'&&req.method==='POST'){
        if(data.admin)throw failure('管理员账号已创建',409);
        const input=await body(req),result=await auth.setup(input);return send(res,200,{authenticated:true,username:input.username,csrf:result.csrf},{'Set-Cookie':result.cookie});
      }
      if(route==='/api/auth/login'&&req.method==='POST'){
        const input=await body(req),result=await auth.login(input);return send(res,200,{authenticated:true,username:input.username,csrf:result.csrf},{'Set-Cookie':result.cookie});
      }
      auth.require(data,req,req.method!=='GET');
      if(route==='/api/article-fields'&&req.method==='POST')return send(res,200,require('./article-fields.cjs').transform(await body(req)));
      if(route==='/api/ai/settings') {
        if(req.method==='GET')return send(res,200,ai.record(data.ai));
        if(['PUT','DELETE'].includes(req.method)) {
          const input=await body(req);
          const result=await store.update(current=>{auth.require(current,req,true);current.ai=ai.mutation(current.ai,input,req.method==='DELETE');return ai.record(current.ai);});
          return send(res,200,result);
        }
      }
      if(route==='/api/ai/generate'&&req.method==='POST')return send(res,200,await ai.generate(store,await body(req),current=>auth.require(current,req,true),aiTransport));
      if(route==='/api/branding'&&['PUT','DELETE'].includes(req.method)){
        const input=await body(req);
        const result=await store.update(current=>{auth.require(current,req,true);current.branding=brandingMutation(current.branding,input,req.method==='DELETE');return brandingRecord(current.branding);});
        return send(res,200,result);
      }
      if(route==='/api/version'&&req.method==='GET')return send(res,200,require('./build-info.cjs').buildInfo());
      if(route==='/api/updates'&&req.method==='GET')return send(res,200,await checkUpdates(brandingRecord(data.branding).branding));
      if(route==='/api/auth/logout'&&req.method==='POST')return send(res,200,{ok:true},{'Set-Cookie':await auth.logout(req)});
      if(route==='/api/auth/password'&&req.method==='POST')return send(res,200,{ok:true},{'Set-Cookie':await auth.password(req,await body(req))});
      if(route.startsWith('/api/auth/storage'))throw failure('云端数据库由部署环境变量管理',409);
      const connection=data.connection;
      const safeConnection=connection?{type:'remote',provider:connection.provider,repository:connection.repository,branch:connection.branch,blogPath:connection.blogPath,hasToken:true}:null;
      if(route==='/api/status'&&req.method==='GET')return send(res,200,{root:connection?`${connection.provider}:${connection.repository}:${connection.branch}:${connection.blogPath}`:null,site:data.site||null,connection:safeConnection,configured:Boolean(connection),mode:'cloud'});
      if(route==='/api/project')throw failure('云端模式仅支持远端仓库',400);
      if(route==='/api/remote/connect'&&req.method==='POST'){
        const repo=repository(await body(req)),snapshot=await repo.snapshot(),site=await new CloudContent(repo).site(snapshot);
        await store.update(current=>{auth.require(current,req,true);current.connection=repo.connection;current.site=site;});
        return send(res,200,{root:`${repo.connection.provider}:${repo.connection.repository}:${repo.connection.branch}:${repo.connection.blogPath}`,site,connection:{type:'remote',provider:repo.connection.provider,repository:repo.connection.repository,branch:repo.connection.branch,blogPath:repo.connection.blogPath}});
      }
      if(route==='/api/preview'&&req.method==='POST'){const input=await body(req);if(typeof input.content!=='string'||Buffer.byteLength(input.content)>1_000_000)throw failure('云端文本内容无效或超过 1 MB');return send(res,200,{html:renderPreview(input.content)});}
      if(!connection)throw failure('请先连接 Hexo 项目');
      const repo=repository(connection),content=new CloudContent(repo);
      if(route.startsWith('/images/hexostudio/')&&req.method==='GET'){
        const image=await content.image(decodeURIComponent(route.slice('/images/hexostudio/'.length)));
        res.writeHead(200,{'Content-Type':image.mime,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'});return res.end(image.buffer);
      }
      if(route==='/api/git/status'&&req.method==='GET')return send(res,200,{cloud:true,...safeConnection});
      if(route.startsWith('/api/git/')||route==='/api/command')throw failure('云端保存会直接提交仓库，请通过仓库流水线构建部署',409);
      if(route==='/api/posts'&&req.method==='GET')return send(res,200,{posts:await content.list(url.searchParams.get('kind')||'post')});
      if(route==='/api/posts'&&req.method==='POST')return send(res,201,await content.create(await body(req)));
      if(route==='/api/post'){
        const name=url.searchParams.get('path'),kind=url.searchParams.get('kind')||'post';
        if(req.method==='GET')return send(res,200,await content.read(await repo.snapshot(),name,kind));
        if(req.method==='PUT')return send(res,200,await content.save(name,kind,await body(req)));
        if(req.method==='DELETE')return send(res,200,await content.remove(name,kind,url.searchParams.get('modified')));
      }
      if(route==='/api/publish'&&req.method==='POST')return send(res,200,await content.publish(await body(req)));
      if(route==='/api/configs'&&req.method==='GET')return send(res,200,{files:await content.configs()});
      if(route==='/api/config'&&req.method==='GET')return send(res,200,await content.config(url.searchParams.get('scope')||'site'));
      if(route==='/api/config'&&req.method==='PUT')return send(res,200,await content.saveConfig(await body(req)));
      if(route==='/api/assets'&&req.method==='GET')return send(res,200,{images:await content.images()});
      if(route==='/api/assets'&&req.method==='POST')return send(res,201,await content.upload(await body(req)));
      throw failure('接口不存在',404);
    }catch(error){if(!res.headersSent)send(res,error.status||400,{error:error.status?error.message:'云端请求失败，请检查输入后重试'});else res.end();}
  };
}
module.exports={createCloudHandler};
