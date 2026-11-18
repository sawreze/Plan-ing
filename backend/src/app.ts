import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { pool } from './db';
import { ErrorFilter } from './http';
import { GoalsController, MeController, SurveyController } from './me';
import { PlansController } from './plans';

@Controller('health')
class HealthController {
  @Get()
  async health() {
    await pool.query('select 1');
    return { ok: true };
  }
}

@Module({ controllers: [HealthController, MeController, PlansController, GoalsController, SurveyController] })
class AppModule {}

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (origins?.length) app.enableCors({ origin: origins });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
