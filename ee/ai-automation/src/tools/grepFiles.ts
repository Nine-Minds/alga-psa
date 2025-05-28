import type { Page } from 'puppeteer';
import { Tool } from './Tool.js';
import { execSync } from 'child_process';
import * as path from 'path';
import { getProjectRoot, resolveProjectPath } from '../utils/projectPath.js';

class GrepFilesTool implements Tool {
  name = 'grep_files';
  description = 'Search for patterns in files using grep';

  async execute(page: Page, args: { 
    pattern: string; 
    directory?: string; 
    filePattern?: string;
    recursive?: boolean;
    lineNumbers?: boolean;
    maxResults?: number;
  }): Promise<any> {
    try {
      const { 
        pattern, 
        directory = '.', 
        filePattern = '*', 
        recursive = true, 
        lineNumbers = true,
        maxResults = 100 
      } = args;

      if (!pattern) {
        throw new Error('pattern is required');
      }

      // Security check - ensure we're only searching within the project directory
      const projectRoot = getProjectRoot();
      const searchDir = resolveProjectPath(directory);

      // Build grep command
      let grepCmd = 'grep';
      
      if (recursive) {
        grepCmd += ' -r';
      }
      
      if (lineNumbers) {
        grepCmd += ' -n';
      }
      
      // Add file pattern if specified
      if (filePattern && filePattern !== '*') {
        grepCmd += ` --include="${filePattern}"`;
      }

      // Exclude common directories that aren't useful for UI automation
      grepCmd += ' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build';
      
      // Add pattern and directory
      grepCmd += ` "${pattern}" "${searchDir}"`;

      const result = execSync(grepCmd, { 
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024, // 1MB max
        cwd: projectRoot
      });

      const lines = result.split('\n').filter(line => line.trim());
      
      // Limit results
      const limitedLines = lines.slice(0, maxResults);
      const truncated = lines.length > maxResults;

      // Parse results into structured format
      const matches = limitedLines.map(line => {
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          return {
            file: path.relative(projectRoot, match[1]),
            line: parseInt(match[2]),
            content: match[3].trim()
          };
        }
        return {
          file: 'unknown',
          line: 0,
          content: line
        };
      });

      return {
        success: true,
        pattern,
        directory: path.relative(projectRoot, searchDir),
        totalMatches: lines.length,
        returnedMatches: limitedLines.length,
        truncated,
        matches
      };
    } catch (error) {
      // If grep finds no matches, it exits with code 1, but that's not an error for us
      if (error instanceof Error && error.message.includes('Command failed')) {
        return {
          success: true,
          pattern: args.pattern,
          directory: args.directory || '.',
          totalMatches: 0,
          returnedMatches: 0,
          truncated: false,
          matches: []
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const grepFiles = new GrepFilesTool();