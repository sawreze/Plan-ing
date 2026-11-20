import { Body, Controller, Delete, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Db, Sql } from './db';
import { id, parse } from './common';
import { AppUser, User } from './auth';
/** Jobs are replaced in the same transaction as their source plan/preferences. */
@Injectable()
export class Notifications {
 constructor(private db:Db){}
 async schedule(sql:Sql,userId:string,planId?:string) {
  await sql.query(`UPDATE notification_jobs SET status='CANCELLED',lease_id=NULL,lock_until=NULL WHERE user_id=$1 AND ($2::uuid IS NULL OR plan_id=$2) AND status IN('PENDING','PROCESSING')`,[userId,planId||null]);
  await sql.query(`INSERT INTO notification_jobs(user_id,plan_id,device_id,plan_version,kind,due_at,next_attempt_at)
    SELECT p.user_id,p.id,d.id,p.version,k.kind,p.start_at-k.offset_min*interval '1 minute',p.start_at-k.offset_min*interval '1 minute'
    FROM plans p JOIN users u ON u.id=p.user_id JOIN devices d ON d.user_id=u.id AND d.enabled
    CROSS JOIN LATERAL (SELECT 'start' AS kind,0 AS offset_min WHERE (u.preferences->'notifications'->>'atStart')::boolean
      UNION ALL SELECT 'before', (u.preferences->'notifications'->>'before')::int WHERE (u.preferences->'notifications'->>'before')::int>0) k
    WHERE p.user_id=$1 AND ($2::uuid IS NULL OR p.id=$2) AND NOT p.done
      AND (u.preferences->'notifications'->>'enabled')::boolean AND p.start_at-k.offset_min*interval '1 minute'>now()
    ON CONFLICT(plan_id,plan_version,device_id,kind) DO UPDATE SET status='PENDING',next_attempt_at=excluded.next_attempt_at,lease_id=NULL,lock_until=NULL
      WHERE notification_jobs.status IN('CANCELLED','FAILED')`,[userId,planId||null]);
 }
 async register(userId:string,body:unknown) {
  const p=parse(z.strictObject({platform:z.literal('ios'),token:z.string().regex(/^[a-fA-F0-9]{64,512}$/)}),body);
  return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);const [device]=await sql.query(`INSERT INTO devices(user_id,platform,token) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,enabled=true,updated_at=now() RETURNING id,platform,enabled`,[userId,p.platform,p.token]);await this.schedule(sql,userId);return device;});
 }
 async remove(userId:string,deviceId:string) { await this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);await sql.query('UPDATE devices SET enabled=false WHERE id=$1 AND user_id=$2',[deviceId,userId]);await sql.query(`UPDATE notification_jobs SET status='CANCELLED',lease_id=NULL WHERE device_id=$1 AND user_id=$2 AND status IN('PENDING','PROCESSING')`,[deviceId,userId]);});return {removed:true}; }
}
@Controller('devices')
export class DevicesController {
 constructor(private notifications:Notifications){}
 @Post() register(@User() u:AppUser,@Body() body:unknown){return this.notifications.register(u.id,body);}
 @Delete(':id') remove(@User() u:AppUser,@Param('id') deviceId:string){return this.notifications.remove(u.id,id(deviceId));}
}
