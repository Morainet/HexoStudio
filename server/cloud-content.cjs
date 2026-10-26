const path=require('node:path').posix;
const crypto=require('node:crypto');
const {parsePost}=require('./core.cjs');
const {updateFrontmatter}=require('./frontmatter.cjs');
const {imageType}=require('./assets.cjs');
const {safePath}=require('./remote-repository.cjs');
const {failure}=require('./cloud-auth.cjs');
const MAX_TEXT=1_000_000, MAX_IMAGE=3_000_000;
const mimes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
const slug=value=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,100)||'untitled';
function articlePath(name,kind){
  safePath(name);if(!/\.(md|markdown)$/i.test(name))throw failure('仅支持 Markdown 文件');
  if(!['post','draft','page'].includes(kind))throw failure('文章类型无效');
  if(kind==='page' && (name.split('/').some(x=>x.startsWith('_')||x.startsWith('.'))||name.startsWith('images/')))throw failure('页面路径无效');
  return `${kind==='post'?'source/_posts':kind==='draft'?'source/_drafts':'source'}/${name}`;
}
function configName(scope){
  if(scope==='site')return '_config.yml';
  if(/^override:_config\.[a-z0-9_-]+\.(yml|yaml|json)$/i.test(scope))return scope.slice(9);
  if(/^theme:[a-z0-9_-]+$/i.test(scope))return `themes/${scope.slice(6)}/_config.yml`;
  throw failure('配置文件不存在');
}
function text(value){if(typeof value!=='string'||Buffer.byteLength(value)>MAX_TEXT)throw failure('云端文本内容无效或超过 1 MB');return value;}
function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?value:new Date().toISOString().replace('T',' ').slice(0,19);}
class CloudContent {
  constructor(repo){this.repo=repo;}
  async site(snapshot){
    const config=(await this.repo.read(snapshot,this.repo.path('_config.yml'))).buffer.toString('utf8');
    const field=name=>config.match(new RegExp(`^${name}:[ \t]*([^\\r\\n]*)`,'mi'))?.[1].replace(/^['"]|['"]$/g,'').trim()||'';
    return {title:field('title'),theme:field('theme')};
  }
  async read(snapshot,name,kind='post'){
    const result=await this.repo.read(snapshot,this.repo.path(articlePath(name,kind)));
    const content=result.buffer.toString('utf8');return {path:name,kind,content,meta:parsePost(content,name),modified:result.modified};
  }
  async list(kind='post'){
    articlePath('validate.md',kind);const snapshot=await this.repo.snapshot(), prefix=kind==='post'?'source/_posts/':kind==='draft'?'source/_drafts/':'source/';
    const names=snapshot.entries.map(entry=>this.repo.relative(entry.path)).filter(name=>name?.startsWith(prefix)&&/\.(md|markdown)$/i.test(name)).map(name=>name.slice(prefix.length)).filter(name=>{try{articlePath(name,kind);return true;}catch{return false;}});
    if(names.length>500)throw failure('云端单类内容最多加载 500 篇，请拆分仓库');
    const output=[];let cursor=0,total=0;
    await Promise.all(Array.from({length:Math.min(6,names.length)},async()=>{
      while(cursor<names.length){const name=names[cursor++], post=await this.read(snapshot,name,kind);total+=Buffer.byteLength(post.content);if(total>20_000_000)throw failure('文章列表内容过大');output.push({path:name,kind,...post.meta,modified:post.modified});}
    }));return output.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  }
  async create(data){
    if(typeof data.title!=='string'||!data.title.trim()||data.title.length>300)throw failure('文章标题无效');
    const kind=data.kind||'post',snapshot=await this.repo.snapshot(),base=slug(data.title);let name;
    for(let i=0;i<1000;i++){const stem=base+(i?`-${i+1}`:'');name=kind==='page'?`${stem}/index.md`:`${stem}.md`;if(!snapshot.entries.some(x=>x.path===this.repo.path(articlePath(name,kind))))break;if(i===999)throw failure('同名文件过多');}
    const content=`---\ntitle: ${JSON.stringify(data.title.trim())}\n${kind==='draft'?'':`date: ${date(data.localDate)}\n`}tags: []\ncategories: []\n---\n\n`;
    await this.repo.commit(snapshot,[{path:this.repo.path(articlePath(name,kind)),expected:null,content}],`Create ${kind}: ${data.title.trim()}`);
    return {path:name,kind,content};
  }
  async save(name,kind,data){
    if(!data.modified)throw failure('缺少文件版本，请重新读取',409);
    const snapshot=await this.repo.snapshot(), content=text(updateFrontmatter(text(data.content),data.metadata||{}));
    await this.repo.commit(snapshot,[{path:this.repo.path(articlePath(name,kind)),expected:data.modified,content}],`Update ${kind}: ${name}`);
    return this.read(await this.repo.snapshot(),name,kind);
  }
  async remove(name,kind,modified){
    if(!modified)throw failure('缺少文件版本，请刷新列表',409);
    await this.repo.commit(await this.repo.snapshot(),[{path:this.repo.path(articlePath(name,kind)),expected:modified,content:null}],`Delete ${kind}: ${name}`);return {ok:true};
  }
  async publish(data){
    const snapshot=await this.repo.snapshot(), draft=await this.read(snapshot,data.path,'draft');
    if(!data.modified||data.modified!==draft.modified)throw failure('草稿已被其他程序修改，请重新加载后再发布',409);
    let name=data.path;for(let i=0;snapshot.entries.some(x=>x.path===this.repo.path(articlePath(name,'post')));i++){if(i>999)throw failure('同名文章过多');name=data.path.replace(/(\.[^.]+)$/,`-${i+2}$1`);}
    const content=draft.meta.date?draft.content:updateFrontmatter(draft.content,{date:date(data.localDate)});
    await this.repo.commit(snapshot,[{path:this.repo.path(articlePath(data.path,'draft')),expected:draft.modified,content:null},{path:this.repo.path(articlePath(name,'post')),expected:null,content}],`Publish draft: ${name}`);
    return this.read(await this.repo.snapshot(),name,'post');
  }
  async configs(){
    const snapshot=await this.repo.snapshot(), files=[];
    for(const entry of snapshot.entries){
      const name=this.repo.relative(entry.path);if(!name)continue;
      const theme=name.match(/^themes\/([a-z0-9_-]+)\/_config.yml$/i);
      const scope=name==='_config.yml'?'site':/^_config\.[a-z0-9_-]+\.(yml|yaml|json)$/i.test(name)?`override:${name}`:theme?`theme:${theme[1]}`:null;
      if(scope)files.push({scope,path:name,bytes:Number.isSafeInteger(entry.size)&&entry.size>=0?entry.size:null,kind:scope==='site'?'site':theme?'theme':'override'});
    }
    const order={site:0,override:1,theme:2};
    return files.sort((a,b)=>order[a.kind]-order[b.kind]||a.path.localeCompare(b.path));
  }
  async config(scope='site'){
    const snapshot=await this.repo.snapshot(),file=await this.repo.read(snapshot,this.repo.path(configName(scope))),names=snapshot.entries.map(x=>this.repo.relative(x.path)).filter(Boolean);
    return {scope,content:file.buffer.toString('utf8'),modified:file.modified,themes:names.map(x=>x.match(/^themes\/([\w-]+)\/_config.yml$/)?.[1]).filter(Boolean),overrides:names.filter(x=>/^_config\.[a-z0-9_-]+\.(yml|yaml|json)$/i.test(x))};
  }
  async saveConfig(data){
    const content=text(data.content),name=configName(data.scope);if(!data.modified)throw failure('缺少文件版本，请重新读取',409);
    if(name.endsWith('.json')){try{JSON.parse(content);}catch{throw failure('JSON 配置语法无效');}}
    await this.repo.commit(await this.repo.snapshot(),[{path:this.repo.path(name),expected:data.modified,content}],`Update configuration: ${name}`);
    return {modified:(await this.config(data.scope)).modified};
  }
  async images(){const snapshot=await this.repo.snapshot(),prefix='source/images/hexostudio/';return snapshot.entries.map(x=>({...x,relative:this.repo.relative(x.path)})).filter(x=>x.relative?.startsWith(prefix)&&mimes[path.extname(x.path).toLowerCase()]&&!x.relative.slice(prefix.length).includes('/')).map(x=>({name:path.basename(x.path),url:`/images/hexostudio/${encodeURIComponent(path.basename(x.path))}`,bytes:x.size||0,modified:snapshot.date||''}));}
  async image(name){safePath(name);if(name.includes('/')||!mimes[path.extname(name).toLowerCase()])throw failure('图片路径无效');const file=await this.repo.read(await this.repo.snapshot(),this.repo.path(`source/images/hexostudio/${name}`),MAX_IMAGE);return {buffer:file.buffer,mime:mimes[path.extname(name).toLowerCase()]};}
  async upload(data){
    if(typeof data.name!=='string'||typeof data.data!=='string'||data.data.length>4_000_004||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.data))throw failure('云端图片无效或超过 3 MB');
    const ext=path.extname(data.name).toLowerCase(),buffer=Buffer.from(data.data,'base64');if(!buffer.length||buffer.length>MAX_IMAGE||!mimes[ext]||imageType(buffer)!==mimes[ext])throw failure('图片格式与扩展名不匹配');
    const name=`${slug(path.basename(data.name,ext))}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    await this.repo.commit(await this.repo.snapshot(),[{path:this.repo.path(`source/images/hexostudio/${name}`),expected:null,content:buffer}],`Upload image: ${name}`);
    return {name,url:`/images/hexostudio/${encodeURIComponent(name)}`,bytes:buffer.length};
  }
}
module.exports={CloudContent,articlePath,configName};
