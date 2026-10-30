// Run after `netlify functions:build --functions dist/netlify-functions`.
// Uses unzip (available on the Linux CI runner and macOS).
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hexostudio-netlify-'));
try {
  execFileSync('unzip',['-q',path.resolve('dist/netlify-functions/entry.zip'),'-d',temporary]);
  const script=`
    const assert=require('node:assert/strict'),path=require('node:path');
    const {createRequire}=require('node:module');
    const {pathToFileURL}=require('node:url');
    const root=process.cwd(), load=createRequire(path.join(root,'package.json'));
    for(const name of ['pg','mysql2/promise','mongodb','markdown-it','katex','yaml']) {
      assert.ok(load.resolve(name).startsWith(root+path.sep), name+' missing from bundle');
      load(name);
    }
    Object.assign(process.env,{HEXOSTUDIO_SECRET:'ab'.repeat(32),HEXOSTUDIO_SETUP_KEY:'test-'.repeat(8),HEXOSTUDIO_ORIGIN:'https://studio.example',HEXOSTUDIO_DATABASE_URL:'postgresql://db.example/test'});
    (async()=>{
      const entry=await import(pathToFileURL(path.join(root,'netlify/functions/entry.mjs')).href);
      const html=await entry.default(new Request('https://studio.example/'));
      assert.equal(html.status,200);assert.match(await html.text(),/HexoStudio/);
      const script=await entry.default(new Request('https://studio.example/app.js'));
      assert.match(script.headers.get('content-type'),/javascript/);
      for(const asset of ['diagram-preview.html','vendor/mermaid/mermaid.min.js','vendor/katex/katex.min.css','vendor/katex/fonts/KaTeX_Main-Regular.woff2']) {
        const result=await entry.default(new Request('https://studio.example/'+asset,{method:'HEAD'}));assert.equal(result.status,200,asset);
      }
      const health=await entry.default(new Request('https://studio.example/api/health'));
      assert.equal((await health.json()).mode,'cloud');
      console.log('Netlify archive: production dependencies, static assets and cloud entrypoint passed.');
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  execFileSync(process.execPath,['-e',script],{cwd:temporary,stdio:'inherit',timeout:30000});
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
