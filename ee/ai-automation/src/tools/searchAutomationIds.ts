import type { Page } from 'puppeteer';
import { Tool } from './Tool.js';
import { execSync } from 'child_process';
import * as path from 'path';
import { getProjectRoot, resolveProjectPath } from '../utils/projectPath.js';

class SearchAutomationIdsTool implements Tool {
  name = 'search_automation_ids';
  description = 'Search for automation IDs (data-automation-id) in the codebase to help understand UI element naming';

  async execute(page: Page, args: { 
    searchTerm?: string; 
    directory?: string; 
    fileTypes?: string[];
    maxResults?: number;
  }): Promise<any> {
    try {
      const { 
        searchTerm, 
        directory = 'server/src', 
        fileTypes = ['tsx', 'ts', 'jsx', 'js'],
        maxResults = 50 
      } = args;

      // Security check - ensure we're only searching within the project directory
      const projectRoot = getProjectRoot();
      const searchDir = resolveProjectPath(directory);

      // Build grep command to find automation IDs
      let pattern = 'data-automation-id';
      if (searchTerm) {
        // If search term provided, look for automation IDs containing that term
        pattern = `data-automation-id.*${searchTerm}`;
      }

      // Create file extension pattern
      const fileExtPattern = `*.{${fileTypes.join(',')}}`;
      
      let grepCmd = `grep -r -n --include="${fileExtPattern}"`;
      grepCmd += ' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build';
      grepCmd += ` "${pattern}" "${searchDir}"`;

      let result: string;
      try {
        result = execSync(grepCmd, { 
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024, // 1MB max
          cwd: projectRoot
        });
      } catch (error) {
        // If grep finds no matches, it exits with code 1
        result = '';
      }

      const lines = result.split('\n').filter(line => line.trim());
      
      // Limit results
      const limitedLines = lines.slice(0, maxResults);
      const truncated = lines.length > maxResults;

      // Parse and extract automation IDs
      const automationIds = new Set<string>();
      const matches = limitedLines.map(line => {
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          const content = match[3];
          
          // Extract automation ID values
          const idMatches = content.match(/data-automation-id=["']([^"']+)["']/g);
          if (idMatches) {
            idMatches.forEach(idMatch => {
              const id = idMatch.match(/data-automation-id=["']([^"']+)["']/);
              if (id && id[1]) {
                automationIds.add(id[1]);
              }
            });
          }

          return {
            file: path.relative(projectRoot, match[1]),
            line: parseInt(match[2]),
            content: content.trim(),
            automationIds: idMatches ? idMatches.map(m => {
              const id = m.match(/data-automation-id=["']([^"']+)["']/);
              return id ? id[1] : null;
            }).filter(Boolean) : []
          };
        }
        return null;
      }).filter(Boolean);

      // Convert Set to sorted array
      const uniqueAutomationIds = Array.from(automationIds).sort();

      return {
        success: true,
        searchTerm,
        directory: path.relative(projectRoot, searchDir),
        fileTypes,
        totalMatches: lines.length,
        returnedMatches: limitedLines.length,
        truncated,
        uniqueAutomationIds,
        totalUniqueIds: uniqueAutomationIds.length,
        matches
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const searchAutomationIds = new SearchAutomationIdsTool();