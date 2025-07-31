import { DebuggerTool, DebuggerToolError } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession, MCPInputSchema } from '../../types/mcp.js';

/**
 * Hot patch tool for replacing script source code on the fly
 * Provides live code replacement with basic validation
 */
export class HotPatchTool extends DebuggerTool {
  readonly name = 'hotPatch';
  readonly description = 'Replace script source code on the fly with new code. Allows live debugging and fixing of issues without restart.';

  readonly inputSchema: MCPInputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Script ID to patch (from listScripts)',
        optional: true,
      },
      url: {
        type: 'string',
        description: 'Script URL to patch (alternative to scriptId)',
        optional: true,
      },
      newSource: {
        type: 'string',
        description: 'New source code to replace the existing script',
        minLength: 1,
      },
      dryRun: {
        type: 'boolean',
        description: 'If true, only validate the new source without applying the patch',
        optional: true,
        default: false,
      },
      skipSyntaxCheck: {
        type: 'boolean',
        description: 'Skip JavaScript syntax validation (use with caution)',
        optional: true,
        default: false,
      },
    },
    required: ['newSource'],
  };

  async execute(
    session: DebugSession,
    args: {
      scriptId?: string;
      url?: string;
      newSource: string;
      dryRun?: boolean;
      skipSyntaxCheck?: boolean;
    },
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      // Validate arguments
      await this.validateArgs(args);

      // Ensure we're connected to the inspector
      this.requiresConnection(session);

      const { scriptId: providedScriptId, url, newSource, dryRun = false, skipSyntaxCheck = false } = args;

      // Validate that either scriptId or url is provided
      if (!providedScriptId && !url) {
        throw new DebuggerToolError(
          'Either scriptId or url must be provided',
          'INVALID_ARGUMENTS',
          this.name,
          session.id
        );
      }

      // If URL is provided, find the scriptId
      let scriptId = providedScriptId;
      if (!scriptId && url) {
        scriptId = await this.findScriptIdByUrl(session, url);
        if (!scriptId) {
          throw new DebuggerToolError(
            `Script with URL '${url}' not found. Use listScripts to see available scripts.`,
            'SCRIPT_NOT_FOUND',
            this.name,
            session.id
          );
        }
      }

      // Ensure debugger is enabled before hot patching
      await this.ensureDebuggerEnabled(session);
      
      // Step 1: Get current script info
      const currentScript = await this.getCurrentScriptInfo(session, scriptId);
      if (!currentScript) {
        throw new DebuggerToolError(
          `Script with ID '${scriptId}' not found. Use listScripts to get available scripts.`,
          'SCRIPT_NOT_FOUND',
          this.name,
          session.id
        );
      }

      // Step 2: Validate new source code syntax (unless skipped)
      if (!skipSyntaxCheck) {
        const syntaxValidation = await this.validateSyntax(newSource);
        if (!syntaxValidation.valid) {
          return this.createErrorResponse(
            `Syntax error in new source: ${syntaxValidation.error}`,
            'SYNTAX_ERROR',
            {
              scriptId,
              syntaxError: syntaxValidation.error,
              lineNumber: syntaxValidation.lineNumber,
              columnNumber: syntaxValidation.columnNumber,
              originalUrl: currentScript.url,
            }
          );
        }
      }

      // Step 3: If dry run, return validation results without applying
      if (dryRun) {
        return this.createSuccessResponse({
          valid: true,
          scriptId,
          originalUrl: currentScript.url,
          originalLength: currentScript.source?.length || 0,
          newLength: newSource.length,
          syntaxChecked: !skipSyntaxCheck,
          message: 'Source code validation passed. Ready for hot patching.',
        });
      }

      // Step 4: Apply the hot patch
      const patchResult = await this.applyHotPatch(session, scriptId, newSource, currentScript);

      // Step 5: Update session script cache
      session.scripts.set(scriptId, {
        ...currentScript,
        source: newSource,
        cachedAt: new Date(),
      });

      return this.createSuccessResponse({
        patched: true,
        scriptId,
        url: currentScript.url,
        originalLength: currentScript.source?.length || 0,
        newLength: newSource.length,
        changesSaved: patchResult.changesSaved,
        restartRequired: patchResult.restartRequired,
        warnings: patchResult.warnings,
        message: 'Hot patch applied successfully',
      });

    } catch (error) {
      return this.handleError(error, `Failed to apply hot patch for script ${args.scriptId}`, session.id);
    }
  }

  /**
   * Get current script information
   */
  private async getCurrentScriptInfo(session: DebugSession, scriptId: string): Promise<any> {
    try {
      // Try to get from cache first
      const cachedScript = session.scripts.get(scriptId);
      if (cachedScript && cachedScript.source) {
        return cachedScript;
      }

      // Get script source from inspector
      const result = await session.inspectorClient.sendCommand('Debugger.getScriptSource', {
        scriptId,
      });

      // Get script parsed info if available
      let scriptInfo = cachedScript;
      if (!scriptInfo) {
        // Try to find in scriptParsed events cache
        const scripts = session.scriptCache || new Map();
        for (const [key, script] of scripts) {
          if (script.scriptId === scriptId) {
            scriptInfo = script;
            break;
          }
        }
      }

      return {
        scriptId,
        source: result.scriptSource,
        url: scriptInfo?.url || `script-${scriptId}`,
        isModule: scriptInfo?.isModule || false,
        executionContextId: scriptInfo?.executionContextId || 1,
      };

    } catch (error) {
      throw new DebuggerToolError(
        `Failed to get script info for ID '${scriptId}': ${error instanceof Error ? error.message : String(error)}`,
        'SCRIPT_ACCESS_ERROR',
        this.name,
        session.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Find script ID by URL
   */
  private async findScriptIdByUrl(session: DebugSession, url: string): Promise<string | null> {
    // Check script cache first
    if (session.scriptCache) {
      for (const [scriptId, script] of session.scriptCache) {
        if (script.url === url) {
          return scriptId;
        }
      }
    }

    // If not in cache, try to get it from the debugger
    // This is a fallback mechanism
    try {
      // Force script enumeration by evaluating something
      await session.inspectorClient.sendCommand('Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
      });

      // Check cache again after evaluation
      if (session.scriptCache) {
        for (const [scriptId, script] of session.scriptCache) {
          if (script.url === url) {
            return scriptId;
          }
        }
      }
    } catch (error) {
      // Ignore errors in fallback mechanism
    }

    return null;
  }

  /**
   * Validate JavaScript syntax
   */
  private async validateSyntax(source: string): Promise<{
    valid: boolean;
    error?: string;
    lineNumber?: number;
    columnNumber?: number;
  }> {
    try {
      // Use eval in a try-catch to check syntax without executing
      // This is safe since we're not actually running the code
      new Function(source);
      return { valid: true };
    } catch (error) {
      const syntaxError = error as SyntaxError;
      
      // Try to extract line/column information from the error message
      let lineNumber: number | undefined;
      let columnNumber: number | undefined;
      
      const match = syntaxError.message.match(/\((\d+):(\d+)\)/);
      if (match) {
        lineNumber = parseInt(match[1], 10);
        columnNumber = parseInt(match[2], 10);
      }

      return {
        valid: false,
        error: syntaxError.message,
        lineNumber,
        columnNumber,
      };
    }
  }

  /**
   * Apply the hot patch using V8 Inspector Protocol
   */
  private async applyHotPatch(
    session: DebugSession,
    scriptId: string,
    newSource: string,
    currentScript: any
  ): Promise<{
    changesSaved: boolean;
    restartRequired: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    try {
      // Use Debugger.setScriptSource to replace the script
      const result = await session.inspectorClient.sendCommand('Debugger.setScriptSource', {
        scriptId,
        scriptSource: newSource,
      });

      // Check if changes were successfully applied
      let changesSaved = true;
      let restartRequired = false;

      // Handle different V8 responses
      if (result.status) {
        switch (result.status) {
          case 'Ok':
            changesSaved = true;
            break;
          case 'CompileError':
            throw new DebuggerToolError(
              `Compile error in hot patch: ${result.exceptionDetails?.text || 'Unknown compile error'}`,
              'COMPILE_ERROR',
              this.name,
              session.id
            );
          case 'BlockedByActiveGenerator':
            restartRequired = true;
            warnings.push('Hot patch blocked by active generator. Application restart may be required.');
            break;
          case 'BlockedByActiveFunction':
            restartRequired = true;
            warnings.push('Hot patch blocked by active function execution. Application restart may be required.');
            break;
          default:
            warnings.push(`Unknown status from V8: ${result.status}`);
        }
      }

      // Check for call frame changes
      if (result.callFrameChanges && result.callFrameChanges.length > 0) {
        warnings.push(`${result.callFrameChanges.length} call frames may need to be updated`);
      }

      // Check if async stack trace was updated
      if (result.asyncStackTrace) {
        warnings.push('Async stack traces have been updated');
      }

      return {
        changesSaved,
        restartRequired,
        warnings,
      };

    } catch (error) {
      // Handle specific V8 errors
      if (error instanceof Error) {
        if (error.message.includes('Cannot set source')) {
          throw new DebuggerToolError(
            'Cannot set source for this script type. Native modules and some system scripts cannot be hot patched.',
            'UNSUPPORTED_SCRIPT_TYPE',
            this.name,
            session.id,
            error
          );
        }
        
        if (error.message.includes('Compilation failed')) {
          throw new DebuggerToolError(
            `Source compilation failed: ${error.message}`,
            'COMPILATION_FAILED',
            this.name,
            session.id,
            error
          );
        }
      }

      throw error;
    }
  }
}