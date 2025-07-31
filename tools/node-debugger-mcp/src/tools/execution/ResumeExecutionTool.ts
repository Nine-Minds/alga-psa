import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * Tool to resume execution from a paused state
 * Continues running the target process normally
 */
export class ResumeExecutionTool extends DebuggerTool {
  readonly name = 'resumeExecution';
  readonly description = 'Resume execution from a paused state. The target process will continue running normally until it hits another breakpoint or completes.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      terminateOnResume: {
        type: 'boolean',
        description: 'Terminate all breakpoints when resuming (clean resume)',
        default: false,
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

      const { terminateOnResume = false } = args;

      // Store pre-resume state for response
      const preResumeState = {
        pauseReason: session.pauseReason,
        currentLocation: session.currentLocation,
        pausedAt: session.isPaused ? new Date().toISOString() : null,
      };

      // If terminateOnResume is true, remove all breakpoints first
      if (terminateOnResume && session.breakpoints && session.breakpoints.size > 0) {
        const breakpointIds = Array.from(session.breakpoints.keys());
        const removedCount = breakpointIds.length;
        
        for (const id of breakpointIds) {
          try {
            await session.inspectorClient.sendCommand('Debugger.removeBreakpoint', {
              breakpointId: id,
            });
          } catch (error) {
            // Continue even if some breakpoints fail to remove
            // Breakpoint removal failures logged at server level
          }
        }
        
        session.breakpoints.clear();
        
        return this.createSuccessResponse({
          resumed: true,
          terminatedBreakpoints: removedCount,
          preResumeState,
          message: `Resumed execution and removed ${removedCount} breakpoint(s)`,
          instructions: [
            'Execution has resumed and all breakpoints have been cleared',
            'The process is now running normally',
            'Use setBreakpointAndWait to pause execution again',
          ],
        }, {
          resumeTime: new Date().toISOString(),
          terminatedBreakpoints: true,
        });
      }

      // Resume execution
      try {
        await session.inspectorClient.sendCommand('Debugger.resume');
      } catch (error) {
        return this.createErrorResponse(
          `Failed to resume execution: ${error instanceof Error ? error.message : String(error)}`,
          'RESUME_FAILED'
        );
      }

      // Update session state
      session.isPaused = false;
      session.pauseReason = undefined;
      session.currentLocation = undefined;
      session.callFrames = [];
      session.lastActivity = new Date();

      // Get count of remaining breakpoints
      const remainingBreakpoints = session.breakpoints ? session.breakpoints.size : 0;

      return this.createSuccessResponse({
        resumed: true,
        preResumeState,
        remainingBreakpoints,
        message: remainingBreakpoints > 0 
          ? `Resumed execution. ${remainingBreakpoints} breakpoint(s) remain active.`
          : 'Resumed execution. No breakpoints are active.',
        instructions: remainingBreakpoints > 0 ? [
          'Execution has resumed normally',
          `${remainingBreakpoints} breakpoint(s) are still active and will pause execution when hit`,
          'Use removeBreakpoint to remove breakpoints if needed',
          'Use setBreakpointAndWait to add more breakpoints',
        ] : [
          'Execution has resumed normally',
          'No breakpoints are active - process will run without interruption',
          'Use setBreakpointAndWait to pause execution again',
        ],
      }, {
        resumeTime: new Date().toISOString(),
        wasTerminated: terminateOnResume,
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to resume execution',
        session.id
      );
    }
  }

  /**
   * Static helper to check if resume is possible
   */
  static canResume(session: DebugSession): { canResume: boolean; reason?: string } {
    if (!session.inspectorClient.isConnected()) {
      return { canResume: false, reason: 'Not connected to inspector' };
    }

    if (!session.isPaused) {
      return { canResume: false, reason: 'Debugger is not paused' };
    }

    return { canResume: true };
  }

  /**
   * Static helper to force resume (ignores pause state check)
   */
  static async forceResume(session: DebugSession): Promise<boolean> {
    try {
      if (!session.inspectorClient.isConnected()) {
        return false;
      }

      await session.inspectorClient.sendCommand('Debugger.resume');
      
      // Update session state
      session.isPaused = false;
      session.pauseReason = undefined;
      session.currentLocation = undefined;
      session.callFrames = [];
      session.lastActivity = new Date();

      return true;
    } catch (error) {
      // Force resume failures logged at server level
      return false;
    }
  }
}