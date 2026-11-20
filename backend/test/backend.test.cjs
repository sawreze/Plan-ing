const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {AuthService}=require('../dist/auth');
const {Plans,Focus}=require('../dist/plans');
const {Notifications}=require('../dist/notifications');
const {ProfileController,studyType}=require('../dist/profile');
const {Crews}=require('../dist/crews');
const {Chat,Gemini}=require('../dist/chat');
const {NotificationWorker}=require('../dist/push');
let pg,db,auth,plans,focus,notify,profile,crews,user,other,chat,modelReply;
const p=(title,date='2030-01-01',start='10:00',end='10:30')=>({title,date,start,end,color:'#b8c9ee'});
const expectStatus=(n)=>e=>e.getStatus?.()===n;
before(async()=>{
 process.env.AUTH_MODE='local';process.env.AUTH_SECRET='test-only-'+randomUUID();
 pg=new PGlite({extensions:{btree_gist}});
 await pg.exec(await readFile(path.join(__dirname,'../migrations/001_initial.sql'),'utf8'));
 const sql=x=>({query:async(s,p=[])=> (await x.query(s,p)).rows});
 db={...sql(pg),tx:fn=>pg.transaction(t=>fn(sql(t)))};
 auth=new AuthService(db);notify=new Notifications(db);plans=new Plans(db,notify);focus=new Focus(db,plans,notify);profile=new ProfileController(db,focus,notify);crews=new Crews(db);
 chat=new Chat(db,plans,{generate:async()=>modelReply});
 const a=await auth.register({email:'one@example.test',password:'test-password-123',displayName:'학생1'});
 user=await auth.authenticate(a.token);
 const b=await auth.register({email:'two@example.test',password:'test-password-456',displayName:'학생2'});other=await auth.authenticate(b.token);
});
after(async()=>{await pg?.close();});
test('real password authentication and token verification',async()=>{
 const r=await auth.login({email:'ONE@example.test',password:'test-password-123'});
 assert.equal((await auth.authenticate(r.token)).id,user.id);
 await assert.rejects(auth.login({email:'one@example.test',password:'wrong-password'}),expectStatus(401));
 await assert.rejects(auth.authenticate(r.token+'x'),expectStatus(401));
 await assert.rejects(auth.register({email:'bad',password:'short',displayName:'x'}),expectStatus(400));
});
test('plans enforce ownership, half-open ranges, version and duplicate colors',async()=>{
 const a=await plans.create(user,p('수학'));
 assert.equal(a.startAt.toISOString(),'2030-01-01T01:00:00.000Z');
 await plans.create(user,p('영어','2030-01-01','10:30','11:00'));
 await assert.rejects(plans.create(user,p('겹침','2030-01-01','10:10','10:40')),e=>e.code==='23P01');
 await plans.create(other,p('다른 계정'));
 await assert.rejects(plans.get(db,other,a.id),expectStatus(404));
 const changed=await plans.update(user,a.id,{title:'수학 복습',version:a.version});assert.equal(changed.version,2);
 await assert.rejects(plans.update(user,a.id,{title:'덮어쓰기',version:1}),expectStatus(409));
 await assert.rejects(plans.update(user,a.id,{title:'버전 없음'}),expectStatus(400));
 await assert.rejects(plans.create(user,p('잘못된 날짜','2030-02-30')),expectStatus(400));
});
test('concurrent duplicate plan inserts preserve the exclusion constraint',async()=>{
 const results=await Promise.allSettled(Array.from({length:6},()=>plans.create(user,p('동시 생성','2030-01-02'))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('focus READY stays idle, pause/resume use server time, rewards are idempotent',async()=>{
 const plan=await plans.create(user,p('집중','2030-01-03'));
 let s=await focus.open(user,plan.id);assert.equal(s.status,'READY');assert.equal(s.remainingSec,1800);
 await assert.rejects(focus.act(user,s.id,'complete'),expectStatus(409));
 await assert.rejects(focus.claim(user,plan.id),expectStatus(409));
 s=await focus.act(user,s.id,'start');assert.equal(s.status,'RUNNING');
 await db.query("UPDATE focus_sessions SET running_since=now()-interval '5 seconds' WHERE id=$1",[s.id]);
 s=await focus.act(user,s.id,'pause');assert.ok(s.remainingSec<=1795);const remaining=s.remainingSec;
 assert.equal((await focus.get(db,user,s.id)).remainingSec,remaining);
 await focus.act(user,s.id,'resume');
 await assert.rejects(plans.update(user,plan.id,{start:'09:00',version:1}),expectStatus(409));
 await focus.act(user,s.id,'complete');
 const claims=await Promise.all(Array.from({length:10},()=>focus.claim(user,plan.id)));
 assert.equal(claims.filter(r=>r.granted).length,1);assert.equal(await focus.balance(user),5);
 const current=await plans.get(db,user,plan.id);await plans.update(user,plan.id,{done:false,version:current.version});
 const next=await focus.open(user,plan.id);await focus.act(user,next.id,'start');await focus.act(user,next.id,'complete');
 assert.equal((await focus.claim(user,plan.id)).granted,false);
 await plans.remove(user,plan.id);assert.equal(await focus.balance(user),5);
});
test('skip never grants rewards and plan edits update READY duration',async()=>{
 const plan=await plans.create(user,p('준비','2030-01-04'));
 let s=await focus.open(user,plan.id);await plans.update(user,plan.id,{end:'10:50',version:plan.version});
 assert.equal((await focus.get(db,user,s.id)).remainingSec,3000);
 await focus.act(user,s.id,'skip');await assert.rejects(focus.claim(user,plan.id),expectStatus(409));
});
test('goals, settings and every survey quadrant persist',async()=>{
 const g=await profile.create(user,{title:'시험 준비',date:'2030-02-01'});
 assert.equal((await profile.patch(user,g.id,{done:true,date:''})).date,null);
 await assert.rejects(profile.patch(other,g.id,{done:true}),expectStatus(404));
 const samples=[[[0],0,'steady_doer'],[[1],1,'flexible_challenger'],[[],0,'calm_designer'],[[2],1,'free_explorer']];
 for(const [q2,q3,type] of samples){assert.equal((await profile.submit(user,{q1:1,q2,q3})).result.type,type);}
 assert.equal((await profile.submit(user,{q1:null,q2:[],q3:null})).result,null);
 await assert.rejects(profile.submit(user,{q1:1,q2:[0,0],q3:1}),expectStatus(400));
 assert.equal((await profile.survey(user)).ruleVersion,1);
 await assert.rejects(profile.update(user,{timeZone:'invalid/zone'}),expectStatus(400));
});
test('crews allow real membership, private access and idempotent personal goals',async()=>{
 const c=await crews.create(user,{name:'자격증 크루',goal:'한국사 합격',category:'자격증'});
 await assert.rejects(crews.detail(other,c.id),expectStatus(404));
 await crews.join(other,{code:c.code});assert.equal((await crews.detail(user,c.id)).members.length,2);
 const a=await crews.addGoal(other,c.id),b=await crews.addGoal(other,c.id);assert.equal(a.id,b.id);
 await assert.rejects(crews.remove(other,c.id),expectStatus(403));
 await crews.rotate(user,c.id);
 await crews.leave(other,c.id);await assert.rejects(crews.join(other,{code:c.code}),expectStatus(404));
 await crews.remove(user,c.id);
});
test('AI proposals require confirmation and reject stale versions',async()=>{
 const today=await plans.today(db,user);
 const plan=await plans.create(user,p('오늘 영어',today,'19:00','19:30'));
 modelReply={reply:'20시로 옮겨볼까?',change:{planId:plan.id,start:'20:00',end:'20:30'}};
 const result=await chat.send(user,{message:'영어를 8시로'});
 assert.equal((await plans.get(db,user,plan.id)).start,'19:00');
 await assert.rejects(chat.apply(other,result.proposal.id),expectStatus(404));
 await plans.update(user,plan.id,{title:'바뀐 영어',version:plan.version});
 await assert.rejects(chat.apply(user,result.proposal.id),expectStatus(409));
 const result2=await chat.send(user,{message:'다시 옮겨줘',conversationId:result.conversationId});
 assert.equal((await chat.apply(user,result2.proposal.id)).plan.start,'20:00');
 assert.equal((await chat.apply(user,result2.proposal.id)).applied,true);
 modelReply={reply:'잘못된 계획',change:{planId:randomUUID(),start:'21:00',end:'21:30'}};
 await assert.rejects(chat.send(user,{message:'x'}),expectStatus(502));
});
test('Gemini adapter is disabled without keys and validates provider responses',async()=>{
 const gemini=new Gemini();const oldKey=process.env.GEMINI_API_KEY,oldModel=process.env.GEMINI_MODEL,oldFetch=global.fetch;
 delete process.env.GEMINI_API_KEY;await assert.rejects(gemini.generate({},[],'안녕'),expectStatus(503));
 process.env.GEMINI_API_KEY='test-only';process.env.GEMINI_MODEL='test-model';
 try{
  global.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({reply:'괜찮아, 같이 해보자.',change:null})}]}}]}));
  assert.equal((await gemini.generate({},[],'고민')).change,null);
  global.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'not json'}]}}]}));
  await assert.rejects(gemini.generate({},[],'고민'),expectStatus(502));
 }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.GEMINI_MODEL;else process.env.GEMINI_MODEL=oldModel;}
});
test('notifications survive updates, cancel with settings and worker delivery records once',async()=>{
 const prefs={theme:'system',notifications:{enabled:true,atStart:true,before:10,sound:true}};
 await profile.update(user,{preferences:prefs});
 const device=await notify.register(user.id,{platform:'ios',token:'a'.repeat(64)});
 const plan=await plans.create(user,p('알림','2030-01-10'));
 let jobs=await db.query("SELECT * FROM notification_jobs WHERE plan_id=$1 AND status='PENDING'",[plan.id]);assert.equal(jobs.length,2);
 await plans.update(user,plan.id,{end:'10:40',version:plan.version});
 jobs=await db.query("SELECT * FROM notification_jobs WHERE plan_id=$1 AND status='PENDING'",[plan.id]);assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.plan_version===2));
 let sends=0;const worker=new NotificationWorker(db,{configured:()=>true,send:async()=>{sends++;return {ok:true,permanent:false};}});
 await db.query("UPDATE notification_jobs SET due_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE id=$1",[jobs[0].id]);
 assert.equal((await worker.once()).processed,1);assert.equal(sends,1);await worker.once();assert.equal(sends,1);
 await profile.update(user,{preferences:{...prefs,notifications:{...prefs.notifications,enabled:false}}});
 assert.equal((await db.query("SELECT * FROM notification_jobs WHERE plan_id=$1 AND status='PENDING'",[plan.id])).length,0);
 await notify.remove(user.id,device.id);
});
test('worker retries transient failures and releases expired leases',async()=>{
 await profile.update(user,{preferences:{theme:'system',notifications:{enabled:true,atStart:true,before:0,sound:false}}});
 await notify.register(user.id,{platform:'ios',token:'b'.repeat(64)});
 const p1=await plans.create(user,p('재시도','2030-01-11'));
 const [job]=await db.query('SELECT * FROM notification_jobs WHERE plan_id=$1',[p1.id]);
 await db.query("UPDATE notification_jobs SET due_at=now(),next_attempt_at=now(),status='PROCESSING',lock_until=now()-interval '1 second' WHERE id=$1",[job.id]);
 const worker=new NotificationWorker(db,{configured:()=>true,send:async()=>{throw Error('offline');}});
 await worker.once();const [r]=await db.query('SELECT * FROM notification_jobs WHERE id=$1',[job.id]);assert.equal(r.status,'PENDING');assert.equal(r.attempts,1);assert.equal(r.lease_id,null);
});

test('Nest module resolves all controllers, guards and services without opening a port',async()=>{
 const {Module}=require('@nestjs/common');const {NestFactory}=require('@nestjs/core');const {AppModule}=require('../dist/app');const {Db}=require('../dist/db');const {PlansController}=require('../dist/plans');
 class Fixture{};Module({controllers:Reflect.getMetadata('controllers',AppModule),providers:Reflect.getMetadata('providers',AppModule).map(p=>p===Db?{provide:Db,useValue:db}:p)})(Fixture);
 const app=await NestFactory.createApplicationContext(Fixture,{logger:false});assert.ok(app.get(PlansController));await app.close();
});
