import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

// Runs before opening the writable workspace connection. Failure stops migration.
export async function backupBeforeAcquisitionMigration(paths) {
  if(!await fs.stat(paths.databaseFile).then(()=>true,()=>false))return;
  const source=new Database(paths.databaseFile,{readonly:true,fileMustExist:true});
  try {
    const version=source.pragma('user_version',{simple:true});if(!version||version>=29)return;
    const folder=path.join(paths.backupsDir,'Migration-Points');await fs.mkdir(folder,{recursive:true});
    const file=path.join(folder,`before-acquisition-v29-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
    await source.backup(file);
    const restored=new Database(file,{readonly:true,fileMustExist:true});
    try {
      if(restored.pragma('integrity_check',{simple:true})!=='ok'||restored.pragma('foreign_key_check').length||restored.pragma('user_version',{simple:true})!==version)throw new Error('迁移恢复点校验失败，停止升级');
      for(const {name} of source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
        const quoted='"'+name.replaceAll('"','""')+'"';
        if(source.prepare(`SELECT count(*) n FROM ${quoted}`).get().n!==restored.prepare(`SELECT count(*) n FROM ${quoted}`).get().n)throw new Error('迁移恢复点逐表数量不一致，停止升级');
      }
    } finally {restored.close();}
    const bytes=await fs.readFile(file);await fs.writeFile(file+'.json',JSON.stringify({fromVersion:version,toVersion:29,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),integrity:'ok',verifiedAt:new Date().toISOString()},null,2));
  } finally {source.close();}
}
