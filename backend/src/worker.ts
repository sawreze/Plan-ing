import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { NotificationWorker,PushGateway } from './push';
async function main(){const app=await NestFactory.createApplicationContext(AppModule);if(!app.get(PushGateway).configured()){await app.close();throw new Error('APNs keys are required to run the notification worker');}
 let stopped=false;process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
 while(!stopped){await app.get(NotificationWorker).once();await new Promise(r=>setTimeout(r,1000));}await app.close();}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
