import { Module } from '@nestjs/common';
import { FallbackService } from './fallback.service.js';
import { RedisModule } from '../redis/redis.module.js';
import { RedisSyncService } from './jobs/redis-sync.service.js';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheFallback, CacheFallbackSchema } from './schemas/fallback.schema.js';

@Module({
  imports: [RedisModule, MongooseModule.forFeature([{ name: CacheFallback.name, schema: CacheFallbackSchema }])],
  providers: [FallbackService, RedisSyncService],
  exports: [FallbackService],
})
export class FallbackModule {}
