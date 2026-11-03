import { BadRequestException, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parse } from '@babel/parser';
import * as traverseModule from '@babel/traverse';
import { makeFileKey } from './babel/graph-key.utils.js';
import { FileWalkerService } from './babel/file-walker.service.js';
import { FileGraphAnalysis, GraphEdgeDraft, GraphNodeDraft } from './types/graph.types.js';
import { AnalysisContext, FileMetrics } from './types/file-analysis.types.js';
import { createBabelVisitor } from './babel/babel-visitor.js';
import { AnalyzeFolderDto } from './dto/analyze-folder.dto.js';

const traverse = ((traverseModule as any).default ??
  traverseModule) as (ast: any, options: any) => void;

@Injectable()
export class BabelAnalyzerService {
  private readonly maxFileSize = 1024 * 1024;

  constructor(private readonly fileWalker: FileWalkerService) {}

  async analyzeRepoPathWithGraph(
    dto:AnalyzeFolderDto
  ): Promise<FileGraphAnalysis[]> {
    const repoPath = dto.repoPath
    if (!repoPath || typeof repoPath !== 'string') {
      throw new BadRequestException('repo path is required');
    }

    const allowedRoot = path.resolve(process.env.REPOS_ROOT || './repos');
    const root = path.resolve(allowedRoot, repoPath);

    if (root !== allowedRoot && !root.startsWith(allowedRoot + path.sep)) {
      throw new BadRequestException('Invalid repo path');
    }

    return this.analyzeFolderWithGraph(root);
  }

  async analyzeFolderWithGraph(
    root: string,
  ): Promise<FileGraphAnalysis[]> {
    const files = await this.fileWalker.walk(root);
    const results: FileGraphAnalysis[] = [];

    for (const file of files) {
      const result = await this.analyzeFileWithGraph(root, file);
      results.push(result);
    }

    return results;
  }

  private async analyzeFileWithGraph(
    root: string,
    filePath: string,
  ): Promise<FileGraphAnalysis> {
    const relativePath = path
      .relative(root, filePath)
      .split(path.sep)
      .join('/');

    const stat = await fs.stat(filePath);

    if (stat.size > this.maxFileSize) {
      return {
        file: relativePath,
        status: 'skipped',
        reason: 'File size exceeds the maximum limit of 1MB',
        nodes: [],
        edges: [],
        sizeBytes: stat.size,
      };
    }

    const code = await fs.readFile(filePath, 'utf-8');

    return this.analyzeSourceWithGraph(relativePath, code, stat.size);
  }

  private analyzeSourceWithGraph(
    relativePath: string,
    code: string,
    sizeBytes: number,
  ): FileGraphAnalysis {
    const metrics = this.createEmptyMetrics(code);
    const fileKey = makeFileKey(relativePath);

    const nodes: GraphNodeDraft[] = [];
    const edges: GraphEdgeDraft[] = [];
    const nodeKeys = new Set<string>();

    const addNode = (node: GraphNodeDraft) => {
      if (nodeKeys.has(node.key)) {
        return;
      }

      nodeKeys.add(node.key);
      nodes.push(node);
    };

    const addEdge = (edge: GraphEdgeDraft) => {
      edges.push(edge);
    };

    addNode({
      key: fileKey,
      type: 'file',
      name: path.posix.basename(relativePath),
      path: relativePath,
      metrics: {
        loc: metrics.loc,
        sizeBytes,
      },
    });

    const ctx: AnalysisContext = {
      relativePath,
      fileKey,
      metrics,
      nodes,
      edges,
      addNode,
      addEdge,
    };

    let ast;

    try {
      ast = parse(code, {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx', 'decorators-legacy'],
        errorRecovery: true,
      });
    } catch (error) {
      return {
        file: relativePath,
        status: 'parse_error',
        metrics,
        nodes,
        edges,
        error: error instanceof Error ? error.message : String(error),
        sizeBytes,
      };
    }

    try {
      traverse(ast, createBabelVisitor(ctx));
    } catch (error) {
      return {
        file: relativePath,
        status: 'traverse_error',
        metrics,
        nodes,
        edges,
        error: error instanceof Error ? error.message : String(error),
        sizeBytes,
      };
    }

    return {
      file: relativePath,
      status: 'ok',
      metrics,
      nodes,
      edges,
      sizeBytes,
    };
  }

  private createEmptyMetrics(code: string): FileMetrics {
    return {
      loc: code.split('\n').length,

      imports: [],
      requires: [],
      exports: [],

      classes: [],
      functions: [],

      complexity: 1,

      hasTryCatch: false,
      hasThrow: false,
      hasAwait: false,
      hasProcessEnv: false,

      hasConsoleLog: false,
      hasConsoleError: false,
      hasSilentCatch: false,

      hasExternalCall: false,
      hasDecorator: false,
    };
  }
}