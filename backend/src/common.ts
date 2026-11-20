import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { z } from 'zod';
export const uuid = z.uuid();
export const date = z.iso.date();
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const title = (max:number) => z.string().trim().min(1).max(max);
export const color = z.string().regex(/^#[A-Fa-f0-9]{6}$/);
export function fail(status:number, message:string):never { throw new HttpException(message,status); }
export function parse<T>(schema:z.ZodType<T>, value:unknown):T { const r=schema.safeParse(value); if(!r.success) fail(400, '입력값을 확인해주세요: '+r.error.issues.map(i=>i.path.join('.')||'요청').join(', ')); return r.data; }
export const id = (v:string) => parse(uuid,v);
export const planInput=z.strictObject({title:title(60),date,start:time,end:time,color});
export const planPatch=planInput.partial().extend({done:z.boolean().optional(),version:z.number().int().positive()});
export const notifications=z.strictObject({enabled:z.boolean(),atStart:z.boolean(),before:z.union([z.literal(0),z.literal(5),z.literal(10),z.literal(15)]),sound:z.boolean()});
export const preferences=z.strictObject({theme:z.enum(['light','dark','system']),notifications});
export function checkTimes(start:string,end:string) { if(end<=start) fail(400,'끝 시간을 시작 시간 뒤로 정해주세요.'); }
@Catch()
export class Errors implements ExceptionFilter {
 catch(e:any,host:ArgumentsHost) {
  let status=e instanceof HttpException?e.getStatus():500;
  let message=e instanceof HttpException?e.message:'서버에서 요청을 처리하지 못했어요.';
  if(e?.code==='23P01') {status=409;message='시간이 겹치는 계획이 있어요.';}
  if(e?.code==='23505') {status=409;message='이미 등록된 정보예요.';}
  if(['22007','22008','22P02'].includes(e?.code)) {status=400;message='날짜나 식별자를 확인해주세요.';}
  if(status===500) console.error('request_failed',e?.code||e?.name||'unknown');
  host.switchToHttp().getResponse().status(status).json({statusCode:status,message});
 }
}
