/* Review Front Matter changes in the editor before saving to the blog. */
const ArticleFields = (() => {
  const reserved=new Set(['title','date','tags','categories','__proto__','constructor','prototype']);
  const validKey=key=>/^[A-Za-z_][\w.-]{0,63}$/.test(key)&&!reserved.has(key);
  function snapshot() {
    if(state.view!=='editor'||!state.current||!$('#editor'))return null;
    return {root:state.root,path:state.current.path,kind:state.current.kind,content:$('#editor').value,metadata:JSON.stringify(state.metadataValues),edits:metadataEdits()};
  }
  function current(saved) {
    return saved&&state.view==='editor'&&state.root===saved.root&&state.current?.path===saved.path&&state.current?.kind===saved.kind&&$('#editor')?.value===saved.content&&JSON.stringify(state.metadataValues)===saved.metadata;
  }
  function changesFor(original,working) {
    const changes=[];
    for(const [key,field] of working) {
      const before=original.get(key);
      if(field.deleted) {if(before)changes.push({key,remove:true});continue;}
      if(!before||field.type!==before.type||field.value!==before.value)changes.push({key,type:field.type,value:field.value});
    }
    return changes;
  }
  function imageUrl(value) {
    if(!value||/[\x00-\x20\x7f\\]/.test(value))return null;
    try {const url=new URL(value,location.origin);return !url.username&&!url.password&&(url.protocol==='https:'||(url.origin===location.origin&&value.startsWith('/images/hexostudio/')))?url.href:null;}catch{return null;}
  }
  async function open() {
    if(state.saving||state.uploading||state.modalBusy||state.gitBusy)return toast(t('请等待当前操作完成'),'error');
    const saved=snapshot();if(!saved)return;
    if(!modal(`<h2 id="modal-title">${t('封面与自定义参数')}</h2><p>${t('正在读取文章参数…')}</p>`))return;
    const loading=state.dialogVersion;
    let result;
    try {result=await api('article-fields',{method:'POST',data:{content:saved.content,metadata:saved.edits}});}
    catch(error){if(state.dialogVersion===loading){closeModal();toast(error.message,'error');}return;}
    if(state.dialogVersion!==loading||!current(saved))return;
    const original=new Map(result.fields.map(field=>[field.key,field])),working=new Map(result.fields.map(field=>[field.key,{...field}]));
    let coverKey='cover';
    modal(`<div class="article-fields-dialog"><h2 id="modal-title">${t('封面与自定义参数')}</h2><p>${t('应用后仍需保存文章，显示效果由博客主题决定。')}</p><section class="cover-settings"><div class="panel-title"><h3>${t('封面图片')}</h3><button id="cover-clear" type="button" class="field-clear">${t('清除字段')}</button></div><div class="cover-inputs"><label>${t('封面字段')}<input id="cover-key" list="cover-field-names" maxlength="64" value="cover" spellcheck="false"><datalist id="cover-field-names"><option value="cover"><option value="top_img"><option value="banner"><option value="thumbnail"></datalist></label><label>${t('图片地址')}<input id="cover-url" placeholder="https://… /images/…" maxlength="4000" spellcheck="false"></label></div><p id="cover-hint" class="field-note"></p><div class="field-actions"><button id="cover-upload" class="secondary" type="button">${icon('upload')} ${t('上传封面')}</button><button id="cover-library" class="secondary" type="button">${t('从图片库选择')}</button><button id="cover-preview-button" class="secondary" type="button">${t('预览图片')}</button></div><input id="cover-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden><div id="cover-preview" class="cover-preview hidden"><img id="cover-preview-image" alt="${t('封面预览')}" referrerpolicy="no-referrer"></div><div id="cover-images" class="media-grid hidden"></div></section><details class="custom-fields-section"><summary>${t('自定义参数')} <span id="custom-field-count"></span></summary><p>${t('例如 description、sticky、comments、toc；布尔值、数字和 YAML 会保留原有类型。')}</p><div id="custom-field-list"></div><form id="custom-field-add" class="field-add"><input id="custom-field-name" aria-label="${t('新参数名称')}" placeholder="${t('参数名称，例如 description')}" maxlength="64" spellcheck="false" required><button class="secondary" type="submit">${t('添加参数')}</button></form></details><div class="actions article-fields-footer"><button id="fields-cancel" class="secondary" type="button">${t('取消')}</button><button id="fields-apply" class="primary" type="button">${t('应用到文章')}</button></div></div>`);
    const dialog=state.dialogVersion;
    const alive=()=>state.dialogVersion===dialog&&current(saved);
    function feedback(message) {$('#cover-hint').textContent=message;}
    function clearPreview() {$('#cover-preview').classList.add('hidden');$('#cover-preview-image').removeAttribute('src');}
    function updateCover() {
      const field=working.get(coverKey);
      $('#cover-url').value=field&&!field.deleted&&field.type==='text'?field.value:'';
      $('#cover-url').disabled=Boolean(field&&!field.editable);
      $('#cover-clear').disabled=Boolean(!field||field.deleted||!field.editable);
      $('#cover-upload').disabled=$('#cover-library').disabled=Boolean(field&&!field.editable);
      feedback(field&&!field.deleted&&field.type!=='text'?t('该字段不是文本，请在自定义参数中编辑；填写图片地址会改为文本。'):t('常用字段为 cover；文章顶部大图可使用 top_img。'));
      clearPreview();
    }
    function setCover(value) {
      if(!validKey(coverKey))return toast(t('参数名称无效、重复或属于基础文章信息'),'error');
      const old=working.get(coverKey);
      if(old&&!old.editable)return toast(t('包含锚点或引用的参数请直接编辑文首 YAML'),'error');
      if(!value.trim()) {if(old)old.deleted=true;}
      else working.set(coverKey,{key:coverKey,type:'text',value:value.trim(),editable:true});
      clearPreview();renderFields();
      $('#cover-clear').disabled=!value.trim();
    }
    function renderFields() {
      const fields=[...working.values()].filter(field=>field.key!==coverKey||field.type!=='text');
      $('#custom-field-count').textContent=String(fields.filter(field=>!field.deleted).length);
      $('#custom-field-list').innerHTML=fields.length?fields.map((field,index)=>`<div class="custom-field-row ${field.deleted?'field-removed':''}" data-field-index="${index}"><div class="custom-field-heading"><code>${escapeHTML(field.key)}</code><button type="button" data-field-remove ${field.editable?'':'disabled'}>${t(field.deleted?'恢复':'移除')}</button></div>${field.deleted?`<p class="field-note">${t('应用后移除此字段')}</p>`:`<label class="sr-only" for="field-type-${index}">${escapeHTML(field.key)} ${t('参数类型')}</label><select id="field-type-${index}" data-field-type ${field.editable?'':'disabled'}>${[['text',t('文本')],['boolean',t('布尔值')],['number',t('数字')],['yaml','YAML']].map(([value,label])=>`<option value="${value}" ${field.type===value?'selected':''}>${label}</option>`).join('')}</select><label class="sr-only" for="field-value-${index}">${escapeHTML(field.key)} ${t('参数值')}</label>${field.type==='boolean'?`<select id="field-value-${index}" data-field-value ${field.editable?'':'disabled'}><option value="true" ${field.value==='true'?'selected':''}>true</option><option value="false" ${field.value==='false'?'selected':''}>false</option></select>`:`<textarea id="field-value-${index}" data-field-value rows="${field.type==='yaml'?4:2}" maxlength="32000" spellcheck="false" ${field.editable?'':'readonly'}>${escapeHTML(field.value)}</textarea>`}${field.editable?'':`<p class="field-note">${t('包含锚点或引用的参数请直接编辑文首 YAML')}</p>`}`}</div>`).join(''):`<p class="field-note">${t('暂无其他自定义参数')}</p>`;
      $('#custom-field-list').querySelectorAll('[data-field-index]').forEach(row=>{
        const field=fields[Number(row.dataset.fieldIndex)];
        row.querySelector('[data-field-remove]').onclick=()=>{field.deleted=!field.deleted;renderFields();if(field.key===coverKey)updateCover();};
        const type=row.querySelector('[data-field-type]'),value=row.querySelector('[data-field-value]');
        if(type)type.onchange=()=>{field.type=type.value;if(type.value==='boolean')field.value='true';else if(type.value==='number')field.value='0';else if(type.value==='yaml')field.value=JSON.stringify(field.value);renderFields();if(field.key===coverKey)updateCover();};
        if(value)value.oninput=()=>{field.value=value.value;};
      });
    }
    $('#cover-key').onchange=()=>{
      const key=$('#cover-key').value.trim();
      if(!validKey(key)) {$('#cover-key').value=coverKey;return toast(t('参数名称无效、重复或属于基础文章信息'),'error');}
      coverKey=key;updateCover();renderFields();
    };
    $('#cover-url').oninput=()=>setCover($('#cover-url').value);
    $('#cover-clear').onclick=()=>{setCover('');updateCover();};
    function preview() {
      const url=imageUrl($('#cover-url').value.trim());
      if(!url)return feedback(t('请填写 HTTPS 图片地址或博客图片路径'));
      const img=$('#cover-preview-image');
      img.onerror=()=>{if(alive()){clearPreview();feedback(t('后台无法预览此图片，请检查地址；主题相对路径需在博客中确认。'));}};
      img.onload=()=>{if(alive())$('#cover-preview').classList.remove('hidden');};
      img.src=url;
    }
    $('#cover-preview-button').onclick=preview;
    $('#cover-upload').onclick=()=>$('#cover-file').click();
    $('#cover-file').onchange=async event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      const outcome=await modalAction($('#cover-upload'),async()=>{
        if(file.size>(state.cloud?3_000_000:8_000_000))throw new Error(t(state.cloud?'云端图片不能超过 3 MB':'图片不能超过 8 MB'));
        return api('assets',{method:'POST',data:{name:file.name,data:await imageBase64(file)}});
      },t('正在上传封面…'));
      if(!outcome.ok||!alive())return;
      setCover(outcome.value.url);updateCover();preview();feedback(t('图片已上传到博客图片库，请应用参数并保存文章。'));
    };
    $('#cover-library').onclick=async()=>{
      const container=$('#cover-images');
      if(!container.classList.contains('hidden')){container.classList.add('hidden');return;}
      const outcome=await modalAction($('#cover-library'),()=>api('assets'),t('正在读取图片库…'));
      if(!outcome.ok||!alive())return;
      container.innerHTML=outcome.value.images.length?outcome.value.images.map(item=>`<button class="media-card" type="button" data-cover-image="${escapeHTML(item.url)}"><img src="${escapeHTML(imageUrl(item.url)||'')}" alt="" loading="lazy" referrerpolicy="no-referrer"><span>${escapeHTML(item.name)}</span></button>`).join(''):`<p class="field-note">${t('图片库为空，请先上传图片')}</p>`;
      container.classList.remove('hidden');
      container.querySelectorAll('[data-cover-image]').forEach(button=>button.onclick=()=>{setCover(button.dataset.coverImage);updateCover();preview();container.classList.add('hidden');});
    };
    $('#custom-field-add').onsubmit=event=>{
      event.preventDefault();const key=$('#custom-field-name').value.trim();
      if(!validKey(key)||working.has(key)&&!working.get(key).deleted)return toast(t('参数名称无效、重复或属于基础文章信息'),'error');
      working.set(key,{key,type:'text',value:'',editable:true});$('#custom-field-name').value='';renderFields();
      if(key===coverKey)updateCover();
    };
    $('#fields-cancel').onclick=closeModal;
    $('#fields-apply').onclick=async()=>{
      if(!current(saved))return toast(t('编辑器内容已变化，请重新打开文章参数'),'error');
      const outcome=await modalAction($('#fields-apply'),()=>api('article-fields',{method:'POST',data:{content:saved.content,metadata:saved.edits,changes:changesFor(original,working)}}),t('正在应用参数…'));
      if(!outcome.ok||!alive())return;
      closeModal();$('#editor').value=outcome.value.content;setEditorDirty();
      toast(t('参数已应用，请保存文章'));
    };
    renderFields();updateCover();
  }
  document.addEventListener('click',event=>{if(event.target.closest('#article-fields-open'))open();});
  return {open,changesFor,current,snapshot,imageUrl};
})();
