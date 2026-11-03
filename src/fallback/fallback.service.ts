import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '../redis/redis.service.js';
import { CacheFallback } from './schemas/fallback.schema.js';
@Injectable()
export class FallbackService {
  private readonly logger = new Logger(FallbackService.name);

  constructor(
    private readonly redisService: RedisService,
    @InjectModel(CacheFallback.name)
    private readonly cacheModel: Model<CacheFallback>,
  ) {}

  async setCache(key: string, value: any, ttlSeconds: number) {
    try {
      await this.redisService.set(key, JSON.stringify(value), ttlSeconds);
    //   await this.cacheModel.deleteOne({ cacheKey: key }).exec();
      return { storedIn: 'redis' };
    } catch {
      this.logger.warn(`Redis down → MongoDB fallback for: ${key}`);
      await this.cacheModel.findOneAndUpdate(
        { redis_key: key },
        { value, expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
        { upsert: true, new: true },
      );
      return { storedIn: 'mongo-fallback' };
    }
  }

  async getCache<T>(key: string): Promise<{ data: T | null; source: string }> {
    try {
      const cached = await this.redisService.get(key);
      if (cached) return { data: JSON.parse(cached), source: 'redis' };
    } catch {}

    const doc = await this.cacheModel.findOne({
      redis_key: key,
      expiresAt: { $gt: new Date() },
    });

    if (doc) {
      // Self-heal this single key if Redis is back
      const ttl = Math.floor((doc.expiresAt.getTime() - Date.now()) / 1000);
      if (ttl > 0) {
        try {
          await this.redisService.set(key, JSON.stringify(doc.value), ttl);
        //   await this.cacheModel.deleteOne({ cacheKey: key }).exec();
         await this.cacheModel.deleteOne({ redis_key: key }).exec();
        return { data: doc.value as T, source: 'mongo-fallback' };
        } catch {}
      }
      return { data: doc.value as T, source: 'mongo-fallback' };
    }

    return { data: null, source: 'none' };
  }
  async deleteCache(key:string){
    try {
        await this.redisService.del(key)
    } catch {
        await this.cacheModel.deleteOne({ redis_key: key }).exec()
    }
  }
}