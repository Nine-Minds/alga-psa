import type { Page } from 'puppeteer';
import { Tool } from './Tool.js';
import { execSync } from 'child_process';
import * as path from 'path';
import { getProjectRoot, resolveProjectPath } from '../utils/projectPath.js';

class FindFilesTool implements Tool {
  name = 'find_files';
  description = 'Find files and directories using find command';

  async execute(page: Page, args: { 
    name?: string; 
    directory?: string; 
    type?: 'f' | 'd' | 'l'; // file, directory, symlink
    extension?: string;
    maxResults?: number;
  }): Promise<any> {
    try {
      const { 
        name, 
        directory = '.', 
        type,
        extension,
        maxResults = 100 
      } = args;

      // Security check - ensure we're only searching within the project directory
      const projectRoot = getProjectRoot();
      const searchDir = resolveProjectPath(directory);

      // Build find command
      let findCmd = `find "${searchDir}"`;
      
      // Add type filter
      if (type) {
        findCmd += ` -type ${type}`;
      }
      
      // Add name filter
      if (name) {
        findCmd += ` -name "${name}"`;
      }
      
      // Add extension filter
      if (extension) {
        const ext = extension.startsWith('.') ? extension : `.${extension}`;
        findCmd += ` -name "*${ext}"`;
      }

      // Exclude common directories
      findCmd += ' -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*"';

      const result = execSync(findCmd, { 
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024, // 1MB max
        cwd: projectRoot
      });

      const lines = result.split('\n').filter(line => line.trim());
      
      // Limit results
      const limitedLines = lines.slice(0, maxResults);
      const truncated = lines.length > maxResults;

      // Convert to relative paths
      const files = limitedLines.map(line => path.relative(projectRoot, line));

      return {
        success: true,
        searchCriteria: { name, directory: path.relative(projectRoot, searchDir), type, extension },
        totalFiles: lines.length,
        returnedFiles: limitedLines.length,
        truncated,
        files
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const findFiles = new FindFilesTool();