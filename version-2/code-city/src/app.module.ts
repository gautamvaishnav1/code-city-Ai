import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UserModule } from './user/user.module.js';
import {MongooseModule} from '@nestjs/mongoose'
import { EmailModule } from './email/email.module.js';
import { RedisModule } from './redis/redis.module.js';
import { FallbackModule } from './fallback/fallback.module.js';
import { TokenModule } from './token/token.module.js';
import { validate } from './config/env.config.js';
import { AnalysisService } from './analysis/analysis.service.js';
import { AnalysisModule } from './analysis/analysis.module.js';
import { AnalysisModule } from './analysis/analysis.module.js';
import { AnalysisModule } from './analysis/analysis.module.js';
export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'code-city',
    }),
    ConfigModule.forRoot({
      isGlobal:true,
      validate
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
    MongooseModule.forRoot(process.env.MONGO_URI as string??'mongodb://localhost/code-city' ),
    EmailModule,
    RedisModule,
    FallbackModule,
    TokenModule,
    AnalysisModule,
  ],
  controllers: [AppController],
  providers: [AppService, AnalysisService],
})
export class AppModule {}
