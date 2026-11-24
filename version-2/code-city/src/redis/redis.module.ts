// src/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './constants/redis.constants.js';
import { RedisService } from './redis.service.js';
// import { RedisService } from './redis.service';



@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';

        return new Redis(redisUrl, {
          // If Redis is down, fail immediately instead of hanging the request
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false, 
          connectTimeout: 2000,
        });
      },
    },
    RedisService,
  ],
  // ⭐ Export BOTH the raw client AND the service
  exports: [REDIS_CLIENT, RedisService], 
})
export class RedisModule {}