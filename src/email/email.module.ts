import { Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports:[ConfigModule],
  providers: [EmailService],
  exports:[EmailService]
})
export class EmailModule {}
