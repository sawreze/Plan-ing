import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { AppUser, User } from './auth';
import { date, fail, id, parse, preferences, title } from './common';
import { Focus } from './plans';
import { Notifications } from './notifications';
const zone=z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Invalid timezone');
const goalCreate=z.strictObject({title:title(80),date:date.nullish()});
const goalPatch=z.strictObject({title:title(80).optional(),date:z.union([date,z.literal(''),z.null()]).optional(),done:z.boolean().optional()});
const GOAL_COLS=`id,title,to_char(target_date,'YYYY-MM-DD') AS date,done,crew_id AS "crewId"`;
export function studyType(q2:number[],q3:number|null) {
 if(q3===null)return null;const guided=q2.includes(0)||q2.includes(1),reset=q3===0;
 const [type,name]=guided?(reset?['steady_doer','차근차근 실천가']:['flexible_challenger','유연한 도전가']):(reset?['calm_designer','차분한 설계자']:['free_explorer','자유로운 탐험가']);
 return {type,name,x:guided?73:27,y:reset?27:73};
}
@Controller()
export class ProfileController {
 constructor(private db:Db,private focus:Focus,private notifications:Notifications){}
 @Get('me') async me(@User() u:AppUser){return {id:u.id,displayName:u.display_name,timeZone:u.time_zone,preferences:u.preferences,coins:await this.focus.balance(u)};}
 @Patch('me') async update(@User() u:AppUser,@Body() body:unknown){
  const p=parse(z.strictObject({displayName:z.string().trim().max(30).optional(),timeZone:zone.optional(),preferences:preferences.optional()}),body);
  const r=await this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);const [r]=await sql.query(`UPDATE users SET display_name=coalesce($2,display_name),time_zone=coalesce($3,time_zone),preferences=coalesce($4::jsonb,preferences) WHERE id=$1 RETURNING *`,[u.id,p.displayName??null,p.timeZone??null,p.preferences?JSON.stringify(p.preferences):null]);if(p.preferences)await this.notifications.schedule(sql,u.id);return r;});return this.me(r as AppUser);
 }
 @Get('goals') goals(@User() u:AppUser){return this.db.query(`SELECT ${GOAL_COLS} FROM goals WHERE user_id=$1 ORDER BY created_at`,[u.id]);}
 @Post('goals') async create(@User() u:AppUser,@Body() body:unknown){const p=parse(goalCreate,body);return (await this.db.query(`INSERT INTO goals(user_id,title,target_date) VALUES($1,$2,$3::date) RETURNING ${GOAL_COLS}`,[u.id,p.title,p.date??null]))[0];}
 @Patch('goals/:id') async patch(@User() u:AppUser,@Param('id') gid:string,@Body() body:unknown){const p=parse(goalPatch,body);const [r]=await this.db.query(`UPDATE goals SET title=coalesce($3,title),target_date=CASE WHEN $4 THEN $5::date ELSE target_date END,done=coalesce($6,done) WHERE id=$1 AND user_id=$2 RETURNING ${GOAL_COLS}`,[id(gid),u.id,p.title??null,'date'in p,p.date||null,p.done??null]);if(!r)fail(404,'목표를 찾을 수 없어요.');return r;}
 @Delete('goals/:id') async remove(@User() u:AppUser,@Param('id') gid:string){const r=await this.db.query('DELETE FROM goals WHERE id=$1 AND user_id=$2 RETURNING id',[id(gid),u.id]);if(!r.length)fail(404,'목표를 찾을 수 없어요.');return {deleted:true};}
 @Post('survey') async submit(@User() u:AppUser,@Body() body:unknown){
  const p=parse(z.strictObject({q1:z.number().int().min(0).max(4).nullable(),q2:z.array(z.number().int().min(0).max(3)).max(4).refine(a=>new Set(a).size===a.length),q3:z.number().int().min(0).max(1).nullable()}),body);const result=studyType(p.q2,p.q3);
  const [r]=await this.db.query(`INSERT INTO survey_responses(user_id,answers,rule_version,result) VALUES($1,$2::jsonb,1,$3::jsonb) RETURNING id,created_at AS "createdAt"`,[u.id,JSON.stringify(p),JSON.stringify(result)]);return {...r,answers:p,ruleVersion:1,result};
 }
 @Get('survey/latest') async survey(@User() u:AppUser){const [s]=await this.db.query(`SELECT id,answers,rule_version AS "ruleVersion",result,created_at AS "createdAt" FROM survey_responses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,[u.id]);if(!s)fail(404,'아직 설문 답변이 없어요.');return s;}
}
