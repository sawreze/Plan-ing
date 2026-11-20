import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
export type Row = Record<string, any>;
export interface Sql { query(sql: string, params?: any[]): Promise<Row[]>; }
@Injectable()
export class Db implements Sql, OnModuleDestroy {
  readonly pool: Pool;
  constructor() { this.pool = new Pool({connectionString: process.env.DATABASE_URL, max: 10, ssl: process.env.DATABASE_SSL === 'require' ? {rejectUnauthorized:true} : undefined}); }
  async query(sql: string, params: any[] = []) { return (await this.pool.query(sql, params)).rows; }
  async tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn({query: async (s,p=[]) => (await client.query(s,p)).rows}); await client.query('COMMIT'); return result; }
    catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
