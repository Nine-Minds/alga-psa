import { DebuggerTool, DebuggerToolError } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession, MCPInputSchema } from '../../types/mcp.js';

/**
 * Tool for reverting wrapped functions back to their original implementation
 */
export class RevertPatchTool extends DebuggerTool {
  readonly name = 'revertPatch';
  readonly description = 'Revert a previously applied function wrapper. Can revert by patch ID, function name, or revert all patches.';

  readonly inputSchema: MCPInputSchema = {
    type: 'object',
    properties: {
      patchId: {
        type: 'string',
        description: 'Specific patch ID to revert',
        optional: true,
      },
      functionName: {
        type: 'string',
        description: 'Revert all patches for this function name',
        optional: true,
      },
      revertAll: {
        type: 'boolean',
        description: 'Revert all active patches',
        optional: true,
        default: false,
      },
    },
    required: [],
  };

  async execute(
    session: DebugSession,
    args: {
      patchId?: string;
      functionName?: string;
      revertAll?: boolean;
    },
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      // Validate arguments
      await this.validateArgs(args);

      // Ensure we're connected
      this.requiresConnection(session);

      const { patchId, functionName, revertAll = false } = args;

      // Must provide at least one way to identify patches
      if (!patchId && !functionName && !revertAll) {
        throw new DebuggerToolError(
          'Must provide either patchId, functionName, or set revertAll to true',
          'INVALID_ARGUMENTS',
          this.name,
          session.id
        );
      }

      // Build the revert expression
      const revertExpression = this.buildRevertExpression({ patchId, functionName, revertAll });

      // Execute the revert
      const result = await session.inspectorClient.sendCommand('Runtime.evaluate', {
        expression: revertExpression,
        returnByValue: true,
        generatePreview: false,
      });

      if (result.exceptionDetails) {
        throw new DebuggerToolError(
          `Failed to revert patches: ${result.exceptionDetails.text || 'Unknown error'}`,
          'REVERT_FAILED',
          this.name,
          session.id
        );
      }

      const revertResult = result.result?.value;
      if (!revertResult || !revertResult.success) {
        throw new DebuggerToolError(
          revertResult?.error || 'Failed to revert patches',
          'REVERT_FAILED',
          this.name,
          session.id
        );
      }

      return this.createSuccessResponse({
        reverted: true,
        count: revertResult.count,
        patches: revertResult.patches,
        stats: revertResult.stats,
        message: revertResult.message,
      });

    } catch (error) {
      return this.handleError(error, 'Failed to revert patches', session.id);
    }
  }

  /**
   * Build the expression to revert patches
   */
  private buildRevertExpression(options: {
    patchId?: string;
    functionName?: string;
    revertAll?: boolean;
  }): string {
    const { patchId, functionName, revertAll } = options;

    return `(function() {
      try {
        // Check if patch manager exists
        if (!global.__patchManager || global.__patchManager.size === 0) {
          return {
            success: false,
            error: 'No patches found to revert',
            count: 0,
            stats: global.__patchStats || { total: 0, active: 0, reverted: 0 }
          };
        }

        const patchManager = global.__patchManager;
        const stats = global.__patchStats || { total: 0, active: 0, reverted: 0 };
        const revertedPatches = [];

        // Helper function to revert a single patch
        function revertPatch(id, patch) {
          try {
            // Find the module
            let module;
            if (patch.moduleType === 'webpack') {
              module = __webpack_require__.cache[patch.moduleId];
            } else if (patch.moduleType === 'commonjs') {
              module = require.cache[patch.moduleId];
            } else {
              module = { exports: global };
            }

            if (!module || !module.exports) {
              return { success: false, error: 'Module no longer exists' };
            }

            // Restore the original function
            module.exports[patch.functionName] = patch.original;

            // Remove from patch manager
            patchManager.delete(id);
            stats.active--;
            stats.reverted++;

            return { success: true };
          } catch (error) {
            return { success: false, error: error.message };
          }
        }

        // Determine which patches to revert
        const patchesToRevert = [];

        if (${revertAll}) {
          // Revert all patches
          for (const [id, patch] of patchManager.entries()) {
            patchesToRevert.push([id, patch]);
          }
        } else if ('${patchId}') {
          // Revert specific patch
          const patch = patchManager.get('${patchId}');
          if (patch) {
            patchesToRevert.push(['${patchId}', patch]);
          } else {
            return {
              success: false,
              error: 'Patch ID not found: ${patchId}',
              count: 0,
              stats
            };
          }
        } else if ('${functionName}') {
          // Revert all patches for a function
          for (const [id, patch] of patchManager.entries()) {
            if (patch.functionName === '${functionName}') {
              patchesToRevert.push([id, patch]);
            }
          }
        }

        // Revert the patches
        for (const [id, patch] of patchesToRevert) {
          const result = revertPatch(id, patch);
          revertedPatches.push({
            patchId: id,
            functionName: patch.functionName,
            moduleId: patch.moduleId,
            applied: patch.applied,
            reverted: new Date().toISOString(),
            success: result.success,
            error: result.error
          });
        }

        const successCount = revertedPatches.filter(p => p.success).length;
        const failedCount = revertedPatches.filter(p => !p.success).length;

        let message;
        if (${revertAll}) {
          message = \`Reverted \${successCount} patches\${failedCount > 0 ? \`, \${failedCount} failed\` : ''}\`;
        } else if ('${patchId}') {
          message = successCount > 0 ? 'Successfully reverted patch' : 'Failed to revert patch';
        } else {
          message = \`Reverted \${successCount} patches for function '${functionName}'\${failedCount > 0 ? \`, \${failedCount} failed\` : ''}\`;
        }

        return {
          success: true,
          count: successCount,
          patches: revertedPatches,
          stats,
          message
        };

      } catch (error) {
        return {
          success: false,
          error: error.message,
          count: 0,
          stats: global.__patchStats || { total: 0, active: 0, reverted: 0 }
        };
      }
    })()`;
  }
}