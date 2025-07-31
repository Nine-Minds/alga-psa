import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * Tool to remove previously set breakpoints
 * Supports removing individual or all breakpoints
 */
export class RemoveBreakpointTool extends DebuggerTool {
  readonly name = 'removeBreakpoint';
  readonly description = 'Remove a previously set breakpoint by ID, or remove all breakpoints';

  readonly inputSchema = {
    type: 'object',
    properties: {
      breakpointId: {
        type: 'string',
        description: 'ID of the breakpoint to remove (from setBreakpointAndWait response)',
        optional: true,
      },
      removeAll: {
        type: 'boolean',
        description: 'Remove all breakpoints instead of a specific one',
        default: false,
        optional: true,
      },
      url: {
        type: 'string',
        description: 'Remove all breakpoints for a specific URL/file',
        optional: true,
      },
      lineNumber: {
        type: 'number',
        description: 'Remove breakpoint at specific line (requires url)',
        minimum: 1,
        optional: true,
      },
    },
    additionalProperties: false,
  };

  async execute(
    session: DebugSession,
    args: any,
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      await this.validateArgs(args);
      this.requiresConnection(session);

      const { breakpointId, removeAll = false, url, lineNumber } = args;

      // Validate arguments
      if (!removeAll && !breakpointId && !url) {
        return this.createErrorResponse(
          'Must specify breakpointId, url, or set removeAll to true',
          'MISSING_IDENTIFIER'
        );
      }

      if (lineNumber && !url) {
        return this.createErrorResponse(
          'lineNumber requires url to be specified',
          'INVALID_ARGUMENTS'
        );
      }

      // Initialize breakpoints map if it doesn't exist
      if (!session.breakpoints) {
        session.breakpoints = new Map();
      }

      const removedBreakpoints: any[] = [];
      const errors: string[] = [];

      if (removeAll) {
        // Remove all breakpoints
        for (const [id, breakpoint] of session.breakpoints.entries()) {
          try {
            await session.inspectorClient.sendCommand('Debugger.removeBreakpoint', {
              breakpointId: id,
            });
            
            removedBreakpoints.push({
              id,
              url: breakpoint.url,
              lineNumber: breakpoint.lineNumber,
            });
            
            session.breakpoints.delete(id);
          } catch (error) {
            errors.push(`Failed to remove breakpoint ${id}: ${error}`);
          }
        }

      } else if (breakpointId) {
        // Remove specific breakpoint by ID
        const breakpoint = session.breakpoints.get(breakpointId);
        if (!breakpoint) {
          return this.createErrorResponse(
            `Breakpoint with ID '${breakpointId}' not found`,
            'BREAKPOINT_NOT_FOUND'
          );
        }

        try {
          await session.inspectorClient.sendCommand('Debugger.removeBreakpoint', {
            breakpointId,
          });
          
          removedBreakpoints.push({
            id: breakpointId,
            url: breakpoint.url,
            lineNumber: breakpoint.lineNumber,
          });
          
          session.breakpoints.delete(breakpointId);
        } catch (error) {
          return this.createErrorResponse(
            `Failed to remove breakpoint: ${error instanceof Error ? error.message : String(error)}`,
            'REMOVAL_FAILED'
          );
        }

      } else if (url) {
        // Remove breakpoints by URL and optionally line number
        const matchingBreakpoints = Array.from(session.breakpoints.entries()).filter(
          ([id, breakpoint]) => {
            const urlMatches = breakpoint.url === url || breakpoint.url.endsWith(url);
            const lineMatches = !lineNumber || breakpoint.lineNumber === lineNumber;
            return urlMatches && lineMatches;
          }
        );

        if (matchingBreakpoints.length === 0) {
          const location = lineNumber ? `${url}:${lineNumber}` : url;
          return this.createErrorResponse(
            `No breakpoints found at '${location}'`,
            'NO_MATCHING_BREAKPOINTS'
          );
        }

        for (const [id, breakpoint] of matchingBreakpoints) {
          try {
            await session.inspectorClient.sendCommand('Debugger.removeBreakpoint', {
              breakpointId: id,
            });
            
            removedBreakpoints.push({
              id,
              url: breakpoint.url,
              lineNumber: breakpoint.lineNumber,
            });
            
            session.breakpoints.delete(id);
          } catch (error) {
            errors.push(`Failed to remove breakpoint ${id}: ${error}`);
          }
        }
      }

      // Update session activity
      session.lastActivity = new Date();

      // Prepare response
      const remainingBreakpoints = Array.from(session.breakpoints.values()).map(bp => ({
        id: bp.id,
        url: bp.url,
        lineNumber: bp.lineNumber,
        condition: bp.condition,
        hasCondition: !!bp.condition,
      }));

      const response = {
        removed: removedBreakpoints,
        remainingCount: remainingBreakpoints.length,
        remaining: remainingBreakpoints,
        errors: errors.length > 0 ? errors : undefined,
        summary: `Removed ${removedBreakpoints.length} breakpoint(s)`,
      };

      if (removedBreakpoints.length === 0 && errors.length > 0) {
        return this.createErrorResponse(
          `Failed to remove any breakpoints: ${errors.join('; ')}`,
          'REMOVAL_FAILED',
          response
        );
      }

      return this.createSuccessResponse(response, {
        removalTime: new Date().toISOString(),
        strategy: removeAll ? 'all' : breakpointId ? 'byId' : 'byLocation',
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to remove breakpoint',
        session.id
      );
    }
  }

  /**
   * Static helper to get all active breakpoints for a session
   */
  static getActiveBreakpoints(session: DebugSession): Array<{
    id: string;
    url: string;
    lineNumber: number;
    condition?: string;
    createdAt: Date;
  }> {
    if (!session.breakpoints) {
      return [];
    }

    return Array.from(session.breakpoints.values()).map(bp => ({
      id: bp.id,
      url: bp.url,
      lineNumber: bp.lineNumber,
      condition: bp.condition,
      createdAt: bp.createdAt,
    }));
  }

  /**
   * Static helper to check if a breakpoint exists at a location
   */
  static hasBreakpointAt(
    session: DebugSession,
    url: string,
    lineNumber: number
  ): boolean {
    if (!session.breakpoints) {
      return false;
    }

    for (const breakpoint of session.breakpoints.values()) {
      if ((breakpoint.url === url || breakpoint.url.endsWith(url)) && 
          breakpoint.lineNumber === lineNumber) {
        return true;
      }
    }

    return false;
  }

  /**
   * Static helper to clean up all breakpoints (used during session cleanup)
   */
  static async cleanupAllBreakpoints(session: DebugSession): Promise<void> {
    if (!session.breakpoints || session.breakpoints.size === 0) {
      return;
    }

    const breakpointIds = Array.from(session.breakpoints.keys());
    
    for (const id of breakpointIds) {
      try {
        await session.inspectorClient.sendCommand('Debugger.removeBreakpoint', {
          breakpointId: id,
        });
      } catch (error) {
        // Ignore errors during cleanup
        console.warn(`Failed to clean up breakpoint ${id}:`, error);
      }
    }

    session.breakpoints.clear();
  }
}