import { Body, Controller, Delete, Get, Injectable, Param, Post } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppUser, User } from './auth';
import { Db, Sql } from './db';
import { date, fail, id, parse, title } from './common';
const crewInput=z.strictObject({name:title(40),goal:title(80),category:z.enum(['자격증','시험 준비','공부 습관','독서','기타']),date:date.nullish(),description:z.string().trim().max(240).default('')});
const CREW_COLS=`c.id,c.name,c.goal,c.category,c.description,to_char(c.target_date,'YYYY-MM-DD') AS date,c.invite_code AS code,c.owner_id AS "ownerId",c.created_at AS "createdAt"`;
@Injectable()
export class Crews {
 constructor(private db:Db){}
 async membership(sql:Sql,uid:string,cid:string,lock=false){const [m]=await sql.query(`SELECT c.id,c.owner_id FROM crews c JOIN crew_members m ON m.crew_id=c.id AND m.user_id=$1 WHERE c.id=$2 ${lock?'FOR UPDATE OF c':''}`,[uid,cid]);if(!m)fail(404,'크루를 찾을 수 없어요.');return m;}
 async detail(u:AppUser,cid:string){await this.membership(this.db,u.id,cid);const [c]=await this.db.query(`SELECT ${CREW_COLS} FROM crews c WHERE c.id=$1`,[cid]);const members=await this.db.query(`SELECT u.id,u.display_name AS "displayName",(u.id=c.owner_id) AS owner FROM crew_members m JOIN users u ON u.id=m.user_id JOIN crews c ON c.id=m.crew_id WHERE m.crew_id=$1 ORDER BY m.joined_at`,[cid]);return {...c,members};}
 async create(u:AppUser,body:unknown){const p=parse(crewInput,body);const cid=await this.db.tx(async sql=>{const [c]=await sql.query(`INSERT INTO crews(owner_id,name,goal,category,target_date,description,invite_code) VALUES($1,$2,$3,$4,$5::date,$6,$7) RETURNING id`,[u.id,p.name,p.goal,p.category,p.date??null,p.description,randomBytes(12).toString('base64url')]);await sql.query('INSERT INTO crew_members VALUES($1,$2,now())',[c.id,u.id]);return c.id;});return this.detail(u,cid);}
 async join(u:AppUser,body:unknown){const p=parse(z.strictObject({code:z.string().regex(/^[A-Za-z0-9_-]{16}$/)}),body);const cid=await this.db.tx(async sql=>{const [c]=await sql.query('SELECT id FROM crews WHERE invite_code=$1 FOR UPDATE',[p.code]);if(!c)fail(404,'참여 코드를 확인해주세요.');await sql.query('INSERT INTO crew_members(crew_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[c.id,u.id]);return c.id;});return this.detail(u,cid);}
 async leave(u:AppUser,cid:string){return this.db.tx(async sql=>{const c=await this.membership(sql,u.id,cid,true);if(c.owner_id===u.id)fail(409,'크루장은 탈퇴 대신 크루 삭제를 사용해주세요.');await sql.query('DELETE FROM crew_members WHERE crew_id=$1 AND user_id=$2',[cid,u.id]);return {left:true};});}
 async remove(u:AppUser,cid:string){return this.db.tx(async sql=>{const c=await this.membership(sql,u.id,cid,true);if(c.owner_id!==u.id)fail(403,'크루장만 삭제할 수 있어요.');await sql.query('DELETE FROM crews WHERE id=$1',[cid]);return {deleted:true};});}
 async addGoal(u:AppUser,cid:string){return this.db.tx(async sql=>{await this.membership(sql,u.id,cid,true);const [g]=await sql.query(`INSERT INTO goals(user_id,title,target_date,crew_id) SELECT $1,goal,target_date,id FROM crews WHERE id=$2 ON CONFLICT(user_id,crew_id) WHERE crew_id IS NOT NULL DO UPDATE SET crew_id=excluded.crew_id RETURNING id,title,done,crew_id AS "crewId",to_char(target_date,'YYYY-MM-DD') AS date`,[u.id,cid]);return g;});}
 async rotate(u:AppUser,cid:string){return this.db.tx(async sql=>{const c=await this.membership(sql,u.id,cid,true);if(c.owner_id!==u.id)fail(403,'크루장만 코드를 바꿀 수 있어요.');return (await sql.query('UPDATE crews SET invite_code=$2 WHERE id=$1 RETURNING invite_code AS code',[cid,randomBytes(12).toString('base64url')]))[0];});}
}
@Controller('crews')
export class CrewsController {
 constructor(private db:Db,private crews:Crews){}
 @Get() list(@User() u:AppUser){return this.db.query(`SELECT ${CREW_COLS},(SELECT count(*)::int FROM crew_members WHERE crew_id=c.id) AS "memberCount" FROM crews c JOIN crew_members m ON m.crew_id=c.id AND m.user_id=$1 ORDER BY c.created_at DESC`,[u.id]);}
 @Post() create(@User() u:AppUser,@Body() b:unknown){return this.crews.create(u,b);}
 @Post('join') join(@User() u:AppUser,@Body() b:unknown){return this.crews.join(u,b);}
 @Get(':id') detail(@User() u:AppUser,@Param('id') cid:string){return this.crews.detail(u,id(cid));}
 @Post(':id/leave') leave(@User() u:AppUser,@Param('id') cid:string){return this.crews.leave(u,id(cid));}
 @Post(':id/goal') goal(@User() u:AppUser,@Param('id') cid:string){return this.crews.addGoal(u,id(cid));}
 @Post(':id/invite') rotate(@User() u:AppUser,@Param('id') cid:string){return this.crews.rotate(u,id(cid));}
 @Delete(':id') remove(@User() u:AppUser,@Param('id') cid:string){return this.crews.remove(u,id(cid));}
}
