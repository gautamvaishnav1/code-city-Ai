import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller.js';
import { BabelAnalyzerService } from './babel-analyzer.service.js';
import { RepoCloneService } from './repo-clone.service.js';
import { FileWalkerService } from './babel/file-walker.service.js';
import { GraphBuilderService } from './graph-builder.service.js';

@Module({
  // imports: [FileWalkerService],
  controllers: [AnalysisController],
  providers:[BabelAnalyzerService,RepoCloneService,FileWalkerService,GraphBuilderService],
  exports:[BabelAnalyzerService,RepoCloneService,GraphBuilderService]
})
export class AnalysisModule {}
