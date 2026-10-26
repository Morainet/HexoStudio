const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('cloud onboarding skips database form and sends setup key, then hides storage controls',async()=>{
  const nodes=new Map(),calls=[],state={cloud:true};
  function element(){const classes=new Set();return {value:'',dataset:{},disabled:false,textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,v){if(v)classes.add(x);else classes.delete(x);}},append(){},replaceChildren(){},focus(){},setAttribute(){},reset(){}};}
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);};
  $('#auth-storage-type').value='postgres';
  const context=vm.createContext({$,state,t:require('../public/i18n.js').t,DisplayPreferences:{place(){}},document:{createElement:element},render(){},toast(){},refreshPosts:async()=>{},
    api:async(name,options)=>{calls.push({name,data:options?.data});return name==='status'?{mode:'cloud',root:null}:{csrf:'shared-session'};}
  });
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function storageFields('),source.indexOf("$('#logout').onclick")),context);
  context.showAuth(false);
  assert.equal($('#auth-form').dataset.step,'account');assert.equal($('#auth-step-count').textContent,'1 / 2');
  assert.equal($('#auth-storage-row').disabled,true);assert.equal($('#auth-back').classList.contains('hidden'),true);
  assert.equal($('#auth-setup-key').required,true);assert.equal($('#auth-setup-key').disabled,false);
  $('#auth-username').value='admin';$('#auth-password').value=$('#auth-confirm').value='long-secure-password';$('#auth-setup-key').value='bootstrap-key';
  await $('#auth-form').onsubmit({preventDefault(){}});
  assert.deepEqual(calls.map(x=>x.name),['auth/setup','status']);
  assert.equal(calls[0].data.setupKey,'bootstrap-key');assert.equal(calls[0].data.storage,undefined);
  assert.equal($('#auth-setup-key').value,'');assert.equal($('#account-storage').classList.contains('hidden'),true);
  context.showAuth(true);assert.equal($('#auth-setup-key').disabled,true);assert.equal($('#auth-setup-key-row').classList.contains('hidden'),true);
});
