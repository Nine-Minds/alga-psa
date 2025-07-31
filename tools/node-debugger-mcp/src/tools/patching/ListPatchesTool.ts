import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession, MCPInputSchema } from '../../types/mcp.js';

/**
 * Tool for listing all active function patches
 */
export class ListPatchesTool extends DebuggerTool {
  readonly name = 'listPatches';
  readonly description = 'List all active function patches with details about what was wrapped and when.';

  readonly inputSchema: MCPInputSchema = {
    type: 'object',
    properties: {
      includeCode: {
        type: 'boolean',
        description: 'Include the wrapper code in the output',
        optional: true,
        default: false,
      },
      filterByFunction: {
        type: 'string',
        description: 'Filter patches by function name',
        optional: true,
      },
      filterByModule: {
        type: 'string',
        description: 'Filter patches by module ID or URL',
        optional: true,
      },
    },
    required: [],
  };

  async execute(
    session: DebugSession,
    args: {
      includeCode?: boolean;
      filterByFunction?: string;
      filterByModule?: string;
    },
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      // Validate arguments
      await this.validateArgs(args);

      // Ensure we're connected
      this.requiresConnection(session);

      const { includeCode = false, filterByFunction, filterByModule } = args;

      // Build the list expression
      const listExpression = this.buildListExpression({ includeCode, filterByFunction, filterByModule });

      // Execute the list command
      const result = await session.inspectorClient.sendCommand('Runtime.evaluate', {
        expression: listExpression,
        returnByValue: true,
        generatePreview: false,
      });

      if (result.exceptionDetails) {
        throw new Error(`Failed to list patches: ${result.exceptionDetails.text || 'Unknown error'}`);
      }

      const listResult = result.result?.value;
      if (!listResult) {
        return this.createSuccessResponse({
          patches: [],
          stats: { total: 0, active: 0, reverted: 0 },
          message: 'No patches found',
        });
      }

      // Enhance patch information with script URLs from cache
      const enhancedPatches = await this.enhancePatchInfo(session, listResult.patches);

      return this.createSuccessResponse({
        patches: enhancedPatches,
        stats: listResult.stats,
        summary: {
          total: enhancedPatches.length,
          byFunction: this.groupByFunction(enhancedPatches),
          byModule: this.groupByModule(enhancedPatches),
        },
        message: `Found ${enhancedPatches.length} active patch${enhancedPatches.length !== 1 ? 'es' : ''}`,
      });

    } catch (error) {
      return this.handleError(error, 'Failed to list patches', session.id);
    }
  }

  /**
   * Build the expression to list patches
   */
  private buildListExpression(options: {
    includeCode: boolean;
    filterByFunction?: string;
    filterByModule?: string;
  }): string {
    const { includeCode, filterByFunction, filterByModule } = options;

    return `(function() {
      try {
        // Check if patch manager exists
        if (!global.__patchManager || global.__patchManager.size === 0) {
          return {
            patches: [],
            stats: global.__patchStats || { total: 0, active: 0, reverted: 0 }
          };
        }

        const patches = [];
        const stats = global.__patchStats || { total: 0, active: 0, reverted: 0 };

        // Iterate through all patches
        for (const [patchId, patch] of global.__patchManager.entries()) {
          // Apply filters
          if ('${filterByFunction}' && patch.functionName !== '${filterByFunction}') {
            continue;
          }
          if ('${filterByModule}' && !patch.moduleId.includes('${filterByModule}')) {
            continue;
          }

          // Build patch info
          const patchInfo = {
            patchId,
            functionName: patch.functionName,
            moduleType: patch.moduleType,
            moduleId: patch.moduleId,
            wrapperType: patch.wrapperType,
            applied: patch.applied,
            isActive: true,
          };

          // Include wrapper code if requested
          if (${includeCode}) {
            try {
              // Try to get the current wrapped function
              let module;
              if (patch.moduleType === 'webpack') {
                module = __webpack_require__.cache[patch.moduleId];
              } else if (patch.moduleType === 'commonjs') {
                module = require.cache[patch.moduleId];
              } else {
                module = { exports: global };
              }

              if (module && module.exports && module.exports[patch.functionName]) {
                const currentFunction = module.exports[patch.functionName];
                patchInfo.currentCode = currentFunction.toString();
                patchInfo.originalCode = patch.original.toString();
              }
            } catch (e) {
              patchInfo.codeError = e.message;
            }
          }

          patches.push(patchInfo);
        }

        return {
          patches,
          stats
        };

      } catch (error) {
        return {
          patches: [],
          stats: global.__patchStats || { total: 0, active: 0, reverted: 0 },
          error: error.message
        };
      }
    })()`;
  }

  /**
   * Enhance patch information with script URLs and source map data
   */
  private async enhancePatchInfo(session: DebugSession, patches: any[]): Promise<any[]> {
    if (!session.scriptCache) {
      return patches;
    }

    return patches.map(patch => {
      const enhanced = { ...patch };

      // Try to find the script URL for webpack modules
      if (patch.moduleType === 'webpack') {
        // Look for webpack-internal URLs that might contain this module
        for (const [scriptId, script] of session.scriptCache.entries()) {
          if (script.url.includes('webpack-internal://') && 
              (script.url.includes(patch.moduleId) || script.url.includes(patch.functionName))) {
            enhanced.scriptUrl = script.url;
            enhanced.scriptId = scriptId;
            enhanced.hasSourceMap = !!script.sourceMapURL;
            break;
          }
        }
      } else if (patch.moduleType === 'commonjs') {
        // For CommonJS, the moduleId is the file path
        enhanced.scriptUrl = patch.moduleId;
        
        // Try to find the script in cache
        for (const [scriptId, script] of session.scriptCache.entries()) {
          if (script.url === patch.moduleId || script.url.endsWith(patch.moduleId)) {
            enhanced.scriptId = scriptId;
            enhanced.hasSourceMap = !!script.sourceMapURL;
            break;
          }
        }
      }

      // Calculate patch age
      if (patch.applied) {
        const appliedTime = new Date(patch.applied).getTime();
        const now = Date.now();
        const ageMs = now - appliedTime;
        enhanced.age = this.formatAge(ageMs);
      }

      return enhanced;
    });
  }

  /**
   * Group patches by function name
   */
  private groupByFunction(patches: any[]): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const patch of patches) {
      groups[patch.functionName] = (groups[patch.functionName] || 0) + 1;
    }
    return groups;
  }

  /**
   * Group patches by module
   */
  private groupByModule(patches: any[]): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const patch of patches) {
      const moduleKey = patch.scriptUrl || patch.moduleId;
      groups[moduleKey] = (groups[moduleKey] || 0) + 1;
    }
    return groups;
  }

  /**
   * Format age in human-readable format
   */
  private formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ago`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ago`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s ago`;
    } else {
      return `${seconds}s ago`;
    }
  }
}