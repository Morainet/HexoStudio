const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SQLITE_DEFAULT = path.join(os.homedir(), '.hexostudio', 'auth.sqlite');
const TABLE = 'hexostudio_admin';

function normalizeStorage(input) {
  if (!input || input.type === 'file') return { type: 'file' };
  if (input.type === 'sqlite') {
    const file = String(input.path || SQLITE_DEFAULT).trim();
    if (!path.isAbsolute(file) || !/\.(sqlite|sqlite3|db)$/i.test(file)) throw new Error('SQLite 路径需为 .sqlite、.sqlite3 或 .db 结尾的绝对路径');
    return { type: 'sqlite', path: path.resolve(file) };
  }
  if (['postgres', 'mysql', 'mongodb'].includes(input.type)) {
    if (typeof input.url !== 'string' || input.url.length > 4096) throw new Error('请输入数据库连接地址');
    let parsed;
    try { parsed = new URL(input.url); } catch { throw new Error('数据库连接地址无效'); }
    const protocols = { postgres: ['postgres:', 'postgresql:'], mysql: ['mysql:'], mongodb: ['mongodb:', 'mongodb+srv:'] };
    if (!protocols[input.type].includes(parsed.protocol) || !parsed.hostname) throw new Error('数据库连接地址与所选类型不匹配');
    if (input.type === 'mongodb') {
      const database = String(input.database || decodeURIComponent(parsed.pathname.slice(1))).trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(database)) throw new Error('请输入 MongoDB 数据库名称（字母、数字、下划线或连字符）');
      return { type: input.type, url: input.url, database };
    }
    if (!parsed.pathname || parsed.pathname === '/') throw new Error('连接地址需要包含数据库名称');
    return { type: input.type, url: input.url };
  }
  throw new Error('不支持的管理员存储类型');
}

function describeStorage(config) {
  const type = config?.type || 'file';
  if (type === 'file') return { type, label: '本机设置文件' };
  if (type === 'sqlite') return { type, label: config.path };
  try {
    const parsed = new URL(config.url);
    return { type, label: `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${type === 'mongodb' ? ` / ${config.database}` : parsed.pathname}` };
  } catch { return { type, label: '连接配置无效' }; }
}

function databaseError(error) {
  if (error.status) return error;
  const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? `（${error.code}）` : '';
  return Object.assign(new Error(`管理员数据库连接或操作失败${code}`), { status: 503 });
}

let sqliteModule;
async function sqliteDatabase(file) {
  sqliteModule ||= require('sql.js')({ locateFile: name => require.resolve(`sql.js/dist/${name}`) });
  const SQL = await sqliteModule;
  const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, username TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL)`);
  return db;
}
function saveSqlite(file, db) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, Buffer.from(db.export()), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function createStore(config, loadSettings, saveSettings) {
  config = normalizeStorage(config);
  if (config.type === 'file') return {
    async probe() {},
    async read() { return loadSettings().admin || null; },
    async create(record) {
      if (loadSettings().admin?.hash) throw Object.assign(new Error('目标存储已有管理员账号'), { status: 409 });
      saveSettings({ ...loadSettings(), admin: record });
    },
    async replace(record) {
      if (!loadSettings().admin?.hash) throw new Error('管理员账号不存在');
      saveSettings({ ...loadSettings(), admin: record });
    }
  };
  if (config.type === 'sqlite') {
    const run = async (action, persist = false) => {
      let db;
      try {
        db = await sqliteDatabase(config.path);
        const result = action(db);
        if (persist) saveSqlite(config.path, db);
        return result;
      } catch (error) { throw databaseError(error); }
      finally { db?.close(); }
    };
    return {
      async probe() { await run(db => db.exec('SELECT 1')); },
      async read() { return run(db => {
        const statement = db.prepare(`SELECT username, salt, hash FROM ${TABLE} WHERE id = ?`);
        try { statement.bind(['main']); return statement.step() ? statement.getAsObject() : null; }
        finally { statement.free(); }
      }); },
      async create(record) { await run(db => {
        const existing = db.exec(`SELECT id FROM ${TABLE} WHERE id = 'main'`);
        if (existing.length) throw Object.assign(new Error('目标存储已有管理员账号'), { status: 409 });
        db.run(`INSERT INTO ${TABLE} (id, username, salt, hash) VALUES (?, ?, ?, ?)`, ['main', record.username, record.salt, record.hash]);
      }, true); },
      async replace(record) { await run(db => {
        db.run(`UPDATE ${TABLE} SET username = ?, salt = ?, hash = ? WHERE id = ?`, [record.username, record.salt, record.hash, 'main']);
        if (!db.getRowsModified()) throw new Error('管理员账号不存在');
      }, true); }
    };
  }
  if (config.type === 'postgres') {
    const { Client } = require('pg');
    const run = async action => {
      const client = new Client({ connectionString: config.url, connectionTimeoutMillis: 6000 });
      try {
        await client.connect();
        await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id VARCHAR(8) PRIMARY KEY, username VARCHAR(32) NOT NULL, salt VARCHAR(64) NOT NULL, hash VARCHAR(128) NOT NULL)`);
        return await action(client);
      } catch (error) { throw databaseError(error); }
      finally { await client.end().catch(() => {}); }
    };
    return {
      async probe() { await run(client => client.query('SELECT 1')); },
      async read() { return run(async client => (await client.query(`SELECT username, salt, hash FROM ${TABLE} WHERE id = $1`, ['main'])).rows[0] || null); },
      async create(record) { await run(async client => {
        if ((await client.query(`SELECT id FROM ${TABLE} WHERE id = $1`, ['main'])).rowCount) throw Object.assign(new Error('目标存储已有管理员账号'), { status: 409 });
        await client.query(`INSERT INTO ${TABLE} (id, username, salt, hash) VALUES ($1, $2, $3, $4)`, ['main', record.username, record.salt, record.hash]);
      }); },
      async replace(record) { await run(async client => {
        const result = await client.query(`UPDATE ${TABLE} SET username = $1, salt = $2, hash = $3 WHERE id = $4`, [record.username, record.salt, record.hash, 'main']);
        if (!result.rowCount) throw new Error('管理员账号不存在');
      }); }
    };
  }
  if (config.type === 'mysql') {
    const mysql = require('mysql2/promise');
    const run = async action => {
      let connection;
      try {
        connection = await mysql.createConnection({ uri: config.url, connectTimeout: 6000 });
        await connection.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id VARCHAR(8) PRIMARY KEY, username VARCHAR(32) NOT NULL, salt VARCHAR(64) NOT NULL, hash VARCHAR(128) NOT NULL)`);
        return await action(connection);
      } catch (error) { throw databaseError(error); }
      finally { await connection?.end().catch(() => {}); }
    };
    return {
      async probe() { await run(connection => connection.query('SELECT 1')); },
      async read() { return run(async connection => (await connection.execute(`SELECT username, salt, hash FROM ${TABLE} WHERE id = ?`, ['main']))[0][0] || null); },
      async create(record) { await run(async connection => {
        if ((await connection.execute(`SELECT id FROM ${TABLE} WHERE id = ?`, ['main']))[0].length) throw Object.assign(new Error('目标存储已有管理员账号'), { status: 409 });
        await connection.execute(`INSERT INTO ${TABLE} (id, username, salt, hash) VALUES (?, ?, ?, ?)`, ['main', record.username, record.salt, record.hash]);
      }); },
      async replace(record) { await run(async connection => {
        const [result] = await connection.execute(`UPDATE ${TABLE} SET username = ?, salt = ?, hash = ? WHERE id = ?`, [record.username, record.salt, record.hash, 'main']);
        if (!result.affectedRows) throw new Error('管理员账号不存在');
      }); }
    };
  }
  const { MongoClient } = require('mongodb');
  const run = async action => {
    const client = new MongoClient(config.url, { serverSelectionTimeoutMS: 6000 });
    try {
      await client.connect();
      return await action(client.db(config.database).collection(TABLE));
    } catch (error) { throw databaseError(error); }
    finally { await client.close().catch(() => {}); }
  };
  return {
    async probe() { await run(collection => collection.findOne({ _id: 'main' })); },
    async read() { return run(async collection => {
      const record = await collection.findOne({ _id: 'main' });
      return record ? { username: record.username, salt: record.salt, hash: record.hash } : null;
    }); },
    async create(record) { await run(async collection => {
      if (await collection.findOne({ _id: 'main' })) throw Object.assign(new Error('目标存储已有管理员账号'), { status: 409 });
      await collection.insertOne({ _id: 'main', ...record });
    }); },
    async replace(record) { await run(async collection => {
      const result = await collection.updateOne({ _id: 'main' }, { $set: record });
      if (!result.matchedCount) throw new Error('管理员账号不存在');
    }); }
  };
}

module.exports = { normalizeStorage, describeStorage, createStore, SQLITE_DEFAULT };
