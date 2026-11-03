import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {promises as fs} from 'node:fs'
import { BabelAnalyzerService } from './babel-analyzer.service.js';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CloneRepoDto } from './dto/clone-repo.dto.js';

const execFileSync = promisify(execFile) 
@Injectable()
export class AnalysisService {
    private readonly logger = new Logger()
    constructor(private readonly babelService:BabelAnalyzerService){}



}
