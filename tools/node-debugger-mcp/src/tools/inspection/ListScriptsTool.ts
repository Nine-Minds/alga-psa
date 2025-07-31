import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  isLiveEdit?: boolean;
  sourceURL?: string;
  sourceMapURL?: string;
  length?: number;
  isModule?: boolean;
  category?: 'application' | 'node_modules' | 'native' | 'unknown';
}

/**
 * Tool to list all loaded JavaScript scripts in the target process
 * Provides comprehensive information about available scripts for debugging
 */
export class ListScriptsTool extends DebuggerTool {
  readonly name = 'listScripts';
  readonly description = 'List all loaded JavaScript scripts with metadata, categorized by type (application, node_modules, native)';

  readonly inputSchema = {
    type: 'object',
    properties: {
      includeNative: {
        type: 'boolean',
        description: 'Include native V8/Node.js internal scripts',
        default: false,
        optional: true,
      },
      includeNodeModules: {
        type: 'boolean',
        description: 'Include scripts from node_modules',
        default: true,
        optional: true,
      },
      pattern: {
        type: 'string',
        description: 'Filter scripts by URL pattern (regex supported)',
        optional: true,
      },
      sortBy: {
        type: 'string',
        enum: ['url', 'size', 'category'],
        description: 'Sort scripts by specified field',
        default: 'url',
        optional: true,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of scripts to return',
        minimum: 1,
        maximum: 1000,
        default: 100,
        optional: true,
      },
    },
    required: [],
  } as const;

  async execute(
    session: DebugSession,
    args: any,
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      await this.validateArgs(args);
      this.requiresConnection(session);

      const {
        includeNative = false,
        includeNodeModules = true,
        pattern,
        sortBy = 'url',
        limit = 100,
      } = args;

      // Get all scripts that have been parsed
      // Scripts are collected via Debugger.scriptParsed events
      let allScripts: ScriptInfo[] = [];

      try {
        // First check if we have collected scripts from events
        if (session.scriptCache && session.scriptCache.size > 0) {
          allScripts = Array.from(session.scriptCache.values());
        }
        
        // If we don't have many scripts, try to enumerate them
        if (allScripts.length < 2) {
          // Method 1: Get the main script
          try {
            const mainScriptResult = await session.inspectorClient.sendCommand('Runtime.evaluate', {
              expression: 'process.mainModule ? process.mainModule.filename : require.main ? require.main.filename : ""',
              returnByValue: true,
            });
            
            if (mainScriptResult.result?.value) {
              // Force debugger to enumerate scripts by setting a dummy breakpoint
              try {
                await session.inspectorClient.sendCommand('Debugger.setBreakpointByUrl', {
                  url: `file://${mainScriptResult.result.value}`,
                  lineNumber: 1,
                });
                
                // Remove the dummy breakpoint immediately
                await session.inspectorClient.sendCommand('Debugger.removeBreakpoint', {
                  breakpointId: 'dummy',
                });
              } catch (e) {
                // Ignore errors from dummy breakpoint
              }
            }
          } catch (e) {
            // Ignore errors
          }

          // Method 2: Force script enumeration by evaluating in each context
          try {
            const contexts = await session.inspectorClient.sendCommand('Runtime.enable');
            
            // Evaluate something to trigger script parsing events
            await session.inspectorClient.sendCommand('Runtime.evaluate', {
              expression: '(function(){return 1})()',
              includeCommandLineAPI: true,
            });
          } catch (e) {
            // Ignore errors
          }

          // Wait for script events to be processed
          await this.delay(200);

          // Check cache again
          if (session.scriptCache && session.scriptCache.size > 0) {
            allScripts = Array.from(session.scriptCache.values());
          }
        }

        // If we still don't have scripts, create a basic list from what we can discover
        if (allScripts.length === 0) {
          // Fallback: Create minimal script info from require.cache
          try {
            const requireCacheResult = await session.inspectorClient.sendCommand('Runtime.evaluate', {
              expression: 'JSON.stringify(Object.keys(require.cache).map(path => ({ url: path, id: Math.random().toString() })))',
              returnByValue: true,
            });

            if (requireCacheResult.result.value) {
              const paths = JSON.parse(requireCacheResult.result.value);
              allScripts = paths.map((item: any, index: number) => ({
                scriptId: item.id || `fallback-${index}`,
                url: item.url,
                startLine: 0,
                startColumn: 0,
                endLine: 0,
                endColumn: 0,
                executionContextId: 1,
                hash: '',
                category: this.categorizeScript(item.url),
              }));
            }
          } catch (error) {
            // If even this fails, return empty list with explanation
            return this.createSuccessResponse({
              scripts: [],
              summary: {
                total: 0,
                application: 0,
                nodeModules: 0,
                native: 0,
                unknown: 0,
              },
              message: 'No scripts could be discovered. This may be because the Debugger domain was not enabled early enough to catch script parsing events.',
              suggestion: 'Try detaching and reattaching the debugger, or restart the target process with --inspect from the beginning.',
            });
          }
        }

      } catch (error) {
        return this.createErrorResponse(
          `Failed to retrieve script information: ${error instanceof Error ? error.message : String(error)}`,
          'SCRIPT_RETRIEVAL_FAILED'
        );
      }

      // Filter scripts based on parameters
      let filteredScripts = allScripts.filter(script => {
        // Filter by native scripts
        if (!includeNative && script.category === 'native') {
          return false;
        }

        // Filter by node_modules
        if (!includeNodeModules && script.category === 'node_modules') {
          return false;
        }

        // Filter by pattern
        if (pattern) {
          try {
            const regex = new RegExp(pattern, 'i');
            return regex.test(script.url);
          } catch (error) {
            // If regex is invalid, do simple string matching
            return script.url.toLowerCase().includes(pattern.toLowerCase());
          }
        }

        return true;
      });

      // Sort scripts
      filteredScripts.sort((a, b) => {
        switch (sortBy) {
          case 'size':
            return (b.length || 0) - (a.length || 0);
          case 'category':
            return (a.category || '').localeCompare(b.category || '');
          case 'url':
          default:
            return a.url.localeCompare(b.url);
        }
      });

      // Apply limit
      if (filteredScripts.length > limit) {
        filteredScripts = filteredScripts.slice(0, limit);
      }

      // Calculate summary statistics
      const summary = {
        total: filteredScripts.length,
        application: filteredScripts.filter(s => s.category === 'application').length,
        nodeModules: filteredScripts.filter(s => s.category === 'node_modules').length,
        native: filteredScripts.filter(s => s.category === 'native').length,
        unknown: filteredScripts.filter(s => s.category === 'unknown').length,
      };

      // Format scripts for response
      const formattedScripts = filteredScripts.map(script => ({
        scriptId: script.scriptId,
        url: script.url,
        category: script.category,
        startLine: script.startLine,
        endLine: script.endLine,
        length: script.length,
        hasSourceMap: !!script.sourceMapURL,
        sourceMapURL: script.sourceMapURL,
        isModule: script.isModule,
        // Add helpful display info
        fileName: this.extractFileName(script.url),
        relativePath: this.makeRelativePath(script.url),
      }));

      return this.createSuccessResponse({
        scripts: formattedScripts,
        summary,
        filters: {
          includeNative,
          includeNodeModules,
          pattern,
          sortBy,
          appliedLimit: limit,
          totalBeforeLimit: allScripts.length,
        },
        instructions: formattedScripts.length > 0 
          ? 'Use getScriptSource with a scriptId to view source code, or setBreakpointAndWait with a URL to debug'
          : 'No scripts match the current filters. Try adjusting the filter parameters.',
      }, {
        scanTime: new Date().toISOString(),
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to list scripts',
        session.id
      );
    }
  }

  /**
   * Categorize a script by its URL
   */
  private categorizeScript(url: string): 'application' | 'node_modules' | 'native' | 'unknown' {
    if (!url || url === '<anonymous>') {
      return 'unknown';
    }

    // Native Node.js or V8 scripts
    if (url.startsWith('node:') || 
        url.includes('internal/') || 
        url.includes('bootstrap/') ||
        url.startsWith('<')) {
      return 'native';
    }

    // Node modules
    if (url.includes('node_modules/')) {
      return 'node_modules';
    }

    // Application files (anything else that looks like a file path)
    if (url.includes('/') || url.includes('\\') || url.endsWith('.js') || url.endsWith('.ts')) {
      return 'application';
    }

    return 'unknown';
  }

  /**
   * Extract filename from URL
   */
  private extractFileName(url: string): string {
    if (!url) return 'unknown';
    
    const parts = url.split(/[/\\]/);
    return parts[parts.length - 1] || url;
  }

  /**
   * Make path relative to current working directory
   */
  private makeRelativePath(url: string): string {
    if (!url || url.startsWith('<') || url.startsWith('node:')) {
      return url;
    }

    try {
      const cwd = process.cwd();
      if (url.startsWith(cwd)) {
        return '.' + url.substring(cwd.length);
      }
    } catch (error) {
      // If we can't determine relative path, return as-is
    }

    return url;
  }

  /**
   * Static helper to initialize script tracking on a session
   */
  static initializeScriptTracking(session: DebugSession): void {
    if (!session.scriptCache) {
      session.scriptCache = new Map();
    }

    // Listen for script parsing events
    session.inspectorClient.on('scriptParsed', (params: any) => {
      const scriptInfo: ScriptInfo = {
        scriptId: params.scriptId,
        url: params.url,
        startLine: params.startLine,
        startColumn: params.startColumn,
        endLine: params.endLine,
        endColumn: params.endColumn,
        executionContextId: params.executionContextId,
        hash: params.hash,
        isLiveEdit: params.isLiveEdit,
        sourceURL: params.sourceURL,
        sourceMapURL: params.sourceMapURL,
        length: params.length,
        isModule: params.isModule,
        category: ListScriptsTool.prototype.categorizeScript(params.url),
      };

      session.scriptCache!.set(params.scriptId, scriptInfo);
    });
  }
}