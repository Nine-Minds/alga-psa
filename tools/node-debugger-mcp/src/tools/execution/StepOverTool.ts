import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * Tool to step over the current line of code
 * Executes the current line and pauses at the next line in the same function
 */
export class StepOverTool extends DebuggerTool {
  readonly name = 'stepOver';
  readonly description = 'Step over the current line of code. If the line contains a function call, the entire function executes and pauses at the next line.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      // No parameters needed for basic step over
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

      // Store the current location before stepping
      const beforeLocation = session.currentLocation ? {
        url: session.currentLocation.url,
        lineNumber: session.currentLocation.lineNumber + 1, // Convert to 1-based
        columnNumber: session.currentLocation.columnNumber,
      } : null;

      const beforeCallFrames = session.callFrames || [];

      // Execute the step over command
      try {
        await session.inspectorClient.sendCommand('Debugger.stepOver');
      } catch (error) {
        return this.createErrorResponse(
          `Failed to step over: ${error instanceof Error ? error.message : String(error)}`,
          'STEP_FAILED'
        );
      }

      // Wait for the debugger to pause again (stepping should cause immediate pause)
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          session.inspectorClient.off('debuggerPaused', pauseHandler);
          
          // If we don't get a pause event, the step might have resumed execution
          session.isPaused = false;
          session.pauseReason = undefined;
          session.currentLocation = undefined;
          session.callFrames = [];
          
          resolve(this.createSuccessResponse({
            stepped: true,
            resumed: true,
            beforeLocation,
            afterLocation: null,
            message: 'Step over completed - execution has resumed (no more breakable lines)',
            instructions: [
              'The step over operation completed but execution has resumed',
              'This usually means the program finished or hit an async boundary',
              'Use setBreakpointAndWait to pause execution again',
            ],
          }, {
            stepTime: new Date().toISOString(),
            resultType: 'resumed',
          }));
        }, 5000); // 5 second timeout for step operations

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
          const sameFile = beforeLocation && afterLocation && 
            beforeLocation.url === afterLocation.url;
          const lineChanged = beforeLocation && afterLocation && 
            beforeLocation.lineNumber !== afterLocation.lineNumber;

          resolve(this.createSuccessResponse({
            stepped: true,
            paused: true,
            beforeLocation,
            afterLocation,
            sameFile,
            lineChanged,
            callFrames: params.callFrames,
            scopes: params.callFrames?.[0]?.scopeChain?.map((scope: any) => ({
              type: scope.type,
              name: scope.name,
              objectId: scope.object.objectId,
            })) || [],
            message: afterLocation 
              ? `Stepped to ${afterLocation.url}:${afterLocation.lineNumber}`
              : 'Step completed',
            instructions: [
              'Step over completed successfully',
              'Use evaluateExpression to inspect variables at the new location',
              'Use stepOver/stepInto/stepOut to continue stepping',
              'Use resumeExecution to continue normal execution',
            ],
          }, {
            stepTime: new Date().toISOString(),
            resultType: 'paused',
            pauseReason: params.reason,
          }));
        };

        session.inspectorClient.on('debuggerPaused', pauseHandler);
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to step over',
        session.id
      );
    }
  }
}