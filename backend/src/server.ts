import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { Errors } from './common';
import helmet from 'helmet';
import type { INestApplication } from '@nestjs/common';
import type { Request,Response,NextFunction } from 'express';
export function configure(app:INestApplication){
 app.use(helmet({contentSecurityPolicy:false}));
 const origins=(process.env.CORS_ORIGINS||'').split(',').filter(Boolean);
 if(origins.length)app.enableCors({origin:origins,methods:['GET','POST','PATCH','DELETE'],allowedHeaders:['Content-Type','Authorization']});
 app.useGlobalFilters(new Errors());
 // Bounded in-process limiter. Put a shared gateway limiter in front of multiple replicas.
 const hits=new Map<string,{n:number;reset:number}>();let lastCleanup=0;
 app.use((req:Request,res:Response,next:NextFunction)=>{
  const now=Date.now();if(now-lastCleanup>60000){for(const [k,v] of hits)if(v.reset<now)hits.delete(k);lastCleanup=now;}
  const auth=req.path.startsWith('/auth/'),key=(req.ip||'unknown')+(auth?':auth':':api');let h=hits.get(key);
  if(!h||h.reset<now){h={n:0,reset:now+60000};hits.set(key,h);}h.n++;
  if(h.n>(auth?20:300)){res.status(429).json({message:'요청이 많아요. 잠시 후 다시 시도해주세요.'});return;}next();
 });
 app.enableShutdownHooks();
}
export async function makeApp(){const app=await NestFactory.create(AppModule,{bodyParser:true});configure(app);return app;}
