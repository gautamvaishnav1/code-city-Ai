import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UserModule } from '../user/user.module.js';
import { EmailModule } from '../email/email.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { FallbackModule } from '../fallback/fallback.module.js';
import { TokenModule } from '../token/token.module.js';
// import { UserService } from '../user/user.service.js';

@Module({
  imports:[UserModule,EmailModule,FallbackModule,RedisModule,TokenModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
