import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * Tool to step into function calls
 * If the current line contains a function call, steps into that function
 */
export class StepIntoTool extends DebuggerTool {
  readonly name = 'stepInto';
  readonly description = 'Step into function calls. If the current line contains a function call, execution pauses at the first line of that function.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      skipList: {
        type: 'array',
        items: { 
          type: 'string',
          description: 'URL pattern to skip'
        },
        description: 'Array of URL patterns to skip when stepping into (e.g., node_modules)',
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
      this.requiresPausedState(session);

      const { skipList = [] } = args;

      // Store the current location before stepping
      const beforeLocation = session.currentLocation ? {
        url: session.currentLocation.url,
        lineNumber: session.currentLocation.lineNumber + 1, // Convert to 1-based
        columnNumber: session.currentLocation.columnNumber,
        functionName: session.callFrames?.[0]?.functionName || '(anonymous)',
      } : null;

      const beforeCallFrames = session.callFrames || [];
      const beforeStackDepth = beforeCallFrames.length;

      // Set up skip patterns if provided
      if (skipList.length > 0) {
        try {
          await session.inspectorClient.sendCommand('Debugger.setSkipAllPauses', {
            skip: false, // We want to pause, but we'll implement skip logic
          });
        } catch (error) {
          // Skip list setting is optional
        }
      }

      // Execute the step into command
      try {
        await session.inspectorClient.sendCommand('Debugger.stepInto');
      } catch (error) {
        return this.createErrorResponse(
          `Failed to step into: ${error instanceof Error ? error.message : String(error)}`,
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
            afterLocation: null,
            enteredFunction: false,
            message: 'Step into completed - execution has resumed',
            instructions: [
              'The step into operation completed but execution has resumed',
              'This may mean there was no function to step into',
              'Use setBreakpointAndWait to pause execution again',
            ],
          }, {
            stepTime: new Date().toISOString(),
            resultType: 'resumed',
          }));
        }, 5000); // 5 second timeout

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
          const enteredFunction = afterStackDepth > beforeStackDepth;
          const sameFile = beforeLocation && afterLocation && 
            beforeLocation.url === afterLocation.url;
          const lineChanged = beforeLocation && afterLocation && 
            beforeLocation.lineNumber !== afterLocation.lineNumber;

          // Check if we should skip this location due to skip list
          let shouldSkip = false;
          if (skipList.length > 0 && afterLocation) {
            shouldSkip = skipList.some(pattern => {
              try {
                const regex = new RegExp(pattern, 'i');
                return regex.test(afterLocation.url);
              } catch {
                return afterLocation.url.includes(pattern);
              }
            });
          }

          // If we should skip, step over automatically
          if (shouldSkip) {
            // Recursively step over until we're out of skipped code
            this.continueSteppingUntilNotSkipped(session, skipList, resolve, afterLocation);
            return;
          }

          resolve(this.createSuccessResponse({
            stepped: true,
            paused: true,
            beforeLocation,
            afterLocation,
            enteredFunction,
            sameFile,
            lineChanged,
            stackDepthChange: afterStackDepth - beforeStackDepth,
            callFrames: params.callFrames,
            scopes: params.callFrames?.[0]?.scopeChain?.map((scope: any) => ({
              type: scope.type,
              name: scope.name,
              objectId: scope.object.objectId,
            })) || [],
            message: enteredFunction
              ? `Stepped into function '${afterLocation?.functionName}' at ${afterLocation?.url}:${afterLocation?.lineNumber}`
              : afterLocation
                ? `Stepped to ${afterLocation.url}:${afterLocation.lineNumber}`
                : 'Step completed',
            instructions: [
              enteredFunction ? 'Successfully stepped into a function call' : 'Step into completed',
              'Use evaluateExpression to inspect variables at the new location',
              'Use stepOver/stepInto/stepOut to continue stepping',
              'Use resumeExecution to continue normal execution',
            ],
          }, {
            stepTime: new Date().toISOString(),
            resultType: 'paused',
            pauseReason: params.reason,
            skippedFiles: skipList,
          }));
        };

        session.inspectorClient.on('debuggerPaused', pauseHandler);
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to step into',
        session.id
      );
    }
  }

  /**
   * Helper method to continue stepping when in skipped code
   */
  private async continueSteppingUntilNotSkipped(
    session: DebugSession,
    skipList: string[],
    resolve: Function,
    currentLocation: any,
    maxSkips = 10
  ): Promise<void> {
    if (maxSkips <= 0) {
      resolve(this.createSuccessResponse({
        stepped: true,
        paused: true,
        afterLocation: currentLocation,
        skippedTooMany: true,
        message: 'Reached maximum skip limit - stopped stepping',
        instructions: [
          'Stopped stepping due to skip limit',
          'You may be in deeply nested skipped code',
          'Use stepOut to exit the current function',
        ],
      }));
      return;
    }

    try {
      await session.inspectorClient.sendCommand('Debugger.stepOver');
      
      const timeout = setTimeout(() => {
        resolve(this.createSuccessResponse({
          stepped: true,
          resumed: true,
          message: 'Step operation timed out while skipping',
        }));
      }, 1000);

      const pauseHandler = (params: any) => {
        clearTimeout(timeout);
        session.inspectorClient.off('debuggerPaused', pauseHandler);

        const newLocation = params.callFrames?.[0]?.location;
        const afterLocation = newLocation ? {
          url: newLocation.url,
          lineNumber: newLocation.lineNumber + 1,
          columnNumber: newLocation.columnNumber,
          functionName: params.callFrames?.[0]?.functionName || '(anonymous)',
        } : null;

        // Check if we're still in skipped code
        let stillSkipped = false;
        if (skipList.length > 0 && afterLocation) {
          stillSkipped = skipList.some(pattern => {
            try {
              const regex = new RegExp(pattern, 'i');
              return regex.test(afterLocation.url);
            } catch {
              return afterLocation.url.includes(pattern);
            }
          });
        }

        if (stillSkipped) {
          // Continue skipping
          this.continueSteppingUntilNotSkipped(session, skipList, resolve, afterLocation, maxSkips - 1);
        } else {
          // We're out of skipped code, return success
          session.isPaused = true;
          session.pauseReason = params.reason || 'step';
          session.currentLocation = newLocation;
          session.callFrames = params.callFrames || [];
          
          resolve(this.createSuccessResponse({
            stepped: true,
            paused: true,
            afterLocation,
            skippedFiles: true,
            message: `Stepped out of skipped code to ${afterLocation?.url}:${afterLocation?.lineNumber}`,
            instructions: [
              'Successfully stepped out of skipped code',
              'Use evaluateExpression to inspect variables',
              'Continue stepping or resume execution',
            ],
          }));
        }
      };

      session.inspectorClient.on('debuggerPaused', pauseHandler);
    } catch (error) {
      resolve(this.createErrorResponse(
        `Failed to skip through code: ${error}`,
        'SKIP_FAILED'
      ));
    }
  }
}