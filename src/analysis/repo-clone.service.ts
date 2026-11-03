import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import { BabelAnalyzerService } from './babel-analyzer.service.js'
import { CloneRepoDto } from './dto/clone-repo.dto.js'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import { FileAnalysis, ResolvedGraph } from './types/file-analysis.types.js'
import { ConfigService } from '@nestjs/config'
import { GraphBuilderService } from './graph-builder.service.js'
// import { ResolvedGraph } from './types/graph.types.js'

const execFileAsync = promisify(execFile)
@Injectable()
export class RepoCloneService {
  private readonly logger = new Logger(RepoCloneService.name)
  private readonly reposRoot = path.resolve(process.env.REPOS_ROOT || './repos')

  constructor (
    private readonly babelAnalyzer: BabelAnalyzerService,
    private readonly configService: ConfigService,
    private readonly graphBuilder: GraphBuilderService
  ) {}

  async cloneAndAnalyze (dto: CloneRepoDto): Promise<ResolvedGraph> {
    console.log('reached request at clone AND ANalyze')
    const owner = this.validateSegment(dto.owner, 'owner')
    const repo = this.validateSegment(dto.repo, 'repo')
    const ref = dto.ref || 'HEAD'
    console.log('Validated owner, repo, and ref:', owner, repo, ref)
    const folderName = `${owner}__${repo}__${Date.now()}`
    const targetPath = path.join(this.reposRoot, folderName)

    await fs.mkdir(this.reposRoot, { recursive: true })
    try {
      await this.cloneRepo(owner, repo, ref, targetPath)
      const draft= await this.babelAnalyzer.analyzeFolderWithGraph(targetPath);
      const res= this.graphBuilder.build(draft)
      return res;
    } finally {
      await fs.rm(targetPath, { recursive: true, force: true })
    }
  }

   async cloneRepo (
    owner: string,
    repo: string,
    ref: string,
    targetPath: string,
  ): Promise<void> {
    const repoUrl = this.buildRepoUrl(owner, repo)
    const args =
      ref === 'HEAD'
        ? ['clone', '--depth', '1', repoUrl, targetPath]
        : ['clone', '--depth', '1', '--branch', ref, repoUrl, targetPath]
    await this.runGit(args)
  }

  private validateSegment (value: string, label: string): string {
    if (!value || typeof value !== 'string') {
      throw new BadRequestException(`${label} is required`)
    }
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(value)) {
      throw new BadRequestException(`Invalid ${label}`);
    }

    return value;
  }

  private buildRepoUrl (owner: string, repo: string): string {
    const token = this.configService.get<string>('GITHUB_ACCESS_TOKEN')
    if (!token) {
      return `https://github.com/${owner}/${repo}.git`
    }
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
  }

  private async runGit (args: string[]): Promise<void> {
    try {
      await execFileAsync('git', args, {
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
    } catch (error) {
      this.logger.error(error)
      const message =
        error instanceof Error ? error.message : 'Unknown git error'

      if (message.includes('not found') || message.includes('does not exist')) {
        throw new BadRequestException('Repository or ref not found')
      }

      if (message.includes('Authentication failed')) {
        throw new BadRequestException('GitHub authentication failed')
      }

      throw new ServiceUnavailableException('Failed to clone repository')
    }
  }
   private validateRef(value: string): string {
    if (!/^[A-Za-z0-9._/-]{1,120}$/.test(value)) {
      throw new BadRequestException('Invalid ref');
    }

    if (value.startsWith('-')) {
      throw new BadRequestException('Invalid ref');
    }

    return value;
  }
  private async getCommitSha(repoFolder: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', 'HEAD'],
    {
      cwd: repoFolder,
      timeout: 10_000,
    },
  );

  return stdout.trim();
}
}
