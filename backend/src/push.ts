import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:http2';
import { randomUUID } from 'node:crypto';
import { Db, Row } from './db';
@Injectable()
export class PushGateway {
 private cached?:{token:string;until:number};
 configured(){return !!(process.env.APNS_KEY_FILE&&process.env.APNS_KEY_ID&&process.env.APNS_TEAM_ID&&process.env.APNS_TOPIC);}
 async token(){
  if(this.cached&&this.cached.until>Date.now())return this.cached.token;
  const {importPKCS8,SignJWT}=await import('jose'),key=await importPKCS8(await readFile(process.env.APNS_KEY_FILE!,'utf8'),'ES256');
  const token=await new SignJWT({}).setProtectedHeader({alg:'ES256',kid:process.env.APNS_KEY_ID!}).setIssuer(process.env.APNS_TEAM_ID!).setIssuedAt().sign(key);this.cached={token,until:Date.now()+50*60000};return token;
 }
 async send(job:Row):Promise<{ok:boolean;permanent:boolean;reason?:string;invalidToken?:boolean}>{
  if(!this.configured())throw new Error('APNS_NOT_CONFIGURED');
  const token=await this.token(),host=process.env.APNS_SANDBOX==='true'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com';
  return new Promise((resolve,reject)=>{
   const client=connect(host);let finished=false;
   const fail=(e:Error)=>{if(finished)return;finished=true;client.destroy();reject(e);};
   client.on('error',fail);
   const req=client.request({':method':'POST',':path':'/3/device/'+job.token,authorization:'bearer '+token,'apns-topic':process.env.APNS_TOPIC!,'apns-push-type':'alert','apns-priority':'10','apns-id':job.id,'apns-collapse-id':job.id});
   let status=0,body='';req.on('response',h=>{status=Number(h[':status']);});req.setEncoding('utf8');
   req.on('data',s=>body+=s);req.setTimeout(10000,()=>fail(new Error('APNS_TIMEOUT')));req.on('error',fail);
   req.on('end',()=>{if(finished)return;finished=true;client.close();let reason='';try{reason=JSON.parse(body).reason||'';}catch{}
    resolve({ok:status===200,permanent:status>=400&&status<500&&status!==429,reason:reason||String(status),invalidToken:status===410||reason==='BadDeviceToken'});
   });
   req.end(JSON.stringify({aps:{alert:{title:'플잉 · '+(job.kind==='before'?'곧 시작할 시간이야':'계획을 시작할 시간'),body:job.title+', 작은 한 걸음부터 같이 시작해보자!'},...(job.sound?{sound:'default'}:{})},eventId:job.id,planId:job.plan_id}));
  });
 }
}
@Injectable()
export class NotificationWorker {
 constructor(private db:Db,private push:PushGateway){}
 async once(){
  if(!this.push.configured())return {configured:false,processed:0};
  const jobs=await this.db.tx(async sql=>{
   await sql.query(`UPDATE notification_jobs SET status='PENDING',lock_until=NULL,lease_id=NULL WHERE status='PROCESSING' AND lock_until<now()`);
   return sql.query(`UPDATE notification_jobs SET status='PROCESSING',lock_until=now()+interval '60 seconds',lease_id=$1,attempts=attempts+1 WHERE id IN
    (SELECT id FROM notification_jobs WHERE status='PENDING' AND next_attempt_at<=now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING *`,[randomUUID()]);
  });
  for(const job of jobs){
   const [current]=await this.db.query(`SELECT j.*,d.token,p.title,(u.preferences->'notifications'->>'sound')::boolean AS sound
    FROM notification_jobs j JOIN plans p ON p.id=j.plan_id JOIN users u ON u.id=j.user_id JOIN devices d ON d.id=j.device_id
    WHERE j.id=$1 AND j.status='PROCESSING' AND j.lease_id=$2 AND p.version=j.plan_version AND NOT p.done AND d.enabled AND d.user_id=j.user_id
      AND (u.preferences->'notifications'->>'enabled')::boolean AND j.due_at>now()-interval '15 minutes'`,[job.id,job.lease_id]);
   if(!current){await this.db.query("UPDATE notification_jobs SET status='CANCELLED',lease_id=NULL WHERE id=$1 AND lease_id=$2",[job.id,job.lease_id]);continue;}
   try{
    const r=await this.push.send(current);
    await this.db.tx(async sql=>{
     await sql.query(`UPDATE notification_jobs SET status=$3,sent_at=CASE WHEN $3='SENT' THEN now() ELSE NULL END,last_error=$4,next_attempt_at=now()+($5*interval '1 second'),lock_until=NULL,lease_id=NULL WHERE id=$1 AND lease_id=$2 AND status='PROCESSING'`,[job.id,job.lease_id,r.ok?'SENT':r.permanent||job.attempts>=5?'FAILED':'PENDING',r.reason?.slice(0,200)||null,Math.min(300,2**job.attempts*5)]);
     if(r.invalidToken)await sql.query('UPDATE devices SET enabled=false WHERE id=$1 AND user_id=$2',[job.device_id,job.user_id]);
    });
   }catch{
    await this.db.query(`UPDATE notification_jobs SET status=$3,lock_until=NULL,lease_id=NULL,last_error='transport_error',next_attempt_at=now()+interval '30 seconds' WHERE id=$1 AND lease_id=$2 AND status='PROCESSING'`,[job.id,job.lease_id,job.attempts>=5?'FAILED':'PENDING']);
   }
  }
  return {configured:true,processed:jobs.length};
 }
}
