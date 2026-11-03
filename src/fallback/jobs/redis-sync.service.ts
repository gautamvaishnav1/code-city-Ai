import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {Cron, CronExpression} from '@nestjs/schedule';
import { Model } from 'mongoose';
import { RedisService } from '../../redis/redis.service.js';
import { CacheFallback } from '../schemas/fallback.schema.js';

@Injectable()
export class RedisSyncService {
  private readonly logger = new Logger(RedisSyncService.name);
    constructor(
        private readonly redisService: RedisService,
        @InjectModel(CacheFallback.name)
        private readonly cacheModel: Model<CacheFallback>,
      ) {}

    @Cron(CronExpression.EVERY_30_SECONDS)
    async syncFallbackToRedis() {
        try{
            await this.redisService.ping()
        }catch{
            return
        }

        const expiredDocs = await this.cacheModel.find({
            expiresAt: { $gt: new Date() },
        }).limit(50).lean();
        if (expiredDocs.length === 0) {
            this.logger.log('No expired documents found for syncing.');
            return;
        }
         for (const doc of expiredDocs) {
      const ttl = Math.floor(
        (new Date(doc.expiresAt).getTime() - Date.now()) / 1000,
      );
      if (ttl <= 0) continue;
        try {
        await this.redisService.set(
          doc.redis_key,
          JSON.stringify(doc.value),
          ttl,
        );
        await this.cacheModel.deleteOne({ _id: doc._id });
        this.logger.log(`♻️ Re-synced: ${doc.redis_key} → Redis`);
      } catch {
        break; // Redis died again mid-sync → retry next cycle
      }
    }

}}