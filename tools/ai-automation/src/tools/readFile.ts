import type { Page } from 'puppeteer';
import { Tool } from './Tool.js';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot, resolveProjectPath } from '../utils/projectPath.js';

class ReadFileTool implements Tool {
  name = 'read_file';
  description = 'Read the contents of a file from the codebase';

  async execute(page: Page, args: { filePath: string; startLine?: number; endLine?: number }): Promise<any> {
    try {
      const { filePath, startLine, endLine } = args;

      if (!filePath) {
        throw new Error('filePath is required');
      }

      // Security check - ensure we're only reading from the project directory
      const projectRoot = getProjectRoot();
      const fullPath = resolveProjectPath(filePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      let result = content;
      let actualStartLine = 1;
      let actualEndLine = lines.length;

      // If line range is specified, extract only those lines
      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(1, startLine || 1) - 1; // Convert to 0-based index
        const end = Math.min(lines.length, endLine || lines.length);
        
        result = lines.slice(start, end).join('\n');
        actualStartLine = start + 1;
        actualEndLine = end;
      }

      return {
        success: true,
        filePath,
        startLine: actualStartLine,
        endLine: actualEndLine,
        totalLines: lines.length,
        content: result,
        truncated: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const readFile = new ReadFileTool();