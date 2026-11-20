import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Db, Sql, Row } from './db';
import { AppUser, User } from './auth';
import { checkTimes, date, fail, id, parse, planInput, planPatch } from './common';
import { Notifications } from './notifications';
export const PLAN_COLS=`p.id,p.title,p.color,p.done,p.version,p.start_at AS "startAt",p.end_at AS "endAt",
 to_char(p.start_at AT TIME ZONE u.time_zone,'YYYY-MM-DD') AS date,to_char(p.start_at AT TIME ZONE u.time_zone,'HH24:MI') AS start,to_char(p.end_at AT TIME ZONE u.time_zone,'HH24:MI') AS "end"`;
@Injectable()
export class Plans {
 constructor(private db:Db,private notifications:Notifications){}
 async today(sql:Sql,u:AppUser){return (await sql.query(`SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS date`,[u.time_zone]))[0].date as string;}
 async list(u:AppUser,from?:string,to?:string,sql:Sql=this.db){
  const f=from?parse(date,from):await this.today(sql,u),t=to?parse(date,to):f;
  const days=(Date.parse(t)-Date.parse(f))/86400000;if(days<0||days>62)fail(400,'조회 기간은 최대 62일이에요.');
  return sql.query(`SELECT ${PLAN_COLS} FROM plans p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.start_at>=($2::date::timestamp AT TIME ZONE u.time_zone) AND p.start_at<(($3::date+1)::timestamp AT TIME ZONE u.time_zone) ORDER BY p.start_at`,[u.id,f,t]);
 }
 async get(sql:Sql,u:AppUser,pid:string,lock=false) {const [p]=await sql.query(`SELECT ${PLAN_COLS} FROM plans p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND p.user_id=$2 ${lock?'FOR UPDATE OF p':''}`,[pid,u.id]);if(!p)fail(404,'계획을 찾을 수 없어요.');return p;}
 async create(u:AppUser,body:unknown) {const p=parse(planInput,body);checkTimes(p.start,p.end);
  return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);const [r]=await sql.query(`INSERT INTO plans(user_id,title,start_at,end_at,color) VALUES($1,$2,($3::date+$4::time) AT TIME ZONE $7,($3::date+$5::time) AT TIME ZONE $7,$6) RETURNING id`,[u.id,p.title,p.date,p.start,p.end,p.color,u.time_zone]);await this.notifications.schedule(sql,u.id,r.id);return this.get(sql,u,r.id);});
 }
 async change(sql:Sql,u:AppUser,pid:string,body:unknown) {
  const patch=parse(planPatch,body),current=await this.get(sql,u,pid,true);
  if(current.version!==patch.version)fail(409,'다른 곳에서 계획이 바뀌었어요. 새로 확인해주세요.');
  const p:Row={...current,...patch};checkTimes(p.start,p.end);
  const timeChanged=['date','start','end'].some(k=>p[k]!==current[k]);
  if(timeChanged) {const active=await sql.query(`SELECT id FROM focus_sessions WHERE plan_id=$1 AND status IN('RUNNING','PAUSED')`,[pid]);if(active.length)fail(409,'집중 중인 계획의 시간은 집중을 마친 뒤 바꿔주세요.');}
  await sql.query(`UPDATE plans SET title=$3,start_at=($4::date+$5::time) AT TIME ZONE $9,end_at=($4::date+$6::time) AT TIME ZONE $9,color=$7,done=$8,version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2`,[pid,u.id,p.title,p.date,p.start,p.end,p.color,p.done,u.time_zone]);
  if(timeChanged) await sql.query(`UPDATE focus_sessions SET duration_sec=$2,remaining_sec=$2 WHERE plan_id=$1 AND status='READY'`,[pid,(parseInt(p.end.slice(0,2))*60+parseInt(p.end.slice(3))-parseInt(p.start.slice(0,2))*60-parseInt(p.start.slice(3)))*60]);
  if(p.done) await sql.query(`UPDATE focus_sessions SET status='SKIPPED',ended_at=now(),running_since=NULL WHERE plan_id=$1 AND status IN('READY','RUNNING','PAUSED')`,[pid]);
  await this.notifications.schedule(sql,u.id,pid);return this.get(sql,u,pid);
 }
 async update(u:AppUser,pid:string,body:unknown){return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);return this.change(sql,u,pid,body);});}
 async remove(u:AppUser,pid:string){return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);await this.get(sql,u,pid,true);await sql.query('DELETE FROM plans WHERE id=$1 AND user_id=$2',[pid,u.id]);return {deleted:true};});}
}
export const SESSION_COLS=`id,plan_id AS "planId",status,duration_sec AS "durationSec",started_at IS NOT NULL AS started,
 CASE WHEN status='COMPLETED' THEN 0 ELSE greatest(0,remaining_sec-CASE WHEN status='RUNNING' THEN floor(extract(epoch FROM now()-running_since))::int ELSE 0 END) END AS "remainingSec"`;
@Injectable()
export class Focus {
 constructor(private db:Db,private plans:Plans,private notifications:Notifications){}
 async get(sql:Sql,u:AppUser,sid:string){const [s]=await sql.query(`SELECT ${SESSION_COLS} FROM focus_sessions WHERE id=$1 AND user_id=$2`,[sid,u.id]);if(!s)fail(404,'집중 기록을 찾을 수 없어요.');return s;}
 async open(u:AppUser,pid:string){return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);const p=await this.plans.get(sql,u,pid,true);const [s]=await sql.query(`SELECT ${SESSION_COLS} FROM focus_sessions WHERE plan_id=$1 AND user_id=$2 AND status IN('READY','RUNNING','PAUSED')`,[pid,u.id]);if(s)return s;if(p.done)fail(409,'이미 완료한 계획이에요.');const [created]=await sql.query(`INSERT INTO focus_sessions(user_id,plan_id,duration_sec,remaining_sec) VALUES($1,$2,extract(epoch FROM $4::timestamptz-$3::timestamptz)::int,extract(epoch FROM $4::timestamptz-$3::timestamptz)::int) RETURNING id`,[u.id,pid,p.startAt,p.endAt]);return this.get(sql,u,created.id);});}
 async active(u:AppUser){return this.db.query(`SELECT ${SESSION_COLS} FROM focus_sessions WHERE user_id=$1 AND status IN('READY','RUNNING','PAUSED') ORDER BY created_at DESC`,[u.id]);}
 async act(u:AppUser,sid:string,action:string){
  parse(z.enum(['start','pause','resume','complete','skip']),action);
  return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);const current=await this.get(sql,u,sid);await this.plans.get(sql,u,current.planId,true);await sql.query('SELECT id FROM focus_sessions WHERE id=$1 FOR UPDATE',[sid]);const s=await this.get(sql,u,sid);
   const target:Record<string,string>={start:'RUNNING',pause:'PAUSED',resume:'RUNNING',complete:'COMPLETED',skip:'SKIPPED'};
   if(s.status===target[action]&&(action!=='start'||s.started))return s;
   const allowed:Record<string,string[]>={start:['READY'],pause:['RUNNING'],resume:['PAUSED'],complete:['RUNNING','PAUSED'],skip:['READY','RUNNING','PAUSED']};if(!allowed[action].includes(s.status))fail(409,'지금 집중 상태에서는 할 수 없어요.');
   await sql.query(`UPDATE focus_sessions SET status=$2,remaining_sec=$3,running_since=CASE WHEN $2='RUNNING' THEN now() ELSE NULL END,started_at=CASE WHEN $4='start' THEN now() ELSE started_at END,ended_at=CASE WHEN $2 IN('COMPLETED','SKIPPED') THEN now() ELSE NULL END WHERE id=$1`,[sid,target[action],s.remainingSec,action]);
   if(action==='complete'){await sql.query('UPDATE plans SET done=true,version=version+1,updated_at=now() WHERE id=$1 AND NOT done',[s.planId]);await this.notifications.schedule(sql,u.id,s.planId);}
   return this.get(sql,u,sid);
  });
 }
 async balance(u:AppUser,sql:Sql=this.db){return (await sql.query('SELECT coalesce(sum(amount),0)::int AS balance FROM reward_ledger WHERE user_id=$1',[u.id]))[0].balance;}
 async claim(u:AppUser,pid:string){return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);const [prior]=await sql.query('SELECT id FROM reward_ledger WHERE user_id=$1 AND plan_id=$2 AND reason=$3',[u.id,pid,'focus_complete']);if(prior)return {granted:false,amount:5,balance:await this.balance(u,sql)};
  const p=await this.plans.get(sql,u,pid,true);const [s]=await sql.query(`SELECT id FROM focus_sessions WHERE user_id=$1 AND plan_id=$2 AND status='COMPLETED' LIMIT 1`,[u.id,pid]);if(!p.done||!s)fail(409,'집중을 완료한 계획만 보상을 받을 수 있어요.');const r=await sql.query(`INSERT INTO reward_ledger(user_id,plan_id,session_id,amount) VALUES($1,$2,$3,5) ON CONFLICT DO NOTHING RETURNING id`,[u.id,pid,s.id]);return {granted:r.length===1,amount:5,balance:await this.balance(u,sql)};});}
}
@Controller()
export class PlansController {
 constructor(private plans:Plans,private focus:Focus,private db:Db){}
 @Get('plans') list(@User() u:AppUser,@Query('from') from?:string,@Query('to') to?:string){return this.plans.list(u,from,to);}
 @Post('plans') create(@User() u:AppUser,@Body() body:unknown){return this.plans.create(u,body);}
 @Patch('plans/:id') update(@User() u:AppUser,@Param('id') pid:string,@Body() b:unknown){return this.plans.update(u,id(pid),b);}
 @Delete('plans/:id') remove(@User() u:AppUser,@Param('id') pid:string){return this.plans.remove(u,id(pid));}
 @Post('plans/:id/focus') open(@User() u:AppUser,@Param('id') pid:string){return this.focus.open(u,id(pid));}
 @Get('focus/active') active(@User() u:AppUser){return this.focus.active(u);}
 @Get('focus/:id') get(@User() u:AppUser,@Param('id') sid:string){return this.focus.get(this.db,u,id(sid));}
 @Post('focus/:id/:action') action(@User() u:AppUser,@Param('id') sid:string,@Param('action') a:string){return this.focus.act(u,id(sid),a);}
 @Post('plans/:id/reward') claim(@User() u:AppUser,@Param('id') pid:string){return this.focus.claim(u,id(pid));}
 @Get('rewards') async rewards(@User() u:AppUser){return {balance:await this.focus.balance(u),ledger:await this.db.query(`SELECT plan_id AS "planId",amount,reason,created_at AS "createdAt" FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,[u.id])};}
}
