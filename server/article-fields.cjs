const YAML = require('yaml');
const { updateFrontmatter } = require('./frontmatter.cjs');
const { failure } = require('./cloud-auth.cjs');
const standard = new Set(['title', 'date', 'tags', 'categories']);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const validKey = key => typeof key === 'string' && /^[A-Za-z_][\w.-]{0,63}$/.test(key) && !standard.has(key) && !forbidden.has(key);
function parse(source) {
  const doc = YAML.parseDocument(source, { prettyErrors:false, keepSourceTokens:true, stringKeys:true });
  if (doc.errors.length) throw failure('文章参数 YAML 格式无效，请先在正文编辑器中修正');
  return doc;
}
function split(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 1_000_000) throw failure('文章内容无效或超过 1 MB');
  const match = content.match(/^(\uFEFF?)---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!match && (/^\uFEFF?---(?:\r?\n|$)/.test(content) || /^[\s\S]*?\r?\n;;;(?:\r?\n|$)/.test(content))) throw failure('请使用完整的 YAML Front Matter 编辑文章参数');
  const header = match ? match[2] + (content.includes('\r\n') ? '\r\n' : '\n') : '';
  if (Buffer.byteLength(header) > 128_000) throw failure('文章参数不能超过 128 KB');
  const doc = parse(header);
  if (doc.contents && (!YAML.isMap(doc.contents) || doc.contents.flow)) throw failure('文章参数需要使用 YAML 键值列表');
  if ((doc.contents?.items.length || 0) > 200) throw failure('文章自定义参数最多 200 项');
  return {content,match,header,doc,newline:content.includes('\r\n')?'\r\n':'\n'};
}
function references(node) {
  let found=false;
  YAML.visit(node, (_key,value)=>{ if (YAML.isAlias(value) || value?.anchor || value?.tag) found=true; });
  return found;
}
function describe(pair, header) {
  const key=pair.key.value, node=pair.value;
  const type=YAML.isScalar(node) && typeof node.value==='string'?'text':YAML.isScalar(node)&&typeof node.value==='boolean'?'boolean':YAML.isScalar(node)&&typeof node.value==='number'&&Number.isFinite(node.value)?'number':'yaml';
  const value=type==='text'?node.value:type==='boolean'||type==='number'?String(node.value):node?new YAML.Document(node).toString({verifyAliasOrder:false,lineWidth:0}).trimEnd():'null';
  return {key,type,value,editable:validKey(key)&&!references(node)};
}
function inspect(content) {
  const {header,doc}=split(content);
  return (doc.contents?.items || []).filter(pair=>!standard.has(pair.key.value)).map(pair=>describe(pair,header));
}
function replacement(change, old) {
  let value;
  if (typeof change.value !== 'string' || change.value.length>32000) throw failure('自定义参数值不能超过 32000 字符');
  if (change.type==='text') value=new YAML.Scalar(change.value);
  else if (change.type==='boolean' && ['true','false'].includes(change.value)) value=new YAML.Scalar(change.value==='true');
  else if (change.type==='number' && change.value.trim() && Number.isFinite(Number(change.value))) value=new YAML.Scalar(Number(change.value));
  else if (change.type==='yaml') {
    const parsed=parse(change.value);
    if (references(parsed.contents) || parsed.warnings.length) throw failure('自定义参数值不支持锚点、引用或自定义标签');
    value=parsed.contents || new YAML.Scalar(null);
  } else throw failure('自定义参数类型或值无效');
  if (old?.value?.comment) value.comment=old.value.comment;
  const doc=new YAML.Document();
  doc.set(change.key,value);
  return doc.toString({lineWidth:0});
}
function patch(content,changes) {
  const {header,doc,newline,match}=split(content);
  if (!Array.isArray(changes) || changes.length>200) throw failure('文章自定义参数最多 200 项');
  const seen=new Set(), edits=[], additions=[];
  for (const change of changes) {
    if (!change || !validKey(change.key) || seen.has(change.key)) throw failure('参数名称无效、重复或属于基础文章信息');
    seen.add(change.key);
    const old=doc.contents?.items.find(pair=>pair.key.value===change.key);
    if (old && !describe(old,header).editable) throw failure('包含锚点或引用的参数请直接编辑文首 YAML');
    const next=change.remove===true?'':replacement(change,old).replace(/\n/g,newline);
    if (!old) { if(next)additions.push(next);continue; }
    const start=old.key.range[0],end=old.value?.range?.[2]??old.key.range[2];
    edits.push({start,end,next});
  }
  if (!edits.length&&!additions.length) return content;
  let updated=header;
  for(const edit of edits.sort((a,b)=>b.start-a.start))updated=updated.slice(0,edit.start)+edit.next+updated.slice(edit.end);
  updated+=additions.join('');
  const bom=match?match[1]:content.startsWith('\uFEFF')?'\uFEFF':'';
  const body=match?content.slice(match[0].length):content.slice(bom.length);
  const result=`${bom}---${newline}${updated}---${newline}${match?'':newline}${body}`;
  split(result); // Reject edits that would leave an invalid document.
  return result;
}
function transform(input) {
  if (!input || typeof input!=='object') throw failure('文章参数请求无效');
  // Validate before merging basic sidebar edits, so a broken header is never duplicated.
  split(input.content);
  const merged=updateFrontmatter(input.content,input.metadata||{});
  const content=input.changes===undefined?merged:patch(merged,input.changes);
  return {content,fields:inspect(content)};
}
module.exports={inspect,patch,transform};
