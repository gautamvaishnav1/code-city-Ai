import { Module } from '@nestjs/common';
import {JwtModule} from '@nestjs/jwt'
import { TokenService } from './token.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports:[ConfigModule],
      inject:[ConfigService],
      useFactory:(configService:ConfigService)=>({
        secret:configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions:{
          expiresIn:Number(configService.get<string>('JWT_ACCESS_TOKEN_EXPIRES') ?? '15m')
        },

      })
    })
  ],
  providers: [TokenService],
  exports:[TokenService]
})
export class TokenModule {}
