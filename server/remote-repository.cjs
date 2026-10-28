const {remoteInput}=require('./git.cjs');
const {failure}=require('./cloud-auth.cjs');
const encode=encodeURIComponent;
function safePath(name){
  if(typeof name!=='string'||!name||name.length>1024||name.includes('\\')||/[\0-\x1f]/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git')) throw failure('仓库文件路径无效');
  return name;
}
class RemoteRepository {
  constructor(connection,fetcher=require('./network.cjs').fetchNetwork){
    try { this.connection=remoteInput(connection); } catch(error) { throw failure(error.message); }
    this.fetcher=fetcher;
    this.github=this.connection.provider==='github';
    this.base=this.github?`https://api.github.com/repos/${this.connection.repository}`:`https://gitlab.com/api/v4/projects/${encode(this.connection.repository)}`;
  }
  async request(route,{method='GET',data}={}){
    let response;
    try {response=await this.fetcher(this.base+route,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{
      Accept:'application/json','User-Agent':'HexoStudio',...(this.github?{Authorization:`Bearer ${this.connection.token}`}:{'PRIVATE-TOKEN':this.connection.token}),...(data?{'Content-Type':'application/json'}:{})
    },body:data?JSON.stringify(data):undefined});}
    catch {throw failure('远端仓库连接失败，请稍后重试',502);}
    if(!response.ok){
      const status=([409,422].includes(response.status)||(!this.github&&response.status===400&&method==='POST'&&route==='/repository/commits'))?409:response.status===404?404:response.status===429?429:502;
      const message=response.status===401||response.status===403?'仓库访问被拒绝，请检查 Token 权限和服务商额度':status===409?'远端文件已变化，请重新读取后合并修改':status===404?'仓库、分支或文件不存在':status===429?'仓库请求过于频繁，请稍后重试':'远端仓库操作失败';
      throw failure(message,status);
    }
    // Bound tree/blob responses before decoding attacker-controlled repository data.
    const reader=response.body.getReader();let size=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20_000_000){await reader.cancel();throw failure('仓库响应过大，请缩小博客目录范围');}chunks.push(Buffer.from(value));}
    try{return {data:JSON.parse(Buffer.concat(chunks).toString('utf8')),headers:response.headers};}
    catch(error){if(size===0)return {data:null,headers:response.headers};throw failure('仓库服务返回了无效响应',502);}
  }
  async snapshot(){
    if(!this.connection.branch){const {data}=await this.request('');this.connection.branch=data.default_branch;}
    if(!this.connection.branch)throw failure('仓库尚无默认分支，请先提交 Hexo 源码');
    const {data:branch}=await this.request(`/repository/branches/${encode(this.connection.branch)}`.replace('/repository/branches/',this.github?'/branches/':'/repository/branches/'));
    const head=branch.commit.id||branch.commit.sha;
    if(this.github){
      const {data:commit}=await this.request(`/git/commits/${head}`);
      const {data:tree}=await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
      if(tree.truncated)throw failure('仓库文件列表过大，请使用独立的博客源码仓库');
      return {head,tree:commit.tree.sha,entries:tree.tree.filter(x=>x.type==='blob'&&['100644','100755'].includes(x.mode)).map(x=>({path:x.path,id:x.sha,size:x.size})),date:commit.committer?.date};
    }
    const entries=[];
    for(let page=1;page<=100;page++){
      const {data,headers}=await this.request(`/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encode(head)}`);
      entries.push(...data.filter(x=>x.type==='blob'&&['100644','100755'].includes(x.mode)).map(x=>({path:x.path,id:x.id})));
      if(!headers.get('x-next-page'))return {head,entries,date:branch.commit.committed_date};
    }throw failure('仓库文件列表过大，请使用独立的博客源码仓库');
  }
  async read(snapshot,name,max=1_000_000){
    safePath(name);const entry=snapshot.entries.find(x=>x.path===name);
    if(!entry)throw failure('文件不存在或不是普通文件',404);
    if(entry.size>max)throw failure('文件超过云端大小限制');
    const {data}=await this.request(this.github?`/git/blobs/${entry.id}`:`/repository/files/${encode(name)}?ref=${encode(snapshot.head)}`);
    if(data.encoding!=='base64')throw failure('不支持的仓库文件编码');
    const buffer=Buffer.from(data.content,'base64');if(buffer.length>max)throw failure('文件超过云端大小限制');
    return {buffer,modified:entry.id,lastCommit:data.last_commit_id};
  }
  async commit(snapshot,changes,message){
    for(const change of changes){
      safePath(change.path);const entry=snapshot.entries.find(x=>x.path===change.path);
      if(change.expected===null?Boolean(entry):!entry||entry.id!==change.expected)throw failure('远端文件已变化，请重新读取后合并修改',409);
    }
    if(this.github){
      const tree=[];
      for(const change of changes){
        const sha=change.content===null?null:(await this.request('/git/blobs',{method:'POST',data:{content:Buffer.from(change.content).toString('base64'),encoding:'base64'}})).data.sha;
        tree.push({path:change.path,mode:'100644',type:'blob',sha});
      }
      const {data:newTree}=await this.request('/git/trees',{method:'POST',data:{base_tree:snapshot.tree,tree}});
      const {data:commit}=await this.request('/git/commits',{method:'POST',data:{message,tree:newTree.sha,parents:[snapshot.head]}});
      await this.request(`/git/refs/heads/${this.connection.branch.split('/').map(encode).join('/')}`,{method:'PATCH',data:{sha:commit.sha,force:false}});
      return commit.sha;
    }
    const actions=[];
    for(const change of changes){
      const previous=change.expected===null?null:await this.read(snapshot,change.path,3_000_000);
      actions.push({action:change.content===null?'delete':previous?'update':'create',file_path:change.path,
        ...(previous?{last_commit_id:previous.lastCommit}:{}),...(change.content===null?{}:{encoding:'base64',content:Buffer.from(change.content).toString('base64')})});
    }
    const {data}=await this.request('/repository/commits',{method:'POST',data:{branch:this.connection.branch,commit_message:message,actions}});return data.id;
  }
  path(name){return safePath([this.connection.blogPath,name].filter(Boolean).join('/'));}
  relative(name){const prefix=this.connection.blogPath?this.connection.blogPath+'/':'';return name.startsWith(prefix)?name.slice(prefix.length):null;}
}
module.exports={RemoteRepository,safePath};
