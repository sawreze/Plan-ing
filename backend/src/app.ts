import 'reflect-metadata';
import { Module, Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Db } from './db';
import { AuthService,AuthController,AccessGuard,Public } from './auth';
import { Notifications,DevicesController } from './notifications';
import { Plans,Focus,PlansController } from './plans';
import { ProfileController } from './profile';
import { Crews,CrewsController } from './crews';
import { Gemini,Chat,ChatController } from './chat';
import { NotificationWorker,PushGateway } from './push';
@Controller()
class Health {
 constructor(private db:Db){}
 @Public() @Get('health') async health(){await this.db.query('SELECT 1');return {status:'ok',service:'pling-api'};}
}
@Module({controllers:[Health,AuthController,PlansController,ProfileController,CrewsController,ChatController,DevicesController],providers:[Db,AuthService,Notifications,Plans,Focus,Crews,Gemini,Chat,NotificationWorker,PushGateway,{provide:APP_GUARD,useClass:AccessGuard}]})
export class AppModule {}
