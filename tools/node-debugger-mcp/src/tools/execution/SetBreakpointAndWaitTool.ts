import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * The core debugging tool that combines setting a breakpoint and waiting for it to be hit
 * This is the simplified pattern that makes debugging easier for LLMs
 */
export class SetBreakpointAndWaitTool extends DebuggerTool {
  readonly name = 'setBreakpointAndWait';
  readonly description = 'Set a breakpoint at a specific location and wait for it to be hit. This is the primary debugging operation that pauses execution for inspection.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Script URL or file path where to set the breakpoint',
      },
      lineNumber: {
        type: 'number',
        description: 'Line number for the breakpoint (1-based)',
        minimum: 1,
      },
      columnNumber: {
        type: 'number',
        description: 'Optional column number for the breakpoint (0-based)',
        minimum: 0,
        optional: true,
      },
      condition: {
        type: 'string',
        description: 'Optional JavaScript expression that must be true for breakpoint to pause execution',
        optional: true,
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait for breakpoint to be hit (milliseconds)',
        default: 30000,
        minimum: 1000,
        maximum: 300000,
        optional: true,
      },
      logMessage: {
        type: 'string',
        description: 'Optional message to log when breakpoint is hit (for logpoints)',
        optional: true,
      },
    },
    required: ['url', 'lineNumber'],
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
        url,
        lineNumber,
        columnNumber,
        condition,
        timeout = 30000,
        logMessage,
      } = args;

      // Validate that we're not already paused
      if (session.isPaused) {
        return this.createErrorResponse(
          'Debugger is already paused. Use resumeExecution first, or use stepping commands.',
          'ALREADY_PAUSED'
        );
      }

      // Step 1: Set the breakpoint
      let setResult;
      try {
        const breakpointParams: any = {
          url,
          lineNumber: lineNumber - 1, // Convert to 0-based for V8
        };

        if (columnNumber !== undefined) {
          breakpointParams.columnNumber = columnNumber;
        }

        if (condition) {
          breakpointParams.condition = condition;
        }

        setResult = await session.inspectorClient.sendCommand(
          'Debugger.setBreakpointByUrl',
          breakpointParams
        );

      } catch (error) {
        return this.createErrorResponse(
          `Failed to set breakpoint: ${error instanceof Error ? error.message : String(error)}`,
          'BREAKPOINT_SET_FAILED'
        );
      }

      const breakpointId = setResult.breakpointId;
      const actualLocations = setResult.locations || [];

      // Store breakpoint in session
      if (!session.breakpoints) {
        session.breakpoints = new Map();
      }

      session.breakpoints.set(breakpointId, {
        id: breakpointId,
        url,
        lineNumber,
        columnNumber,
        condition,
        logMessage,
        actualLocations,
        createdAt: new Date(),
      });

      // Step 2: Set up the wait mechanism
      return new Promise((resolve) => {
        const startTime = Date.now();
        
        const cleanup = () => {
          session.inspectorClient.off('debuggerPaused', pauseHandler);
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        };

        const timeoutHandle = setTimeout(() => {
          cleanup();
          
          // Breakpoint was set but never hit
          resolve(this.createSuccessResponse({
            breakpointSet: true,
            breakpointId,
            actualLocations,
            hit: false,
            paused: false,
            reason: 'timeout',
            waitTime: Date.now() - startTime,
            message: `Breakpoint set at ${url}:${lineNumber} but not hit within ${timeout}ms`,
            instructions: [
              'The breakpoint is still active and will pause execution when hit',
              'Use removeBreakpoint to remove it, or trigger the code path that should hit it',
              'Use listScripts to verify the URL is correct',
            ],
          }, {
            breakpointId,
            timeoutReached: true,
          }));
        }, timeout);

        const pauseHandler = (params: any) => {
          // Check if this pause event is for our breakpoint
          const hitBreakpoints = params.hitBreakpoints || [];
          
          if (!hitBreakpoints.includes(breakpointId)) {
            // Different breakpoint, keep waiting
            return;
          }

          cleanup();

          // Update session state
          session.isPaused = true;
          session.pauseReason = params.reason || 'breakpoint';
          session.currentLocation = params.callFrames?.[0]?.location;
          session.callFrames = params.callFrames || [];
          session.lastActivity = new Date();

          // Handle logpoint if specified
          if (logMessage) {
            // For logpoints, we typically resume automatically after logging
            // But for our simplified model, we'll include the log in the response
            // and let the user decide whether to resume
          }

          // Prepare call frame information
          const currentFrame = params.callFrames?.[0];
          const location = currentFrame ? {
            url: currentFrame.url,
            lineNumber: currentFrame.location.lineNumber + 1, // Convert back to 1-based
            columnNumber: currentFrame.location.columnNumber,
            functionName: currentFrame.functionName || '(anonymous)',
          } : null;

          // Prepare scope information
          const scopes = currentFrame?.scopeChain?.map((scope: any) => ({
            type: scope.type,
            name: scope.name,
            objectId: scope.object.objectId,
          })) || [];

          resolve(this.createSuccessResponse({
            breakpointSet: true,
            breakpointId,
            actualLocations,
            hit: true,
            paused: true,
            reason: params.reason || 'breakpoint',
            waitTime: Date.now() - startTime,
            location,
            callFrames: params.callFrames,
            scopes,
            logMessage: logMessage ? `Logpoint: ${logMessage}` : undefined,
            message: `Breakpoint hit at ${location?.url}:${location?.lineNumber}`,
            instructions: [
              'Debugger is now paused and ready for inspection',
              'Use evaluateExpression to inspect variables',
              'Use getStackTrace to see the full call stack', 
              'Use stepOver/stepInto/stepOut to step through code',
              'Use resumeExecution to continue running',
            ],
          }, {
            breakpointId,
            pausedAt: new Date().toISOString(),
            hitLocation: location,
          }));
        };

        // Listen for debugger pause events
        session.inspectorClient.on('debuggerPaused', pauseHandler);
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to set breakpoint and wait',
        session.id
      );
    }
  }

  /**
   * Helper method to validate breakpoint location
   */
  private async validateBreakpointLocation(
    session: DebugSession,
    url: string,
    lineNumber: number
  ): Promise<{ valid: boolean; suggestion?: string }> {
    try {
      // Check if we have script information
      if (session.scriptCache) {
        for (const script of session.scriptCache.values()) {
          if (script.url === url || script.url.endsWith(url)) {
            // Found the script, check line bounds
            if (lineNumber > script.endLine) {
              return {
                valid: false,
                suggestion: `Line ${lineNumber} exceeds script length (${script.endLine} lines). Use getScriptSource to see the code.`,
              };
            }
            return { valid: true };
          }
        }
        
        return {
          valid: false,
          suggestion: `Script '${url}' not found. Use listScripts to see available scripts.`,
        };
      }

      // If no script cache, assume valid (breakpoint will fail if invalid)
      return { valid: true };

    } catch (error) {
      // If validation fails, proceed anyway
      return { valid: true };
    }
  }

  /**
   * Static helper to check if a breakpoint can be set
   */
  static async canSetBreakpoint(
    session: DebugSession,
    url: string,
    lineNumber: number
  ): Promise<{ canSet: boolean; reason?: string }> {
    if (!session.inspectorClient.isConnected()) {
      return { canSet: false, reason: 'Not connected to inspector' };
    }

    if (session.isPaused) {
      return { canSet: false, reason: 'Debugger is already paused' };
    }

    // Additional validation could be added here
    return { canSet: true };
  }

  /**
   * Static helper to find good breakpoint locations in a script
   */
  static async suggestBreakpointLocations(
    session: DebugSession,
    url: string,
    startLine?: number,
    endLine?: number
  ): Promise<number[]> {
    try {
      // This would require analyzing the script source to find executable lines
      // For now, return empty array - this is an advanced feature
      return [];
    } catch (error) {
      return [];
    }
  }
}