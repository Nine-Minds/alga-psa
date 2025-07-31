import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * Tool to step out of the current function
 * Continues execution until the current function returns
 */
export class StepOutTool extends DebuggerTool {
  readonly name = 'stepOut';
  readonly description = 'Step out of the current function. Execution continues until the current function returns, then pauses at the calling location.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      // No parameters needed for basic step out
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
      this.requiresPausedState(session);

      // Store the current location and stack before stepping
      const beforeLocation = session.currentLocation ? {
        url: session.currentLocation.url,
        lineNumber: session.currentLocation.lineNumber + 1, // Convert to 1-based
        columnNumber: session.currentLocation.columnNumber,
        functionName: session.callFrames?.[0]?.functionName || '(anonymous)',
      } : null;

      const beforeCallFrames = session.callFrames || [];
      const beforeStackDepth = beforeCallFrames.length;

      // Check if we're at the top level (cannot step out)
      if (beforeStackDepth <= 1) {
        return this.createErrorResponse(
          'Cannot step out - already at top level of execution',
          'AT_TOP_LEVEL'
        );
      }

      // Get information about the function we're stepping out of
      const currentFunction = beforeCallFrames[0];
      const callingFunction = beforeCallFrames[1];

      // Execute the step out command
      try {
        await session.inspectorClient.sendCommand('Debugger.stepOut');
      } catch (error) {
        return this.createErrorResponse(
          `Failed to step out: ${error instanceof Error ? error.message : String(error)}`,
          'STEP_FAILED'
        );
      }

      // Wait for the debugger to pause again
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          session.inspectorClient.off('debuggerPaused', pauseHandler);
          
          // If we don't get a pause event, execution might have resumed
          session.isPaused = false;
          session.pauseReason = undefined;
          session.currentLocation = undefined;
          session.callFrames = [];
          
          resolve(this.createSuccessResponse({
            stepped: true,
            resumed: true,
            beforeLocation,
            beforeFunction: currentFunction?.functionName || '(anonymous)',
            afterLocation: null,
            message: 'Step out completed - execution has resumed',
            instructions: [
              'The step out operation completed but execution has resumed',
              'This usually means the program finished or exited all functions',
              'Use setBreakpointAndWait to pause execution again',
            ],
          }, {
            stepTime: new Date().toISOString(),
            resultType: 'resumed',
          }));
        }, 10000); // Longer timeout for step out (functions might be long)

        const pauseHandler = (params: any) => {
          clearTimeout(timeout);
          session.inspectorClient.off('debuggerPaused', pauseHandler);

          // Update session state
          session.isPaused = true;
          session.pauseReason = params.reason || 'step';
          session.currentLocation = params.callFrames?.[0]?.location;
          session.callFrames = params.callFrames || [];
          session.lastActivity = new Date();

          // Get the new location
          const afterLocation = session.currentLocation ? {
            url: session.currentLocation.url,
            lineNumber: session.currentLocation.lineNumber + 1, // Convert to 1-based
            columnNumber: session.currentLocation.columnNumber,
            functionName: params.callFrames?.[0]?.functionName || '(anonymous)',
          } : null;

          // Analyze the step result
          const afterStackDepth = params.callFrames?.length || 0;
          const stackReduced = afterStackDepth < beforeStackDepth;
          const returnedToFunction = callingFunction && afterLocation &&
            afterLocation.functionName === callingFunction.functionName;

          // Check if we actually stepped out successfully
          const steppedOut = stackReduced || afterStackDepth < beforeStackDepth;

          resolve(this.createSuccessResponse({
            stepped: true,
            paused: true,
            beforeLocation,
            beforeFunction: currentFunction?.functionName || '(anonymous)',
            afterLocation,
            afterFunction: afterLocation?.functionName || '(anonymous)',
            steppedOut,
            stackDepthChange: afterStackDepth - beforeStackDepth,
            returnedToFunction,
            callFrames: params.callFrames,
            scopes: params.callFrames?.[0]?.scopeChain?.map((scope: any) => ({
              type: scope.type,
              name: scope.name,
              objectId: scope.object.objectId,
            })) || [],
            message: steppedOut
              ? `Stepped out of '${currentFunction?.functionName || '(anonymous)'}' to ${afterLocation?.url}:${afterLocation?.lineNumber}`
              : afterLocation
                ? `Stepped to ${afterLocation.url}:${afterLocation.lineNumber}`
                : 'Step completed',
            instructions: [
              steppedOut ? 'Successfully stepped out of function' : 'Step out completed',
              'Use evaluateExpression to inspect variables at the new location',
              'Use stepOver/stepInto/stepOut to continue stepping',
              'Use resumeExecution to continue normal execution',
            ],
          }, {
            stepTime: new Date().toISOString(),
            resultType: 'paused',
            pauseReason: params.reason,
            functionExited: currentFunction?.functionName || '(anonymous)',
          }));
        };

        session.inspectorClient.on('debuggerPaused', pauseHandler);
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to step out',
        session.id
      );
    }
  }

  /**
   * Static helper to check if step out is possible
   */
  static canStepOut(session: DebugSession): { canStepOut: boolean; reason?: string } {
    if (!session.inspectorClient.isConnected()) {
      return { canStepOut: false, reason: 'Not connected to inspector' };
    }

    if (!session.isPaused) {
      return { canStepOut: false, reason: 'Debugger is not paused' };
    }

    const stackDepth = session.callFrames?.length || 0;
    if (stackDepth <= 1) {
      return { canStepOut: false, reason: 'Already at top level - no function to step out of' };
    }

    return { canStepOut: true };
  }

  /**
   * Static helper to get current function info
   */
  static getCurrentFunctionInfo(session: DebugSession): {
    functionName: string;
    canStepOut: boolean;
    callingFunction?: string;
    stackDepth: number;
  } {
    const callFrames = session.callFrames || [];
    const stackDepth = callFrames.length;
    
    return {
      functionName: callFrames[0]?.functionName || '(anonymous)',
      canStepOut: stackDepth > 1,
      callingFunction: callFrames[1]?.functionName || undefined,
      stackDepth,
    };
  }
}