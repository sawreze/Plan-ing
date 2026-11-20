import { Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Post, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Db, Row } from './db';
import { fail, parse, title } from './common';
export const Public=()=>SetMetadata('public',true);
export const User=createParamDecorator((_,ctx)=>ctx.switchToHttp().getRequest().user);
export type AppUser={id:string;time_zone:string;display_name:string;preferences:any};
const credentials=z.strictObject({email:z.email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(10).max(128)});
const signup=credentials.extend({displayName:title(30)});
@Injectable()
export class AuthService {
 private readonly secret=new TextEncoder().encode(process.env.AUTH_SECRET||'');
 private readonly mode=process.env.AUTH_MODE||'local';
 private remote:any;
 constructor(private db:Db) {
  if(this.mode==='local'&&this.secret.length<32) throw new Error('AUTH_SECRET must be at least 32 characters');
  if(!['local','supabase'].includes(this.mode)) throw new Error('Invalid AUTH_MODE');
  if(this.mode==='supabase'&&!process.env.AUTH_ISSUER?.startsWith('https://')) throw new Error('HTTPS AUTH_ISSUER required');
 }
 async issue(userId:string) {
  const {SignJWT}=await import('jose');
  return new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setIssuer('pling-local').setAudience('pling-api').setIssuedAt().setExpirationTime('12h').sign(await this.key());
 }
 private async key() {return this.secret;}
 async authenticate(token:string):Promise<AppUser> {
  const {jwtVerify,createRemoteJWKSet}=await import('jose');
  let sub:string|undefined;
  try {
   if(this.mode==='local') sub=(await jwtVerify(token,this.secret,{algorithms:['HS256'],issuer:'pling-local',audience:'pling-api'})).payload.sub;
   else {const issuer=process.env.AUTH_ISSUER!.replace(/\/$/,'');this.remote??=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'));sub=(await jwtVerify(token,this.remote,{issuer,audience:process.env.AUTH_AUDIENCE||'authenticated'})).payload.sub;}
  } catch {fail(401,'로그인이 필요해요.');}
  if(!sub||sub.length>200) fail(401,'로그인이 필요해요.');
  if(this.mode==='local') { const [u]=await this.db.query('SELECT * FROM users WHERE id::text=$1',[sub]);if(!u)fail(401,'로그인이 필요해요.');return u as AppUser; }
  const [u]=await this.db.query(`INSERT INTO users(auth_subject) VALUES($1) ON CONFLICT(auth_subject) DO UPDATE SET auth_subject=excluded.auth_subject RETURNING *`,['supabase:'+sub]);return u as AppUser;
 }
 async register(body:unknown) {
  if(this.mode!=='local')fail(404,'설정한 인증 공급자에서 가입해주세요.');
  const p=parse(signup,body),salt=randomBytes(16).toString('hex'),hash=scryptSync(p.password,salt,64).toString('hex');
  const user=await this.db.tx(async sql=>{const [u]=await sql.query('INSERT INTO users(auth_subject,display_name) VALUES($1,$2) RETURNING *',['local:'+randomUUID(),p.displayName]);await sql.query('INSERT INTO accounts VALUES($1,$2,$3)',[u.id,p.email,salt+':'+hash]);return u;});
  return {token:await this.issue(user.id),expiresIn:43200};
 }
 async login(body:unknown) {
  if(this.mode!=='local')fail(404,'설정한 인증 공급자에서 로그인해주세요.');
  const p=parse(credentials,body);const [a]=await this.db.query('SELECT * FROM accounts WHERE email=$1',[p.email]);
  const [salt,hash]=(a?.password_hash||'00000000000000000000000000000000:'+Buffer.alloc(64).toString('hex')).split(':');
  if(!timingSafeEqual(scryptSync(p.password,salt,64),Buffer.from(hash,'hex'))||!a)fail(401,'이메일과 비밀번호를 확인해주세요.');
  return {token:await this.issue(a.user_id),expiresIn:43200};
 }
}
@Injectable()
export class AccessGuard implements CanActivate {
 constructor(private reflector:Reflector,private auth:AuthService){}
 async canActivate(ctx:ExecutionContext) {
  if(this.reflector.getAllAndOverride('public',[ctx.getHandler(),ctx.getClass()]))return true;
  const req=ctx.switchToHttp().getRequest(),header=req.headers.authorization;
  if(typeof header!=='string'||!header.startsWith('Bearer '))fail(401,'로그인이 필요해요.');
  req.user=await this.auth.authenticate(header.slice(7));return true;
 }
}
@Controller('auth')
export class AuthController {
 constructor(private auth:AuthService){}
 @Public() @Post('register') register(@Body() body:unknown){return this.auth.register(body);}
 @Public() @Post('login') login(@Body() body:unknown){return this.auth.login(body);}
 @Public() @Get('config') config(){return {mode:process.env.AUTH_MODE||'local',supabaseUrl:process.env.SUPABASE_URL||null,supabasePublishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||null};}
}
