// Control only services started by hs. Never signal a PID read from disk.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { fork, spawn } = require('node:child_process');
const { version } = require('../package.json');

function paths(settings) {
  const directory = path.join(path.dirname(settings), '.hexostudio-runtime', crypto.createHash('sha256').update(settings).digest('hex').slice(0, 24));
  return { directory, record: path.join(directory, 'service.json'), log: path.join(directory, 'service.log'), lock: path.join(directory, 'lock.json') };
}
function directory(files) {
  fs.mkdirSync(files.directory, { recursive: true, mode: 0o700 });
  for (const folder of [path.dirname(files.directory), files.directory]) {
    const stat = fs.lstatSync(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runtime directory must not be a symbolic link.');
    if (process.platform !== 'win32') fs.chmodSync(folder, 0o700);
  }
}
function read(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 16000 || process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) throw new Error('Unsafe runtime file. Check its owner and permissions.');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('Runtime file is not valid JSON. Check the instance runtime directory.');
    throw error;
  }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function request(record, stop = false) {
  return new Promise((resolve, reject) => {
    if (!record || !Number.isInteger(record.controlPort) || record.controlPort < 1 || record.controlPort > 65535 || !/^[a-f0-9]{64}$/.test(record.token || '')) return reject(new Error('Invalid service record.'));
    const req = http.request({ hostname:'127.0.0.1', port:record.controlPort, path:stop?'/stop':'/status', method:stop?'POST':'GET', headers:{Authorization:`Bearer ${record.token}`}, timeout:2000 }, res => {
      let body='';res.on('data', chunk => {body+=chunk;if(body.length>16000)req.destroy(new Error('Invalid service response.'));});
      res.on('error',reject);
      res.on('end',()=>{try {const result=JSON.parse(body);if(res.statusCode!==200||result.id!==record.id||result.pid!==record.pid)throw new Error('Service identity did not match.');resolve(result);}catch(error){reject(error);}});
    });
    req.on('timeout',()=>req.destroy(new Error('Service did not respond.')));req.on('error',reject);req.end();
  });
}
async function status(settings) {
  const files=paths(settings),record=read(files.record);
  if (!record) return {status:'stopped',settings,log:files.log};
  try {
    const result=await request(record);
    return {status:'running',pid:result.pid,url:result.url,version:result.version,startedAt:result.startedAt,settings,log:files.log};
  } catch {
    return {status:alive(record.pid)?'unreachable':'stopped',settings,log:files.log};
  }
}
async function locked(settings, action) {
  const files=paths(settings);directory(files);
  let fd;
  for(let attempt=0;attempt<2;attempt++) {
    try {fd=fs.openSync(files.lock,'wx',0o600);break;}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const owner=read(files.lock);
      if(attempt||!owner||alive(owner.pid))throw new Error('Another hs command is running. Try again shortly.');
      fs.unlinkSync(files.lock);
    }
  }
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);
  try {return await action(files);}
  finally {try {if(read(files.lock)?.pid===process.pid)fs.unlinkSync(files.lock);}catch{}}
}
async function launch(options,files) {
  const existing=await status(options.settings);
  if(existing.status==='running')return {...existing,alreadyRunning:true};
  if(existing.status==='unreachable')throw new Error('The recorded service is unreachable. Inspect its logs; hs will not stop an unidentified process.');
  if(read(files.record))fs.unlinkSync(files.record);
  const fd=fs.openSync(files.log,fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW||0),0o600);
  if(process.platform!=='win32')fs.fchmodSync(fd,0o600);
  const child=fork(__filename,[],{cwd:process.cwd(),detached:true,stdio:['ignore',fd,fd,'ipc'],windowsHide:true});fs.closeSync(fd);
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();finish(new Error('Background startup timed out. Run hs logs.'));},15000);
      function finish(error){clearTimeout(timer);child.removeListener('message',message);child.removeListener('exit',exited);child.removeListener('error',failed);error?reject(error):resolve();}
      function message(data){if(data?.ready)finish();else if(data?.error)finish(new Error(data.error));}
      function exited(){finish(new Error('Background startup failed. Run hs logs.'));}
      function failed(){finish(new Error('Cannot start the background process.'));}
      child.on('message',message);child.once('exit',exited);child.once('error',failed);child.send({options});
    });
  } finally {if(child.connected)child.disconnect();child.unref();}
  return status(options.settings);
}
async function halt(settings) {
  const files=paths(settings),record=read(files.record),info=await status(settings);
  if(info.status==='stopped') {if(record)fs.unlinkSync(files.record);return info;}
  if(info.status!=='running')throw new Error('Service identity cannot be verified. hs will not signal an unidentified process.');
  await request(record,true);
  for(let i=0;i<90;i++) {
    if(!read(files.record))return {status:'stopped',settings,log:files.log};
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Service is still shutting down. Check hs status and hs logs.');
}
function start(options) {return locked(options.settings,files=>launch(options,files));}
function stop(settings) {return locked(settings,()=>halt(settings));}
function restart(options) {
  return locked(options.settings,async files=>{
    const record=read(files.record),info=await status(options.settings);
    if(info.status!=='running')throw new Error('No managed service is running. Use hs start -d first.');
    await halt(options.settings);
    return launch({...record.options,...options,port:record.options.port,host:record.options.host,root:record.options.root},files);
  });
}
function logs(settings,lines) {
  const file=paths(settings).log;let fd;
  try {
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const stat=fs.fstatSync(fd);
    if(!stat.isFile())throw new Error('Log path must be a regular file.');
    const size=Math.min(stat.size,256000),buffer=Buffer.alloc(size);fs.readSync(fd,buffer,0,size,stat.size-size);
    return buffer.toString('utf8').split(/\r?\n/).slice(-(lines+1)).join('\n');
  } catch(error) {if(error.code==='ENOENT')return 'No service log yet. Start with hs start -d.\n';throw error;}
  finally {if(fd!==undefined)fs.closeSync(fd);}
}
function openBrowser(url) {
  const parsed=new URL(url);
  if(parsed.protocol!=='http:'||parsed.username||parsed.password)throw new Error('Invalid local workspace URL.');
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32.exe':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:'ignore',windowsHide:true});
    child.once('error',()=>reject(new Error(`Cannot open a browser. Open ${url} manually.`)));
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
async function childMain(options) {
  const files=paths(options.settings);directory(files);
  const running=await require('./cli.cjs').startForeground(options,false);
  const token=crypto.randomBytes(32).toString('hex'),id=crypto.randomBytes(16).toString('hex');
  const info={id,pid:process.pid,url:running.browserUrl,version,startedAt:new Date().toISOString()};
  let stopping=false;
  const shutdown=()=>{
    if(stopping)return;stopping=true;
    const finish=()=>{try{if(read(files.record)?.id===id)fs.unlinkSync(files.record);}finally{process.exit(0);}};
    const timer=setTimeout(()=>{running.server.closeAllConnections();control.closeAllConnections();finish();},6000);timer.unref();
    running.server.close(()=>control.close(finish));
  };
  const control=http.createServer((req,res)=>{
    const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);
    if(req.headers.origin||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)){res.writeHead(403);return res.end();}
    if(!(req.method==='GET'&&req.url==='/status'||req.method==='POST'&&req.url==='/stop')){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(info));
    if(req.url==='/stop')setImmediate(shutdown);
  });
  control.requestTimeout=3000;control.headersTimeout=3000;
  await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(0,'127.0.0.1',resolve);});
  fs.writeFileSync(files.record,JSON.stringify({...info,token,controlPort:control.address().port,options}),{flag:'wx',mode:0o600});
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  process.send({ready:true});
}
if(require.main===module) {
  process.once('message',data=>childMain(data.options).catch(error=>{console.error(`HexoStudio: ${error.message}`);if(process.connected)process.send({error:error.message},()=>process.exit(1));else process.exit(1);}));
}
module.exports={paths,status,start,stop,restart,logs,openBrowser};
