import { Injectable, Logger } from '@nestjs/common'
import * as path from 'node:path'
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs'
import { BabelAnalyzerService } from './babel-analyzer.service.js'
import { GraphBuilderService } from './graph-builder.service.js'
import { RepoCloneService } from './repo-clone.service.js'
import { AnalyzeRepoPathDto } from './dto/url.dto.js'
import { parseGitHubUrl } from './utils/parse-github-url.js'
import { CloneRepoDto } from './dto/clone-repo.dto.js';

@Injectable()
export class AnalysisPipelineService {
  private readonly logger = new Logger(AnalysisPipelineService.name)
  constructor (
    private readonly babelService: BabelAnalyzerService,
    private readonly graphBuilder: GraphBuilderService,
    private readonly repoCloneService: RepoCloneService,
  ) {}
  async run (dto: AnalyzeRepoPathDto) {
    const repoPath = dto.repoPath
    let tempFolder: string | null = null
    let runId: string | null = null
   
      // Validate and parse URL
      const target:CloneRepoDto = parseGitHubUrl(repoPath)
    //   const res:CloneRepoDto ={target.owner}
      // ----------------------------
      // STEP 2: Create repo + run in MongoDB
      // ----------------------------
      //   const repo = await this.persistence.findOrCreateRepo({
      //     owner: target.owner,
      //     repo: target.repo,
      //     repoUrl,
      //   });
      const temp = path.join(tmpdir(), `cc-${Date.now()}`)
      await fs.mkdir(temp, { recursive: true });
    // cloneRep
   try {
    await this.repoCloneService.cloneAndAnalyze(target)
   } catch (error) {
    
   }
  }
}
