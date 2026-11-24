import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service.js';

@Module({
  providers: [AnalysisService]
})
export class AnalysisModule {}
