import type { Page } from 'puppeteer';
import { Tool } from './Tool.js';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot, resolveProjectPath } from '../utils/projectPath.js';

class ListDirectoryTool implements Tool {
  name = 'list_directory';
  description = 'List contents of a directory';

  async execute(page: Page, args: { 
    directory?: string; 
    showHidden?: boolean;
    recursive?: boolean;
    maxDepth?: number;
  }): Promise<any> {
    try {
      const { 
        directory = '.', 
        showHidden = false,
        recursive = false,
        maxDepth = 2
      } = args;

      // Security check - ensure we're only listing within the project directory
      const projectRoot = getProjectRoot();
      const targetDir = resolveProjectPath(directory);

      if (!fs.existsSync(targetDir)) {
        throw new Error(`Directory not found: ${directory}`);
      }

      const stat = fs.statSync(targetDir);
      if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${directory}`);
      }

      const listDir = (dir: string, depth: number = 0): any[] => {
        if (depth > maxDepth) return [];
        
        try {
          const items = fs.readdirSync(dir);
          const result: any[] = [];

          for (const item of items) {
            // Skip hidden files unless requested
            if (!showHidden && item.startsWith('.')) continue;
            
            // Skip node_modules and other build directories
            if (['node_modules', 'dist', 'build', '.git'].includes(item)) continue;

            const itemPath = path.join(dir, item);
            const itemStat = fs.statSync(itemPath);
            const relativePath = path.relative(projectRoot, itemPath);

            const itemInfo = {
              name: item,
              path: relativePath,
              type: itemStat.isDirectory() ? 'directory' : 'file',
              size: itemStat.isFile() ? itemStat.size : undefined,
              modified: itemStat.mtime
            };

            result.push(itemInfo);

            // Recurse into directories if requested
            if (recursive && itemStat.isDirectory() && depth < maxDepth) {
              const children = listDir(itemPath, depth + 1);
              if (children.length > 0) {
                itemInfo.children = children;
              }
            }
          }

          return result.sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) {
              return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });
        } catch (error) {
          return [];
        }
      };

      const contents = listDir(targetDir);

      return {
        success: true,
        directory: path.relative(projectRoot, targetDir),
        itemCount: contents.length,
        contents
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const listDirectory = new ListDirectoryTool();