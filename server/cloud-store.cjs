const crypto = require('node:crypto');
const { normalizeStorage } = require('./auth-store.cjs');
const TABLE = 'hexostudio_cloud';
function cloudConfig(env = process.env) {
  if (!/^[a-f0-9]{64}$/i.test(env.HEXOSTUDIO_SECRET || '')) throw new Error('HEXOSTUDIO_SECRET 必须是 64 位十六进制随机密钥');
  if ((env.HEXOSTUDIO_SETUP_KEY || '').length < 32) throw new Error('HEXOSTUDIO_SETUP_KEY 至少需要 32 个字符');
  if (env.HEXOSTUDIO_SECRET === env.HEXOSTUDIO_SETUP_KEY) throw new Error('请为加密和初始化使用不同的随机密钥');
  const url = env.HEXOSTUDIO_DATABASE_URL || '';
  const type = /^postgres(?:ql)?:/.test(url) ? 'postgres' : /^mysql:/.test(url) ? 'mysql' : /^mongodb(?:\+srv)?:/.test(url) ? 'mongodb' : '';
  const storage = normalizeStorage({type, url, database:env.HEXOSTUDIO_DATABASE_NAME});
  let origin;
  try { origin = new URL(env.HEXOSTUDIO_ORIGIN); } catch { throw new Error('请设置 HEXOSTUDIO_ORIGIN 为后台的完整访问地址'); }
  if (!['https:', 'http:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('HEXOSTUDIO_ORIGIN 格式无效');
  if (origin.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) throw new Error('云端访问地址必须使用 HTTPS');
  return { storage, secret:env.HEXOSTUDIO_SECRET, setupKey:env.HEXOSTUDIO_SETUP_KEY, origin:origin.origin };
}
function codec(secret) {
  const key = Buffer.from(secret, 'hex');
  return {
    seal(value) {
      const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
      const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
    },
    open(value) {
      try {
        const data=Buffer.from(value,'base64'), decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
        decipher.setAuthTag(data.subarray(12,28));
        return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
      } catch { throw Object.assign(new Error('云端数据无法解密，请检查 HEXOSTUDIO_SECRET 是否与初始化时一致'),{status:503}); }
    }
  };
}
// Every mutation is a compare-and-swap against the shared database revision.
// Callbacks must be synchronous and side-effect-free: a competing instance can cause a retry.
function createCloudStore(config) {
  const cipher=codec(config.secret), storage=config.storage;
  async function run(action) {
    let db;
    try {
      if (storage.type==='postgres') {
        db=new (require('pg').Client)({connectionString:storage.url,connectionTimeoutMillis:6000,statement_timeout:10000});
        await db.connect();
        await db.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id VARCHAR(8) PRIMARY KEY, revision BIGINT NOT NULL, payload TEXT NOT NULL)`);
        await db.query(`INSERT INTO ${TABLE} VALUES ($1,0,$2) ON CONFLICT (id) DO NOTHING`,['main',cipher.seal({})]);
        return await action({
          read:async()=> (await db.query(`SELECT revision,payload FROM ${TABLE} WHERE id=$1`,['main'])).rows[0],
          cas:async(revision,payload)=> Boolean((await db.query(`UPDATE ${TABLE} SET revision=revision+1,payload=$1 WHERE id=$2 AND revision=$3`,[payload,'main',revision])).rowCount)
        });
      }
      if (storage.type==='mysql') {
        db=await require('mysql2/promise').createConnection({uri:storage.url,connectTimeout:6000});
        await db.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id VARCHAR(8) PRIMARY KEY, revision BIGINT NOT NULL, payload LONGTEXT NOT NULL)`);
        await db.execute(`INSERT IGNORE INTO ${TABLE} VALUES (?,0,?)`,['main',cipher.seal({})]);
        return await action({
          read:async()=> (await db.execute(`SELECT revision,payload FROM ${TABLE} WHERE id=?`,['main']))[0][0],
          cas:async(revision,payload)=> Boolean((await db.execute(`UPDATE ${TABLE} SET revision=revision+1,payload=? WHERE id=? AND revision=?`,[payload,'main',revision]))[0].affectedRows)
        });
      }
      db=new (require('mongodb').MongoClient)(storage.url,{serverSelectionTimeoutMS:6000,socketTimeoutMS:10000});
      await db.connect(); const collection=db.db(storage.database).collection(TABLE);
      try { await collection.updateOne({_id:'main'},{$setOnInsert:{revision:0,payload:cipher.seal({})}},{upsert:true}); }
      catch(error) { if(error.code!==11000) throw error; }
      return await action({
        read:()=>collection.findOne({_id:'main'}),
        cas:async(revision,payload)=> Boolean((await collection.updateOne({_id:'main',revision},{$set:{payload},$inc:{revision:1}})).modifiedCount)
      });
    } catch(error) {
      if(error.status) throw error;
      throw Object.assign(new Error('云端数据库连接或操作失败，请检查连接配置和数据库权限'),{status:503});
    } finally { if(db) await (storage.type==='mongodb'?db.close():db.end()).catch(()=>{}); }
  }
  return versionedStore(run,cipher);
}

function versionedStore(run,cipher) {
  return {
    read:()=>run(async db=>cipher.open((await db.read()).payload)),
    update:action=>run(async db=>{
      for(let attempt=0;attempt<12;attempt++) {
        const record=await db.read(), state=cipher.open(record.payload), result=action(state);
        if(result && typeof result.then==='function') throw new Error('Cloud store callbacks must be synchronous');
        if(await db.cas(record.revision,cipher.seal(state))) return result;
      }
      throw Object.assign(new Error('操作冲突，请稍后重试'),{status:409});
    })
  };
}
module.exports={cloudConfig,codec,createCloudStore,versionedStore};
