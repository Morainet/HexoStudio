const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaults = Object.freeze({ name: 'HexoStudio', tagline: '', loginTitle: '', loginDescription: '', logo: '', favicon: '', accentLight: '#365fc5', accentDark: '#9dbbff', footerText: '', helpUrl: '', releaseRepository: 'Morainet/HexoStudio' });
const fail = message => Object.assign(new Error(message), { status: 400 });
function validateBranding(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('品牌配置格式无效');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key) || typeof value !== 'string') throw fail('品牌配置包含不支持的字段');
    const text = value.trim();
    const limit = ['logo', 'favicon'].includes(key) ? 360_000 : ['name', 'loginTitle'].includes(key) ? 48 : key === 'helpUrl' ? 2048 : 200;
    if (text.length > limit || /[\x00-\x1f\x7f]/.test(text)) throw fail('品牌配置内容过长或包含无效字符');
    if (key === 'name' && !text) throw fail('请填写产品名称');
    if (key.startsWith('accent') && !/^#[a-f0-9]{6}$/i.test(text)) throw fail('主题色需要使用六位十六进制颜色');
    if (key === 'releaseRepository' && text && (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(text) || ['.', '..'].includes(text.split('/')[1]))) throw fail('更新仓库格式应为 owner/repo，留空关闭检查');
    if (['logo', 'favicon'].includes(key) && text) validateImage(text);
    if (key === 'helpUrl' && text) validateUrl(text);
    result[key] = text;
  }
  return result;
}
function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('品牌链接必须使用 HTTPS 地址'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail('品牌链接必须使用 HTTPS 地址');
}
function validateImage(value) {
  if (value.startsWith('https:')) return validateUrl(value);
  const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw fail('品牌图片仅支持 HTTPS 地址或 PNG、JPEG、WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length > 256 * 1024 || bytes.toString('base64') !== match[2]) throw fail('品牌图片格式无效或超过 256 KB');
}
function deploymentBranding() {
  let settings = {};
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'oem-branding.json');
  if (packaged && fs.existsSync(packaged)) settings = validateBranding(JSON.parse(fs.readFileSync(packaged, 'utf8')));
  if (process.env.HEXOSTUDIO_BRANDING) {
    try { settings = { ...settings, ...validateBranding(JSON.parse(process.env.HEXOSTUDIO_BRANDING)) }; }
    catch { throw Object.assign(new Error('HEXOSTUDIO_BRANDING 品牌配置无效'), { status: 503 }); }
  }
  return { ...defaults, ...settings };
}
function brandingRecord(stored = {}) {
  const clean = validateBranding(stored);
  return { branding: { ...deploymentBranding(), ...clean }, revision: crypto.createHash('sha256').update(JSON.stringify(clean)).digest('hex') };
}
function brandingMutation(stored, input, reset = false) {
  if (!input || input.revision !== brandingRecord(stored).revision) throw Object.assign(new Error('品牌配置已变化，请重新打开后修改'), { status: 409 });
  return reset ? {} : validateBranding(input.branding);
}
module.exports = { defaults, validateBranding, brandingRecord, brandingMutation, deploymentBranding };
