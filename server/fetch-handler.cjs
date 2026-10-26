const {Readable,Writable}=require('node:stream');
const {handle}=require('./index.cjs');
// Web-standard adapter for hosts such as Netlify. No server socket or local writes.
async function fetchHandler(request){
  const url=new URL(request.url),parts=[];let size=0;
  if(request.body){
    const reader=request.body.getReader();
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>4_300_000){await reader.cancel();return new Response(JSON.stringify({error:'请求内容超过云端限制'}),{status:413,headers:{'Content-Type':'application/json'}});}
      parts.push(Buffer.from(value));
    }
  }
  const buffer=Buffer.concat(parts);
  const req=Readable.from(buffer.length?[buffer]:[]);
  req.url=url.pathname+url.search;req.method=request.method;req.headers=Object.fromEntries(request.headers);req.headers.host=url.host;req.socket={remoteAddress:'127.0.0.1'};
  return new Promise((resolve,reject)=>{
    const chunks=[];let status=200,headers={};
    const res=new Writable({write(chunk,encoding,callback){chunks.push(Buffer.from(chunk));callback();}});
    res.headersSent=false;
    res.writeHead=(code,value)=>{status=code;headers=value;res.headersSent=true;return res;};
    res.on('finish',()=>{try{resolve(new Response(request.method==='HEAD'||[204,304].includes(status)?null:Buffer.concat(chunks),{status,headers}));}catch(error){reject(error);}});
    res.on('error',reject);Promise.resolve(handle(req,res)).catch(reject);
  });
}
module.exports={fetchHandler};
