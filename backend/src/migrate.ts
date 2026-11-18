import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, tx } from './db';

// 순서대로 한 번씩 적용. 적용 기록은 schema_migrations에 남긴다.
export async function migrate() {
  const dir = join(__dirname, '../../migrations');
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(7151)');
      if ((await c.query('select 1 from schema_migrations where name=$1', [name])).rowCount) return;
      await c.query(readFileSync(join(dir, name), 'utf8'));
      await c.query('insert into schema_migrations(name) values ($1)', [name]);
      console.log('applied', name);
    });
  }
}

if (require.main === module) migrate().then(() => pool.end(), (e) => { console.error(e); process.exit(1); });
