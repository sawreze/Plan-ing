import 'dotenv/config';
import { readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Db,Sql } from './db';
export async function migrate(db:Db){
 await db.tx(async sql=>{
  await sql.query("SELECT pg_advisory_xact_lock(7371981)");
  await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,hash text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const dir=path.join(__dirname,'../migrations');
  for(const name of (await readdir(dir)).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
   const text=await readFile(path.join(dir,name),'utf8'),hash=createHash('sha256').update(text).digest('hex');
   const [old]=await sql.query('SELECT hash FROM schema_migrations WHERE name=$1',[name]);if(old){if(old.hash!==hash)throw new Error('Changed migration: '+name);continue;}
   await sql.query(text);await sql.query('INSERT INTO schema_migrations(name,hash) VALUES($1,$2)',[name,hash]);
  }
 });
}
if(require.main===module){const db=new Db();migrate(db).finally(()=>db.onModuleDestroy()).catch(e=>{console.error(e.message);process.exitCode=1;});}
