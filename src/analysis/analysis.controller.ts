import { BadRequestException, Body, Controller, Post } from '@nestjs/common'
import { BabelAnalyzerService } from './babel-analyzer.service.js'
import { AnalyzeFolderDto } from './dto/analyze-folder.dto.js'
import { FileAnalysis } from './types/file-analysis.types.js'
import { RepoCloneService } from './repo-clone.service.js'
import { CloneRepoDto } from './dto/clone-repo.dto.js'
import { parseGitHubUrl } from './utils/parse-github-url.js'
import { GraphBuilderService } from './graph-builder.service.js'
import { FileGraphAnalysis } from './types/graph.types.js'

@Controller('analysis')
export class AnalysisController {
  constructor (
    private readonly babelAnalyzerService: BabelAnalyzerService,
    private readonly repoCloneService: RepoCloneService,
    private readonly graphBuilder:GraphBuilderService
  ) {}

  @Post('folder')
  async analyzeFolder (@Body() dto: AnalyzeFolderDto): Promise<FileAnalysis[]> {
    return await this.babelAnalyzerService.analyzeRepoPathWithGraph(dto)
  }
  @Post('debug/resolve-graph')
async resolveGraph(@Body() dto: AnalyzeFolderDto) {
  const draftGraph =
    await this.babelAnalyzerService.analyzeRepoPathWithGraph(dto);

  const resolvedGraph = this.graphBuilder.build(draftGraph);

  return resolvedGraph;
}

  @Post('clone')
  async cloneAndAnalyze (
    @Body() dto: CloneRepoDto,
  ) {
    // const repoUrl = dto.repo
    // const owner = dto.owner
    // const ref = dto.ref
    if (!dto.owner || !dto.repo) {
      throw new BadRequestException('Owner and repo URL are required')
    }
    console.log('Received clone request: at analysis.controller', dto)
    return this.repoCloneService.cloneAndAnalyze(dto)
    // Implementation for cloning and analyzing the repository
  }

  
  @Post('url')
  async analyzeGitHubUrl (@Body()  dto:AnalyzeFolderDto){

    try {
      const target = parseGitHubUrl(dto.repoPath)
      const cloneDto: CloneRepoDto = {
        owner: target.owner,
        repo: target.repo,
        ref: target.ref,
      }
      const draft = await this.repoCloneService.cloneAndAnalyze(cloneDto)
      return draft
      // return this.graphBuilder.build(draft)
    //  const res:FileGraphAnalysis = await this.repoCloneService.cloneAndAnalyze(cloneDto)
    // const result = this.graphBuilder.build(res);
    //  console.log('Analysis result:', res)
    //  return res;
    } catch (error) {
      throw new BadRequestException('Invalid GitHub URL')
    }
  }
}
