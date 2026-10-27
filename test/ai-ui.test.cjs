const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/ai.js'), 'utf8');

function fixture(content) {
  const editor = {value:content,selectionStart:0,selectionEnd:content.length};
  const state = {view:'editor',root:'/blog',current:{path:'hello.md',kind:'draft'}};
  const ctx = vm.createContext({state,$:selector=>selector==='#editor'?editor:null,document:{addEventListener(){},querySelector:()=>({})}});
  vm.runInContext(source + '\nthis.writer = AIWriter;',ctx);
  return {state,editor,writer:ctx.writer};
}

test('AI selections exclude YAML front matter including CRLF, BOM and end-of-file delimiters',()=>{
  for (const header of ['---\ntitle: Hello\n---\n','\uFEFF---\r\ntitle: Hello\r\n...\r\n']) {
    const f=fixture(header+'Body paragraph');
    assert.equal(f.writer.captureEditor().text,'Body paragraph');
    f.state.editorSelection={start:0,end:header.length-1};
    assert.equal(f.writer.captureEditor().text,'');
    assert.equal(f.writer.captureEditor().start,header.length);
  }
  const f=fixture('---\ntitle: Hello\n---');
  assert.equal(f.writer.captureEditor().text,'');
});

test('AI results cannot replace a changed buffer, another file, kind or project',()=>{
  const f=fixture('A paragraph'), snapshot=f.writer.captureEditor();
  assert.equal(f.writer.unchanged(snapshot),true);
  f.editor.value='New edits';assert.equal(f.writer.unchanged(snapshot),false);f.editor.value=snapshot.content;
  f.state.current.path='other.md';assert.equal(f.writer.unchanged(snapshot),false);f.state.current.path=snapshot.path;
  f.state.current.kind='post';assert.equal(f.writer.unchanged(snapshot),false);f.state.current.kind=snapshot.kind;
  f.state.root='/other';assert.equal(f.writer.unchanged(snapshot),false);f.state.root=snapshot.root;
  f.state.modalBusy=true;assert.equal(f.writer.unchanged(snapshot),false);
});
