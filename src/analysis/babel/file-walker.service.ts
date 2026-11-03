/**
 * find files inside folder
 * ignore folders
 * filter extensions
 */

import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

@Injectable()
export class FileWalkerService {
  private readonly extensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

  private readonly ignoredDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.cache',
  ]);

  async walk(dir: string, files: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (this.ignoredDirs.has(entry.name)) {
          continue;
        }

        await this.walk(fullPath, files);
      }

      if (entry.isFile()) {
        const ext = path.extname(entry.name);

        if (this.extensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }
}