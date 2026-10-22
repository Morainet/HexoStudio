const editableFields = new Set(['title', 'date', 'tags', 'categories']);

function normalizeMetadata(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('文章信息无效');
  const normalized = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!editableFields.has(key)) throw new Error('不支持修改此文章字段');
    if (key === 'tags' || key === 'categories') {
      if (!Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== 'string' || item.length > 100)) throw new Error('标签或分类无效');
      normalized[key] = JSON.stringify(value.map(item => item.trim()).filter(Boolean));
    } else if (key === 'title') {
      if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('文章标题无效');
      normalized[key] = JSON.stringify(value.trim());
    } else {
      if (typeof value !== 'string' || (value && !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(value))) throw new Error('文章日期格式无效');
      normalized[key] = value;
    }
  }
  return normalized;
}

function updateFrontmatter(content, updates) {
  const values = normalizeMetadata(updates);
  if (!Object.keys(values).length) return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const marker = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = content.slice(marker.length);
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const rows = match ? match[1].split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  const output = [];
  for (let index = 0; index < rows.length;) {
    const found = rows[index].match(/^([A-Za-z_][\w-]*):(?:\s|$)/);
    const key = found?.[1];
    if (!pending.has(key)) { output.push(rows[index++]); continue; }
    const value = pending.get(key);
    pending.delete(key);
    if (value !== '') output.push(`${key}: ${value}`);
    index++;
    while (index < rows.length && (/^[ \t]/.test(rows[index]) || (rows[index] === '' && /^[ \t]/.test(rows[index + 1] || '')))) index++;
  }
  for (const [key, value] of pending) if (value !== '') output.push(`${key}: ${value}`);
  const rest = match ? source.slice(match[0].length) : source;
  return marker + `---${newline}${output.join(newline)}${newline}---${newline}` + (match ? rest : `${newline}${rest}`);
}

module.exports = { updateFrontmatter };
